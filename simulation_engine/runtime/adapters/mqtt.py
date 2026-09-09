"""MQTT bağlayıcısı — sunucu tarafı.

`aiomqtt` kullanılır (paho tabanlı, asenkron sarmalayıcı). Kütüphane kurulu
değilse hiçbir deneme yapılmaz ve durum **"Doğrulanmadı"** olur.

Doğrulama ölçütü
----------------
Broker'a bağlanmak (CONNACK) ve konulara abone olmak (SUBACK) gerçek bir
broker yanıtıdır ve doğrulama sayılır. Mesaj gelmesi **beklenmez**: yayın
yapan bir cihaz yoksa konuda saatlerce mesaj olmayabilir ve bunu bir bağlantı
arızası saymak yanlış olurdu. Ancak zaman aşımı içinde bir mesaj gelirse kanıt
olarak kaydedilir.

Konu doğrulaması
----------------
Joker karakterler (`+`, `#`) yalnızca abone olurken geçerlidir ve `#` yalnızca
konunun sonunda bulunabilir. Bozuk bir konu broker tarafından sessizce
reddedilir; bunu önceden yakalamak, "bağlandı ama hiç veri gelmiyor" durumunun
en sık nedenini ortadan kaldırır.
"""

from __future__ import annotations

import asyncio
import sys
import time
from typing import Any, List, Optional, Tuple

from simulation_engine.runtime.adapters.base import (
    clamp_qos,
    clamp_timeout_ms,
    describe_network_error,
    elapsed_ms,
    failed,
    missing_library,
    split_endpoint,
    succeeded,
)
from simulation_engine.runtime.types import ConnectionSpec, ProbeResult

DEFAULT_PORT = 1883
LIBRARY_NAME = "aiomqtt"
LIBRARY_PACKAGE = "aiomqtt"

#: İlk mesaj için beklenecek süre (sn).
#:
#: Mesaj gelmemesi bir hata değildir; bu süre yalnızca "gelirse kanıt olarak
#: alalım" penceresidir ve kısa tutulur ki bağlantı testi uzamasın.
FIRST_MESSAGE_WINDOW_S = 1.0


def loop_supports_readers(loop: asyncio.AbstractEventLoop) -> bool:
    """Bu olay döngüsü soket okuyucularını destekliyor mu?

    MQTT istemcisi (paho) soketi `loop.add_reader` ile izler. Windows'ta
    uvicorn'un varsayılan döngüsü `Proactor`'dur ve bu çağrıyı desteklemez;
    istemci hiçbir geri çağrı almaz ve bağlantı **zaman aşımıyla** düşer.

    Bu, doğrulama sırasında gerçekten yaşandı: broker ayakta ve erişilebilirken
    uç "Bağlantı kurulamadı: Operation timed out" döndürüyordu. Sorunun broker'da
    olduğu sanılırdı; oysa neden sunucunun olay döngüsüydü.
    """
    if getattr(loop, "add_reader", None) is None:
        return False
    if sys.platform == "win32":
        proactor = getattr(asyncio, "ProactorEventLoop", None)
        return proactor is None or not isinstance(loop, proactor)
    return True


def is_valid_topic(topic: str) -> bool:
    """Abone olunabilir bir MQTT konusu mu?"""
    text = topic.strip()
    if not text or len(text) > 65_535:
        return False
    if "\x00" in text:
        return False
    levels = text.split("/")
    for index, level in enumerate(levels):
        if level == "#" and index != len(levels) - 1:
            # `#` yalnızca son seviyede olabilir.
            return False
        if "#" in level and level != "#":
            return False
        if "+" in level and level != "+":
            return False
    return True


def valid_topics(spec: ConnectionSpec) -> List[str]:
    return [topic for topic in spec.topics if is_valid_topic(topic)]


def invalid_topics(spec: ConnectionSpec) -> List[str]:
    return [topic for topic in spec.topics if not is_valid_topic(topic)]


def broker_address(spec: ConnectionSpec) -> Tuple[str, int]:
    """Broker adresi ve portu.

    Port önce açık alandan, sonra adresin kendisinden, en son varsayılandan
    alınır: kullanıcı ikisini de yazdıysa açık alan kazanır.
    """
    host, parsed_port = split_endpoint(spec.endpoint, DEFAULT_PORT)
    port = spec.port if spec.port else (parsed_port or DEFAULT_PORT)
    return host, int(port)


