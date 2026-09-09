"""OEE — üç çarpanın birleşimi.

    OEE = Availability × Performance × Quality

Bir çarpan bile hesaplanamıyorsa OEE **hesaplanamaz**
-----------------------------------------------------
Eksik çarpanı 1 varsaymak (yani "sorun yoktur") en tehlikeli seçenek olurdu:
kalitesi hiç ölçülmemiş bir hat, %92 OEE ile mükemmel görünür ve fire hiç fark
edilmez. Eksik çarpanı 0 varsaymak da yanlıştır; ölçülmemiş bir şeyi sıfır
saymak, çalışan bir hattı durmuş göstermek demektir.

Doğru yanıt üçüncüsüdür: **bilinmiyor**. `None` döner, arayüz "—" gösterir ve
hangi çarpanın eksik olduğunu yazar.

Yüzde mi oran mı
----------------
Motor 0-1 arası **oran** üretir; yüzdeye çevirme arayüzün işidir. İkisi
karışırsa 0,92 ile %92 aynı alanda görünür ve bir yerde 100 kat hata olur.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from simulation_engine.runtime.oee.availability import (
    availability,
    availability_reason,
    run_time_ms,
)
from simulation_engine.runtime.oee.performance import performance, performance_reason
from simulation_engine.runtime.oee.quality import quality, quality_reason


@dataclass(frozen=True)
class OeeInput:
    """OEE hesabı için gereken ölçümler.

    Hepsi `Optional`: gerçek bir hatta çoğu zaman bir kısmı eksiktir ve eksik
    olan uydurulmaz.
    """

    #: Vardiyanın planlanan üretim süresi (ms).
    planned_time_ms: Optional[float] = None
    #: Ölçülen toplam duruş (ms).
    downtime_ms: Optional[float] = None
    #: Sağlam üretim adedi.
    good_parts: Optional[float] = None
    #: Fire adedi.
    scrap_parts: Optional[float] = None
    #: İdeal çevrim süresi (sn/parça).
    ideal_cycle_seconds: Optional[float] = None


@dataclass(frozen=True)
class OeeResult:
    """OEE ve üç çarpanı; hesaplanamayan alan `None`."""

    availability: Optional[float]
    performance: Optional[float]
    quality: Optional[float]
    oee: Optional[float]
    #: Hangi çarpan neden hesaplanamadı?
    reasons: Dict[str, str]

    @property
    def is_complete(self) -> bool:
        return self.oee is not None

    def as_percent(self) -> Dict[str, Optional[float]]:
        """Yüzdeye çevrilmiş kopya; arayüz bunu gösterir."""
        return {
            "availability": None if self.availability is None else self.availability * 100,
            "performance": None if self.performance is None else self.performance * 100,
            "quality": None if self.quality is None else self.quality * 100,
            "oee": None if self.oee is None else self.oee * 100,
        }

    def to_dict(self) -> Dict[str, object]:
        return {
            "availability": self.availability,
            "performance": self.performance,
            "quality": self.quality,
            "oee": self.oee,
            "percent": self.as_percent(),
            "reasons": dict(self.reasons),
            "complete": self.is_complete,
        }


def compute_oee(data: OeeInput) -> OeeResult:
    """Üç çarpanı ve OEE'yi hesaplar."""
    run_ms = run_time_ms(data.planned_time_ms, data.downtime_ms)

    availability_value = availability(data.planned_time_ms, data.downtime_ms)
    performance_value = performance(
        data.good_parts, run_ms, data.ideal_cycle_seconds
    )
    quality_value = quality(data.good_parts, data.scrap_parts)

    reasons: Dict[str, str] = {}
    availability_why = availability_reason(data.planned_time_ms, data.downtime_ms)
    if availability_why is not None:
        reasons["availability"] = availability_why

    performance_why = performance_reason(
        data.good_parts, run_ms, data.ideal_cycle_seconds
    )
    if performance_why is not None:
        reasons["performance"] = performance_why

    quality_why = quality_reason(data.good_parts, data.scrap_parts)
    if quality_why is not None:
        reasons["quality"] = quality_why

    factors = [availability_value, performance_value, quality_value]
    oee_value = (
        availability_value * performance_value * quality_value  # type: ignore[operator]
        if all(factor is not None for factor in factors)
        else None
    )

    if oee_value is None and "oee" not in reasons:
        missing = [
            name
            for name, value in (
                ("kullanılabilirlik", availability_value),
                ("performans", performance_value),
                ("kalite", quality_value),
            )
            if value is None
        ]
        reasons["oee"] = (
            "Şu çarpanlar hesaplanamadı: " + ", ".join(missing) + "."
            if missing
            else "OEE hesaplanamadı."
        )

    return OeeResult(
        availability=availability_value,
        performance=performance_value,
        quality=quality_value,
        oee=oee_value,
        reasons=reasons,
    )


def line_oee(results: List[OeeResult]) -> Optional[float]:
    """Hattın OEE'si — makine OEE'lerinin ortalaması.

    Yalnızca **hesaplanabilmiş** makineler ortalamaya girer; eksik olanı sıfır
    saymak hattı olduğundan kötü, bir saymak olduğundan iyi gösterirdi. Hiçbir
    makinenin OEE'si hesaplanamıyorsa hattınki de hesaplanamaz.
    """
    values = [item.oee for item in results if item.oee is not None]
    return sum(values) / len(values) if values else None


def is_valid_oee(value: Optional[float]) -> bool:
    """Değer geçerli bir OEE mi? (`None` ya da 0-1 arası sonlu sayı)

    Kabul listesi bunu kullanır: NaN, sonsuz ya da aralık dışı bir OEE,
    hesaplama hatasının en görünür işaretidir.
    """
    if value is None:
        return True
    return isinstance(value, (int, float)) and value == value and 0.0 <= value <= 1.0
