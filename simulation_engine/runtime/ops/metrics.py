"""Süreç ölçümleri: çalışma süresi, bellek, işlemci, hata oranı.

Ölçülemeyen değer `None`
------------------------
Bellek ve işlemci ölçümü `psutil` gerektirir. Paket yoksa değer **uydurulmaz**:
`None` döner ve arayüz "ölçülmedi" yazar. Sıfır dönmek, hiç bellek kullanmayan
bir sunucu göstermek olurdu — bu, ölçüm eksikliğini fark edilmez kılardı.

İşlemci ölçümünün özel durumu
-----------------------------
`psutil.cpu_percent()` ilk çağrısında **her zaman 0.0** döner; bu bir ölçüm
değil, iki çağrı arasındaki farkı hesaplamak için tutulan başlangıç noktasıdır.
Bu yüzden ilk çağrının sonucu ölçüm sayılmaz ve `None` olarak bildirilir.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

#: Hata oranı hesabında saklanan en fazla istek kaydı.
#:
#: Bin istek, yoğun bir dakikayı kapsar. Sınırsız bırakılsaydı, günlerce
#: çalışan bir süreçte liste sürekli büyürdü.
MAX_SAMPLES = 1_000


def _psutil():
    """`psutil`; kurulu değilse `None`."""
    try:
        import psutil  # type: ignore import-not-found

        return psutil
    except ImportError:
        return None


def memory_mb() -> Optional[float]:
    """Sürecin kullandığı bellek (MB); ölçülemiyorsa `None`."""
    module = _psutil()
    if module is None:
        return None
    try:
        return module.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:  # noqa: BLE001 — ölçüm hatası sunucuyu düşürmez
        return None


@dataclass
class CpuSampler:
    """İşlemci kullanımını ölçer.

    Durum tutar çünkü `cpu_percent` iki çağrı arasındaki farkı verir; ilk
    çağrı bir ölçüm değildir ve `None` döner.
    """

    _primed: bool = False

    def percent(self) -> Optional[float]:
        module = _psutil()
        if module is None:
            return None
        try:
            value = module.Process(os.getpid()).cpu_percent(interval=None)
        except Exception:  # noqa: BLE001
            return None

        if not self._primed:
            # İlk çağrı başlangıç noktasını kurar; sonucu ölçüm değildir.
            self._primed = True
            return None
        return float(value)


@dataclass
class RequestCounter:
    """İstek ve hata sayacı; hata oranı buradan çıkar."""

    total: int = 0
    errors: int = 0
    _recent: List[bool] = field(default_factory=list)

    def note(self, ok: bool) -> None:
        self.total += 1
        if not ok:
            self.errors += 1
        self._recent.append(ok)
        if len(self._recent) > MAX_SAMPLES:
            del self._recent[0 : len(self._recent) - MAX_SAMPLES]

    def error_rate(self) -> Optional[float]:
        """Hata oranı (0-1); hiç istek görülmediyse `None`.

        Sıfır dönmek, hiç istek almamış bir sunucuyu "hatasız" diye
        raporlamak olurdu — oysa henüz **ölçülmemiştir**.
        """
        if self.total == 0:
            return None
        return self.errors / self.total

    def recent_error_rate(self) -> Optional[float]:
        """Son isteklerdeki hata oranı; pencere boşsa `None`."""
        if not self._recent:
            return None
        failures = len([item for item in self._recent if not item])
        return failures / len(self._recent)

    def reset(self) -> None:
        self.total = 0
        self.errors = 0
        self._recent.clear()


@dataclass
class ProcessMetrics:
    """Sürecin ölçümlerini toplar."""

    started_at_ms: int
    clock: Callable[[], int] = lambda: int(time.time() * 1000)
    cpu: CpuSampler = field(default_factory=CpuSampler)
    requests: RequestCounter = field(default_factory=RequestCounter)

    def uptime_ms(self, now_ms: Optional[int] = None) -> int:
        """Sürecin ayakta olduğu süre (ms); negatif olmaz."""
        moment = now_ms if now_ms is not None else self.clock()
        return max(0, moment - self.started_at_ms)

    def snapshot(self, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Monitoring ekranının okuduğu ölçümler."""
        uptime = self.uptime_ms(now_ms)
        return {
            "uptime_ms": uptime,
            "uptime_seconds": round(uptime / 1_000, 1),
            "memory_mb": _rounded(memory_mb()),
            "cpu_percent": _rounded(self.cpu.percent()),
            "requests": self.requests.total,
            "errors": self.requests.errors,
            "error_rate": _rounded(self.requests.error_rate(), 4),
            "recent_error_rate": _rounded(self.requests.recent_error_rate(), 4),
            "measurement_available": _psutil() is not None,
        }


def _rounded(value: Optional[float], digits: int = 2) -> Optional[float]:
    return None if value is None else round(value, digits)
