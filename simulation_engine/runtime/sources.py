"""Gerçek protokol kaynakları — akışların cihaz tarafı.

`streaming.py` içindeki koşucular veriyi bir **kaynaktan** okur; kaynak burada
üretilir. Ayrı durmasının nedeni sınanabilirlik: koşucular sahte kaynaklarla
ağsız sınanır, bu dosya ise gerçek sunucularla doğrulanır.

Her kaynak bir asenkron üreteçtir ve istemcinin ömrünü kendisi yönetir:
üreteç kapandığında oturum da kapanır. Ayrı bir "kapat" çağrısı olsaydı, bir
yerde unutulduğunda cihazda açık kalan bir oturum kalırdı.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any, AsyncIterator, Callable, List, Optional, Tuple

from simulation_engine.runtime.adapters.base import clamp_timeout_ms, clamp_qos
from simulation_engine.runtime.adapters.mqtt import (
    broker_address,
    loop_supports_readers,
    valid_topics,
)
from simulation_engine.runtime.adapters.opcua import node_ids_of
from simulation_engine.runtime.types import ConnectionSpec

#: OPC UA aboneliğinin yayın aralığı (ms).
#:
#: Sunucu bu sıklıkta **değişiklik varsa** haber verir; değişiklik yoksa hiçbir
#: şey göndermez. Yoklamadan farkı budur.
DEFAULT_PUBLISH_INTERVAL_MS = 500

#: Kaynak kuyruğunun boyutu.
#:
#: Tüketici yavaşsa kuyruk dolar ve en eski bildirim düşer; sınırsız kuyruk,
#: hızlı bir hatta belleği doldururdu.
QUEUE_SIZE = 500


class _DataChangeHandler:
    """`asyncua` aboneliğinin geri çağrı arayüzü."""

    def __init__(self, on_change: Callable[[str, Any], None]) -> None:
        self._on_change = on_change

    def datachange_notification(self, node, value, data) -> None:  # noqa: D102, ANN001
        try:
            node_id = node.nodeid.to_string()
        except Exception:  # noqa: BLE001 — kimlik okunamazsa metin hâli kullanılır
            node_id = str(node)
        self._on_change(node_id, value)

    def event_notification(self, event) -> None:  # noqa: D102, ANN001
        """Olay bildirimleri bu sürümde kullanılmaz."""

    def status_change_notification(self, status) -> None:  # noqa: D102, ANN001
        """Durum bildirimleri bu sürümde kullanılmaz."""


async def opcua_subscription_source(
    spec: ConnectionSpec,
    publish_interval_ms: int = DEFAULT_PUBLISH_INTERVAL_MS,
    client_factory=None,
) -> AsyncIterator[Tuple[str, Any]]:
    """OPC UA değişiklik bildirimlerini yayan üreteç.

    Abonelik kurulur, izlenen öğeler eklenir ve sunucu değer değiştirdikçe
    `(düğüm, değer)` çiftleri akar. Üreteç kapandığında abonelik silinir ve
    oturum kapanır.
    """
    if client_factory is None:
        from asyncua import Client  # type: ignore import-not-found

        client_factory = Client

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)

    def push(node_id: str, value: Any) -> None:
        """Bildirimi kuyruğa koyar; kuyruk doluysa en eskisi düşer."""
        try:
            queue.put_nowait((node_id, value))
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
                queue.put_nowait((node_id, value))
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass

    def push_threadsafe(node_id: str, value: Any) -> None:
        loop.call_soon_threadsafe(push, node_id, value)

    client = client_factory(
        url=spec.endpoint, timeout=clamp_timeout_ms(spec.timeout_ms) / 1000.0
    )
    if spec.username:
        client.set_user(spec.username)
    if spec.password:
        client.set_password(spec.password)

    async with client:
        handler = _DataChangeHandler(push_threadsafe)
        subscription = await client.create_subscription(publish_interval_ms, handler)
        nodes = [client.get_node(node_id) for node_id in node_ids_of(spec)]
        await subscription.subscribe_data_change(nodes)
        try:
            while True:
                yield await queue.get()
        finally:
            try:
                await subscription.delete()
            except Exception:  # noqa: BLE001 — oturum zaten kapanmış olabilir
                pass


async def mqtt_message_source(
    spec: ConnectionSpec,
    client_factory=None,
) -> AsyncIterator[Tuple[str, bytes]]:
    """MQTT mesajlarını yayan üreteç.

    Windows'ta olay döngüsü soket okuyucusu desteklemiyorsa (uvicorn'un
    varsayılan `Proactor` döngüsü) dinleme **ayrı bir iş parçacığında**, kendi
    seçici döngüsünde yapılır ve mesajlar ana döngüye taşınır. Bu olmadan akış
    hiç mesaj almadan sessizce beklerdi.
    """
    if client_factory is None:
        import aiomqtt  # type: ignore import-not-found

        client_factory = aiomqtt.Client

    host, port = broker_address(spec)
    topics = valid_topics(spec)
    qos = clamp_qos(spec.qos)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)

    if loop_supports_readers(loop):
        client = client_factory(
            hostname=host,
            port=port,
            username=spec.username or None,
            password=spec.password or None,
            timeout=clamp_timeout_ms(spec.timeout_ms) / 1000.0,
        )
        async with client:
            for topic in topics:
                await client.subscribe(topic, qos=qos)
            async for message in client.messages:
                yield str(message.topic), bytes(message.payload)
        return

    stop = threading.Event()

    def listen() -> None:
        worker = asyncio.SelectorEventLoop()
        asyncio.set_event_loop(worker)

        async def pump() -> None:
            client = client_factory(
                hostname=host,
                port=port,
                username=spec.username or None,
                password=spec.password or None,
                timeout=clamp_timeout_ms(spec.timeout_ms) / 1000.0,
            )
            async with client:
                for topic in topics:
                    await client.subscribe(topic, qos=qos)
                async for message in client.messages:
                    if stop.is_set():
                        break
                    loop.call_soon_threadsafe(
                        _offer, queue, (str(message.topic), bytes(message.payload))
                    )

        try:
            worker.run_until_complete(pump())
        except Exception:  # noqa: BLE001 — akış kapanınca istisna beklenir
            pass
        finally:
            worker.close()

    thread = threading.Thread(target=listen, daemon=True)
    thread.start()
    try:
        while True:
            yield await queue.get()
    finally:
        stop.set()


def _offer(queue: asyncio.Queue, item: Tuple[str, bytes]) -> None:
    """Kuyruğa koyar; doluysa en eskisi düşer."""
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        try:
            queue.get_nowait()
            queue.put_nowait(item)
        except (asyncio.QueueEmpty, asyncio.QueueFull):
            pass


def rest_fetch(spec: ConnectionSpec, fetch=None) -> Callable[[], Any]:
    """REST yoklaması için gövde okuyan işlev üretir.

    Dönen işlev **eşzamanlıdır** ve koşucu tarafından iş parçacığında çağrılır;
    `urllib` engelleyicidir ve olay döngüsünde doğrudan çağrılsaydı tek bir
    yavaş uç bütün sunucuyu durdururdu.
    """
    from simulation_engine.runtime.adapters.rest import _fetch, build_headers

    impl = fetch if fetch is not None else _fetch
    headers = build_headers(spec)
    timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0

    async def read() -> bytes:
        _, body = await asyncio.to_thread(impl, spec.endpoint, headers, timeout_s)
        return body

    return read


def now_ms() -> int:
    """Duvar saati (ms). Tek yerde durur ki testler onu değiştirebilsin."""
    return int(time.time() * 1000)


def default_node_ids(spec: ConnectionSpec) -> List[str]:
    """Abonelik açılacak düğümler."""
    return node_ids_of(spec)


def source_availability(spec: ConnectionSpec) -> Optional[str]:
    """Bu bağlantı için akış açılabilir mi? Açılamıyorsa nedeni.

    Kütüphane eksikse ya da yapılandırma yetersizse akış **başlatılmaz** ve
    neden söylenir; başlatılıp sessizce boş kalmak, "veri gelmiyor" sorusunun
    yanıtsız kalması demek olurdu.
    """
    kind = spec.kind.value

    if kind == "opcua":
        try:
            import asyncua  # noqa: F401
        except ImportError:
            return "Doğrulanmadı: asyncua kurulu değil; abonelik açılamaz."
        return None

    if kind == "mqtt":
        try:
            import aiomqtt  # noqa: F401
        except ImportError:
            return "Doğrulanmadı: aiomqtt kurulu değil; dinleme açılamaz."
        if not valid_topics(spec):
            return "Akış açılamadı: abone olunabilir geçerli bir konu yok."
        return None

    if kind == "rest":
        return None

    return f"Doğrulanmadı: {kind} için akış sürücüsü yok."
