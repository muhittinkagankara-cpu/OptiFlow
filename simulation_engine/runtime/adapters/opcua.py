"""OPC UA bağlayıcısı — sunucu tarafı, ilk gerçek uygulama.

`asyncua` kütüphanesi kullanılır. Kütüphane kurulu değilse hiçbir deneme
yapılmaz ve durum **"Doğrulanmadı"** olur; "bağlanamadı" demek yanlış olurdu,
çünkü bağlanmaya çalışılmadı.

Doğrulama ölçütü
----------------
Oturum açmak tek başına yeterli sayılmaz: bir düğüm **okunur** ve okunan değer
kanıt olarak kaydedilir. Yalnızca oturuma bakılsaydı, yanlış yapılandırılmış
ama ayakta duran bir sunucu "çalışıyor" görünür, veri ise hiç akmazdı.

Düğüm verilmediğinde `i=2258` okunur: bu, OPC UA belirtiminde her sunucuda
bulunması zorunlu olan `Server_ServerStatus_CurrentTime` düğümüdür. Sunucuya
özel bir düğüm seçilseydi, bağlantı testi cihazın adres uzayına bağımlı olurdu.

Güvenlik
--------
`None` politikasında parola **düz metin** gider ve arayüz bunu yazar.
`Basic256Sha256` istemci sertifikası ister; sertifika verilmediyse bağlanmayı
denemek yerine ne eksik olduğu söylenir.
"""

from __future__ import annotations

import time
from typing import Any, List, Optional, Tuple

from simulation_engine.runtime.adapters.base import (
    clamp_timeout_ms,
    describe_network_error,
    elapsed_ms,
    failed,
    is_valid_endpoint,
    missing_library,
    succeeded,
)
from simulation_engine.runtime.types import ConnectionSpec, ProbeResult, SecurityPolicy

#: Her OPC UA sunucusunda bulunan standart düğüm: sunucu saati.
DEFAULT_NODE_ID = "i=2258"

#: Kütüphane adı ve pip paketi.
LIBRARY_NAME = "asyncua"
LIBRARY_PACKAGE = "asyncua"


def is_valid_node_id(node_id: str) -> bool:
    """OPC UA düğüm kimliği biçimsel olarak geçerli mi?

    Kabul edilen biçimler: ``i=2258``, ``ns=2;i=5``, ``ns=2;s=Hat.Sayac``,
    ``g=...`` ve ``b=...``. Doğrulama biçimseldir; düğümün sunucuda var olup
    olmadığını yalnızca okuma denemesi söyleyebilir.
    """
    text = node_id.strip()
    if not text:
        return False
    parts = text.split(";")
    if len(parts) > 2:
        return False
    if len(parts) == 2:
        if not parts[0].startswith("ns=") or not parts[0][3:].isdigit():
            return False
        body = parts[1]
    else:
        body = parts[0]
    return len(body) > 2 and body[:2] in ("i=", "s=", "g=", "b=") and bool(body[2:])


def node_ids_of(spec: ConnectionSpec) -> List[str]:
    """Okunacak düğümler; hiçbiri verilmemişse sunucu saati.

    Geçersiz biçimli düğümler süzülür — hepsi geçersizse yine varsayılana
    düşülür, çünkü bağlantının kendisi yine de sınanabilir.
    """
    valid = [node for node in spec.topics if is_valid_node_id(node)]
    return valid if valid else [DEFAULT_NODE_ID]


def invalid_node_ids(spec: ConnectionSpec) -> List[str]:
    """Biçimi bozuk düğümler; kullanıcı uyarılır."""
    return [node for node in spec.topics if not is_valid_node_id(node)]


def security_string(spec: ConnectionSpec) -> Optional[str]:
    """`asyncua` için güvenlik dizgesi; `None` politikasında `None`."""
    if spec.security_policy is SecurityPolicy.NONE:
        return None
    return f"{spec.security_policy.value},SignAndEncrypt"


def security_note(spec: ConnectionSpec) -> str:
    """Kullanıcıya gösterilecek güvenlik açıklaması."""
    if spec.security_policy is SecurityPolicy.NONE:
        if spec.password:
            return (
                "Güvenlik politikası None: parola şifrelenmeden gönderilir. "
                "Üretim ortamında Basic256Sha256 kullanın."
            )
        return "Güvenlik politikası None: trafik şifrelenmez (anonim bağlantı)."
    return (
        "Basic256Sha256 seçildi: istemci sertifikası ve özel anahtarı gerekir; "
        "bu sunucuda tanımlı değil."
    )


