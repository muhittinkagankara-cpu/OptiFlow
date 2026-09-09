"""Sürekli veri akışları: OPC UA aboneliği, MQTT dinleme, REST yoklama.

Tek seferlik `probe` bir bağlantının **kurulabildiğini** gösterir; üretim
ekranının veriye ihtiyacı ise süreklidir. Bu modül, doğrulanmış bir bağlantıyı
sürekli veri üreten bir kaynağa çevirir.

Üç yol, tek sözleşme
--------------------
* **OPC UA** — abonelik (subscription) ve izlenen öğe (monitored item). Sunucu
  değer değiştiğinde haber verir; yoklama yapılmaz. Yoklama, saniyede bir kez
  soran ve aradaki değişimi kaçıran bir yöntemdir.
* **MQTT** — broker mesajı ittiğinde okunur.
* **REST** — protokolde itme yoktur; belirli aralıkla sorulur. Başarısızlıkta
  aralık üstel olarak büyür (backoff), böylece kapalı bir uç saniyede onlarca
  kez yoklanmaz.

Hepsi aynı yere çıkar: `TransformResult` → `DeviceDispatcher`. Ekran hangisinin
konuştuğunu bilmez.

Ölçüm dürüstlüğü
----------------
Bir akışın "çalışıyor" sayılması için **veri gelmiş olması** gerekir. Görevin
ayakta olması yeterli değildir: `first_data_at_ms` boşsa akış "Veri bekleniyor"
durumundadır ve arayüz bunu yazar.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from simulation_engine.runtime.health import retry_delay_ms
from simulation_engine.runtime.pipeline.device_events import Quality, TransformResult
from simulation_engine.runtime.pipeline.transformers import (
    MappingTable,
    from_mqtt_message,
    from_opcua_value,
    from_rest_payload,
)
from simulation_engine.runtime.types import ConnectionSpec

#: REST yoklamasının varsayılan aralığı (ms).
DEFAULT_POLL_INTERVAL_MS = 5_000

#: Kabul edilen en kısa yoklama aralığı (ms).
#:
#: Daha kısası bir uç noktayı saniyede beşten fazla yoklar; çoğu MES bunu
#: kötüye kullanım sayar ve istekleri kısıtlar.
MIN_POLL_INTERVAL_MS = 200

#: Kabul edilen en uzun aralık (ms): beş dakika.
MAX_POLL_INTERVAL_MS = 300_000


def poll_interval_ms(requested: Optional[int]) -> int:
    """Yoklama aralığını kullanılabilir bir aralığa çeker."""
    if requested is None:
        return DEFAULT_POLL_INTERVAL_MS
    try:
        value = int(requested)
    except (TypeError, ValueError):
        return DEFAULT_POLL_INTERVAL_MS
    return max(MIN_POLL_INTERVAL_MS, min(MAX_POLL_INTERVAL_MS, value))


def backoff_interval_ms(base_interval_ms: int, consecutive_failures: int) -> int:
    """Ard arda başarısızlıkta bir sonraki yoklamaya kadarki süre.

    İlk başarısızlıkta aralık iki katına çıkar ve tavanla sınırlanır. Sabit
    aralık, kapalı bir uca dakikalarca aynı sıklıkta gitmek demek olurdu.
    """
    if consecutive_failures <= 0:
        return base_interval_ms
    # `+ 1`: ilk basarisizlikta aralik zaten iki katina cikar. Kaydirilmasaydi
    # ilk hatadan sonra da taban araliginda yoklanir ve kapali bir uc, sorun
    # baslar baslamaz ayni siklikta zorlanmaya devam ederdi.
    delay = retry_delay_ms(
        consecutive_failures + 1, base_ms=base_interval_ms, cap_ms=MAX_POLL_INTERVAL_MS
    )
    return max(base_interval_ms, delay)


@dataclass
class StreamState:
    """Bir akışın ölçülen durumu.

    Ölçülemeyen alanlar `None`'dır: hiç veri gelmediyse "son veri" yoktur ve
    sıfır yazmak, veri gelmiş gibi görünmesine yol açardı.
    """

    connection_id: str
    kind: str
    running: bool = False
    #: İlk verinin geldiği an; hiç veri gelmediyse `None`.
    first_data_at_ms: Optional[int] = None
    last_data_at_ms: Optional[int] = None
    payloads: int = 0
    events_published: int = 0
    problems: int = 0
    consecutive_failures: int = 0
    last_error: Optional[str] = None
    #: REST için geçerli yoklama aralığı; ötekilerde `None`.
    interval_ms: Optional[int] = None
    #: OPC UA aboneliğindeki izlenen öğe sayısı; ötekilerde `None`.
    monitored_items: Optional[int] = None

    @property
    def has_data(self) -> bool:
        return self.first_data_at_ms is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "kind": self.kind,
            "running": self.running,
            "has_data": self.has_data,
            "first_data_at_ms": self.first_data_at_ms,
            "last_data_at_ms": self.last_data_at_ms,
            "payloads": self.payloads,
            "events_published": self.events_published,
            "problems": self.problems,
            "consecutive_failures": self.consecutive_failures,
            "last_error": self.last_error,
            "interval_ms": self.interval_ms,
            "monitored_items": self.monitored_items,
        }


def note_payload(state: StreamState, at_ms: int, result: TransformResult) -> StreamState:
    """Gelen bir yükü akış durumuna işler."""
    state.payloads += 1
    state.events_published += len(result.usable_events)
    state.problems += len(result.problems)
    state.consecutive_failures = 0
    if result.usable_events:
        if state.first_data_at_ms is None:
            state.first_data_at_ms = at_ms
        state.last_data_at_ms = at_ms
    return state


def note_failure(state: StreamState, message: str) -> StreamState:
    """Başarısız bir denemeyi işler."""
    state.consecutive_failures += 1
    state.last_error = message
    return state


class RestPollingRunner:
    """REST ucunu belirli aralıkla yoklar.

    `fetch` dışarıdan verilir: testlerde ağ olmadan, üretimde gerçek HTTP
    istemcisiyle çalışır. Yoklama döngüsü, ard arda başarısızlıkta aralığı
    büyütür ve başarıda tabana döner.
    """

    kind = "rest"

    def __init__(
        self,
        spec: ConnectionSpec,
        fetch: Callable[[], Any],
        on_result: Callable[[TransformResult, int], None],
        mapping: Optional[MappingTable] = None,
        interval_ms: Optional[int] = None,
        sleep=asyncio.sleep,
        clock: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        self.spec = spec
        self._fetch = fetch
        self._on_result = on_result
        self._mapping = mapping
        self._sleep = sleep
        self._clock = clock
        self.state = StreamState(
            connection_id=spec.connection_id,
            kind="rest",
            interval_ms=poll_interval_ms(interval_ms),
        )
        self._stopping = False

    def stop(self) -> None:
        self._stopping = True
        self.state.running = False

    async def run(self, max_cycles: Optional[int] = None) -> StreamState:
        """Yoklama döngüsü.

        `max_cycles` yalnızca testler içindir; üretimde döngü `stop()`
        çağrılana kadar sürer.
        """
        self.state.running = True
        cycles = 0
        base = self.state.interval_ms or DEFAULT_POLL_INTERVAL_MS

        while not self._stopping:
            at_ms = self._clock()
            try:
                payload = self._fetch()
                if asyncio.iscoroutine(payload):
                    payload = await payload
                result = from_rest_payload(
                    connection_id=self.spec.connection_id,
                    payload=payload,
                    at_ms=at_ms,
                    mapping=self._mapping,
                    default_machine=self.spec.label,
                )
                note_payload(self.state, at_ms, result)
                self._on_result(result, at_ms)
            except Exception as error:  # noqa: BLE001 — döngü tek hatada durmaz
                note_failure(self.state, str(error) or error.__class__.__name__)

            cycles += 1
            if max_cycles is not None and cycles >= max_cycles:
                break

            delay = backoff_interval_ms(base, self.state.consecutive_failures)
            await self._sleep(delay / 1000.0)

        self.state.running = False
        return self.state


class MqttStreamRunner:
    """MQTT mesajlarını dinler ve olaylara çevirir."""

    kind = "mqtt"

    def __init__(
        self,
        spec: ConnectionSpec,
        messages: Callable[[], Any],
        on_result: Callable[[TransformResult, int], None],
        mapping: Optional[MappingTable] = None,
        clock: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        """`messages` bir asenkron yineleyici döndürür (konu, yük) çiftleriyle."""
        self.spec = spec
        self._messages = messages
        self._on_result = on_result
        self._mapping = mapping
        self._clock = clock
        self.state = StreamState(connection_id=spec.connection_id, kind="mqtt")
        self._stopping = False

    def stop(self) -> None:
        self._stopping = True
        self.state.running = False

    async def run(self, max_messages: Optional[int] = None) -> StreamState:
        self.state.running = True
        seen = 0
        try:
            async for topic, payload in self._messages():
                if self._stopping:
                    break
                at_ms = self._clock()
                result = from_mqtt_message(
                    connection_id=self.spec.connection_id,
                    topic=str(topic),
                    payload=payload if isinstance(payload, bytes) else bytes(payload),
                    at_ms=at_ms,
                    mapping=self._mapping,
                )
                note_payload(self.state, at_ms, result)
                self._on_result(result, at_ms)
                seen += 1
                if max_messages is not None and seen >= max_messages:
                    break
        except Exception as error:  # noqa: BLE001
            note_failure(self.state, str(error) or error.__class__.__name__)

        self.state.running = False
        return self.state


@dataclass
class MonitoredItem:
    """OPC UA aboneliğinde izlenen tek bir düğüm."""

    node_id: str
    #: Sunucunun bildirdiği en son değer; hiç bildirim gelmediyse `None`.
    last_value: Any = None
    last_at_ms: Optional[int] = None
    notifications: int = 0


class OpcUaSubscriptionRunner:
    """OPC UA abonelik motoru.

    Yoklama yerine **değişiklik bildirimi** kullanılır: sunucu değer
    değiştiğinde haber verir. Yoklama, iki soru arasındaki değişimi kaçırır ve
    hızlı bir hattı olduğundan yavaş gösterir.

    `notifications` dışarıdan verilir; gerçek kullanımda `asyncua`
    aboneliğinden, testlerde sahte bir üreteçten gelir.
    """

    kind = "opcua"

    def __init__(
        self,
        spec: ConnectionSpec,
        notifications: Callable[[], Any],
        on_result: Callable[[TransformResult, int], None],
        mapping: Optional[MappingTable] = None,
        clock: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        self.spec = spec
        self._notifications = notifications
        self._on_result = on_result
        self._mapping = mapping
        self._clock = clock
        self.items: Dict[str, MonitoredItem] = {}
        self.state = StreamState(
            connection_id=spec.connection_id,
            kind="opcua",
            monitored_items=0,
        )
        self._stopping = False

    def subscribe(self, node_ids: List[str]) -> List[MonitoredItem]:
        """İzlenen öğeleri kaydeder."""
        for node_id in node_ids:
            if node_id not in self.items:
                self.items[node_id] = MonitoredItem(node_id=node_id)
        self.state.monitored_items = len(self.items)
        return list(self.items.values())

    def unsubscribe(self, node_id: str) -> bool:
        """İzlemeyi bırakır; kayıt yoksa `False`."""
        removed = self.items.pop(node_id, None) is not None
        self.state.monitored_items = len(self.items)
        return removed

    def unsubscribe_all(self) -> int:
        count = len(self.items)
        self.items.clear()
        self.state.monitored_items = 0
        return count

    def on_change(self, node_id: str, value: Any, at_ms: int, quality: Quality = Quality.GOOD) -> TransformResult:
        """Tek bir değişiklik bildirimini işler.

        İzlenmeyen bir düğümden bildirim gelirse **yok sayılmaz**: öğe
        kendiliğinden kaydedilir ve sayaç artar. Sunucular bazen abonelikte
        istenmeyen düğümleri de gönderir; bunu sessizce atmak, gelen veriyi
        görünmez kılardı.
        """
        item = self.items.get(node_id)
        if item is None:
            item = MonitoredItem(node_id=node_id)
            self.items[node_id] = item
            self.state.monitored_items = len(self.items)

        item.last_value = value
        item.last_at_ms = at_ms
        item.notifications += 1

        result = from_opcua_value(
            connection_id=self.spec.connection_id,
            node_id=node_id,
            value=value,
            at_ms=at_ms,
            mapping=self._mapping,
            quality=quality,
            default_machine=self.spec.label,
        )
        note_payload(self.state, at_ms, result)
        self._on_result(result, at_ms)
        return result

    def stop(self) -> None:
        self._stopping = True
        self.state.running = False

    async def run(self, max_notifications: Optional[int] = None) -> StreamState:
        """Bildirim akışını dinler."""
        self.state.running = True
        seen = 0
        try:
            async for node_id, value in self._notifications():
                if self._stopping:
                    break
                self.on_change(str(node_id), value, self._clock())
                seen += 1
                if max_notifications is not None and seen >= max_notifications:
                    break
        except Exception as error:  # noqa: BLE001
            note_failure(self.state, str(error) or error.__class__.__name__)

        self.state.running = False
        return self.state


@dataclass
class StreamRegistry:
    """Çalışan akışların kaydı."""

    runners: Dict[str, Any] = field(default_factory=dict)

    def add(self, connection_id: str, runner: Any) -> None:
        self.runners[connection_id] = runner

    def get(self, connection_id: str) -> Optional[Any]:
        return self.runners.get(connection_id)

    def remove(self, connection_id: str) -> Optional[Any]:
        return self.runners.pop(connection_id, None)

    def states(self) -> List[Dict[str, Any]]:
        return [_runner_state(runner) for runner in self.runners.values()]

    def is_running(self, connection_id: str) -> bool:
        runner = self.runners.get(connection_id)
        if runner is None:
            return False
        return bool(_runner_state(runner).get("running"))


def _runner_state(runner: Any) -> Dict[str, Any]:
    """Koşucunun durumunu sözlüğe çevirir.

    İki biçim vardır ve ikisi de desteklenir: bu modüldeki eski koşucular
    `state` adlı bir **nesne** taşır, `stream/` altındaki yeni kaynaklar ise
    `state()` adlı bir **işlev**. Kayıt defterinin ikisini de tanıması,
    geçişin tek seferde yapılmasını gerektirmedi; aksi hâlde iki ayrı kayıt
    defteri tutmak ve panoda iki listeyi birleştirmek gerekirdi.
    """
    state = getattr(runner, "state", None)
    if callable(state):
        return state()
    if state is not None and hasattr(state, "to_dict"):
        return state.to_dict()
    return {"running": bool(getattr(runner, "running", False))}
