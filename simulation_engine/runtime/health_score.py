"""Runtime sağlık skoru (0-100).

Tek bir sayı, "köprü iyi durumda mı?" sorusunun hızlı yanıtıdır. Dört ölçüden
oluşur ve her birinin ağırlığı bir karardır:

* **Çalışma süresi (%40)** — en ağır olanı: veri akmıyorsa geri kalanı önemsiz.
* **Hata oranı (%25)** — akan verinin ne kadarının bozuk olduğu.
* **Yeniden bağlanma (%20)** — kararlılık; sık kopan bir hat izlenemez.
* **Gecikme (%15)** — en hafifi: yavaş ama düzenli veri, hızlı ama kesik
  veriden iyidir.

Ölçülemeyen skor yoktur
-----------------------
Hiçbir ölçü yoksa skor **hesaplanmaz** (`None`). Sıfır dönmek, hiç izlenmemiş
bir köprüyü "tamamen bozuk" diye raporlamak olurdu; yüz dönmek ise tersi.
Kısmi ölçümde skor, yalnızca **ölçülebilen** bileşenlerin ağırlıkları yeniden
normalize edilerek hesaplanır ve hangi bileşenin eksik olduğu yazılır.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

#: Bileşen ağırlıkları; toplamı 1.
WEIGHTS: Dict[str, float] = {
    "uptime": 0.40,
    "errors": 0.25,
    "reconnects": 0.20,
    "latency": 0.15,
}

#: Bu gecikmenin üstü "kötü" sayılır (ms).
#:
#: Bir saniyelik gecikme, saniyede bir yayınlayan bir cihazda verinin sürekli
#: geç gelmesi demektir.
LATENCY_CEILING_MS = 1_000.0

#: Bu kadar yeniden bağlanma "tamamen kararsız" sayılır.
RECONNECT_CEILING = 10


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def uptime_score(uptime_ms: Optional[float], window_ms: Optional[float]) -> Optional[float]:
    """Bağlantının pencerenin ne kadarında açık olduğu (0-1)."""
    if uptime_ms is None or window_ms is None or window_ms <= 0:
        return None
    return _clamp(uptime_ms / window_ms)


def error_score(packets: Optional[int], errors: Optional[int]) -> Optional[float]:
    """Hatasızlık oranı (0-1); hiç deneme yoksa `None`."""
    if packets is None or errors is None:
        return None
    total = max(0, packets) + max(0, errors)
    if total == 0:
        return None
    return _clamp(1.0 - (max(0, errors) / total))


def reconnect_score(reconnects: Optional[int]) -> Optional[float]:
    """Kararlılık (0-1); ölçülmediyse `None`.

    Sıfır yeniden bağlanma tam puandır; tavan aşıldığında puan sıfırlanır.
    """
    if reconnects is None:
        return None
    return _clamp(1.0 - (max(0, reconnects) / RECONNECT_CEILING))


def latency_score(avg_latency_ms: Optional[float]) -> Optional[float]:
    """Gecikme puanı (0-1); ölçülmediyse `None`."""
    if avg_latency_ms is None or avg_latency_ms < 0:
        return None
    return _clamp(1.0 - (avg_latency_ms / LATENCY_CEILING_MS))


@dataclass(frozen=True)
class HealthInput:
    """Skorun girdisi; hepsi ölçüm olmayabilir."""

    uptime_ms: Optional[float] = None
    window_ms: Optional[float] = None
    packets: Optional[int] = None
    errors: Optional[int] = None
    reconnects: Optional[int] = None
    avg_latency_ms: Optional[float] = None


@dataclass
class HealthScore:
    """Skor ve bileşenleri."""

    #: 0-100 arası; hiçbir bileşen ölçülemediyse `None`.
    score: Optional[float]
    components: Dict[str, Optional[float]] = field(default_factory=dict)
    #: Ölçülemeyen bileşenler.
    missing: list = field(default_factory=list)

    @property
    def label(self) -> str:
        """Skorun okunur karşılığı."""
        if self.score is None:
            return "Ölçülmedi"
        if self.score >= 85:
            return "İyi"
        if self.score >= 60:
            return "Dikkat"
        return "Kötü"

    def to_dict(self) -> Dict[str, object]:
        return {
            "score": self.score,
            "label": self.label,
            "components": dict(self.components),
            "missing": list(self.missing),
        }


def compute_health_score(data: HealthInput) -> HealthScore:
    """Sağlık skorunu hesaplar (0-100)."""
    components: Dict[str, Optional[float]] = {
        "uptime": uptime_score(data.uptime_ms, data.window_ms),
        "errors": error_score(data.packets, data.errors),
        "reconnects": reconnect_score(data.reconnects),
        "latency": latency_score(data.avg_latency_ms),
    }

    measured = {name: value for name, value in components.items() if value is not None}
    missing = [name for name, value in components.items() if value is None]

    if not measured:
        return HealthScore(score=None, components=components, missing=missing)

    # Eksik bileşenlerin ağırlığı ölçülebilenlere dağıtılır; eksik bileşeni
    # sıfır saymak, ölçülmemiş bir şeyi "kötü" diye puanlamak olurdu.
    total_weight = sum(WEIGHTS[name] for name in measured)
    weighted = sum(WEIGHTS[name] * value for name, value in measured.items())

    return HealthScore(
        score=round((weighted / total_weight) * 100, 1),
        components=components,
        missing=missing,
    )


def is_valid_score(value: Optional[float]) -> bool:
    """Skor geçerli mi? (`None` ya da 0-100 arası sonlu sayı)"""
    if value is None:
        return True
    return isinstance(value, (int, float)) and value == value and 0.0 <= value <= 100.0
