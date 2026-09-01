"""TEST 1 — M/M/1 analitik doğrulama (Şartname Bölüm 4).

Senaryo
-------
Tek sunuculu, sonsuz kuyruklu, Poisson varışlı ve üstel hizmet süreli bir
istasyon: lambda = 4/saat, mu = 5/saat, rho = 0.8. Bu model için kapalı form
çözümler bilinmektedir (Gross & Harris 2008, Bölüm 2.2):

    rho = lambda / mu
    L   = rho / (1 - rho)
    Lq  = rho^2 / (1 - rho)
    W   = 1 / (mu - lambda)
    Wq  = rho / (mu - lambda)

Simülasyondan ölçülen değerler bu analitik değerlerden %5'ten fazla sapıyorsa
motorda mantık hatası var demektir.

Neden 100.000 dakika ve 30 replikasyonun ortalaması?
----------------------------------------------------
Şartnamenin ilk hâli tek bir 10.000 dakikalık koşum öngörüyordu. Bu senaryoda
ortalama varışlar arası süre 15 dakikadır; 10.000 dakika yalnızca ~633 varış
üretir. Bu örneklem, rho = 0.8 gibi yüksek yüklü bir kuyruğun ağır kuyruklu
bekleme süresi dağılımını kestirmek için yetersizdir. Motor üzerinde ölçüldü:

    10.000 dk, 30 bağımsız koşum:
        tek koşum Wq aralığı           : 29,52 - 106,12 dk (analitik 48,00)
        %5 toleransını tutturan koşum  : 3 / 30
        30 koşumun ortalaması          : 44,67 dk  (sapma %6,93)

    100.000 dk, 30 bağımsız koşum:
        tek koşum Wq aralığı           : 35,37 - 57,72 dk
        30 koşumun ortalaması          : 48,03 dk  (sapma %0,06)

Yani tek koşumluk kabul kriteri, doğru çalışan bir motoru bile vakaların
%90'ında başarısız ilan ederdi; test motoru değil, örnekleme gürültüsünü
ölçüyordu. Bu nedenle iki değişiklik yapıldı:

1. Koşum süresi 100.000 dakikaya çıkarıldı (~6.667 varış / replikasyon).
2. %5 tolerans **tek koşuma değil, 30 replikasyonun ortalamasına** uygulanıyor.

İkinci madde yalnızca bir gevşetme değil, doğru istatistiksel uygulamadır:
tek bir replikasyon, kararlı durum ortalamasının yansız ama yüksek varyanslı
bir kestiricisidir; bağımsız replikasyonların ortalaması ise varyansı 1/n
oranında düşürür (Law 2015, Bölüm 9.4.1 — "replication/deletion" yaklaşımı).
Test ayrıca %95 güven aralığını raporlar ve analitik değerin bu aralığın
içinde kaldığını da doğrular.

Kaynaklar
---------
- Gross, D. & Harris, C. M. (2008). *Fundamentals of Queueing Theory*, 4th ed.
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 9.4.
"""

from __future__ import annotations

import statistics
from typing import Callable, List, NamedTuple

import pytest

from simulation_engine.models.schemas import (
    ArrivalProcess,
    Distribution,
    ReplicationResult,
    SimulationConfig,
    Station,
)

# --------------------------------------------------------------------------- #
# Senaryo sabitleri (magic number kullanılmaz)
# --------------------------------------------------------------------------- #

MINUTES_PER_HOUR: float = 60.0

#: Varış hızı lambda = 4 parça/saat.
ARRIVAL_RATE_PER_MINUTE: float = 4.0 / MINUTES_PER_HOUR
#: Hizmet hızı mu = 5 parça/saat.
SERVICE_RATE_PER_MINUTE: float = 5.0 / MINUTES_PER_HOUR