def credentials_of(spec: ConnectionSpec) -> Tuple[Optional[str], Optional[str]]:
    """Kullanıcı adı ve parola; ikisi de yoksa anonim bağlantı demektir."""
    username = spec.username or None
    password = spec.password or None
    return username, password


def is_anonymous(spec: ConnectionSpec) -> bool:
    return spec.username in (None, "")


def import_client() -> Tuple[Optional[Any], Optional[str]]:
    """`asyncua` istemcisini içe aktarır; yoksa nedenini döndürür.

    İçe aktarma modül düzeyinde yapılsaydı, kütüphane kurulu olmayan bir
    dağıtımda **tüm uygulama** açılmazdı; oysa OPC UA olmadan ürünün geri kalanı
    çalışmaya devam etmelidir.
    """
    try:
        from asyncua import Client  # type: ignore import-not-found

        return Client, None
    except ImportError:
        return None, missing_library(LIBRARY_NAME, LIBRARY_PACKAGE)


class OpcUaAdapter:
    """OPC UA sunucularına bağlanan sürücü."""

    kind = "opcua"

    def __init__(self, client_factory=None) -> None:
        """`client_factory` testlerde değiştirilebilir; varsayılan `asyncua`."""
        self._client_factory = client_factory

    def _resolve_factory(self) -> Tuple[Optional[Any], Optional[str]]:
        if self._client_factory is not None:
            return self._client_factory, None
        return import_client()

    async def probe(self, spec: ConnectionSpec) -> ProbeResult:
        if not is_valid_endpoint(spec.endpoint, ("opc.tcp",)):
            return failed(
                "Bağlantı kurulamadı: OPC UA adresi opc.tcp:// ile başlamalı."
            )

        if spec.security_policy is not SecurityPolicy.NONE:
            # Sertifika olmadan şifreli oturum açılamaz; denemek yerine
            # eksiğin ne olduğu söylenir.
            return failed(f"Doğrulanmadı: {security_note(spec)}")

        factory, error = self._resolve_factory()
        if factory is None:
            return failed(error or missing_library(LIBRARY_NAME, LIBRARY_PACKAGE))

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        nodes = node_ids_of(spec)
        username, password = credentials_of(spec)
        started = time.perf_counter()

        client = factory(url=spec.endpoint, timeout=timeout_s)
        if username is not None:
            client.set_user(username)
        if password is not None:
            client.set_password(password)

        try:
            async with client:
                values = []
                for node_id in nodes:
                    node = client.get_node(node_id)
                    values.append((node_id, await node.read_value()))
        except Exception as error:  # noqa: BLE001 — sürücü hataları çevrilir
            latency = elapsed_ms(started, time.perf_counter())
            return failed(describe_network_error(error), latency)

        latency = elapsed_ms(started, time.perf_counter())
        evidence = "; ".join(f"{node_id} = {value}" for node_id, value in values)
        return succeeded(
            detail=f"OPC UA oturumu açıldı ve {len(values)} düğüm okundu.",
            evidence=evidence,
            latency_ms=latency,
        )

    async def read_nodes(self, spec: ConnectionSpec) -> Tuple[List[Tuple[str, Any]], Optional[str]]:
        """Düğümleri okur; hata olursa açıklamasını döndürür.

        `probe`'dan farkı, sonuçların **çağırana** verilmesidir: canlı akış bu
        değerleri olay olarak yayımlar.
        """
        factory, error = self._resolve_factory()
        if factory is None:
            return [], error

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        username, password = credentials_of(spec)
        client = factory(url=spec.endpoint, timeout=timeout_s)
        if username is not None:
            client.set_user(username)
        if password is not None:
            client.set_password(password)

        try:
            async with client:
                readings: List[Tuple[str, Any]] = []
                for node_id in node_ids_of(spec):
                    node = client.get_node(node_id)
                    readings.append((node_id, await node.read_value()))
                return readings, None
        except Exception as error:  # noqa: BLE001
            return [], describe_network_error(error)
