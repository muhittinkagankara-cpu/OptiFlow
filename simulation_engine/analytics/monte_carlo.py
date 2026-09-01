"""Monte Carlo simülasyonu ve güven aralığı — Şartname Bölüm 3.7.

Neden tek koşum yeterli değil?
------------------------------
Bir kesikli olay simülasyonu rastgele girdilerle çalışır; tek bir koşumun
sonucu, kararlı durum ortalamasının **yansız ama yüksek varyanslı** bir
kestirimidir. Aynı senaryo farklı tohumlarla çalıştırıldığında birbirinden
belirgin biçimde farklı sayılar üretir. Tek bir koşumun sayısını kesin bir
tahmin gibi sunmak, ürünü bilimsel olarak savunulamaz kılar.

Bu projede bunun somut ölçümü yapıldı: lambda = 4/saat, mu = 5/saat olan bir
M/M/1 hattında 10.000 dakikalık tek koşumlar, analitik değeri %5 toleransla
yalnızca 30 denemenin 3'ünde tutturdu. Doğru yaklaşım, bağımsız
replikasyonların **ortalamasını** ve bu ortalamanın belirsizliğini birlikte
raporlamaktır.

Yöntem (replication/deletion)
-----------------------------
1. Aynı senaryo, bağımsız rastgele sayı akışlarıyla n kez (en az 30)
   çalıştırılır. Her replikasyonun tohumu tek bir ana tohumdan deterministik
   olarak türetilir; böylece tüm koşum birebir tekrarlanabilir kalır.
2. Her replikasyonun ısınma sonrası ortalaması **tek bir gözlem** olarak alınır.
   Bu, replikasyonlar arası bağımsızlığı garanti eder — aynı koşum içindeki
   ardışık gözlemler otokorelasyonlu olduğu için doğrudan kullanılamazdı.
3. n gözlemin ortalaması ve örnek standart sapması hesaplanır.
4. %95 güven aralığı: ortalama +/- (1.96 * s / KAREKOK(n))

Kritik değer üzerine bir not
---------------------------
Şartname kritik değer olarak 1.96'yı (standart normal) belirtir ve varsayılan
davranış budur. İstatistiksel olarak daha doğrusu, varyans örneklemden
kestirildiği için Student t dağılımını kullanmaktır: n = 30'da
t(0.025, 29) = 2.045'tir ve normal yaklaşım aralığı yaklaşık %4 dar gösterir.
Fark küçüktür ama kestirimi olduğundan kesin gösterme yönündedir. Bu nedenle
`use_student_t=True` seçeneği sunulur; varsayılan, şartnameye uygun olarak
normal yaklaşımdır.

Kaç replikasyon gerekir?
------------------------
`required_replications` fonksiyonu, hedeflenen kesinliğe ulaşmak için gereken
replikasyon sayısını bir pilot çalıştırmadan kestirir (Law 2015, denklem 9.6):

    n* = n * (h / h*)^2

burada h mevcut yarı genişlik, h* ise hedeflenen yarı genişliktir. Yarı
genişlik KAREKOK(n) ile azaldığından, kesinliği ikiye katlamak dört kat
replikasyon gerektirir.

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 9.4.1
  (replication/deletion yaklaşımı ve güven aralıkları).
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed., Bölüm 11.
"""

from __future__ import annotations

import math
import random
import statistics
import time
from typing import Callable, Dict, List, Optional, Sequence

from simulation_engine.core.engine import run_replication
from simulation_engine.distributions.base import SEED_BITS
from simulation_engine.models.schemas import (
    MIN_RECOMMENDED_REPLICATIONS,
    MonteCarloReport,
    MonteCarloStatistic,
    MonteCarloStationSummary,
    ReplicationResult,
    SimulationConfig,
    StationRunMetrics,
)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Şartname Bölüm 3.7'de belirtilen, %95 güven aralığı için standart normal
#: kritik değer. Standart normal dağılımın %97.5 yüzdeliğidir.
Z_SCORE_95: float = 1.96