#: Replikasyon başına simülasyon süresi. 10.000 dakika istatistiksel olarak
#: yetersiz kaldığı için (bkz. modül açıklaması) 100.000 dakikaya çıkarıldı.
SIMULATION_DURATION_MINUTES: float = 100_000.0

#: Isınma periyodu (şartnamedeki değer korundu).
WARMUP_PERIOD_MINUTES: float = 500.0

#: Bağımsız replikasyon sayısı. Şartname Bölüm 3.7'nin önerdiği asgari değer.
NUM_REPLICATIONS: int = 30

#: Sabit ana tohum — testin tekrarlanabilir olması için (Şartname TEST 5).
RANDOM_SEED: int = 2024

#: Kabul kriteri: replikasyon ortalamasının analitik değerden bağıl sapması.
RELATIVE_TOLERANCE: float = 0.05

#: %95 güven aralığı için standart normal kritik değer.
Z_SCORE_95: float = 1.96

STATION_ID: str = "S1"


class AnalyticalMM1(NamedTuple):
    """M/M/1 modelinin kapalı form çözümleri (dakika cinsinden)."""

    utilization: float
    l_system: float
    l_queue: float
    w_system: float
    w_queue: float


def _analytical_mm1(arrival_rate: float, service_rate: float) -> AnalyticalMM1:
    """M/M/1 kapalı form sonuçlarını hesaplar.

    Args:
        arrival_rate: lambda, birim zamandaki varış sayısı.
        service_rate: mu, birim zamandaki hizmet sayısı.

    Returns:
        rho, L, Lq, W ve Wq değerleri.

    Raises:
        ValueError: rho >= 1 ise (kararsız sistem; kapalı form tanımsızdır).
    """
    rho = arrival_rate / service_rate
    if rho >= 1.0:
        raise ValueError(f"M/M/1 kapali formu rho < 1 gerektirir, alinan rho={rho}")
    return AnalyticalMM1(
        utilization=rho,
        l_system=rho / (1.0 - rho),
        l_queue=rho**2 / (1.0 - rho),
        w_system=1.0 / (service_rate - arrival_rate),
        w_queue=rho / (service_rate - arrival_rate),
    )


ANALYTICAL = _analytical_mm1(ARRIVAL_RATE_PER_MINUTE, SERVICE_RATE_PER_MINUTE)


class ReplicationSummary(NamedTuple):
    """Bağımsız replikasyonlardan elde edilen bir metriğin özeti."""

    mean: float
    std_dev: float
    half_width: float
    minimum: float
    maximum: float

    @property
    def confidence_interval(self) -> tuple[float, float]:
        """%95 güven aralığı: ortalama +/- 1.96 * s / sqrt(n)."""
        return self.mean - self.half_width, self.mean + self.half_width


def _summarize(values: List[float]) -> ReplicationSummary:
    """Replikasyon sonuçlarından ortalama, standart sapma ve güven aralığı üretir.

    Güven aralığı yarı genişliği z * s / sqrt(n) formülüyle hesaplanır
    (Şartname Bölüm 3.7). Replikasyonlar bağımsız ve aynı dağılımlı olduğu için
    Merkezi Limit Teoremi n = 30'da normal yaklaşımı geçerli kılar.
    """
    mean = statistics.fmean(values)
    std_dev = statistics.stdev(values) if len(values) > 1 else 0.0
    half_width = Z_SCORE_95 * std_dev / (len(values) ** 0.5) if values else 0.0
    return ReplicationSummary(
        mean=mean,
        std_dev=std_dev,
        half_width=half_width,
        minimum=min(values),
        maximum=max(values),
    )


def _relative_deviation(observed: float, expected: float) -> float:
    """İki değer arasındaki bağıl sapmayı oran olarak döndürür."""
    return abs(observed - expected) / abs(expected)