def import_client() -> Tuple[Optional[Any], Optional[str]]:
    """`aiomqtt` istemcisini içe aktarır; yoksa nedenini döndürür."""
    try:
        import aiomqtt  # type: ignore import-not-found

        return aiomqtt.Client, None
    except ImportError:
        return None, missing_library(LIBRARY_NAME, LIBRARY_PACKAGE)


class MqttAdapter:
    """MQTT broker'larına bağlanan sürücü."""

    kind = "mqtt"

    def __init__(self, client_factory=None) -> None:
        self._client_factory = client_factory

    def _resolve_factory(self) -> Tuple[Optional[Any], Optional[str]]:
        if self._client_factory is not None:
            return self._client_factory, None
        return import_client()

    async def probe(self, spec: ConnectionSpec) -> ProbeResult:
        """Broker'a bağlanmayı dener.

        Olay döngüsü soket okuyucusu desteklemiyorsa (Windows/Proactor) deneme
        **ayrı bir iş parçacığında**, seçici bir döngüde yapılır. Alternatif,
        çalışabilecek bir bağlantıyı zaman aşımı diye raporlamak olurdu.
        """
        if not loop_supports_readers(asyncio.get_running_loop()):
            return await asyncio.to_thread(self._probe_in_selector_thread, spec)
        return await self._attempt(spec)

    def _probe_in_selector_thread(self, spec: ConnectionSpec) -> ProbeResult:
        """Denemeyi kendi seçici döngüsünde çalıştırır."""
        loop = asyncio.SelectorEventLoop()
        try:
            return loop.run_until_complete(self._attempt(spec))
        finally:
            loop.close()

    async def _attempt(self, spec: ConnectionSpec) -> ProbeResult:
        host, port = broker_address(spec)
        if not host:
            return failed("Bağlantı kurulamadı: broker adresi boş.")

        topics = valid_topics(spec)
        if not topics:
            return failed(
                "Bağlantı kurulamadı: abone olunabilir geçerli bir konu yok. "
                "En az bir konu girin (örn. fabrika/hat1/sayac)."
            )

        factory, error = self._resolve_factory()
        if factory is None:
            return failed(error or missing_library(LIBRARY_NAME, LIBRARY_PACKAGE))

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        qos = clamp_qos(spec.qos)
        started = time.perf_counter()

        try:
            client = factory(
                hostname=host,
                port=port,
                username=spec.username or None,
                password=spec.password or None,
                timeout=timeout_s,
            )
            async with client:
                for topic in topics:
                    await client.subscribe(topic, qos=qos)
                payload = await self._first_message(client)
        except Exception as error:  # noqa: BLE001 — sürücü hataları çevrilir
            latency = elapsed_ms(started, time.perf_counter())
            return failed(describe_network_error(error), latency)

        latency = elapsed_ms(started, time.perf_counter())
        if payload is None:
            evidence = (
                f"Broker bağlantıyı ve {len(topics)} konunun aboneliğini onayladı "
                "(CONNACK + SUBACK); bu pencerede mesaj yayınlanmadı."
            )
            received = None
        else:
            topic_name, body = payload
            evidence = f"{topic_name} konusundan {len(body)} bayt alındı."
            received = len(body)

        return succeeded(
            detail=f"MQTT broker yanıt verdi ({host}:{port}).",
            evidence=evidence,
            latency_ms=latency,
            bytes_received=received,
        )

    async def _first_message(self, client: Any) -> Optional[Tuple[str, bytes]]:
        """Kısa bir pencerede ilk mesajı bekler; gelmezse `None`.

        Zaman aşımı bir hata değildir: yayın yapan cihaz yoksa konu sessizdir
        ve bu bağlantının kurulmadığı anlamına gelmez.
        """

        async def first() -> Optional[Tuple[str, bytes]]:
            async for message in client.messages:
                return str(message.topic), bytes(message.payload)
            return None

        try:
            return await asyncio.wait_for(first(), timeout=FIRST_MESSAGE_WINDOW_S)
        except (asyncio.TimeoutError, TimeoutError):
            return None
        except Exception:  # noqa: BLE001 — mesaj beklemek bağlantıyı düşürmez
            return None
