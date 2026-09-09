"""Abonelik motorları — OPC UA ve MQTT.

Yoklamadan farkı
----------------
Yoklamada soruyu biz sorarız; abonelikte cihaz kendi konuşur. OPC UA sunucusu
bir düğümün **değeri değiştiğinde** bildirim yollar, MQTT broker'ı bir mesaj
yayınlandığında iletir. İkisi de yoklamanın kaçırdığını yakalar: saniyede bir
soran bir istemci, aradaki iki değişimi hiç görmez.

Aynı kapı
---------
İki motor da olaylarını `StreamDispatcher`'a verir ve sıra numarasını
kaynağında alır. Böylece bir ekran hangi protokolün konuştuğunu bilmez;
protokol eklemek ekranı değiştirmeyi gerektirmez.

Sessizlik bir durumdur
----------------------
Abonelik açık ama hiç bildirim gelmemişse akış "çalışıyor" sayılmaz: durum
`IDLE` olur ve arayüz "Veri bekleniyor" yazar. Açık bir soket, akan veri
demek değildir — SALES-9'da bu ayrım olmadığı için ekran, hiç veri
göndermeyen bir sunucuyu "bağlı ve çalışıyor" gösteriyordu.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Tuple

from simulation_engine.runtime.pipeline.transformers import (
    MappingTable,
    from_mqtt_message,
    from_opcua_value,
)
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.poller import emit_result
from simulation_engine.runtime.stream.scheduler import StreamHealth
from simulation_engine.runtime.stream.types import SequenceCounter
from simulation_engine.runtime.types import ConnectionSpec


@dataclass
class SubscriptionOutcome:
    """Tek bir bildirimin işlenme sonucu."""

    connector_id: str
    at_ms: int
    origin: str
    events: int = 0
    accepted: int = 0
    duplicates: int = 0
    problems: int = 0

    def to_dict(self) -> Dict[str, object]:
        return {
            "connector_id": self.connector_id,
            "at_ms": self.at_ms,
            "origin": self.origin,
            "events": self.events,
            "accepted": self.accepted,
            "duplicates": self.duplicates,
            "problems": self.problems,
        }


@dataclass
class _SubscriberBase:
    """İki abonelik motorunun ortak durumu ve sayaçları."""

    spec: ConnectionSpec
    dispatcher: StreamDispatcher
    sequences: SequenceCounter
    mapping: Optional[MappingTable] = None
    clock: Callable[[], int] = lambda: int(time.time() * 1000)

    outcomes: List[SubscriptionOutcome] = field(default_factory=list)
    #: Kaç bildirim geldi?
    notifications: int = 0
    first_data_at_ms: Optional[int] = None
    last_data_at_ms: Optional[int] = None
    running: bool = False
    last_error: Optional[str] = None
    _stopping: bool = False

    @property
    def connector_id(self) -> str:
        return self.spec.connection_id

    def stop(self) -> None:
        self._stopping = True
        self.running = False

    def _record(self, outcome: SubscriptionOutcome) -> None:
        self.notifications += 1
        self.outcomes.append(outcome)
        if len(self.outcomes) > 50:
            del self.outcomes[0 : len(self.outcomes) - 50]
        if outcome.events > 0:
            if self.first_data_at_ms is None:
                self.first_data_at_ms = outcome.at_ms
            self.last_data_at_ms = outcome.at_ms

    @property
    def health(self) -> StreamHealth:
        if not self.running:
            return StreamHealth.STOPPED
        if self.last_error is not None:
            return StreamHealth.FAILING
        if self.dispatcher.queue.under_pressure:
            return StreamHealth.BACKPRESSURE
        if self.first_data_at_ms is None:
            return StreamHealth.IDLE
        return StreamHealth.RUNNING

    def state(self) -> Dict[str, object]:
        return {
            # Anahtar iki adla da yazılır: olay modeli `connector_id`
            # kullanır (SALES-13), akış durumu sözleşmesi ise SALES-9'dan beri
            # `connection_id`. Tek ada indirgemek ya arayüzü ya da yöneticiyi
            # kırardı; iki ad aynı değeri taşır.
            "connector_id": self.connector_id,
            "connection_id": self.connector_id,
            "protocol": self.protocol,
            "running": self.running,
            "health": self.health.value,
            "notifications": self.notifications,
            "first_data_at_ms": self.first_data_at_ms,
            "last_data_at_ms": self.last_data_at_ms,
            "last_error": self.last_error,
            "last_outcome": self.outcomes[-1].to_dict() if self.outcomes else None,
        }


@dataclass
class OpcUaSubscriber(_SubscriberBase):
    """OPC UA değer değişimlerini olaya çevirir."""

    protocol: str = "opcua"
    #: `(node_id, value, at_ms)` üreten asenkron kaynak.
    notifications_source: Optional[Callable[[], AsyncIterator[Any]]] = None
    #: Düğüm başına son görülen değer; yalnızca **değişim** olay üretir.
    _last_values: Dict[str, Any] = field(default_factory=dict)

    def on_value(
        self, node_id: str, value: Any, at_ms: Optional[int] = None
    ) -> Optional[SubscriptionOutcome]:
        """Tek bir değer bildirimini işler.

        Değer değişmediyse olay üretilmez ve `None` döner. Üretilseydi, her
        yayın aralığında aynı sayı yeniden işlenir; üretim sayacı değişmediği
        hâlde ekran sürekli "yeni veri" gösterir ve gerçek bir değişimi fark
        etmek imkânsızlaşırdı.
        """
        moment = at_ms if at_ms is not None else self.clock()

        if node_id in self._last_values and self._last_values[node_id] == value:
            return None
        self._last_values[node_id] = value

        result = from_opcua_value(
            connection_id=self.connector_id,
            node_id=node_id,
            value=value,
            at_ms=moment,
            mapping=self.mapping,
            default_machine=self.spec.label,
        )
        counts = emit_result(
            result, self.dispatcher, self.sequences, self.connector_id
        )
        outcome = SubscriptionOutcome(
            connector_id=self.connector_id,
            at_ms=moment,
            origin=node_id,
            **counts,
        )
        self._record(outcome)
        return outcome

    async def run(self, max_notifications: Optional[int] = None) -> "OpcUaSubscriber":
        """Kaynaktan gelen bildirimleri işler."""
        if self.notifications_source is None:
            raise RuntimeError("OPC UA abonelik kaynagi tanimli degil.")

        # `_stopping` burada **sıfırlanmaz**. Sıfırlanıyordu ve bu gerçek bir
        # yarış açıyordu: `start_stream` görevi oluşturur, kullanıcı hemen
        # `stop_stream` çağırırsa durdurma bayrağı görev henüz sıraya
        # girmeden yazılır; döngü başlarken onu silince akış yine de
        # çalışırdı. Durdurulmuş bir kaynak yeniden başlatılmaz; yeni bir
        # kaynak kurulur.
        self.running = True
        handled = 0

        try:
            async for notification in self.notifications_source():
                if self._stopping:
                    break
                node_id, value, at_ms = _unpack_opcua(notification)
                self.on_value(node_id, value, at_ms)
                self.dispatcher.drain(self.clock())

                handled += 1
                if max_notifications is not None and handled >= max_notifications:
                    break
        except Exception as error:  # noqa: BLE001 — hata durumu görünür olmalı
            self.last_error = str(error) or error.__class__.__name__
        finally:
            self.running = False

        return self


@dataclass
class MqttSubscriber(_SubscriberBase):
    """MQTT mesajlarını olaya çevirir."""

    protocol: str = "mqtt"
    #: `(topic, payload)` üreten asenkron kaynak.
    messages_source: Optional[Callable[[], AsyncIterator[Tuple[str, bytes]]]] = None

    def on_message(
        self, topic: str, payload: Any, at_ms: Optional[int] = None
    ) -> SubscriptionOutcome:
        """Tek bir mesajı işler.

        Aynı içerikli mesaj yeniden gelirse **olay üretilir**: MQTT'de aynı
        değerin yeniden yayınlanması, cihazın hâlâ yayında olduğunu söyleyen
        bir bilgidir ve "veri gelmiyor" alarmını kapatan tek şeydir.
        """
        moment = at_ms if at_ms is not None else self.clock()
        result = from_mqtt_message(
            connection_id=self.connector_id,
            topic=topic,
            payload=payload,
            at_ms=moment,
            mapping=self.mapping,
            default_machine=self.spec.label,
        )
        counts = emit_result(
            result, self.dispatcher, self.sequences, self.connector_id
        )
        outcome = SubscriptionOutcome(
            connector_id=self.connector_id,
            at_ms=moment,
            origin=topic,
            **counts,
        )
        self._record(outcome)
        return outcome

    async def run(self, max_messages: Optional[int] = None) -> "MqttSubscriber":
        if self.messages_source is None:
            raise RuntimeError("MQTT mesaj kaynagi tanimli degil.")

        # `_stopping` burada **sıfırlanmaz**. Sıfırlanıyordu ve bu gerçek bir
        # yarış açıyordu: `start_stream` görevi oluşturur, kullanıcı hemen
        # `stop_stream` çağırırsa durdurma bayrağı görev henüz sıraya
        # girmeden yazılır; döngü başlarken onu silince akış yine de
        # çalışırdı. Durdurulmuş bir kaynak yeniden başlatılmaz; yeni bir
        # kaynak kurulur.
        self.running = True
        handled = 0

        try:
            async for message in self.messages_source():
                if self._stopping:
                    break
                topic, payload = message[0], message[1]
                self.on_message(topic, payload)
                self.dispatcher.drain(self.clock())

                handled += 1
                if max_messages is not None and handled >= max_messages:
                    break
        except Exception as error:  # noqa: BLE001
            self.last_error = str(error) or error.__class__.__name__
        finally:
            self.running = False

        return self


def _unpack_opcua(notification: Any) -> Tuple[str, Any, Optional[int]]:
    """Bildirimi `(düğüm, değer, an)` üçlüsüne çevirir.

    Kaynak iki biçim üretebilir: zaman damgalı üçlü ya da damgasız ikili.
    Damga yoksa `None` döner ve çağıran kendi saatini kullanır — uydurma bir
    zaman damgası, ölçümün ne zaman alındığı sorusuna yanlış yanıt olurdu.
    """
    if isinstance(notification, (tuple, list)):
        if len(notification) >= 3:
            return str(notification[0]), notification[1], int(notification[2])
        if len(notification) == 2:
            return str(notification[0]), notification[1], None
    raise ValueError("OPC UA bildirimi cozulemedi.")
