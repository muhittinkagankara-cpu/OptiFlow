"""Kayıpların parasal karşılığının hesaplanması.

Bu modül **hiçbir şey ölçmez**. Motorun zaten saydığı büyüklükleri alır ve
işletmenin maliyet oranlarıyla çarpar. Tüm işlevler saftır: aynı girdi her
zaman aynı çıktıyı verir, yan etkisi yoktur, veritabanına ya da ağa dokunmaz.
Bu, finansal rakamların bir simülasyon koşumu olmadan da (ör. testte, ileride
bir "ya olsaydı" karşılaştırmasında) hesaplanabilmesini sağlar.

Formüller
---------
    Downtime Loss    = arıza saati        × machine_cost_per_hour
    Waiting Loss     = bloke saati        × labor_cost_per_hour
    Scrap Loss       = hurda adedi        × scrap_cost_per_unit
    Opportunity Loss = kayıp birim        × contribution_margin
    Total            = yukarıdakilerin toplamı

İki karar formüllerin kendisinden daha önemlidir
------------------------------------------------
**Eksik oran sıfır değildir.** Bir oran verilmediğinde ilgili kalem hesaba
katılmaz ve `missing_inputs` içinde adı geçer. Sıfır kabul edilseydi, hiç
maliyet girmemiş bir kullanıcı "toplam kaybınız 0 TL" yanıtını alır ve bunu
iyi bir haber sanardı.

**Fırsat maliyeti her açlıkta oluşmaz.** Darboğazın boşta beklediği süre,
yalnızca kısıt **içerideyse** (sistem kapasiteyle sınırlıysa) kaybedilmiş
üretimdir. Kısıt dışarıdaysa — yani talep yetersizse — aynı boş süre bir kayıp
değil, sadece kullanılmayan kapasitedir; onu paraya çevirmek olmayan bir zararı
rapor etmek olurdu. Bu ayrım motorun kendi kuralıyla (`CRITICAL_UTILIZATION`)
yapılır; burada yeni bir eşik uydurulmaz.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from simulation_engine.analytics.bottleneck import CRITICAL_UTILIZATION
from simulation_engine.finance.models import (
    REQUIRED_RATE_BY_COMPONENT,
    FinancialImpact,
    FinancialReport,
    FinancialSettings,
    ImprovementSuggestion,
    LossComponent,
    MetricProvenance,
    StationFinancialImpact,
)
from simulation_engine.models.schemas import BottleneckAnalysis, StationRunMetrics

MINUTES_PER_HOUR: float = 60.0

#: Kestirime dayanan payın güveni ne kadar düşürdüğü. Tümüyle kestirimden
#: oluşan bir sonuç, oranların tamamı verilmiş olsa bile bu kadar iskonto
#: görür: sayımla kestirim aynı ağırlıkta sunulmamalıdır.
ESTIMATE_CONFIDENCE_DISCOUNT: float = 0.30

#: Kullanıcıya gösterilecek kalem adları.
COMPONENT_LABELS: Dict[str, str] = {
    "downtime_loss": "Arıza kaybı",
    "waiting_loss": "Bekleme kaybı",
    "scrap_loss": "Fire kaybı",
    "opportunity_loss": "Fırsat kaybı",
}

#: Baskın kayıp kalemine karşılık gelen bilinen eylem. Metinler Kısıtlar
#: Teorisi'nin mevcut sözlüğünden alınmıştır; burada yeni tavsiye üretilmez.
ACTION_BY_COMPONENT: Dict[str, str] = {
    "downtime_loss": (
        "Önleyici bakım önceliğini bu istasyona verin: kısıttaki her arıza "
        "dakikası doğrudan sistem çıktısı kaybıdır."
    ),
    "waiting_loss": (
        "Aşağı akıştaki tampon kapasitesini artırın: istasyon işini bitiriyor "
        "ama çıkışı tıkandığı için bekliyor."
    ),
    "scrap_loss": (
        "Kalite kontrolü bu istasyonun ÖNÜNE alın: kısıtta işlenen kusurlu bir "
        "parça, geri kazanılamayan kapasite tüketir."
    ),
    "opportunity_loss": (
        "Darboğazın önündeki tamponu büyütün ya da çevrim süresini kısaltın: "
        "kısıt burada ve boşta beklediği her dakika üretilemeyen birimdir."
    ),
}


def hours(minutes: float) -> float:
    """Dakikayı saate çevirir."""
    return minutes / MINUTES_PER_HOUR


# --------------------------------------------------------------------------- #
# Kalem hesabı
# --------------------------------------------------------------------------- #


def _component(
    name: str,
    quantity: float,
    quantity_unit: str,
    settings: FinancialSettings,
    provenance: MetricProvenance,
    basis: str,
) -> LossComponent:
    """Tek bir kalemi hesaplar.

    Oran verilmemişse tutar sıfırdır ama kalem `is_available=False` ile
    işaretlenir; bu ikisi rapor okunurken birbirine karıştırılmamalıdır.
    """
    rate_name = REQUIRED_RATE_BY_COMPONENT[name]
    rate_value = settings.rate(rate_name)
    available = rate_value is not None
    amount = quantity * rate_value if available else 0.0

    return LossComponent(
        name=name,
        label=COMPONENT_LABELS[name],
        amount=amount,
        provenance=provenance,
        quantity=quantity,
        quantity_unit=quantity_unit,
        rate_name=rate_name,
        rate_value=rate_value,
        is_available=available,
        basis=basis if available else f"{rate_name} verilmedigi icin hesaplanamadi",
    )


def is_capacity_constrained(bottleneck: Optional[BottleneckAnalysis]) -> bool:
    """Kısıt içeride mi (kapasite) yoksa dışarıda mı (talep)?

    Motorun kendi kuralı yeniden kullanılır: darboğazın kullanım oranı
    `CRITICAL_UTILIZATION` eşiğinin altındaysa sistemi sınırlayan şey iç
    kapasite değildir. Burada ayrı bir eşik tanımlansaydı, aynı koşum için
    darboğaz analizi "kısıt dışarıda" derken finans raporu "üretim kaybınız
    var" diyebilirdi.
    """
    if bottleneck is None:
        return False
    return bottleneck.bottleneck_utilization >= CRITICAL_UTILIZATION


def lost_units_from(bottleneck: Optional[BottleneckAnalysis]) -> float:
    """Fırsat maliyetine esas alınacak kayıp birim sayısı.

    Kısıt dışarıdaysa sıfırdır: talep yetersizken boş geçen kapasite bir
    üretim kaybı değildir.
    """
    if bottleneck is None or not is_capacity_constrained(bottleneck):
        return 0.0
    recommendation = bottleneck.drum_buffer_rope
    if recommendation is None:
        return 0.0
    return max(0.0, recommendation.estimated_lost_units)


# --------------------------------------------------------------------------- #
# Güven ve veri bütünlüğü
# --------------------------------------------------------------------------- #


def data_completeness(components: Sequence[LossComponent]) -> float:
    """Gerekli oranların kaçının verildiği (0-1)."""
    if not components:
        return 0.0
    provided = sum(1 for item in components if item.is_available)
    return provided / len(components)


def confidence_of(
    components: Sequence[LossComponent], completeness: float
) -> float:
    """Sonuca ne kadar güvenilebileceği.

    İki şeyden etkilenir: verilen oranların oranı (`completeness`) ve toplamın
    ne kadarının **kestirime** dayandığı. Tümüyle sayıma dayanan bir sonuç
    completeness'iyle aynı güveni alır; tümüyle kestirime dayanan bir sonuç
    `ESTIMATE_CONFIDENCE_DISCOUNT` kadar iskonto görür.
    """
    total = sum(item.amount for item in components)
    if total <= 0.0:
        return completeness

    estimated = sum(
        item.amount
        for item in components
        if item.provenance is MetricProvenance.ESTIMATED
    )
    estimated_share = estimated / total
    return completeness * (1.0 - ESTIMATE_CONFIDENCE_DISCOUNT * estimated_share)


# --------------------------------------------------------------------------- #
# Toplam etki
# --------------------------------------------------------------------------- #


def compute_financial_impact(
    stations: Sequence[StationRunMetrics],
    settings: FinancialSettings,
    bottleneck: Optional[BottleneckAnalysis] = None,
) -> FinancialImpact:
    """Bir koşumun toplam finansal kaybını hesaplar.

    Args:
        stations: Koşumun istasyon metrikleri (motorun saydığı ham değerler).
        settings: İşletmenin maliyet oranları.
        bottleneck: Darboğaz analizi. Verilmezse fırsat maliyeti hesaplanmaz —
            hangi istasyonun kısıt olduğu ve kısıtın içeride olup olmadığı
            bilinmeden kayıp birim sayısı bilinemez.

    Returns:
        Kalem dökümü, güven ve eksik girdi listesiyle birlikte toplam kayıp.
    """
    down_hours = hours(sum(item.down_minutes for item in stations))
    blocked_hours = hours(sum(item.blocked_minutes for item in stations))
    scrap_units = float(sum(item.units_scrapped for item in stations))
    lost_units = lost_units_from(bottleneck)

    components = [
        _component(
            "downtime_loss",
            down_hours,
            "saat",
            settings,
            MetricProvenance.CALCULATED,
            f"{down_hours:,.2f} saat ariza x saatlik makine maliyeti",
        ),
        _component(
            "waiting_loss",
            blocked_hours,
            "saat",
            settings,
            MetricProvenance.CALCULATED,
            f"{blocked_hours:,.2f} saat bloke x saatlik iscilik maliyeti",
        ),
        _component(
            "scrap_loss",
            scrap_units,
            "adet",
            settings,
            MetricProvenance.CALCULATED,
            f"{scrap_units:,.0f} adet hurda x birim hurda maliyeti",
        ),
        _component(
            "opportunity_loss",
            lost_units,
            "adet",
            settings,
            # Kayip birim sayisi bir SAYIM degil, darbogaz aclik suresinden
            # turetilmis bir KESTIRIMDIR; etiketi bunu soyler.
            MetricProvenance.ESTIMATED,
            f"{lost_units:,.0f} tahmini uretilemeyen birim x katki payi",
        ),
    ]

    by_name = {item.name: item for item in components}
    total = sum(item.amount for item in components)
    completeness = data_completeness(components)

    notes: List[str] = []
    if bottleneck is not None and not is_capacity_constrained(bottleneck):
        notes.append(
            "Kisit disaridadir (darbogaz kapasitesinin tamamini kullanmiyor): "
            "bosta gecen sure bir uretim kaybi degil, kullanilmayan kapasitedir. "
            "Bu yuzden firsat maliyeti sifir alindi."
        )
    if lost_units > 0.0:
        notes.append(
            "Firsat maliyeti bir kestirimdir: darbogazin aclik suresinde "
            "uretebilecegi birim sayisindan turetilir, sayilmis bir kayip degildir."
        )

    missing = [
        item.rate_name for item in components if not item.is_available
    ]
    if missing:
        notes.append(
            "Eksik maliyet orani olan kalemler hesaba KATILMADI; toplam bu "
            "yuzden gercek kaybin altindadir."
        )

    return FinancialImpact(
        downtime_loss=by_name["downtime_loss"].amount,
        waiting_loss=by_name["waiting_loss"].amount,
        scrap_loss=by_name["scrap_loss"].amount,
        opportunity_loss=by_name["opportunity_loss"].amount,
        total_loss=total,
        confidence=confidence_of(components, completeness),
        data_completeness=completeness,
        components=components,
        missing_inputs=missing,
        notes=notes,
    )


# --------------------------------------------------------------------------- #
# İstasyon dökümü
# --------------------------------------------------------------------------- #


def compute_station_impact(
    metrics: StationRunMetrics,
    settings: FinancialSettings,
    bottleneck: Optional[BottleneckAnalysis] = None,
) -> StationFinancialImpact:
    """Tek bir istasyonun kayıp dökümü.

    Fırsat maliyeti yalnızca **darboğaz istasyonuna** yazılır: üretilemeyen
    birim sistemin çıktısıdır ve onu sınırlayan tek istasyon kısıttır. Kaybı
    tüm istasyonlara dağıtmak, aynı kaybı birden çok kez saymak olurdu.
    """
    is_bottleneck = (
        bottleneck is not None
        and bottleneck.bottleneck_station_id == metrics.station_id
    )
    lost_units = lost_units_from(bottleneck) if is_bottleneck else 0.0

    down = _component(
        "downtime_loss",
        hours(metrics.down_minutes),
        "saat",
        settings,
        MetricProvenance.CALCULATED,
        "istasyon ariza saati x saatlik makine maliyeti",
    )
    waiting = _component(
        "waiting_loss",
        hours(metrics.blocked_minutes),
        "saat",
        settings,
        MetricProvenance.CALCULATED,
        "istasyon bloke saati x saatlik iscilik maliyeti",
    )
    scrap = _component(
        "scrap_loss",
        float(metrics.units_scrapped),
        "adet",
        settings,
        MetricProvenance.CALCULATED,
        "istasyon hurda adedi x birim hurda maliyeti",
    )
    opportunity = _component(
        "opportunity_loss",
        lost_units,
        "adet",
        settings,
        MetricProvenance.ESTIMATED,
        "darbogazin uretemedigi tahmini birim x katki payi",
    )

    return StationFinancialImpact(
        station_id=metrics.station_id,
        station_name=metrics.station_name,
        downtime_loss=down.amount,
        waiting_loss=waiting.amount,
        scrap_loss=scrap.amount,
        opportunity_loss=opportunity.amount,
        total_loss=down.amount + waiting.amount + scrap.amount + opportunity.amount,
        is_bottleneck=is_bottleneck,
    )


# --------------------------------------------------------------------------- #
# Kurtarılabilir kayıp ve öneri
# --------------------------------------------------------------------------- #


def recoverable_loss(impact: FinancialImpact) -> float:
    """Bilinen bir eylemin doğrudan hedefleyebileceği kayıp toplamı.

    Arıza, bekleme ve fırsat kayıpları sayılır: üçünün de karşılığında somut
    ve bilinen bir eylem vardır (önleyici bakım, tampon boyutlandırma, kısıtı
    genişletme).

    **Fire kaybı sayılmaz.** Fireyi azaltmak bir süreç değişikliği gerektirir
    ve ne kadarının giderilebileceği bu modelden bilinemez; onu "kurtarılabilir"
    saymak, gerçekleşmesi belirsiz bir kazancı kesinmiş gibi sunmak olurdu.
    """
    return impact.downtime_loss + impact.waiting_loss + impact.opportunity_loss


def suggest_improvements(
    stations: Sequence[StationFinancialImpact], limit: int = 3
) -> List[ImprovementSuggestion]:
    """En çok para kaybettiren istasyonlar için somut eylem önerir.

    Sıralama tümüyle parasaldır: hangi istasyonda en çok kayıp varsa önce o
    gelir. Her istasyon için baskın kalem bulunur ve o kaleme karşılık gelen
    bilinen eylem seçilir; yeni bir tavsiye üretilmez.
    """
    ranked = sorted(
        (item for item in stations if item.total_loss > 0.0),
        key=lambda item: item.total_loss,
        reverse=True,
    )

    suggestions: List[ImprovementSuggestion] = []
    for station in ranked[:limit]:
        amounts = {
            "downtime_loss": station.downtime_loss,
            "waiting_loss": station.waiting_loss,
            "scrap_loss": station.scrap_loss,
            "opportunity_loss": station.opportunity_loss,
        }
        dominant = max(amounts, key=lambda key: amounts[key])
        if amounts[dominant] <= 0.0:
            continue

        share = amounts[dominant] / station.total_loss * 100.0
        rationale = (
            f"'{station.station_name}' istasyonunda toplam "
            f"{station.total_loss:,.0f} birimlik kaybin %{share:.0f}'i "
            f"{COMPONENT_LABELS[dominant].lower()} kaleminden geliyor."
        )
        if station.is_bottleneck:
            rationale += " Bu istasyon ayni zamanda darbogazdir."

        suggestions.append(
            ImprovementSuggestion(
                station_id=station.station_id,
                station_name=station.station_name,
                dominant_loss=dominant,
                recoverable_amount=amounts[dominant],
                action=ACTION_BY_COMPONENT[dominant],
                rationale=rationale,
            )
        )
    return suggestions


# --------------------------------------------------------------------------- #
# Rapor
# --------------------------------------------------------------------------- #


def build_report(
    stations: Sequence[StationRunMetrics],
    settings: FinancialSettings,
    window_minutes: float,
    bottleneck: Optional[BottleneckAnalysis] = None,
) -> FinancialReport:
    """Finansal etki raporunun tamamını üretir.

    Args:
        stations: Koşumun istasyon metrikleri.
        settings: Maliyet oranları.
        window_minutes: İstatistik penceresinin uzunluğu. Günlük projeksiyon
            bununla ölçeklenir.
        bottleneck: Darboğaz analizi; verilmezse fırsat maliyeti hesaplanmaz.

    Raises:
        ValueError: `window_minutes` pozitif değilse — sıfır pencereye bölmek
            sonsuz bir günlük kayıp üretirdi.
    """
    if window_minutes <= 0.0:
        raise ValueError(
            f"Istatistik penceresi pozitif olmalidir, alinan: {window_minutes}"
        )

    impact = compute_financial_impact(stations, settings, bottleneck)
    per_station = [
        compute_station_impact(item, settings, bottleneck) for item in stations
    ]

    daily: Optional[float] = None
    if settings.production_minutes_per_day is not None:
        # Pencere kaybi gunluk uretim suresine olceklenir. `production_minutes_per_day`
        # verilmediginde bu alan bilincli olarak bos birakilir: uydurulmus bir
        # vardiya suresiyle uretilen "gunluk kayip", hic rakam vermemekten kotudur.
        daily = impact.total_loss * (
            settings.production_minutes_per_day / window_minutes
        )

    return FinancialReport(
        impact=impact,
        stations=sorted(per_station, key=lambda item: item.total_loss, reverse=True),
        suggestions=suggest_improvements(per_station),
        recoverable_loss=recoverable_loss(impact),
        daily_loss=daily,
        window_minutes=window_minutes,
    )
