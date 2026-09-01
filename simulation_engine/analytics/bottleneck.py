"""Kısıtlar Teorisi (TOC) — darboğaz tespiti ve Drum-Buffer-Rope — Bölüm 3.6.

Temel ilke
----------
Eliyahu Goldratt'ın Kısıtlar Teorisi'ne göre her sistemin çıktısı tek bir
kısıt tarafından belirlenir. Kısıt olmayan bir istasyonu iyileştirmek sistem
çıktısını **artırmaz**; yalnızca o istasyonun boş bekleme süresini uzatır.
Bu nedenle iyileştirme kaynakları önce doğru istasyona yönlendirilmelidir.

Darboğaz tespiti
----------------
Darboğaz, sunucularının işlem yaparak geçirdiği süre oranı (rho) en yüksek
olan istasyondur. **Bloke geçen süre bu orana dahil edilmez**: çıkışı tıkalı
olduğu için bekleyen bir istasyon meşgul görünse de kısıt değildir, kısıt
onun aşağısındadır. Blokaj süresini kullanıma katmak, darboğazı sistematik
olarak yukarı akışa kaydırır ve yanlış istasyona yatırım yapılmasına yol açar.

Ziyaret oranı düzeltmesi
------------------------
Bir istasyon iş emri başına birden fazla kez ziyaret ediliyorsa (yeniden
işleme döngüleri, çok geçişli operasyonlar), kendi kapasitesi sistem çıktısını
o oranda daha fazla sınırlar:

    sistem kapasitesi_j = (c_j * mu_j * A_j) / v_j

Sistemin teorik azami çıktısı bu değerlerin en küçüğüdür. Bu düzeltme
yapılmazsa, iki kez ziyaret edilen hızlı bir istasyon yanlışlıkla rahat
görünür.

Drum-Buffer-Rope
----------------
DBR, TOC'un üretim planlama uygulamasıdır:

- **Drum (davul):** darboğaz hattın ritmini belirler; tüm hat onun hızında çalışır.
- **Buffer (tampon):** darboğazın önüne, onu yukarı akıştaki dalgalanmalardan
  koruyacak bir stok konur. Darboğazda kaybedilen bir dakika **tüm sistemde**
  kaybedilmiş bir dakikadır ve geri kazanılamaz.
- **Rope (halat):** hatta malzeme salımı darboğazın tüketim hızına bağlanır;
  böylece kısıt olmayan istasyonlar gereksiz ara stok üretmez.

Tampon boyutu şöyle hesaplanır (Şartname Bölüm 3.6):

    zaman tamponu = yukarı akış değişkenlik süresi x güvenlik katsayısı (1.5)
    tampon (parça)  = TAVAN(zaman tamponu / darboğaz çevrim süresi)

Değişkenlik süresi olarak besleyen istasyonun işlem süresi standart sapması
ile ortalama onarım süresi (MTTR) toplamı kullanılır: ilki normal dalgalanmayı,
ikincisi ise beklenmedik duruşun süresini temsil eder. Zaman tamponunun parça
sayısına çevrilmesi, sonucun doğrudan `Station.buffer_capacity_before` alanına
yazılabilmesini sağlar.

Kaynaklar
---------
- Goldratt, E. M. (1984). *The Goal*, North River Press.
- Goldratt, E. M. (1990). *Theory of Constraints*, North River Press.
- Schragenheim, E. & Dettmer, H. W. (2000). *Manufacturing at Warp Speed*
  (Drum-Buffer-Rope tampon boyutlandırması).
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional

from simulation_engine.models.schemas import (
    BottleneckAnalysis,
    DrumBufferRopeRecommendation,
    INFINITE_CAPACITY,
    ReplicationResult,
    SimulationConfig,
    StationLoad,
    StationRunMetrics,
)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Şartname Bölüm 3.6'da belirtilen Drum-Buffer-Rope güvenlik katsayısı.
DBR_SAFETY_FACTOR: float = 1.5

#: Bir istasyonun "kritik yüklü" sayıldığı eşik; bu değerin üzerinde küçük bir
#: dalgalanma bile kuyruğu hızla büyütür.
CRITICAL_UTILIZATION: float = 0.85

#: İkinci darboğazın "yakın rakip" sayılması için birinciye olan azami uzaklık.
#: Aradaki fark bu değerden küçükse darboğaz genişletildiğinde kısıt hemen
#: ikinci istasyona kayar.
CLOSE_CONTENDER_MARGIN: float = 0.05

#: Darboğazdaki açlığın "anlamlı" sayılması için gereken asgari süre oranı.
SIGNIFICANT_STARVATION_FRACTION: float = 0.01

#: Tampon önerisinde asgari parça sayısı: koruma amaçlı bir tampon en az bir
#: parça tutabilmelidir.
MIN_RECOMMENDED_BUFFER_UNITS: int = 1


def _station_capacity_per_minute(metrics: StationRunMetrics) -> float:
    """İstasyonun kendi işlem kapasitesini birim zamandaki parça olarak verir.

    c * mu * A biçimindedir: sunucu sayısı çarpı hizmet hızı çarpı ölçülen
    kullanılabilirlik. Kullanılabilirlik teorik MTBF/(MTBF+MTTR) yerine
    **ölçülen** değerdir; gerçekleşen arıza davranışını yansıtır.
    """
    if metrics.ideal_cycle_time <= 0.0:
        return math.inf
    return (
        metrics.num_servers / metrics.ideal_cycle_time * metrics.availability_fraction
    )


def _build_station_loads(result: ReplicationResult) -> List[StationLoad]:
    """Tüm istasyonların yük profilini kullanım oranına göre sıralar."""
    visit_ratios = result.stability.visit_ratios
    window = result.system.window_duration_minutes

    entries: List[tuple[float, StationRunMetrics, float, float]] = []
    for metrics in result.stations:
        visit_ratio = visit_ratios.get(metrics.station_id, 1.0)
        capacity = _station_capacity_per_minute(metrics)
        system_capacity = capacity / visit_ratio if visit_ratio > 0.0 else math.inf
        entries.append((metrics.utilization, metrics, visit_ratio, system_capacity))

    # Kullanım oranına göre azalan sıra; eşitlikte istasyon kimliği belirleyici
    # olur, böylece sonuç deterministik kalır.
    entries.sort(key=lambda item: (-item[0], item[1].station_id))

    loads: List[StationLoad] = []
    for rank, (utilization, metrics, visit_ratio, system_capacity) in enumerate(
        entries, start=1
    ):
        planned = metrics.planned_production_time_minutes
        starvation_fraction = metrics.idle_minutes / planned if planned > 0.0 else 0.0
        loads.append(
            StationLoad(
                station_id=metrics.station_id,
                station_name=metrics.station_name,
                rank=rank,
                utilization=utilization,
                blocked_fraction=metrics.blocked_fraction,
                starvation_fraction=starvation_fraction,
                visit_ratio=visit_ratio,
                capacity_per_minute=_station_capacity_per_minute(metrics),
                system_capacity_per_minute=system_capacity,
            )
        )
    _ = window  # pencere uzunluğu yalnızca oran hesaplarında dolaylı kullanılır
    return loads


def _find_upstream_feeder(
    config: Optional[SimulationConfig], bottleneck_id: str, result: ReplicationResult
) -> Optional[StationRunMetrics]:
    """Darboğazı besleyen ana istasyonu bulur.

    Birden fazla besleyici varsa en yüksek kullanım oranına sahip olan seçilir:
    darboğazı aç bırakma riski en yüksek olan kaynak odur.
    """
    if config is None:
        return None
    feeder_ids = {
        connection.from_station_id
        for connection in config.incoming_connections(bottleneck_id)
    }
    if not feeder_ids:
        return None
    candidates = [m for m in result.stations if m.station_id in feeder_ids]
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.utilization, item.station_id))


def _recommend_buffer(
    result: ReplicationResult,
    bottleneck: StationRunMetrics,
    config: Optional[SimulationConfig],
    safety_factor: float,
) -> DrumBufferRopeRecommendation:
    """Darboğaz önündeki koruyucu tamponu boyutlandırır."""
    feeder = _find_upstream_feeder(config, bottleneck.station_id, result)

    if feeder is None:
        # Darboğaz doğrudan dış varış süreciyle besleniyor. Değişkenlik ölçüsü
        # olarak darboğazın kendi işlem süresi değişkenliği kullanılır; dış
        # varış süreci hakkında ham metriklerde bilgi yoktur.
        variation_source = bottleneck
        source_label = "dis varis sureci"
    else:
        variation_source = feeder
        source_label = f"'{feeder.station_name}'"

    mean_repair = (
        variation_source.total_repair_minutes / variation_source.failure_count
        if variation_source.failure_count > 0
        else 0.0
    )
    variation_minutes = variation_source.service_time_std_dev + mean_repair
    time_buffer = variation_minutes * safety_factor

    cycle_time = bottleneck.ideal_cycle_time / max(bottleneck.num_servers, 1)
    if cycle_time > 0.0:
        units = max(math.ceil(time_buffer / cycle_time), MIN_RECOMMENDED_BUFFER_UNITS)
    else:
        units = MIN_RECOMMENDED_BUFFER_UNITS

    current_capacity = INFINITE_CAPACITY
    if config is not None:
        station_config = config.station_by_id().get(bottleneck.station_id)
        if station_config is not None:
            current_capacity = station_config.buffer_capacity_before
    is_sufficient = current_capacity == INFINITE_CAPACITY or current_capacity >= units

    starvation = bottleneck.idle_minutes
    lost_units = starvation * _station_capacity_per_minute(bottleneck) / max(
        bottleneck.num_servers, 1
    )

    rationale = (
        f"Darbogaz '{bottleneck.station_name}' {source_label} tarafindan beslenir. "
        f"Yukari akis degiskenligi {variation_minutes:.3f} dk "
        f"(islem suresi std. sapmasi {variation_source.service_time_std_dev:.3f} dk"
        + (f" + ortalama onarim {mean_repair:.3f} dk" if mean_repair > 0.0 else "")
        + f"). Guvenlik katsayisi {safety_factor} ile zaman tamponu "
        f"{time_buffer:.3f} dk; darbogaz bu surede {units} parca tuketir. "
        f"Darbogazda kaybedilen bir dakika tum sistemde kaybedilmis bir dakikadir "
        f"ve geri kazanilamaz; tampon tam olarak bu kaybi onlemek icindir."
    )
    if not is_sufficient:
        rationale += (
            f" MEVCUT TAMPON YETERSIZ: kapasite {current_capacity}, "
            f"onerilen {units}."
        )

    return DrumBufferRopeRecommendation(
        bottleneck_station_id=bottleneck.station_id,
        upstream_station_id=None if feeder is None else feeder.station_id,
        upstream_variation_minutes=variation_minutes,
        safety_factor=safety_factor,
        recommended_time_buffer_minutes=time_buffer,
        recommended_buffer_units=units,
        current_buffer_capacity=current_capacity,
        is_current_buffer_sufficient=is_sufficient,
        observed_starvation_minutes=starvation,
        estimated_lost_units=lost_units,
        rationale=rationale,
    )


def analyze(
    result: ReplicationResult,
    config: Optional[SimulationConfig] = None,
    safety_factor: float = DBR_SAFETY_FACTOR,
) -> BottleneckAnalysis:
    """Darboğazı tespit eder ve Drum-Buffer-Rope önerisi üretir.

    Args:
        result: Tek bir replikasyonun ham sonuçları.
        config: Senaryo konfigürasyonu. Verilirse besleyen istasyon ve mevcut
            tampon kapasitesi de rapora dahil edilir; verilmezse tampon önerisi
            yalnızca darboğazın kendi değişkenliğinden türetilir.
        safety_factor: DBR güvenlik katsayısı.

    Returns:
        Darboğaz kimliği, teorik azami çıktı, istasyon yük sıralaması ve
        iyileştirme önerileri.

    Raises:
        ValueError: Sonuçta hiç istasyon yoksa.
    """
    if not result.stations:
        raise ValueError("Darbogaz analizi icin en az bir istasyon gereklidir.")

    loads = _build_station_loads(result)
    bottleneck_load = loads[0]
    bottleneck = result.station(bottleneck_load.station_id)
    secondary = loads[1] if len(loads) > 1 else None

    theoretical_max = min(load.system_capacity_per_minute for load in loads)
    observed = result.system.throughput_per_minute
    capacity_utilization_pct = (
        observed / theoretical_max * 100.0 if theoretical_max > 0.0 else 0.0
    )

    recommendation = _recommend_buffer(result, bottleneck, config, safety_factor)
    # Kısıt içeride mi dışarıda mı? Darboğazın bile kayda değer boş kapasitesi
    # varsa sistem çıktısını sınırlayan şey iç kaynaklar değil, dış talep ya da
    # besleme hızıdır. Bu ayrım öneriyi tümüyle değiştirir.
    is_capacity_constrained = bottleneck_load.utilization >= CRITICAL_UTILIZATION

    warnings: List[str] = []
    if not result.stability.is_stable:
        warnings.append(
            "Model kararsiz (rho >= 1). Darbogaz dogru tespit edilir, ancak olculen "
            "kuyruk ve bekleme degerleri hicbir kararli duruma yakinsamaz."
        )

    return BottleneckAnalysis(
        bottleneck_station_id=bottleneck_load.station_id,
        bottleneck_station_name=bottleneck_load.station_name,
        bottleneck_utilization=bottleneck_load.utilization,
        secondary_bottleneck_station_id=None if secondary is None else secondary.station_id,
        theoretical_max_throughput_per_minute=theoretical_max,
        observed_throughput_per_minute=observed,
        capacity_utilization_pct=capacity_utilization_pct,
        station_loads=loads,
        drum_buffer_rope=recommendation,
        diagnosis=_build_diagnosis(
            loads, theoretical_max, observed, is_capacity_constrained
        ),
        recommendations=_build_recommendations(
            loads, bottleneck, recommendation, is_capacity_constrained
        ),
        warnings=warnings,
    )


def _build_diagnosis(
    loads: List[StationLoad],
    theoretical_max: float,
    observed: float,
    is_capacity_constrained: bool,
) -> str:
    """Darboğaz durumunu özetleyen açıklama metni üretir."""
    bottleneck = loads[0]
    parts = [
        f"Sistem darbogazi: '{bottleneck.station_name}' "
        f"(kullanim %{bottleneck.utilization * 100:.1f}). "
        f"Teorik azami sistem ciktisi {theoretical_max:.4f} parca/dk, "
        f"olculen {observed:.4f} parca/dk."
    ]

    if is_capacity_constrained:
        parts.append(
            f"Kullanim %{CRITICAL_UTILIZATION * 100:.0f} esiginin uzerinde: sistem "
            f"kapasite kisitli. Bu bolgede kuyruk uzunlugu kullanim oranindaki kucuk "
            f"artislara bile cok duyarlidir (1 / (1 - rho) buyumesi)."
        )
    else:
        parts.append(
            f"KISIT DISARIDA: en yuklu istasyon bile kapasitesinin yalnizca "
            f"%{bottleneck.utilization * 100:.1f}'ini kullaniyor. Sistem ciktisini "
            f"sinirlayan sey ic kaynaklar degil, dis talep veya besleme hizidir; "
            f"TOC terminolojisiyle kisit pazardadir."
        )

    if bottleneck.visit_ratio > 1.0:
        parts.append(
            f"Bu istasyon is emri basina {bottleneck.visit_ratio:.2f} kez ziyaret "
            f"ediliyor; kendi kapasitesi "
            f"{bottleneck.capacity_per_minute:.4f} parca/dk olsa da sistem ciktisini "
            f"{bottleneck.system_capacity_per_minute:.4f} parca/dk ile sinirliyor."
        )

    if len(loads) > 1:
        secondary = loads[1]
        gap = bottleneck.utilization - secondary.utilization
        if gap < CLOSE_CONTENDER_MARGIN:
            parts.append(
                f"UYARI: '{secondary.station_name}' cok yakin "
                f"(%{secondary.utilization * 100:.1f}, fark yalnizca "
                f"%{gap * 100:.1f}). Darbogaz genisletildiginde kisit aninda buraya "
                f"kayacaktir; iyilestirme ikisini birlikte ele almalidir."
            )
        else:
            parts.append(
                f"Ikinci sirada '{secondary.station_name}' "
                f"(%{secondary.utilization * 100:.1f}); darbogaz genisletildiginde "
                f"kisit buraya kayar."
            )

    return " ".join(parts)


def _build_recommendations(
    loads: List[StationLoad],
    bottleneck: StationRunMetrics,
    recommendation: DrumBufferRopeRecommendation,
    is_capacity_constrained: bool,
) -> List[str]:
    """TOC'un beş odaklanma adımına dayalı somut öneriler üretir.

    Önerilerin içeriği, kısıtın içeride mi dışarıda mı olduğuna göre kökten
    değişir. Darboğazın kayda değer boş kapasitesi varsa sistem çıktısı dış
    talep tarafından sınırlıdır; böyle bir durumda darboğazı hızlandırmak ya da
    önüne tampon koymak çıktıyı **artırmaz**. Bu ayrımın yapılmaması, klasik
    "boşta duran makineyi meşgul etme" hatasına yol açar.
    """
    items: List[str] = []
    planned = bottleneck.planned_production_time_minutes
    starvation_fraction = bottleneck.idle_minutes / planned if planned > 0.0 else 0.0

    if not is_capacity_constrained:
        items.append(
            f"KISIT DISARIDA: Darbogaz kapasitesinin yalnizca "
            f"%{bottleneck.utilization * 100:.1f}'ini kullaniyor ve penceresinin "
            f"%{starvation_fraction * 100:.1f}'inde bosta bekliyor. Bu aclik bir "
            f"kapasite sorunu DEGILDIR: sisteme yeterli is girmiyor. Darbogazi "
            f"hizlandirmak veya onune tampon koymak ciktiyi artirmaz; yalnizca "
            f"ara stogu ve akis suresini azaltir. Ciktiyi artirmak icin varis "
            f"hizinin (talebin) yukselmesi gerekir."
        )
    elif (
        starvation_fraction > SIGNIFICANT_STARVATION_FRACTION
        and not recommendation.is_current_buffer_sufficient
    ):
        items.append(
            f"KISITI SOMUR: Darbogaz istatistik penceresinin "
            f"%{starvation_fraction * 100:.1f}'inde bosta bekledi "
            f"({bottleneck.idle_minutes:,.0f} dk, tahmini "
            f"{recommendation.estimated_lost_units:,.0f} birim uretilemedi) ve "
            f"onundeki tampon yetersiz (mevcut "
            f"{recommendation.current_buffer_capacity}, onerilen "
            f"{recommendation.recommended_buffer_units}). Tamponu buyutmek bu "
            f"kaybi dogrudan geri kazandirir."
        )
    elif starvation_fraction > SIGNIFICANT_STARVATION_FRACTION:
        items.append(
            f"KISITI SOMUR: Darbogaz penceresinin "
            f"%{starvation_fraction * 100:.1f}'inde bosta bekledi ancak onundeki "
            f"tampon zaten yeterli. Aclik tampon boyutundan degil, yukari akisin "
            f"besleme hizindan kaynaklaniyor; kok neden yukari akista aranmalidir."
        )

    if bottleneck.blocked_minutes > 0.0:
        items.append(
            f"Darbogaz {bottleneck.blocked_minutes:,.0f} dk bloke kaldi: cikisi "
            f"tikaniyor. Asagi akistaki tampon kapasitesi artirilmali; darbogazin "
            f"bloke gecirdigi her dakika dogrudan sistem ciktisi kaybidir."
        )
    if bottleneck.down_minutes > 0.0:
        items.append(
            f"Darbogaz {bottleneck.down_minutes:,.0f} dk arizali kaldi "
            f"({bottleneck.failure_count} ariza). Onleyici bakim onceligi bu "
            f"istasyona verilmelidir; kisit olmayan makinelerdeki arizalar sistem "
            f"ciktisini etkilemez."
        )
    if bottleneck.units_scrapped > 0:
        items.append(
            f"Darbogazda {bottleneck.units_scrapped:,} birim hurdaya ayrildi. "
            f"Kalite kontrolu darbogazin ONUNE alinmali: kisitta islenen kusurlu "
            f"bir parca, geri kazanilamayan kapasite tuketir."
        )

    if is_capacity_constrained:
        items.append(
            f"KISITI YUKSELT: '{bottleneck.station_name}' istasyonuna paralel sunucu "
            f"eklemek veya cevrim suresini kisaltmak sistem ciktisini dogrudan "
            f"artirir. Kisit oradadir ve genisletildiginde kisit bir sonraki "
            f"istasyona kayar."
        )
    non_bottlenecks = [load for load in loads[1:] if load.starvation_fraction > 0.2]
    if non_bottlenecks:
        names = ", ".join(f"'{load.station_name}'" for load in non_bottlenecks[:3])
        items.append(
            f"DIKKAT: {names} istasyonlari zamanlarinin buyuk bolumunde bos. Bu "
            f"normaldir ve bir sorun degildir; kisit olmayan istasyonlari "
            f"'verimli' kilmak icin fazla uretim yaptirmak yalnizca ara stok "
            f"biriktirir (yerel optimizasyon tuzagi)."
        )
    return items


def format_report(analysis: BottleneckAnalysis) -> str:
    """Darboğaz analizini insan tarafından okunabilir bir tabloya dönüştürür."""
    lines: List[str] = [
        "KISITLAR TEORISI — DARBOGAZ ANALIZI",
        "-" * 92,
        f"{'#':>2}  {'Istasyon':<22}{'rho':>9}{'bloke':>9}{'bosta':>9}"
        f"{'v_j':>7}{'kapasite':>11}{'sistem kap.':>13}",
        "-" * 92,
    ]
    for load in analysis.station_loads:
        marker = " <== DARBOGAZ" if load.rank == 1 else ""
        lines.append(
            f"{load.rank:>2}  {load.station_name:<22}"
            f"{f'%{load.utilization * 100:.1f}':>9}"
            f"{f'%{load.blocked_fraction * 100:.1f}':>9}"
            f"{f'%{load.starvation_fraction * 100:.1f}':>9}"
            f"{load.visit_ratio:>7.2f}{load.capacity_per_minute:>11.4f}"
            f"{load.system_capacity_per_minute:>13.4f}{marker}"
        )
    lines.append("-" * 92)
    lines.append(
        f"Teorik azami cikti: "
        f"{analysis.theoretical_max_throughput_per_minute:.4f} parca/dk | "
        f"olculen: {analysis.observed_throughput_per_minute:.4f} parca/dk "
        f"(%{analysis.capacity_utilization_pct:.1f})"
    )
    if analysis.drum_buffer_rope is not None:
        dbr = analysis.drum_buffer_rope
        lines.append("")
        lines.append("DRUM-BUFFER-ROPE ONERISI")
        lines.append(
            f"  Yukari akis degiskenligi : {dbr.upstream_variation_minutes:.3f} dk"
        )
        lines.append(
            f"  Zaman tamponu            : {dbr.upstream_variation_minutes:.3f} x "
            f"{dbr.safety_factor} = {dbr.recommended_time_buffer_minutes:.3f} dk"
        )
        lines.append(
            f"  Onerilen tampon          : {dbr.recommended_buffer_units} parca "
            f"(mevcut: "
            f"{'sinirsiz' if dbr.current_buffer_capacity == INFINITE_CAPACITY else dbr.current_buffer_capacity}"
            f", yeterli mi: {'EVET' if dbr.is_current_buffer_sufficient else 'HAYIR'})"
        )
    lines.append("")
    lines.append(f"Teshis: {analysis.diagnosis}")
    for item in analysis.recommendations:
        lines.append(f"  - {item}")
    for warning in analysis.warnings:
        lines.append(f"  ! {warning}")
    return "\n".join(lines)