def build_mm1_config() -> SimulationConfig:
    """Şartname TEST 1'in M/M/1 senaryosunu kurar.

    Sonsuz tampon ve tek sunucu (`num_servers=1`) M/M/1 modelinin tam
    karşılığıdır; arıza modeli tanımlanmaz, çünkü kapalı form çözüm kesintisiz
    çalışan bir sunucu varsayar.
    """
    return SimulationConfig(
        stations=[
            Station(
                id=STATION_ID,
                name="M/M/1 Tek Istasyon",
                num_servers=1,
                service_time_distribution=Distribution.exponential_rate(
                    SERVICE_RATE_PER_MINUTE
                ),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(ARRIVAL_RATE_PER_MINUTE),
            entry_station_id=STATION_ID,
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=NUM_REPLICATIONS,
        random_seed=RANDOM_SEED,
    )


@pytest.fixture(scope="module")
def replications() -> List[ReplicationResult]:
    """30 bağımsız replikasyonu bir kez çalıştırır ve tüm testlerle paylaşır.

    Modül kapsamlı fixture kullanılması bilinçlidir: replikasyonlar pahalıdır ve
    her metrik testinin aynı örneklem üzerinden değerlendirilmesi, testler arası
    tutarsız sonuçları önler.
    """
    from simulation_engine.core.engine import run_replication

    config = build_mm1_config()
    return [
        run_replication(config, replication_index=index)
        for index in range(NUM_REPLICATIONS)
    ]


#: Test edilecek metrikler: (ad, analitik değer, replikasyondan çıkarıcı fonksiyon)
METRICS: List[tuple[str, float, Callable[[ReplicationResult], float]]] = [
    ("rho (kullanim orani)", ANALYTICAL.utilization,
     lambda r: r.station(STATION_ID).utilization),
    ("L (sistemdeki ortalama birim)", ANALYTICAL.l_system,
     lambda r: r.system.avg_wip),
    ("Lq (kuyruktaki ortalama birim)", ANALYTICAL.l_queue,
     lambda r: r.station(STATION_ID).avg_queue_length),
    ("W (sistemde ortalama sure)", ANALYTICAL.w_system,
     lambda r: r.system.avg_flow_time),
    ("Wq (kuyrukta ortalama bekleme)", ANALYTICAL.w_queue,
     lambda r: r.station(STATION_ID).avg_wait_time),
]


def test_scenario_is_stable(replications: List[ReplicationResult]) -> None:
    """Senaryo kararlı olmalı; aksi hâlde kapalı form karşılaştırması anlamsızdır."""
    for result in replications:
        assert result.stability.is_stable, (
            f"Replikasyon {result.replication_index} kararsiz bulundu: "
            f"{result.stability.messages}"
        )
        assert not result.warnings, f"Beklenmeyen uyari: {result.warnings}"


def test_mm1_waiting_time_matches_analytical(
    replications: List[ReplicationResult],
) -> None:
    """TEST 1 (asıl kabul kriteri): ortalama Wq analitik değerden %5'ten az sapmalı.

    Tolerans, şartnamenin ilk hâlindeki gibi tek bir koşuma değil, 30 bağımsız
    replikasyonun ortalamasına uygulanır (gerekçe modül açıklamasında).
    """
    observed = [result.station(STATION_ID).avg_wait_time for result in replications]
    summary = _summarize(observed)
    deviation = _relative_deviation(summary.mean, ANALYTICAL.w_queue)

    assert deviation < RELATIVE_TOLERANCE, (
        f"Wq sapmasi kabul edilebilir sinirin uzerinde: "
        f"analitik={ANALYTICAL.w_queue:.4f} dk, "
        f"{NUM_REPLICATIONS} replikasyon ortalamasi={summary.mean:.4f} dk, "
        f"sapma=%{deviation * 100:.2f} (sinir %{RELATIVE_TOLERANCE * 100:.0f})"
    )


def test_analytical_waiting_time_within_confidence_interval(
    replications: List[ReplicationResult],
) -> None:
    """Analitik Wq, replikasyonlardan kurulan %95 güven aralığının içinde olmalı.

    Bu, ortalama sapmasından daha güçlü bir kriterdir: yalnızca ortalamanın
    yakın olmasını değil, kestirimdeki belirsizliğin de gerçek değeri
    kapsamasını ister. Sistematik bir yanlılık (ör. sıfır bekleme gözlemlerinin
    kaydedilmemesi) ortalamayı %5 içinde tutsa bile bu testi düşürür.
    """
    observed = [result.station(STATION_ID).avg_wait_time for result in replications]
    summary = _summarize(observed)
    lower, upper = summary.confidence_interval

    assert lower <= ANALYTICAL.w_queue <= upper, (
        f"Analitik Wq={ANALYTICAL.w_queue:.4f} dk, %95 guven araliginin "
        f"[{lower:.4f}, {upper:.4f}] disinda kaldi."
    )


@pytest.mark.parametrize(
    ("metric_name", "analytical_value", "extractor"),
    METRICS,
    ids=[name.split(" ")[0] for name, _, _ in METRICS],
)
def test_mm1_metrics_match_analytical(
    replications: List[ReplicationResult],
    metric_name: str,
    analytical_value: float,
    extractor: Callable[[ReplicationResult], float],
) -> None:
    """Tüm M/M/1 kapalı form büyüklükleri %5 tolerans içinde doğrulanır."""
    observed = [extractor(result) for result in replications]
    summary = _summarize(observed)
    deviation = _relative_deviation(summary.mean, analytical_value)

    assert deviation < RELATIVE_TOLERANCE, (
        f"{metric_name}: analitik={analytical_value:.5f}, "
        f"simulasyon ortalamasi={summary.mean:.5f}, sapma=%{deviation * 100:.2f}"
    )


def test_report_summary_table(replications: List[ReplicationResult]) -> None:
    """Karşılaştırma tablosunu rapor olarak yazdırır (`pytest -s` ile görünür).

    Bu bir kabul kriteri değil, doğrulama raporudur: her metriğin analitik
    değeri, replikasyon ortalaması, %95 güven aralığı ve sapması tek tabloda
    sunulur. Şartname Bölüm 5'teki `/validation-report` ucu bu tabloyu
    dönecektir.
    """
    header = (
        f"\nM/M/1 ANALITIK DOGRULAMA — lambda=4/saat, mu=5/saat, rho=0.8\n"
        f"{NUM_REPLICATIONS} replikasyon x {SIMULATION_DURATION_MINUTES:,.0f} dk "
        f"(isinma {WARMUP_PERIOD_MINUTES:,.0f} dk), seed={RANDOM_SEED}\n"
        f"{'-' * 88}\n"
        f"{'Metrik':<32}{'Analitik':>11}{'Simulasyon':>13}"
        f"{'%95 guven araligi':>26}{'Sapma':>8}\n"
        f"{'-' * 88}"
    )
    lines = [header]
    for metric_name, analytical_value, extractor in METRICS:
        summary = _summarize([extractor(result) for result in replications])
        lower, upper = summary.confidence_interval
        deviation = _relative_deviation(summary.mean, analytical_value) * 100
        lines.append(
            f"{metric_name:<32}{analytical_value:>11.5f}{summary.mean:>13.5f}"
            f"{f'[{lower:.5f}, {upper:.5f}]':>26}{f'%{deviation:.2f}':>8}"
        )

    departures = [r.system.entities_departed for r in replications]
    lines.append("-" * 88)
    lines.append(
        f"Replikasyon basina cikan parca: ortalama {statistics.fmean(departures):,.0f} "
        f"(min {min(departures):,} / max {max(departures):,})"
    )
    lines.append(
        f"Toplam islenen olay: {sum(r.events_processed for r in replications):,} | "
        f"toplam sure: {sum(r.wall_clock_seconds for r in replications):.1f} sn"
    )
    print("\n".join(lines))
