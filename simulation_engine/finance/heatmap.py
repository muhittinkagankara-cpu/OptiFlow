"""İstasyon ısı skoru: "param nerede yanıyor?" sorusunun tek sayılık cevabı.

Bu modül de finans katmanının geri kalanı gibi **hiçbir şey ölçmez ve hiçbir
şeyi yeniden hesaplamaz**. Kayıp motorunun ürettiği istasyon bazlı kayıpları ve
motorun zaten saydığı oranları (kullanım, blokaj, fire) alır; bunları tek bir
0–100 skoruna indirger. Simülasyon matematiğine dokunulmaz, finans hesabı
tekrarlanmaz.

Skorun neden **göreli** olduğu — ve bunun neden açıkça söylenmesi gerektiği
------------------------------------------------------------------------
Kayıp bileşeni, istasyonun kaybının **o koşumdaki en kötü istasyona** oranıdır.
Bunun sebebi basit: "1.400 TL kayıp" tek başına ne iyi ne kötüdür; anlamı
ancak fabrikanın geri kalanıyla kıyaslandığında ortaya çıkar. Isı haritasının
sorduğu soru da zaten karşılaştırmalıdır: *hangi* istasyon en çok yakıyor.

Bunun bir bedeli vardır ve gizlenmemelidir: kayıpların tamamı önemsizse bile
en kötü istasyon yine kırmızıya boyanır. Bu yüzden `is_relative` bayrağı ve
mutlak tutar her zaman skorla birlikte taşınır; arayüz kırmızı bir kutunun
yanında "1.400 TL" yazmadan onu göstermemelidir. Aksi hâlde 5 TL kaybeden bir
fabrikaya "burası yanıyor" demiş oluruz.

Ağırlıklar
----------
    %40  finansal kayıp   — paranın kendisi; en ağır bileşen
    %25  kullanım oranı   — kısıt riskinin nerede toplandığı
    %20  bekleme (blokaj) — çıkışı tıkalı geçen süre
    %15  fire oranı       — kaliteden kaynaklı kayıp
"""

from __future__ import annotations

from typing import Dict, List, Sequence

from simulation_engine.finance.models import (
    HeatBand,
    HeatComponent,
    StationFinancialImpact,
    StationHeat,
)
from simulation_engine.models.schemas import StationRunMetrics

#: Bileşen ağırlıkları. Toplamı 1.0 olmalıdır; `_assert_weights` bunu yükleme
#: anında doğrular — ağırlıklardan biri değiştirilip toplam bozulduğunda skor
#: sessizce 100'ün altında ya da üstünde sıkışırdı.
WEIGHT_LOSS: float = 0.40
WEIGHT_UTILIZATION: float = 0.25
WEIGHT_WAITING: float = 0.20
WEIGHT_SCRAP: float = 0.15

#: Bant sınırları. Alt sınır dâhil, üst sınır hariçtir: tam 25 sarıdır,
#: tam 75 kırmızıdır. Sınırın hangi tarafa ait olduğu belirsiz bırakılsaydı,
#: aynı skor iki farklı yerde iki farklı renk alabilirdi.
GREEN_MAX: float = 25.0
YELLOW_MAX: float = 50.0
ORANGE_MAX: float = 75.0

#: Skorun üst sınırı.
MAX_SCORE: float = 100.0


def _assert_weights() -> None:
    total = WEIGHT_LOSS + WEIGHT_UTILIZATION + WEIGHT_WAITING + WEIGHT_SCRAP
    if abs(total - 1.0) > 1e-9:
        raise ValueError(
            f"Isi skoru agirliklarinin toplami 1.0 olmalidir, hesaplanan: {total}"
        )


_assert_weights()


def clamp01(value: float) -> float:
    """Değeri 0–1 aralığına sıkıştırır.

    Motorun oranları zaten bu aralıktadır; sıkıştırma, kayan nokta artıkları
    (ör. 1.0000000002) yüzünden skorun 100'ü aşmasını engeller.
    """
    if value != value:  # NaN
        return 0.0
    return max(0.0, min(1.0, value))


def scrap_rate(metrics: StationRunMetrics) -> float:
    """İstasyonun fire oranı: hurda / (üretilen + hurda).

    Payda üretilen ve hurdaya ayrılan birimlerin toplamıdır — yani istasyonun
    işlediği her şey. Yalnızca `units_produced`'a bölünseydi, her parçası
    hurdaya çıkan bir istasyonda oran 1'i aşardı.
    """
    handled = metrics.units_produced + metrics.units_scrapped
    if handled <= 0:
        return 0.0
    return clamp01(metrics.units_scrapped / handled)