#: Varsayılan güven düzeyi.
DEFAULT_CONFIDENCE_LEVEL: float = 0.95

#: Student t dağılımının %97.5 yüzdelikleri (iki yanlı %95 güven aralığı için),
#: serbestlik derecesine göre. Örnek varyansı kullanıldığında doğru kritik
#: değerlerdir. Tabloda bulunmayan büyük serbestlik dereceleri için, kendisinden
#: küçük en yakın anahtar kullanılır (muhafazakâr taraf).
T_CRITICAL_95: Dict[int, float] = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
    40: 2.021, 60: 2.000, 120: 1.980,
}

#: Bağıl kesinlik bu değerin üzerindeyse kullanıcıya daha fazla replikasyon
#: önerilir. %10, mühendislik kararları için yaygın kabul gören üst sınırdır.
ACCEPTABLE_RELATIVE_PRECISION: float = 0.10


def t_critical_95(degrees_of_freedom: int) -> float:
    """Verilen serbestlik derecesi için iki yanlı %95 t kritik değerini verir."""
    if degrees_of_freedom < 1:
        return Z_SCORE_95
    if degrees_of_freedom in T_CRITICAL_95:
        return T_CRITICAL_95[degrees_of_freedom]
    smaller = [key for key in T_CRITICAL_95 if key < degrees_of_freedom]
    if not smaller:
        return T_CRITICAL_95[1]
    return T_CRITICAL_95[max(smaller)]


def summarize(
    values: Sequence[float],
    metric: str,
    label: str,
    unit: str = "",
    use_student_t: bool = False,
) -> MonteCarloStatistic:
    """Replikasyon gözlemlerinden ortalama, standart sapma ve güven aralığı üretir.

    Args:
        values: Her replikasyondan bir gözlem.
        metric: Metriğin makine okunabilir adı.
        label: Raporda gösterilecek ad.
        unit: Birim etiketi.
        use_student_t: True ise kritik değer Student t dağılımından alınır.

    Returns:
        Metriğin replikasyonlar arası özeti.

    Raises:
        ValueError: Gözlem listesi boşsa.
    """
    if not values:
        raise ValueError(f"'{metric}' icin hicbir gozlem yok.")

    count = len(values)
    mean = statistics.fmean(values)
    std_dev = statistics.stdev(values) if count > 1 else 0.0
    standard_error = std_dev / math.sqrt(count) if count > 0 else 0.0
    critical = t_critical_95(count - 1) if use_student_t else Z_SCORE_95
    half_width = critical * standard_error

    return MonteCarloStatistic(
        metric=metric,
        label=label,
        unit=unit,
        count=count,
        mean=mean,
        std_dev=std_dev,
        standard_error=standard_error,
        critical_value=critical,
        half_width=half_width,
        ci_lower=mean - half_width,
        ci_upper=mean + half_width,
        minimum=min(values),
        maximum=max(values),
        relative_precision=half_width / abs(mean) if mean != 0.0 else 0.0,
    )


def required_replications(
    statistic: MonteCarloStatistic, target_relative_precision: float
) -> int:
    """Hedeflenen bağıl kesinliğe ulaşmak için gereken replikasyon sayısını kestirir.

    Yarı genişlik KAREKOK(n) ile azaldığı için (Law 2015, denklem 9.6):

        n* = n * (h / h*)^2

    Args:
        statistic: Pilot çalıştırmadan elde edilen özet.
        target_relative_precision: Hedeflenen yarı genişlik / ortalama oranı,
            ör. %5 kesinlik için 0.05.

    Returns:
        Gereken replikasyon sayısı; mevcut sayıdan küçük olamaz.

    Raises:
        ValueError: Hedef kesinlik pozitif değilse.
    """
    if target_relative_precision <= 0.0:
        raise ValueError(
            f"Hedef bagil kesinlik pozitif olmalidir, alinan: "
            f"{target_relative_precision}"
        )
    if statistic.relative_precision <= target_relative_precision:
        return statistic.count
    ratio = statistic.relative_precision / target_relative_precision
    return max(statistic.count, math.ceil(statistic.count * ratio**2))


