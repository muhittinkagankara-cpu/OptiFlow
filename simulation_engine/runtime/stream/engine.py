"""Akış motoru — kaynakları, dağıtıcıyı ve alıcıları bir arada tutar.

Bu sınıf, akışın tek sahibidir: yoklayıcılar ve aboneler burada kurulur,
dağıtıcının alıcıları burada kaydedilir. Yönetici (`RuntimeManager`) yalnızca
"şu bağlantı için akışı başlat" der; hangi protokolün nasıl okunacağını
bilmez.

Alıcı sırası bir karardır
-------------------------
1. **Görüntü** — makinenin son durumu güncellenir ve diske yazılır.
2. **Yayın** — ölçüm SSE aboneleriyle paylaşılır.
3. **İzleme** — alarm, duruş, OEE ve KPI yeniden değerlendirilir.

Görüntü ilk sırada olmasaydı, alarm henüz güncellenmemiş bir görüntüyle
hesaplanır ve "makine durdu" alarmının yanında "çalışıyor" yazardı. Yayın
izlemeden önce gelir: tarayıcıda görüldüğü üzere ters sırada, alarm onu
doğuran ölçümden önce ekrana düşüyor ve ekran alarmın nedenini
gösteremiyordu.

İzleme neden her olayda değil
-----------------------------
Alarm ve OEE yeniden değerlendirmesi bütün makineleri tarar. Saniyede yüz olay
üreten bir hatta bunu her olayda yapmak, aynı sonucu yüz kez hesaplamak
olurdu. Bu yüzden değerlendirme **en fazla** `EVALUATION_INTERVAL_MS`'de bir
yapılır; arada gelen olaylar görüntüyü yine de günceller, yalnızca
değerlendirme birleştirilir.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.poller import RestPoller
from simulation_engine.runtime.stream.scheduler import (
    PollScheduler,
    StreamHealth,
    poll_rate_hz,
)
from simulation_engine.runtime.stream.subscriber import (
    MqttSubscriber,
    OpcUaSubscriber,
)
from simulation_engine.runtime.stream.types import (
    DeviceDataEvent,
    SequenceCounter,
)

#: Alarm/OEE değerlendirmesinin en sık yapılabileceği aralık (ms).
#:
#: Yarım saniye, bir operatörün ekrandaki değişimi fark etme süresinden
#: kısadır; daha sık değerlendirmek görünür bir fayda sağlamaz.
EVALUATION_INTERVAL_MS = 500

#: Yayın (SSE) için saklanan son olaylar.
BROADCAST_BUFFER = 200


@dataclass
class StreamEngine:
    """Bir organizasyonun bütün cihaz akışlarını yürütür."""

    dispatcher: StreamDispatcher = field(default_factory=StreamDispatcher)
    sequences: SequenceCounter = field(default_factory=SequenceCounter)
    scheduler: PollScheduler = field(default_factory=PollScheduler)
    clock: Callable[[], int] = lambda: int(time.time() * 1000)

    #: Bağlantı kimliğine göre çalışan kaynaklar.
    pollers: Dict[str, RestPoller] = field(default_factory=dict)
    subscribers: Dict[str, Any] = field(default_factory=dict)

    #: Son yayılan olaylar (Payload Inspector ve SSE için).
    recent: List[DeviceDataEvent] = field(default_factory=list)

    #: İzleme değerlendirmesinin son yapıldığı an.
    last_evaluation_ms: Optional[int] = None
    evaluations: int = 0

    # -- Alıcılar -----------------------------------------------------------

    def register_snapshot_sink(self, handle: Callable[[Any], None]) -> None:
        """Görüntü güncellemesini bağlar.

        Ham `DeviceEvent` iletilir: görüntü boru hattı SALES-10'dan beri onunla
        çalışır ve akış katmanı için yeniden yazılmaz.
        """

        def sink(event: DeviceDataEvent) -> None:
            if event.device_event is not None:
                handle(event.device_event)

        self.dispatcher.register("snapshot", sink)

    def register_monitoring_sink(
        self, evaluate: Callable[[int], None]
    ) -> None:
        """Alarm/OEE/KPI değerlendirmesini bağlar (aralıkla sınırlı)."""

        def sink(event: DeviceDataEvent) -> None:
            now = self.clock()
            if (
                self.last_evaluation_ms is not None
                and now - self.last_evaluation_ms < EVALUATION_INTERVAL_MS
            ):
                return
            self.last_evaluation_ms = now
            self.evaluations += 1
            evaluate(now)

        self.dispatcher.register("monitoring", sink)

    def register_broadcast_sink(
        self, broadcast: Optional[Callable[[DeviceDataEvent], None]] = None
    ) -> None:
        """Yayını bağlar; son olaylar ayrıca tamponda tutulur."""

        def sink(event: DeviceDataEvent) -> None:
            self.recent.append(event)
            if len(self.recent) > BROADCAST_BUFFER:
                del self.recent[0 : len(self.recent) - BROADCAST_BUFFER]
            if broadcast is not None:
                broadcast(event)

        self.dispatcher.register("broadcast", sink)

    # -- Kaynaklar ----------------------------------------------------------

    def add_poller(self, poller: RestPoller) -> RestPoller:
        self.pollers[poller.connector_id] = poller
        return poller

    def add_subscriber(self, subscriber: Any) -> Any:
        self.subscribers[subscriber.connector_id] = subscriber
        return subscriber

    def remove(self, connector_id: str) -> bool:
        """Bir bağlantının akışını durdurur ve kaydını siler."""
        removed = False
        poller = self.pollers.pop(connector_id, None)
        if poller is not None:
            poller.stop()
            removed = True
        subscriber = self.subscribers.pop(connector_id, None)
        if subscriber is not None:
            subscriber.stop()
            removed = True
        self.scheduler.remove(connector_id)
        return removed

    def source_for(self, connector_id: str) -> Optional[Any]:
        return self.pollers.get(connector_id) or self.subscribers.get(connector_id)

    def is_running(self, connector_id: str) -> bool:
        source = self.source_for(connector_id)
        return bool(source is not None and source.running)

    # -- Durum --------------------------------------------------------------

    def states(self) -> List[Dict[str, object]]:
        """Her akışın durumu; Runtime panosu bunu okur."""
        return [
            *[poller.state() for poller in self.pollers.values()],
            *[item.state() for item in self.subscribers.values()],
        ]

    def health(self) -> StreamHealth:
        """Bütün akışların özet durumu.

        En kötü durum kazanır: bir akış hata alıyorsa özet "iyi" olamaz.
        """
        states = self.states()
        if not states:
            return StreamHealth.STOPPED
        values = {item["health"] for item in states}
        for candidate in (
            StreamHealth.BACKPRESSURE,
            StreamHealth.FAILING,
            StreamHealth.IDLE,
            StreamHealth.RUNNING,
        ):
            if candidate.value in values:
                return candidate
        return StreamHealth.STOPPED

    def average_poll_rate_hz(self) -> Optional[float]:
        """Yoklayıcıların ortalama sıklığı; yoklayıcı yoksa `None`.

        Sıfır dönmek, hiç REST bağlantısı olmayan bir kurulumu "hiç
        yoklanmıyor" diye raporlamak olurdu — oysa yoklanacak bir şey yoktur.
        """
        rates = [
            poll_rate_hz(entry.current_interval_ms)
            for entry in self.scheduler.entries.values()
        ]
        measured = [value for value in rates if value is not None]
        return sum(measured) / len(measured) if measured else None

    def stats(self) -> Dict[str, object]:
        """Runtime panosunun okuduğu akış özeti."""
        return {
            "streams": len(self.pollers) + len(self.subscribers),
            "running": len(
                [item for item in self.states() if item["running"] is True]
            ),
            "health": self.health().value,
            "poll_rate_hz": self.average_poll_rate_hz(),
            "schedule": self.scheduler.states(),
            "dispatcher": self.dispatcher.stats(),
        }

    def recent_events(self, limit: int = 50) -> List[Dict[str, object]]:
        """Son olaylar (yeniden eskiye); Payload Inspector bunu gösterir."""
        return [event.to_dict() for event in reversed(self.recent[-limit:])]

    def stop_all(self) -> int:
        """Bütün akışları durdurur; durdurulan sayısını döndürür."""
        count = 0
        for poller in list(self.pollers.values()):
            poller.stop()
            count += 1
        for subscriber in list(self.subscribers.values()):
            subscriber.stop()
            count += 1
        return count

    def clear(self) -> None:
        self.stop_all()
        self.pollers.clear()
        self.subscribers.clear()
        self.scheduler.clear()
        self.dispatcher.clear()
        self.recent.clear()
        self.last_evaluation_ms = None
        self.evaluations = 0


def build_poller(
    spec,
    fetch,
    engine: StreamEngine,
    mapping=None,
    interval_ms: Optional[int] = None,
) -> RestPoller:
    """Motorun zamanlayıcısını ve dağıtıcısını paylaşan bir yoklayıcı kurar."""
    poller = RestPoller(
        spec=spec,
        fetch=fetch,
        dispatcher=engine.dispatcher,
        sequences=engine.sequences,
        mapping=mapping,
        interval_ms=interval_ms,
        scheduler=engine.scheduler,
        clock=engine.clock,
    )
    return engine.add_poller(poller)


def build_opcua_subscriber(
    spec, source, engine: StreamEngine, mapping=None
) -> OpcUaSubscriber:
    subscriber = OpcUaSubscriber(
        spec=spec,
        dispatcher=engine.dispatcher,
        sequences=engine.sequences,
        mapping=mapping,
        clock=engine.clock,
        notifications_source=source,
    )
    return engine.add_subscriber(subscriber)


def build_mqtt_subscriber(
    spec, source, engine: StreamEngine, mapping=None
) -> MqttSubscriber:
    subscriber = MqttSubscriber(
        spec=spec,
        dispatcher=engine.dispatcher,
        sequences=engine.sequences,
        mapping=mapping,
        clock=engine.clock,
        messages_source=source,
    )
    return engine.add_subscriber(subscriber)