def band_for(score: float) -> HeatBand:
    """Skoru renk bandına çevirir.

    Sınırlar alt uçtan dâhildir: 0–25 yeşil, 25–50 sarı, 50–75 turuncu,
    75–100 kırmızı.
    """
    if score < GREEN_MAX:
        return HeatBand.GREEN
    if score < YELLOW_MAX:
        return HeatBand.YELLOW
    if score < ORANGE_MAX:
        return HeatBand.ORANGE
    return HeatBand.RED


def _component(
    name: str, label: str, raw: float, normalized: float, weight: float
) -> HeatComponent:
    normalized = clamp01(normalized)
    return HeatComponent(
        name=name,
        label=label,
        raw_value=raw,
        normalized=normalized,
        weight=weight,
        contribution=normalized * weight * MAX_SCORE,
    )


def compute_station_heat(
    metrics: StationRunMetrics,
    impact: StationFinancialImpact,
    max_loss: float,
) -> StationHeat:
    """Tek bir istasyonun ısı skorunu üretir.

    Args:
        metrics: Motorun saydığı ham oranlar (kullanım, blokaj, fire).
        impact: Kayıp motorunun ürettiği parasal döküm.
        max_loss: Koşumdaki en yüksek istasyon kaybı. Kayıp bileşeni buna
            göre normalleştirilir; sıfırsa kayıp bileşeni herkes için sıfırdır
            (kimse "en kötü" ilan edilmez).

    Returns:
        Skor, bant ve bileşen dökümü. Döküm arayüzün ipucu balonunda
        gösterilir: bir kutunun neden kırmızı olduğu, kutuya bakan kişi
        tarafından okunabilmelidir.
    """
    loss_normalized = impact.total_loss / max_loss if max_loss > 0.0 else 0.0

    components = [
        _component(
            "loss",
            "Finansal kayıp",
            impact.total_loss,
            loss_normalized,
            WEIGHT_LOSS,
        ),
        _component(
            "utilization",
            "Kullanım oranı",
            metrics.utilization,
            metrics.utilization,
            WEIGHT_UTILIZATION,
        ),
        _component(
            "waiting",
            "Bekleme (blokaj)",
            metrics.blocked_fraction,
            metrics.blocked_fraction,
            WEIGHT_WAITING,
        ),
        _component(
            "scrap",
            "Fire oranı",
            scrap_rate(metrics),
            scrap_rate(metrics),
            WEIGHT_SCRAP,
        ),
    ]

    score = sum(item.contribution for item in components)
    # Kayan nokta artiklarina karsi: skor tanim geregi 0-100 araligindadir.
    score = max(0.0, min(MAX_SCORE, score))

    return StationHeat(
        station_id=impact.station_id,
        station_name=impact.station_name,
        score=score,
        band=band_for(score),
        components=components,
        total_loss=impact.total_loss,
        is_bottleneck=impact.is_bottleneck,
        is_relative=max_loss > 0.0,
    )


def compute_heatmap(
    stations: Sequence[StationRunMetrics],
    impacts: Sequence[StationFinancialImpact],
) -> List[StationHeat]:
    """Tüm istasyonların ısı skorunu üretir; en sıcaktan en soğuğa sıralar.

    Metrikler ve kayıp dökümü istasyon kimliğiyle eşleştirilir. Eşleşmeyen bir
    kayıp kaydı sessizce atlanmaz — böyle bir durum, iki listenin farklı
    koşumlardan geldiği anlamına gelir ve sessiz bir yanlış eşleştirme,
    kullanıcıya başka bir istasyonun rakamlarını gösterirdi.

    Raises:
        KeyError: Bir kayıp kaydının karşılığı metriklerde bulunamazsa.
    """
    by_id: Dict[str, StationRunMetrics] = {
        item.station_id: item for item in stations
    }
    max_loss = max((item.total_loss for item in impacts), default=0.0)

    heat = [
        compute_station_heat(by_id[impact.station_id], impact, max_loss)
        for impact in impacts
    ]
    return sorted(heat, key=lambda item: item.score, reverse=True)


def top_loss_stations(
    heat: Sequence[StationHeat], limit: int = 5
) -> List[StationHeat]:
    """En çok para kaybettiren istasyonlar (skora göre değil, **paraya** göre).

    Isı skoru kullanımı ve fireyi de içerdiği için en sıcak istasyon her zaman
    en pahalı istasyon değildir. "Top Loss" panelinin sorduğu soru parasaldır;
    bu yüzden sıralama doğrudan tutara göredir. İkisini aynı sıralamayla
    göstermek, "en sıcak" ile "en pahalı"yı karıştırmak olurdu.
    """
    ranked = [item for item in heat if item.total_loss > 0.0]
    ranked.sort(key=lambda item: item.total_loss, reverse=True)
    return ranked[:limit]