#: Sistem düzeyinde özetlenen metrikler: (metrik adı, etiket, birim, çıkarıcı).
SYSTEM_METRICS: List[tuple[str, str, str, Callable[[ReplicationResult], float]]] = [
    ("units_produced", "Toplam uretim (iyi urun)", "birim",
     lambda r: float(r.system.entities_completed)),
    ("units_scrapped", "Hurda", "birim", lambda r: float(r.system.entities_scrapped)),
    ("units_rejected", "Kabul edilmeyen", "birim",
     lambda r: float(r.system.entities_rejected)),
    ("throughput_per_minute", "Cikti hizi", "birim/dk",
     lambda r: r.system.throughput_per_minute),
    ("avg_wip", "Ortalama WIP (L)", "birim", lambda r: r.system.avg_wip),
    ("avg_flow_time", "Ortalama akis suresi (W)", "dk",
     lambda r: r.system.avg_flow_time),
]

#: İstasyon düzeyinde özetlenen metrikler.
STATION_METRICS: List[tuple[str, str, str, Callable[[StationRunMetrics], float]]] = [
    ("utilization", "Kullanim orani (rho)", "", lambda s: s.utilization),
    ("avg_queue_length", "Ortalama kuyruk (Lq)", "birim", lambda s: s.avg_queue_length),
    ("avg_wait_time", "Ortalama bekleme (Wq)", "dk", lambda s: s.avg_wait_time),
    ("availability_fraction", "Kullanilabilirlik", "", lambda s: s.availability_fraction),
    ("units_produced", "Uretim", "birim", lambda s: float(s.units_produced)),
]


def run_replications(
    config: SimulationConfig,
    num_replications: Optional[int] = None,
    master_seed: Optional[int] = None,
) -> tuple[List[ReplicationResult], int, float]:
    """Bağımsız replikasyonları çalıştırır ve ham sonuçları döndürür.

    `run_monte_carlo` bu fonksiyonun üzerine kuruludur. Ayrı tutulması
    bilinçlidir: API katmanı hem özet istatistiklere hem de ham replikasyonlara
    (darboğaz analizi, OEE ve Little's Law denetimi için) ihtiyaç duyar ve
    senaryoyu iki kez çalıştırmak kabul edilemez.

    Args:
        config: Simülasyon konfigürasyonu.
        num_replications: Replikasyon sayısı; verilmezse
            `config.num_replications` kullanılır.
        master_seed: Ana tohum; verilmezse `config.random_seed`, o da yoksa
            rastgele üretilir.

    Returns:
        (replikasyon sonuçları, kullanılan ana tohum, geçen süre) üçlüsü.

    Raises:
        ValueError: Replikasyon sayısı 1'den küçükse.
    """
    replication_count = (
        num_replications if num_replications is not None else config.num_replications
    )
    if replication_count < 1:
        raise ValueError(
            f"Replikasyon sayisi en az 1 olmalidir, alinan: {replication_count}"
        )

    # Ana tohum bir kez çözülür ve tüm replikasyonlara aynısı geçirilir; aksi
    # hâlde her replikasyon kendi rastgele tohumunu üretir ve koşum
    # tekrarlanamaz hâle gelir.
    resolved_master = master_seed if master_seed is not None else config.random_seed
    if resolved_master is None:
        resolved_master = random.SystemRandom().getrandbits(SEED_BITS)

    started_at = time.perf_counter()
    results = [
        run_replication(config, replication_index=index, master_seed=resolved_master)
        for index in range(replication_count)
    ]
    return results, int(resolved_master), time.perf_counter() - started_at


