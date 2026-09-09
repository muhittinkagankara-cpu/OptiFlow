"""REST bağlayıcısı — sunucu tarafı.

Frontend'deki REST runtime (SALES-7) korunur; bu, aynı işi **sunucudan** yapan
ikinci bir yoldur. Fark önemlidir: tarayıcıdan yapılan çağrı fabrika ağına
ulaşamaz ve CORS'a takılır, sunucudan yapılan çağrı ise fabrika ağının içinden
gider.

Bağımlılık eklenmez: `urllib.request` standart kütüphanededir ve bu iş için
yeterlidir. `httpx` yalnızca test bağımlılığıdır; çalışma zamanı için ikinci
bir HTTP istemcisi kurmak, kazancı olmayan bir bakım yüküdür.

Çağrı bir iş parçacığına verilir (`asyncio.to_thread`); `urllib` engelleyicidir
ve olay döngüsünde doğrudan çağrılsaydı tek bir yavaş cihaz tüm sunucuyu
durdururdu.
"""

from __future__ import annotations

import asyncio
import time
import urllib.error
import urllib.request
from typing import Dict, Optional, Tuple

from simulation_engine.runtime.adapters.base import (
    clamp_timeout_ms,
    describe_network_error,
    elapsed_ms,
    failed,
    is_valid_endpoint,
    succeeded,
)
from simulation_engine.runtime.types import ConnectionSpec, ProbeResult

#: Yanıttan okunacak en fazla bayt.
#:
#: Bir uç yanlışlıkla devasa bir gövde döndürebilir; kanıt için ilk birkaç
#: kilobayt yeterlidir ve gerisi belleğe alınmaz.
MAX_BODY_BYTES = 64 * 1024


def classify_status(status_code: int) -> Tuple[bool, str]:
    """HTTP durum kodunu "doğrulandı mı?" sorusuna çevirir.

    2xx ve 3xx **gerçek bir yanıttır**: uç ayakta ve konuşuyor. 4xx de bir
    yanıttır ama isteğin kendisi reddedilmiştir; bu bir bağlantı doğrulaması
    sayılmaz çünkü veri akmayacaktır. 5xx sunucunun kendi arızasıdır.
    """
    if 200 <= status_code < 400:
        return True, f"HTTP {status_code}: uç yanıt verdi."
    if status_code in (401, 403):
        return False, (
            f"Bağlantı kurulamadı: uç {status_code} döndürdü (yetki reddedildi). "
            "Kimlik bilgilerini kontrol edin."
        )
    if status_code == 404:
        return False, (
            "Bağlantı kurulamadı: uç 404 döndürdü. Yol (path) doğru mu kontrol edin."
        )
    if 400 <= status_code < 500:
        return False, f"Bağlantı kurulamadı: uç {status_code} döndürdü (istek reddedildi)."
    return False, f"Bağlantı kurulamadı: uç {status_code} döndürdü (sunucu hatası)."


def build_headers(spec: ConnectionSpec) -> Dict[str, str]:
    """İstek başlıkları.

    Kullanıcı adı ve parola verilmişse temel kimlik doğrulama başlığı eklenir;
    verilmemişse hiçbir kimlik başlığı gönderilmez — boş bir `Authorization`
    başlığı bazı uçlarda 400 üretir.
    """
    headers = {"Accept": "application/json, text/plain;q=0.9, */*;q=0.5"}
    if spec.username:
        import base64

        raw = f"{spec.username}:{spec.password or ''}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    return headers


def _fetch(url: str, headers: Dict[str, str], timeout_s: float) -> Tuple[int, bytes]:
    """Engelleyici HTTP çağrısı; ayrı iş parçacığında çalıştırılır."""
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        body = response.read(MAX_BODY_BYTES)
        return int(response.status), body


class RestAdapter:
    """HTTP uçlarına bağlanan sürücü."""

    kind = "rest"

    def __init__(self, fetch=None) -> None:
        """`fetch` testlerde değiştirilebilir; varsayılan gerçek ağ çağrısıdır."""
        self._fetch = fetch if fetch is not None else _fetch

    async def probe(self, spec: ConnectionSpec) -> ProbeResult:
        if not is_valid_endpoint(spec.endpoint, ("http", "https")):
            return failed(
                "Bağlantı kurulamadı: adres http:// ya da https:// ile başlamalı."
            )

        timeout_s = clamp_timeout_ms(spec.timeout_ms) / 1000.0
        headers = build_headers(spec)
        started = time.perf_counter()

        try:
            status_code, body = await asyncio.to_thread(
                self._fetch, spec.endpoint, headers, timeout_s
            )
        except urllib.error.HTTPError as error:
            # HTTPError bir yanıttır: uç konuştu ama olumsuz yanıt verdi.
            latency = elapsed_ms(started, time.perf_counter())
            _, detail = classify_status(int(error.code))
            return failed(detail, latency)
        except urllib.error.URLError as error:
            latency = elapsed_ms(started, time.perf_counter())
            reason = error.reason if isinstance(error.reason, BaseException) else error
            return failed(describe_network_error(reason), latency)
        except Exception as error:  # noqa: BLE001 — her ağ hatası kullanıcıya çevrilir
            latency = elapsed_ms(started, time.perf_counter())
            return failed(describe_network_error(error), latency)

        latency = elapsed_ms(started, time.perf_counter())
        ok, detail = classify_status(status_code)
        if not ok:
            return failed(detail, latency)

        return succeeded(
            detail=detail,
            evidence=f"HTTP {status_code}, {len(body)} bayt gövde alındı.",
            latency_ms=latency,
            bytes_received=len(body),
        )


def preview_body(body: bytes, limit: int = 120) -> Optional[str]:
    """Gövdenin kısa, okunabilir önizlemesi; çözülemezse `None`."""
    if not body:
        return None
    try:
        text = body.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None
    cleaned = " ".join(text.split())
    return cleaned[:limit] if cleaned else None
