"""Bağlayıcı arayüzü ve ortak saf yardımcılar.

Her bağlayıcı tek bir soruya yanıt verir: **cihazdan gerçek bir yanıt alındı
mı?** `probe` bunu dener ve `ProbeResult` döndürür. Başarı yalnızca cihazdan
somut bir şey alındığında (`evidence`) bildirilir.

Buradaki yardımcılar saftır ve ağ kullanmaz; bu yüzden hem sınanabilir hem de
bir cihaz olmadan çalıştırılabilirler. Ağ yapan tek şey adaptörlerin kendisidir.
"""

from __future__ import annotations

import socket
from typing import Optional, Protocol, Tuple
from urllib.parse import urlparse

from simulation_engine.runtime.types import ConnectionSpec, ProbeResult

#: Kütüphane kurulu değilse kullanılan açıklama.
#:
#: "Bağlanamadı" demek yanlış olurdu: hiçbir deneme yapılmadı. Kullanıcı neyin
#: eksik olduğunu ve ne yapması gerektiğini okur.
MISSING_LIBRARY_TEMPLATE = (
    "Doğrulanmadı: {library} kütüphanesi bu sunucuda kurulu değil, bu yüzden "
    "hiçbir bağlantı denemesi yapılmadı. Kurulum: pip install {package}"
)


class RuntimeAdapter(Protocol):
    """Bir bağlantı türünün sunucu tarafı sürücüsü."""

    kind: str

    async def probe(self, spec: ConnectionSpec) -> ProbeResult:
        """Cihaza bağlanıp gerçek bir yanıt almayı dener."""
        ...


def clamp_timeout_ms(value: Optional[int], lowest: int = 200, highest: int = 60_000) -> int:
    """Zaman aşımını kullanılabilir bir aralığa çeker.

    Çok küçük bir değer her bağlantıyı sahte biçimde başarısız gösterir; çok
    büyük bir değer bir isteği dakikalarca askıda tutar. `None` gelirse
    varsayılan 5 saniyedir.
    """
    if value is None:
        return 5_000
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 5_000
    return max(lowest, min(highest, number))


def clamp_qos(value: Optional[int]) -> int:
    """MQTT QoS değerini 0-2 aralığına çeker."""
    if value is None:
        return 1
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 1
    return max(0, min(2, number))


def split_endpoint(endpoint: str, default_port: Optional[int] = None) -> Tuple[str, Optional[int]]:
    """`ana:port` biçimindeki adresi ayırır.

    Şema içeren adresler (``opc.tcp://``) de kabul edilir; ayrıştırma başarısız
    olursa port `None` döner ve çağıran varsayılanını kullanır.
    """
    text = endpoint.strip()
    if "://" in text:
        parsed = urlparse(text)
        host = parsed.hostname or ""
        return host, parsed.port if parsed.port is not None else default_port

    if text.count(":") == 1:
        host, _, port_text = text.partition(":")
        try:
            return host.strip(), int(port_text)
        except ValueError:
            return host.strip(), default_port

    return text, default_port


def is_valid_endpoint(endpoint: str, schemes: Tuple[str, ...]) -> bool:
    """Adres beklenen şemalardan biriyle mi başlıyor?"""
    text = endpoint.strip().lower()
    return any(text.startswith(f"{scheme}://") for scheme in schemes)


def describe_network_error(error: BaseException) -> str:
    """Ağ hatasını kullanıcının anlayacağı bir cümleye çevirir.

    Ham istisna metni ("[Errno 111] Connection refused") bir operatöre hiçbir
    şey söylemez. Her cümle **ne yapılacağını** da içerir; hata mesajının işi
    sorunu adlandırmak değil, bir sonraki adımı göstermektir.
    """
    if isinstance(error, TimeoutError) or isinstance(error, socket.timeout):
        return (
            "Bağlantı kurulamadı: cihaz zaman aşımı süresinde yanıt vermedi. "
            "Adresi ve ağ erişimini kontrol edin."
        )
    if isinstance(error, ConnectionRefusedError):
        return (
            "Bağlantı kurulamadı: adres yanıt verdi ama bağlantıyı reddetti. "
            "Port numarasını ve cihazın sunucu hizmetinin açık olduğunu kontrol edin."
        )
    if isinstance(error, socket.gaierror):
        return (
            "Bağlantı kurulamadı: adres çözülemedi. Ana bilgisayar adını "
            "kontrol edin."
        )
    if isinstance(error, PermissionError):
        return (
            "Bağlantı kurulamadı: kimlik doğrulama reddedildi. Kullanıcı adı, "
            "parola ve güvenlik politikasını kontrol edin."
        )
    text = str(error).strip()
    detail = text if text else error.__class__.__name__
    return f"Bağlantı kurulamadı: {detail}"


def missing_library(library: str, package: str) -> str:
    """Kurulu olmayan kütüphane için açıklama."""
    return MISSING_LIBRARY_TEMPLATE.format(library=library, package=package)


def elapsed_ms(start: float, end: float) -> float:
    """İki `perf_counter` okuması arasındaki süre (ms).

    Negatif fark **sıfıra çekilir**: saat geri gitmiş olsa bile eksi bir
    gecikme ölçümü rapora giremez.
    """
    return max(0.0, (end - start) * 1000.0)


def failed(detail: str, latency_ms: Optional[float] = None) -> ProbeResult:
    """Başarısız deneme sonucu."""
    return ProbeResult(ok=False, latency_ms=latency_ms, detail=detail, evidence=None)


def succeeded(
    detail: str,
    evidence: str,
    latency_ms: Optional[float],
    bytes_received: Optional[int] = None,
) -> ProbeResult:
    """Başarılı deneme sonucu.

    `evidence` zorunludur: cihazdan ne alındığını yazamıyorsak, alındığını da
    iddia edemeyiz.
    """
    return ProbeResult(
        ok=True,
        latency_ms=latency_ms,
        detail=detail,
        evidence=evidence,
        bytes_received=bytes_received,
    )
