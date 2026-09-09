"""Akışın tek çıkış kapısı.

Bütün protokoller olaylarını buraya verir; buradan sonra kimse doğrudan
depoya, alarma ya da KPI'a yazmaz. Tek kapı olmasının nedeni SALES-12'de
görülen sorunun kökü: aynı olayı iki farklı yol işlediğinde biri alarmı açar,
öteki açmaz ve iki ekran birbirini tutmaz.

Yineleme nasıl elenir
---------------------
Anahtar `bağlantı::sıra`. Aynı anahtar ikinci kez geldiğinde olay **hiçbir**
alıcıya iletilmez. Yinelenme gerçek bir durumdur: yeniden bağlanma sonrası
tampon yeniden oynatılır, kurtarma diskteki olayları yeniden okur, bir REST
yanıtı iki zamanlayıcı tarafından çekilebilir. Elenmeseydi üretim sayacı
gerçeğin iki katı görünürdü — SALES-11'de tam olarak bu yaşandı.

Anahtar belleği sınırlıdır: son `DEDUP_WINDOW` anahtar tutulur. Sınırsız
olsaydı, günlerce çalışan bir süreçte küme milyonlarca satıra çıkardı. Pencere
dışındaki bir yineleme geçebilir; ama o kadar eski bir olayın yeniden gelmesi,
elenmesi gereken bir yineleme değil, gerçekten yeni bir okumadır.

Alıcı hatası akışı durdurmaz
----------------------------
Bir alıcı (ör. disk yazımı) hata verirse öteki alıcılar yine çağrılır ve hata
sayılır. Aksi hâlde dolu bir disk, ekrandaki canlı veriyi de karartırdı.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Deque, Dict, Iterable, List, Optional, Set

from simulation_engine.runtime.stream.backpressure import (
    BoundedEventQueue,
    loss_ratio,
)
from simulation_engine.runtime.stream.types import DeviceDataEvent

#: Yineleme denetiminde hatırlanan anahtar sayısı.
DEDUP_WINDOW = 10_000

#: Gecikme ölçümünde saklanan örnek sayısı.
LATENCY_SAMPLES = 200

#: Bir alıcı işlevi: olayı alır, bir şey döndürmez.
EventSink = Callable[[DeviceDataEvent], None]


@dataclass
class SinkRegistration:
    """Kayıtlı bir alıcı ve sayaçları."""

    name: str
    sink: EventSink
    delivered: int = 0
    errors: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "name": self.name,
            "delivered": self.delivered,
            "errors": self.errors,
            "last_error": self.last_error,
        }


@dataclass
class StreamDispatcher:
    """Olayları eler, sıraya alır ve alıcılara dağıtır."""

    queue: BoundedEventQueue = field(default_factory=BoundedEventQueue)
    sinks: List[SinkRegistration] = field(default_factory=list)

    #: İşlenen olay sayısı.
    processed: int = 0
    #: Yinelendiği için elenen olay sayısı.
    duplicates: int = 0
    #: Bozuk kalite ya da değersiz olduğu için metrik güncellemeyen olaylar.
    unusable: int = 0

    _seen: Set[str] = field(default_factory=set)
    _seen_order: Deque[str] = field(default_factory=deque)
    _latencies: Deque[float] = field(default_factory=deque)
    #: İlk ve son işlenen olayın anı; olay hızı bundan çıkar.
    first_at_ms: Optional[int] = None
    last_at_ms: Optional[int] = None

    # -- Alıcılar -----------------------------------------------------------

    def register(self, name: str, sink: EventSink) -> SinkRegistration:
        """Bir alıcı ekler.

        Aynı ad ikinci kez kaydedilirse öncekinin yerine geçer; iki kayıt
        kalsaydı her olay o alıcıya iki kez giderdi.
        """
        self.unregister(name)
        registration = SinkRegistration(name=name, sink=sink)
        self.sinks.append(registration)
        return registration

    def unregister(self, name: str) -> bool:
        before = len(self.sinks)
        self.sinks = [item for item in self.sinks if item.name != name]
        return len(self.sinks) != before

    def sink_names(self) -> List[str]:
        return [item.name for item in self.sinks]

    # -- Yineleme -----------------------------------------------------------

    def is_duplicate(self, event: DeviceDataEvent) -> bool:
        return event.key in self._seen

    def _remember(self, key: str) -> None:
        self._seen.add(key)
        self._seen_order.append(key)
        while len(self._seen_order) > DEDUP_WINDOW:
            self._seen.discard(self._seen_order.popleft())

    # -- Dağıtım ------------------------------------------------------------

    def submit(self, event: DeviceDataEvent) -> bool:
        """Olayı kuyruğa alır; yinelenmişse `False` döner.

        Kuyruk doluysa **en eski** olay düşürülür ve sayaç artar; olay burada
        reddedilmez, çünkü en yeni ölçüm en değerlisidir.
        """
        if self.is_duplicate(event):
            self.duplicates += 1
            return False
        self._remember(event.key)
        self.queue.push(event)
        return True

    def submit_many(self, events: Iterable[DeviceDataEvent]) -> Dict[str, int]:
        accepted = 0
        duplicates = 0
        for event in events:
            if self.submit(event):
                accepted += 1
            else:
                duplicates += 1
        return {"accepted": accepted, "duplicates": duplicates}

    def drain(self, now_ms: int, limit: Optional[int] = None) -> List[DeviceDataEvent]:
        """Kuyruktaki olayları alıcılara dağıtır ve dağıtılanları döndürür."""
        events = self.queue.drain(limit)
        for event in events:
            self._deliver(event, now_ms)
        return events

    def _deliver(self, event: DeviceDataEvent, now_ms: int) -> None:
        self.processed += 1
        if not event.is_usable:
            self.unusable += 1

        if self.first_at_ms is None:
            self.first_at_ms = now_ms
        self.last_at_ms = now_ms

        # Gecikme: ölçümün cihazdaki anı ile dağıtım anı arasındaki fark.
        # Negatif çıkarsa (cihaz saati ileri) ölçüm sayılmaz; uydurmak yerine
        # atlamak doğrudur.
        latency = now_ms - event.timestamp
        if latency >= 0:
            self._latencies.append(float(latency))
            while len(self._latencies) > LATENCY_SAMPLES:
                self._latencies.popleft()

        for registration in self.sinks:
            try:
                registration.sink(event)
                registration.delivered += 1
            except Exception as error:  # noqa: BLE001 — bir alıcı ötekini durdurmaz
                registration.errors += 1
                registration.last_error = str(error)

    def dispatch(self, event: DeviceDataEvent, now_ms: int) -> bool:
        """Tek bir olayı sıraya alıp hemen dağıtır."""
        if not self.submit(event):
            return False
        self.drain(now_ms)
        return True

    # -- Ölçümler -----------------------------------------------------------

    def average_latency_ms(self) -> Optional[float]:
        """Ortalama dağıtım gecikmesi; hiç ölçüm yoksa `None`."""
        if not self._latencies:
            return None
        return sum(self._latencies) / len(self._latencies)

    def max_latency_ms(self) -> Optional[float]:
        return max(self._latencies) if self._latencies else None

    def events_per_second(self) -> Optional[float]:
        """Olay hızı; ölçülemiyorsa `None`.

        En az iki olay ve bir saniyeden uzun bir pencere gerekir. Daha kısa
        bir pencereden hız çıkarmak ölçüm değil tahmin olurdu.
        """
        if (
            self.first_at_ms is None
            or self.last_at_ms is None
            or self.processed < 2
        ):
            return None
        window_ms = self.last_at_ms - self.first_at_ms
        if window_ms < 1_000:
            return None
        return self.processed / (window_ms / 1_000)

    def stats(self) -> Dict[str, object]:
        """Runtime panosunun okuduğu sayaçlar."""
        return {
            "processed": self.processed,
            "duplicates": self.duplicates,
            "unusable": self.unusable,
            "dropped": self.queue.dropped,
            "queue": self.queue.to_dict(),
            "events_per_second": self.events_per_second(),
            "avg_latency_ms": self.average_latency_ms(),
            "max_latency_ms": self.max_latency_ms(),
            "loss_ratio": loss_ratio(self.processed, self.queue.dropped),
            "sinks": [item.to_dict() for item in self.sinks],
        }

    def clear(self) -> None:
        """Sayaçları ve kuyruğu sıfırlar; alıcılar kayıtlı kalır."""
        self.queue.clear()
        self.queue.reset_counters()
        self._seen.clear()
        self._seen_order.clear()
        self._latencies.clear()
        self.processed = 0
        self.duplicates = 0
        self.unusable = 0
        self.first_at_ms = None
        self.last_at_ms = None
