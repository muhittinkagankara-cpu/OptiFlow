"""Saklama politikası ve temizleme işi.

Neden gerekli
-------------
Telemetri tablosu kendiliğinden küçülmez. Saniyede on ölçüm üreten bir hat
ayda yaklaşık 26 milyon satır yazar; iki yıl sonra tablo yarım milyar satıra
çıkar ve trend sorgusu indeksli olsa bile yavaşlar. Diski dolduran bir izleme
sistemi, izlediği hattı da durdurur.

Neden turlar hâlinde
--------------------
Tek bir `DELETE`, milyonlarca satırı silerken uzun süren bir kilit tutar ve o
sırada yazmalar bekler. Turlara bölmek, temizliğin canlı sistemde
çalıştırılabilmesini sağlar; bir tur eksik kalırsa bir sonraki tur devam eder.

Neden silinen sayı raporlanır
-----------------------------
"Temizlik çalıştı" demek yetmez: kaç satırın silindiği görülmezse, hiç
çalışmayan bir işle her turda binlerce satır silen bir iş aynı görünür.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from simulation_engine.runtime.telemetry.types import (
    CLEANUP_BATCH,
    DEFAULT_RETENTION_DAYS,
)

#: Temizliğin en sık çalışabileceği aralık (ms).
#:
#: Bir saat, saklama penceresi gün cinsinden ölçüldüğü için fazlasıyla
#: sıktır; daha sık çalıştırmak veritabanını boş yere meşgul ederdi.
CLEANUP_INTERVAL_MS = 3_600_000

#: Kabul edilen en kısa ve en uzun saklama süresi (gün).
#:
#: Alt sınır, bir vardiyanın kaybolmasını engeller: bir günden kısa bir
#: pencere, gece vardiyasının verisini sabah toplantısından önce silerdi.
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650

DAY_MS = 86_400_000


def clamp_retention_days(days: Optional[int]) -> int:
    """Saklama süresini kabul edilen aralığa çeker.

    `None` ya da geçersiz bir değer varsayılana düşer; sıfır ya da negatif bir
    süre kabul edilseydi, temizlik bütün tabloyu silerdi.
    """
    if days is None:
        return DEFAULT_RETENTION_DAYS
    try:
        value = int(days)
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_DAYS
    return max(MIN_RETENTION_DAYS, min(MAX_RETENTION_DAYS, value))


def cutoff_ms(now_ms: int, retention_days: int) -> int:
    """Bu andan önce yazılmış ölçümlerin silineceği sınır."""
    return now_ms - clamp_retention_days(retention_days) * DAY_MS


@dataclass
class RetentionPolicy:
    """Bir kiracının saklama ayarı."""

    retention_days: int = DEFAULT_RETENTION_DAYS
    batch_size: int = CLEANUP_BATCH
    interval_ms: int = CLEANUP_INTERVAL_MS

    def __post_init__(self) -> None:
        self.retention_days = clamp_retention_days(self.retention_days)
        self.batch_size = max(1, int(self.batch_size))
        self.interval_ms = max(1, int(self.interval_ms))

    def cutoff_ms(self, now_ms: int) -> int:
        return cutoff_ms(now_ms, self.retention_days)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "retention_days": self.retention_days,
            "batch_size": self.batch_size,
            "interval_ms": self.interval_ms,
        }


@dataclass
class CleanupResult:
    """Bir temizleme turunun sonucu."""

    deleted: int
    cutoff_ms: int
    #: Tur sınırına dayanıldı mı? Dayanıldıysa silinecek satır kalmış olabilir.
    truncated: bool
    #: Kalan en eski ölçümün anı; tablo boşsa `None`.
    oldest_remaining_ms: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "deleted": self.deleted,
            "cutoff_ms": self.cutoff_ms,
            "truncated": self.truncated,
            "oldest_remaining_ms": self.oldest_remaining_ms,
        }


class CleanupJob:
    """Saklama süresini aşan ölçümleri silen iş.

    Zamanı kendisi okumaz: `run(now_ms)` çağıranın verdiği anı kullanır.
    İçeride `time.time()` çağrılsaydı, temizlik davranışı testte
    doğrulanamazdı.
    """

    def __init__(self, repository, policy: Optional[RetentionPolicy] = None) -> None:
        self._repository = repository
        self._policy = policy or RetentionPolicy()
        self._last_run_ms: Optional[int] = None
        self._total_deleted = 0
        self._runs = 0
        self._errors = 0
        self._last_error: Optional[str] = None

    @property
    def policy(self) -> RetentionPolicy:
        return self._policy

    @property
    def last_run_ms(self) -> Optional[int]:
        """Son turun anı; hiç çalışmadıysa `None`."""
        return self._last_run_ms

    def due(self, now_ms: int) -> bool:
        """Yeni bir tur zamanı geldi mi?"""
        if self._last_run_ms is None:
            return True
        return now_ms - self._last_run_ms >= self._policy.interval_ms

    def run(self, org_id: str, now_ms: int) -> CleanupResult:
        """Bir tur temizlik yapar.

        Silme başarısız olursa sıfır silinmiş sayılır ve hata kaydedilir;
        istisna dışarı sızsaydı, arka plan görevi tamamen dururdu.
        """
        limit = self._policy.cutoff_ms(now_ms)
        self._runs += 1
        self._last_run_ms = now_ms
        try:
            deleted = int(
                self._repository.delete_telemetry_before(
                    org_id, limit, self._policy.batch_size
                )
            )
        except Exception as error:
            self._errors += 1
            self._last_error = str(error)
            return CleanupResult(deleted=0, cutoff_ms=limit, truncated=False)
        self._total_deleted += deleted
        oldest = None
        try:
            oldest = self._repository.oldest_telemetry_ms(org_id)
        except Exception:  # okuma hatası temizliğin sonucunu geçersiz kılmaz
            oldest = None
        return CleanupResult(
            deleted=deleted,
            cutoff_ms=limit,
            truncated=deleted >= self._policy.batch_size,
            oldest_remaining_ms=oldest,
        )

    def stats(self) -> Dict[str, Any]:
        return {
            "runs": self._runs,
            "total_deleted": self._total_deleted,
            "errors": self._errors,
            "last_error": self._last_error,
            "last_run_ms": self._last_run_ms,
            "policy": self._policy.to_dict(),
        }
