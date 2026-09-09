"""Cihaz keşfi: uçtaki cihaza "nelerin var?" diye sormak.

Her protokolde keşif farklı bir şeydir
--------------------------------------
* **OPC UA** — sunucunun adres uzayı gezilebilir. `Objects` düğümünden
  başlanır, çocuklar özyinelemeli olarak dolaşılır ve değişken düğümleri
  okunur. Bu, gerçek bir keşiftir: sunucu ne varsa onu söyler.
* **REST** — uç bir JSON döndürür; alanları düzleştirilir. Sunucu "hangi
  alanların var?" sorusunu ayrıca yanıtlamaz, bu yüzden **gelen yanıtın
  kendisi** keşiftir.
* **MQTT** — protokolde "konuları listele" diye bir çağrı yoktur. Tek yol
  joker konuya abone olup bir süre dinlemektir. Bu yüzden MQTT keşfi
  eksiktir ve bunu söyler: o pencerede yayın yapmayan bir konu bulunamaz.

Uydurma yok
-----------
Hiçbir yolda örnek etiket üretilmez. Yanıt alınamazsa liste boş döner ve neden
yazılır. Örnek üretilseydi, kullanıcı olmayan bir düğümü eşler ve hata ancak
üretimde ortaya çıkardı.

Sınırlar neden var
------------------
Büyük bir OPC UA sunucusunda on binlerce düğüm bulunabilir; hepsini gezmek
dakikalar sürer ve tarayıcıya gönderilen liste kullanılamaz olur. Derinlik ve
sayı sınırı, keşfi kullanılabilir bir sürede bitirir; sınıra dayanıldığı
sonuçta ayrıca yazılır, sessizce kesilmez.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, List, Optional, Tuple

from simulation_engine.runtime.adapters.base import (
    clamp_timeout_ms,
    describe_network_error,
    elapsed_ms,
    is_valid_endpoint,
)
from simulation_engine.runtime.adapters.mqtt import (
    broker_address,
    loop_supports_readers,
)
from simulation_engine.runtime.adapters.opcua import credentials_of
from simulation_engine.runtime.adapters.rest import build_headers
from simulation_engine.runtime.provisioning import naming
from simulation_engine.runtime.provisioning.types import (
    MAX_DISCOVERED_TAGS,
    MQTT_LISTEN_MS,
    CredentialTest,
    DiscoveredTag,
    DiscoveryResult,
    discovery_failed,
)
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

#: OPC UA adres uzayında gezilecek en fazla derinlik.
#:
#: Beş kademe, `Objects → Hat → Makine → Grup → Değişken` yapısını kapsar.
#: Sınırsız gezinme, döngüsel referanslarda hiç bitmeyen bir tarama olurdu.
MAX_BROWSE_DEPTH = 5

#: REST yanıtında düzleştirilecek en fazla iç içe derinlik.
MAX_JSON_DEPTH = 4


def flatten_json(payload: Any, prefix: str = "", depth: int = 0) -> List[Tuple[str, Any]]:
    """JSON gövdesini `yol → değer` çiftlerine düzleştirir.

    Listeler indeksle adreslenir (`makineler.0.uretim`): sahada dizi
    döndüren uçlar yaygındır ve indekssiz bir yol iki makineyi aynı adrese
    yazardı.
    """
    if depth > MAX_JSON_DEPTH:
        return []
    if isinstance(payload, dict):
        rows: List[Tuple[str, Any]] = []
        for key, value in payload.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            rows.extend(flatten_json(value, path, depth + 1))
        return rows
    if isinstance(payload, list):
        rows = []
        for index, value in enumerate(payload):
            path = f"{prefix}.{index}" if prefix else str(index)
            rows.extend(flatten_json(value, path, depth + 1))
        return rows
    if not prefix:
        return []
    return [(prefix, payload)]


def tags_from_json(payload: Any) -> List[DiscoveredTag]:
    """Düzleştirilmiş JSON'dan etiket listesi.

    Yalnızca sayısal, mantıksal ve metin alanlar etiket olur; `None` alanlar da
    listelenir çünkü uçta var olan ama o an değeri olmayan bir alan da
    eşlenebilir olmalıdır.
    """
    return [
        naming.describe(path, value)
        for path, value in flatten_json(payload)[:MAX_DISCOVERED_TAGS]
    ]


class RestDiscovery:
    """REST ucundan gelen yanıtı etiketlere çevirir."""

    kind = ConnectionKind.REST

    def __init__(self, fetch=None) -> None:
        """`fetch` testlerde değiştirilebilir; varsayılan gerçek ağ çağrısıdır."""
        if fetch is None:
            from simulation_engine.runtime.adapters.rest import _fetch

            fetch = _fetch
        self._fetch = fetch

    async def discover(self, spec: ConnectionSpec) -> DiscoveryResult:
        if not is_valid_endpoint(spec.endpoint, ("http", "https")):
            return discovery_failed(
                self.kind,
                spec.endpoint,
                "Keşif yapılamadı: adres http:// ya da https:// ile başlamalı.",
            )

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        started = time.perf_counter()
        try:
            status_code, body = await asyncio.to_thread(
                self._fetch, spec.endpoint, build_headers(spec), timeout_s
            )
        except Exception as error:  # noqa: BLE001 — ağ hataları kullanıcıya çevrilir
            latency = elapsed_ms(started, time.perf_counter())
            return discovery_failed(
                self.kind, spec.endpoint, describe_network_error(error), latency
            )

        latency = elapsed_ms(started, time.perf_counter())
        if status_code >= 400:
            return discovery_failed(
                self.kind,
                spec.endpoint,
                f"Keşif yapılamadı: uç {status_code} döndürdü.",
                latency,
            )

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return discovery_failed(
                self.kind,
                spec.endpoint,
                "Keşif yapılamadı: uç JSON döndürmedi, alanlar çıkarılamıyor.",
                latency,
            )

        tags = tags_from_json(payload)
        return DiscoveryResult(
            ok=True,
            kind=self.kind,
            endpoint=spec.endpoint,
            tags=tags,
            detail=f"Uç yanıt verdi, {len(tags)} alan bulundu.",
            evidence=f"HTTP {status_code}, {len(body)} bayt gövde çözümlendi.",
            latency_ms=latency,
            at_ms=int(time.time() * 1000),
        )


class OpcUaDiscovery:
    """OPC UA adres uzayını gezerek değişken düğümlerini bulur."""

    kind = ConnectionKind.OPCUA

    def __init__(self, client_factory=None) -> None:
        self._client_factory = client_factory

    def _factory(self):
        if self._client_factory is not None:
            return self._client_factory, None
        from simulation_engine.runtime.adapters.opcua import import_client

        return import_client()

    async def discover(self, spec: ConnectionSpec) -> DiscoveryResult:
        factory, error = self._factory()
        if factory is None:
            return discovery_failed(self.kind, spec.endpoint, error or "Sürücü yok.")

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        username, password = credentials_of(spec)
        started = time.perf_counter()
        unreadable: List[str] = []
        tags: List[DiscoveredTag] = []

        try:
            client = factory(url=spec.endpoint, timeout=timeout_s)
            if username is not None:
                client.set_user(username)
            if password is not None:
                client.set_password(password)
            async with client:
                root = client.nodes.objects
                await self._walk(root, tags, unreadable, depth=0)
        except Exception as error:  # noqa: BLE001
            latency = elapsed_ms(started, time.perf_counter())
            return discovery_failed(
                self.kind, spec.endpoint, describe_network_error(error), latency
            )

        latency = elapsed_ms(started, time.perf_counter())
        truncated = len(tags) >= MAX_DISCOVERED_TAGS
        detail = f"Adres uzayı gezildi, {len(tags)} değişken bulundu."
        if truncated:
            detail += f" Liste {MAX_DISCOVERED_TAGS} düğümde kesildi."
        return DiscoveryResult(
            ok=True,
            kind=self.kind,
            endpoint=spec.endpoint,
            tags=tags,
            detail=detail,
            evidence=_first_reading(tags),
            unreadable=unreadable,
            latency_ms=latency,
            at_ms=int(time.time() * 1000),
        )

    async def _walk(
        self,
        node: Any,
        tags: List[DiscoveredTag],
        unreadable: List[str],
        depth: int,
    ) -> None:
        """Adres uzayını özyinelemeli gezer.

        Okunamayan bir düğüm taramayı **durdurmaz**: bir sunucuda erişim izni
        olmayan tek bir düğüm yüzünden bütün keşfin başarısız olması, kurulumu
        imkânsız kılardı. Okunamayanlar ayrıca listelenir.
        """
        if depth > MAX_BROWSE_DEPTH or len(tags) >= MAX_DISCOVERED_TAGS:
            return
        try:
            children = await node.get_children()
        except Exception:  # noqa: BLE001 — gezilemeyen dal atlanır
            return
        for child in children:
            if len(tags) >= MAX_DISCOVERED_TAGS:
                return
            address = str(getattr(child, "nodeid", child))
            try:
                node_class = await child.read_node_class()
            except Exception:  # noqa: BLE001
                node_class = None
            if _is_variable(node_class):
                try:
                    value = await child.read_value()
                except Exception:  # noqa: BLE001
                    unreadable.append(address)
                    continue
                tags.append(naming.describe(address, value))
                continue
            await self._walk(child, tags, unreadable, depth + 1)


def _is_variable(node_class: Any) -> bool:
    """Düğüm bir değişken mi?

    `asyncua` `NodeClass.Variable` döndürür; adı üzerinden bakmak, sürüm
    farklarında sayısal değerin değişmesine karşı dayanıklıdır.
    """
    if node_class is None:
        return False
    return getattr(node_class, "name", str(node_class)) == "Variable"


def _first_reading(tags: List[DiscoveredTag]) -> Optional[str]:
    """İlk okunan değeri kanıt olarak yazar; hiç okunmadıysa `None`."""
    for tag in tags:
        if tag.value is not None:
            return f"{tag.address} düğümü okundu: {tag.value}"
    return None


class MqttDiscovery:
    """Joker konuya abone olup yayınlanan konuları toplar.

    MQTT'de "konuları listele" diye bir çağrı yoktur; tek yol dinlemektir.
    Bu yüzden keşif **eksiktir** ve sonucun açıklaması bunu söyler: dinleme
    penceresinde yayın yapmayan bir konu bulunamaz. "Cihazda başka konu yok"
    denseydi, seyrek yayın yapan bir sensör kurulumdan düşerdi.
    """

    kind = ConnectionKind.MQTT

    def __init__(self, client_factory=None, listen_ms: int = MQTT_LISTEN_MS) -> None:
        self._client_factory = client_factory
        self._listen_ms = max(100, int(listen_ms))

    def _factory(self):
        if self._client_factory is not None:
            return self._client_factory, None
        from simulation_engine.runtime.adapters.mqtt import import_client

        return import_client()

    async def discover(self, spec: ConnectionSpec) -> DiscoveryResult:
        if not loop_supports_readers(asyncio.get_running_loop()):
            return await asyncio.to_thread(self._discover_in_selector_thread, spec)
        return await self._attempt(spec)

    def _discover_in_selector_thread(self, spec: ConnectionSpec) -> DiscoveryResult:
        loop = asyncio.SelectorEventLoop()
        try:
            return loop.run_until_complete(self._attempt(spec))
        finally:
            loop.close()

    async def _attempt(self, spec: ConnectionSpec) -> DiscoveryResult:
        factory, error = self._factory()
        if factory is None:
            return discovery_failed(self.kind, spec.endpoint, error or "Sürücü yok.")

        host, port = broker_address(spec)
        if not host:
            return discovery_failed(
                self.kind, spec.endpoint, "Keşif yapılamadı: broker adresi boş."
            )

        pattern = spec.topics[0] if spec.topics else "#"
        started = time.perf_counter()
        seen: Dict[str, Any] = {}

        try:
            client = factory(
                hostname=host,
                port=port,
                username=spec.username or None,
                password=spec.password or None,
                timeout=clamp_timeout_ms(spec.timeout_ms) / 1000.0,
            )
            async with client:
                await client.subscribe(pattern)
                await self._collect(client, seen)
        except Exception as error:  # noqa: BLE001
            latency = elapsed_ms(started, time.perf_counter())
            return discovery_failed(
                self.kind, spec.endpoint, describe_network_error(error), latency
            )

        latency = elapsed_ms(started, time.perf_counter())
        tags = [naming.describe(topic, value) for topic, value in seen.items()]
        detail = (
            f"{self._listen_ms // 1000} sn dinlendi, {len(tags)} konu yayın yaptı. "
            "Bu pencerede yayın yapmayan konular listede yoktur."
        )
        return DiscoveryResult(
            ok=True,
            kind=self.kind,
            endpoint=spec.endpoint,
            tags=tags,
            detail=detail,
            evidence=_first_reading(tags),
            latency_ms=latency,
            at_ms=int(time.time() * 1000),
        )

    async def _collect(self, client: Any, seen: Dict[str, Any]) -> None:
        """Dinleme penceresi boyunca konuları toplar.

        Zaman aşımı bir hata değildir: pencerenin dolması keşfin normal
        bitişidir.
        """

        async def listen() -> None:
            async for message in client.messages:
                topic = str(message.topic)
                seen[topic] = decode_payload(bytes(message.payload))
                if len(seen) >= MAX_DISCOVERED_TAGS:
                    return

        try:
            await asyncio.wait_for(listen(), timeout=self._listen_ms / 1000.0)
        except (asyncio.TimeoutError, TimeoutError):
            return
        except Exception:  # noqa: BLE001 — dinleme hatası keşfi düşürmez
            return


def decode_payload(payload: bytes) -> Any:
    """MQTT gövdesini değere çevirir; çözülemezse ham metin, o da olmazsa `None`.

    Sayıya zorlanmaz: `"OK"` yayınlayan bir konu sıfıra çevrilseydi, durum
    bilgisi sayısal bir ölçüm gibi görünürdü.
    """
    if not payload:
        return None
    try:
        text = payload.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(parsed, (dict, list)):
        return text
    return parsed


def discovery_for(kind: ConnectionKind):
    """Protokole göre keşif sürücüsü."""
    if kind is ConnectionKind.REST:
        return RestDiscovery()
    if kind is ConnectionKind.OPCUA:
        return OpcUaDiscovery()
    return MqttDiscovery()


async def test_credentials(adapter, spec: ConnectionSpec) -> CredentialTest:
    """Kimlik bilgilerini gerçek uçta dener.

    Sürücünün `probe` çağrısını kullanır: kimlik doğrulamanın çalıştığını
    söylemenin tek yolu, uçta gerçekten oturum açmaktır. Parola sonuçta
    taşınmaz.
    """
    result = await adapter.probe(spec)
    return CredentialTest(
        ok=bool(result.ok),
        detail=result.detail,
        username=spec.username or None,
        requires_auth=bool(spec.username),
        latency_ms=result.latency_ms,
    )