def summarize_replications(
    results: Sequence[ReplicationResult],
    master_seed: int,
    elapsed_seconds: float = 0.0,
    use_student_t: bool = False,
) -> MonteCarloReport:
    """Hazır replikasyon sonuçlarından güven aralıklı özet üretir.

    Args:
        results: `run_replications` çıktısı.
        master_seed: Replikasyonların türetildiği ana tohum.
        elapsed_seconds: Koşumun sürdüğü süre (raporlama için).
        use_student_t: True ise kritik değer Student t dağılımından alınır.

    Returns:
        Sistem ve istasyon düzeyinde ortalamalar ve %95 güven aralıkları.

    Raises:
        ValueError: Sonuç listesi boşsa.
    """
    if not results:
        raise ValueError("Ozet icin en az bir replikasyon sonucu gereklidir.")
    replication_count = len(results)

    system_statistics = [
        summarize(
            [extractor(result) for result in results],
            metric=metric,
            label=label,
            unit=unit,
            use_student_t=use_student_t,
        )
        for metric, label, unit, extractor in SYSTEM_METRICS
    ]

    station_summaries: List[MonteCarloStationSummary] = []
    for station_metrics in results[0].stations:
        station_id = station_metrics.station_id
        station_summaries.append(
            MonteCarloStationSummary(
                station_id=station_id,
                station_name=station_metrics.station_name,
                statistics=[
                    summarize(
                        [extractor(result.station(station_id)) for result in results],
                        metric=metric,
                        label=label,
                        unit=unit,
                        use_student_t=use_student_t,
                    )
                    for metric, label, unit, extractor in STATION_METRICS
                ],
            )
        )

    production = next(s for s in system_statistics if s.metric == "units_produced")
    return MonteCarloReport(
        num_replications=replication_count,
        master_seed=master_seed,
        replication_seeds=[result.seed for result in results],
        confidence_level=DEFAULT_CONFIDENCE_LEVEL,
        uses_student_t=use_student_t,
        system=system_statistics,
        stations=station_summaries,
        headline=format_headline(production),
        total_wall_clock_seconds=elapsed_seconds,
        warnings=_collect_warnings(results, system_statistics, replication_count),
    )


def run_monte_carlo(
    config: SimulationConfig,
    num_replications: Optional[int] = None,
    master_seed: Optional[int] = None,
    use_student_t: bool = False,
) -> MonteCarloReport:
    """Senaryoyu bağımsız tohumlarla çok kez çalıştırıp güven aralığı üretir.

    `run_replications` ve `summarize_replications` fonksiyonlarının bileşimidir.

    Args:
        config: Simülasyon konfigürasyonu.
        num_replications: Replikasyon sayısı; verilmezse
            `config.num_replications` kullanılır.
        master_seed: Ana tohum; verilmezse `config.random_seed`, o da yoksa
            rastgele üretilir. Tüm replikasyonlar bu tek tohumdan türetilir,
            böylece koşumun tamamı birebir tekrarlanabilir.
        use_student_t: True ise kritik değer Student t dağılımından alınır
            (istatistiksel olarak daha doğru); False ise şartnamedeki 1.96.

    Returns:
        Sistem ve istasyon düzeyinde ortalamalar, standart sapmalar ve %95
        güven aralıkları.
    """
    results, resolved_master, elapsed = run_replications(
        config, num_replications=num_replications, master_seed=master_seed
    )
    return summarize_replications(
        results, resolved_master, elapsed, use_student_t=use_student_t
    )


def _collect_warnings(
    results: Sequence[ReplicationResult],
    system_statistics: Sequence[MonteCarloStatistic],
    replication_count: int,
) -> List[str]:
    """Kestirimin güvenilirliğine dair uyarıları toplar."""
    warnings: List[str] = []

    if replication_count < MIN_RECOMMENDED_REPLICATIONS:
        warnings.append(
            f"Yalnizca {replication_count} replikasyon calistirildi; onerilen asgari "
            f"{MIN_RECOMMENDED_REPLICATIONS}. Bu sayinin altinda Merkezi Limit "
            f"Teoremi'ne dayanan normal yaklasim guvenilir degildir ve guven "
            f"araligi oldugundan dar cikabilir."
        )
    if replication_count == 1:
        warnings.append(
            "Tek replikasyonda standart sapma tanimsizdir; guven araligi sifir "
            "genislikte raporlandi. Bu deger bir kesinlik gostergesi DEGILDIR."
        )

    unstable = [r.replication_index for r in results if not r.stability.is_stable]
    if unstable:
        warnings.append(
            f"{len(unstable)} replikasyon kararsiz model uyarisi uretti "
            f"(rho >= 1). Kararsiz bir sistemde ortalamalar hicbir degere "
            f"yakinsamaz; guven araligi yorumlanamaz."
        )

    for statistic in system_statistics:
        if (
            statistic.mean != 0.0
            and statistic.relative_precision > ACCEPTABLE_RELATIVE_PRECISION
        ):
            needed = required_replications(statistic, ACCEPTABLE_RELATIVE_PRECISION)
            warnings.append(
                f"'{statistic.label}' kestiriminin bagil kesinligi "
                f"%{statistic.relative_precision * 100:.1f}; "
                f"%{ACCEPTABLE_RELATIVE_PRECISION * 100:.0f} hedefi icin yaklasik "
                f"{needed} replikasyon gerekir."
            )
    return warnings


def format_headline(statistic: MonteCarloStatistic) -> str:
    """Ana sonucu şartnamedeki tek cümlelik biçimde sunar.

    Örnek: ``Beklenen uretim: 1250 birim (%95 guven araligi: 1180 - 1320)``

    Bu biçim bilinçlidir: ürün "kesin sayı söylüyorum" yerine "istatistiksel
    olarak güvenilir tahmin sunuyorum" der. Profesyonel simülasyon
    yazılımlarının ayırt edici özelliği budur.
    """
    unit = f" {statistic.unit}" if statistic.unit else ""
    if statistic.unit == "birim":
        return (
            f"Beklenen uretim: {statistic.mean:,.0f}{unit} "
            f"(%95 guven araligi: {statistic.ci_lower:,.0f} - "
            f"{statistic.ci_upper:,.0f})"
        )
    return (
        f"{statistic.label}: {statistic.mean:,.4f}{unit} "
        f"(%95 guven araligi: {statistic.ci_lower:,.4f} - {statistic.ci_upper:,.4f})"
    )


def format_report(report: MonteCarloReport) -> str:
    """Monte Carlo sonuçlarını okunabilir bir tabloya dönüştürür."""
    critical_label = "t" if report.uses_student_t else "z"
    lines: List[str] = [
        f"MONTE CARLO — {report.num_replications} REPLIKASYON "
        f"(ana tohum {report.master_seed})",
        f"%{report.confidence_level * 100:.0f} guven araligi, kritik deger "
        f"{critical_label} = {report.system[0].critical_value}",
        "-" * 92,
        f"{'Metrik':<28}{'Ortalama':>13}{'Std.Sapma':>12}"
        f"{'%95 guven araligi':>28}{'Kesinlik':>11}",
        "-" * 92,
    ]
    for statistic in report.system:
        lines.append(
            f"{statistic.label:<28}{statistic.mean:>13.4f}{statistic.std_dev:>12.4f}"
            f"{f'[{statistic.ci_lower:.4f}, {statistic.ci_upper:.4f}]':>28}"
            f"{f'%{statistic.relative_precision * 100:.2f}':>11}"
        )
    for summary in report.stations:
        lines.append("")
        lines.append(f"  Istasyon '{summary.station_name}' ({summary.station_id})")
        for statistic in summary.statistics:
            lines.append(
                f"    {statistic.label:<24}{statistic.mean:>13.4f}"
                f"{statistic.std_dev:>12.4f}"
                f"{f'[{statistic.ci_lower:.4f}, {statistic.ci_upper:.4f}]':>28}"
                f"{f'%{statistic.relative_precision * 100:.2f}':>11}"
            )
    lines.append("-" * 92)
    lines.append(report.headline)
    lines.append(f"Toplam sure: {report.total_wall_clock_seconds:.2f} sn")
    for warning in report.warnings:
        lines.append(f"  ! {warning}")
    return "\n".join(lines)
