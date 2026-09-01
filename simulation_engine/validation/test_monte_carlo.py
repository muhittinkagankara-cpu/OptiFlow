"""Monte Carlo ve güven aralığı doğrulaması — Şartname Bölüm 3.7.

Bir güven aralığı iki şeyi doğru yapmalıdır: aritmetiği ve kapsamayı.

**Aritmetik** kolay sınanır — yarı genişlik tam olarak
kritik değer x s / KAREKOK(n) olmalıdır ve bu, modülden bağımsız hesaplanan
değerle karşılaştırılır.

**Kapsama** daha zordur ve asıl önemli olandır: %95 güven aralığı, gerçek
değeri koşumların yaklaşık %95'inde içermelidir. Bu, M/M/1 senaryosunda
analitik olarak bilinen L, W ve Wq değerleri kullanılarak doğrudan ölçülür:
otuz bağımsız Monte Carlo çalıştırması yapılır ve analitik değerin kaç
aralıkta kaldığı sayılır. Bu test, aralığın yalnızca "hesaplanmış" değil,
gerçekten anlamlı olduğunu gösterir.
"""

from __future__ import annotations

import math
import statistics
from typing import List

import pytest

from simulation_engine.analytics.monte_carlo import (
    ACCEPTABLE_RELATIVE_PRECISION,
    T_CRITICAL_95,
    Z_SCORE_95,
    format_headline,
    format_report,
    required_replications,
    run_monte_carlo,
    summarize,
    t_critical_95,
)
from simulation_engine.models.schemas import (
    MIN_RECOMMENDED_REPLICATIONS,
    ArrivalProcess,
    Connection,
    Distribution,
    SimulationConfig,
    Station,
)

#: M/M/1 senaryosu: lambda = 0.8, mu = 1.0, rho = 0.8.
ARRIVAL_MEAN_MINUTES: float = 1.25
SERVICE_MEAN_MINUTES: float = 1.0
UTILIZATION: float = SERVICE_MEAN_MINUTES / ARRIVAL_MEAN_MINUTES

#: M/M/1 kapalı form değerleri (lambda = 0.8, mu = 1.0).
ANALYTIC_L: float = UTILIZATION / (1.0 - UTILIZATION)
ANALYTIC_W: float = 1.0 / (1.0 / SERVICE_MEAN_MINUTES - 1.0 / ARRIVAL_MEAN_MINUTES)
ANALYTIC_WQ: float = UTILIZATION * ANALYTIC_W

SIMULATION_DURATION_MINUTES: float = 30_000.0
WARMUP_PERIOD_MINUTES: float = 2_000.0


def _mm1_config(seed: int = 2025, replications: int = 30) -> SimulationConfig:
    """Guven araligi testleri icin M/M/1 senaryosu."""
    return SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Tek Istasyon",
                service_time_distribution=Distribution.exponential(
                    SERVICE_MEAN_MINUTES
                ),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(ARRIVAL_MEAN_MINUTES),
            entry_station_id="S",
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=replications,
        random_seed=seed,
    )


@pytest.fixture(scope="module")
def report():
    """30 replikasyonluk temel Monte Carlo raporunu bir kez üretir."""
    return run_monte_carlo(_mm1_config())


# --------------------------------------------------------------------------- #
# 1. Güven aralığı aritmetiği
# --------------------------------------------------------------------------- #


def test_confidence_interval_arithmetic_matches_specification() -> None:
    """Yari genislik tam olarak 1.96 * s / KAREKOK(n) olmali."""
    values = [10.0, 12.0, 11.0, 9.0, 13.0, 10.5, 11.5, 12.5, 9.5, 10.2]
    statistic = summarize(values, metric="test", label="Test")

    expected_mean = statistics.fmean(values)
    expected_std = statistics.stdev(values)
    expected_half_width = Z_SCORE_95 * expected_std / math.sqrt(len(values))

    assert statistic.count == len(values)
    assert statistic.mean == pytest.approx(expected_mean)
    assert statistic.std_dev == pytest.approx(expected_std)
    assert statistic.standard_error == pytest.approx(expected_std / math.sqrt(len(values)))
    assert statistic.critical_value == Z_SCORE_95
    assert statistic.half_width == pytest.approx(expected_half_width)
    assert statistic.ci_lower == pytest.approx(expected_mean - expected_half_width)
    assert statistic.ci_upper == pytest.approx(expected_mean + expected_half_width)
    assert statistic.minimum == min(values)
    assert statistic.maximum == max(values)
    assert statistic.relative_precision == pytest.approx(
        expected_half_width / expected_mean
    )


def test_student_t_option_widens_the_interval() -> None:
    """Student t secildiginde aralik normal yaklasimdan genis olmali.

    n = 30'da t(0.025, 29) = 2.045 > 1.96; normal yaklasim araligi yaklasik
    %4 dar gosterir. Sartname 1.96'yi belirttigi icin varsayilan odur, ancak
    dogru olan secenek de sunulur.
    """
    values = [float(index) for index in range(30)]
    normal = summarize(values, metric="m", label="M", use_student_t=False)
    student = summarize(values, metric="m", label="M", use_student_t=True)

    assert normal.critical_value == Z_SCORE_95
    assert student.critical_value == T_CRITICAL_95[29]
    assert student.half_width > normal.half_width
    assert student.ci_upper > normal.ci_upper
    assert student.ci_lower < normal.ci_lower
    assert student.mean == pytest.approx(normal.mean)


@pytest.mark.parametrize(
    ("degrees_of_freedom", "expected"),
    [(1, 12.706), (9, 2.262), (29, 2.045), (30, 2.042), (60, 2.000)],
)
def test_t_critical_table_values(degrees_of_freedom: int, expected: float) -> None:
    """t tablosu bilinen degerleri dondurmeli."""
    assert t_critical_95(degrees_of_freedom) == pytest.approx(expected)


def test_t_critical_falls_back_for_missing_degrees_of_freedom() -> None:
    """Tabloda olmayan serbestlik dereceleri icin muhafazakâr deger secilmeli."""
    # 45 tabloda yok; kendisinden kucuk en yakin anahtar 40'tir.
    assert t_critical_95(45) == T_CRITICAL_95[40]
    assert t_critical_95(1000) == T_CRITICAL_95[120]
    assert t_critical_95(0) == Z_SCORE_95


def test_single_replication_has_zero_width_interval() -> None:
    """Tek gozlemde standart sapma tanimsizdir; aralik sifir genislikte olmali."""
    statistic = summarize([42.0], metric="m", label="M")

    assert statistic.count == 1
    assert statistic.std_dev == 0.0
    assert statistic.half_width == 0.0
    assert statistic.ci_lower == statistic.ci_upper == 42.0


def test_summarize_rejects_empty_input() -> None:
    """Bos gozlem listesi hata vermeli."""
    with pytest.raises(ValueError):
        summarize([], metric="m", label="M")


# --------------------------------------------------------------------------- #
# 2. Kapsama (coverage) — asıl anlamlı test
# --------------------------------------------------------------------------- #


def test_confidence_interval_covers_analytical_values(report) -> None:
    """Analitik M/M/1 degerleri %95 guven araliginin icinde olmali."""
    wip = report.metric("avg_wip")
    flow = report.metric("avg_flow_time")

    assert wip.ci_lower <= ANALYTIC_L <= wip.ci_upper, (
        f"L = {ANALYTIC_L:.5f} aralik disinda: "
        f"[{wip.ci_lower:.5f}, {wip.ci_upper:.5f}]"
    )
    assert flow.ci_lower <= ANALYTIC_W <= flow.ci_upper, (
        f"W = {ANALYTIC_W:.5f} aralik disinda: "
        f"[{flow.ci_lower:.5f}, {flow.ci_upper:.5f}]"
    )

    waiting = report.station("S").metric("avg_wait_time")
    assert waiting.ci_lower <= ANALYTIC_WQ <= waiting.ci_upper, (
        f"Wq = {ANALYTIC_WQ:.5f} aralik disinda: "
        f"[{waiting.ci_lower:.5f}, {waiting.ci_upper:.5f}]"
    )


def test_empirical_coverage_is_close_to_nominal() -> None:
    """Otuz bagimsiz Monte Carlo kosumunda kapsama %95'e yakin olmali.

    Bu, guven araliginin yalnizca dogru hesaplanmis degil, gercekten anlamli
    oldugunu gosteren asil testtir: her kosum farkli bir ana tohumla yapilir ve
    analitik Wq degerinin kac aralikta kaldigi sayilir. Sistematik olarak dar
    araliklar ureten bir hata (or. standart hatanin KAREKOK(n)'e bolunmemesi)
    kapsamayi belirgin bicimde dusururdu.

    Kabul araligi genis tutulur: 30 kosumda gozlenen kapsamanin kendisi de
    rastgeledir (nominal %95 icin standart sapma yaklasik %4).
    """
    trials = 30
    covered = 0
    for trial in range(trials):
        trial_report = run_monte_carlo(
            _mm1_config(replications=15).model_copy(
                update={"simulation_duration_minutes": 10_000.0}
            ),
            master_seed=9_000 + trial,
        )
        waiting = trial_report.station("S").metric("avg_wait_time")
        if waiting.ci_lower <= ANALYTIC_WQ <= waiting.ci_upper:
            covered += 1

    coverage = covered / trials
    assert 0.75 <= coverage <= 1.0, (
        f"Gozlenen kapsama %{coverage * 100:.0f} ({covered}/{trials}); "
        f"nominal %95'ten belirgin sapma var."
    )


def test_interval_narrows_as_replications_increase() -> None:
    """Replikasyon sayisi arttikca yari genislik KAREKOK(n) ile daralmali."""
    few = run_monte_carlo(_mm1_config(), num_replications=10, master_seed=555)
    many = run_monte_carlo(_mm1_config(), num_replications=40, master_seed=555)

    narrow = many.metric("avg_wip")
    wide = few.metric("avg_wip")
    assert narrow.half_width < wide.half_width
    assert narrow.relative_precision < wide.relative_precision


# --------------------------------------------------------------------------- #
# 3. Tekrarlanabilirlik ve bağımsızlık
# --------------------------------------------------------------------------- #


def test_same_master_seed_reproduces_identical_report() -> None:
    """Ayni ana tohum birebir ayni raporu uretmeli (TEST 5)."""
    first = run_monte_carlo(_mm1_config(), num_replications=8, master_seed=777)
    second = run_monte_carlo(_mm1_config(), num_replications=8, master_seed=777)

    exclude = {"total_wall_clock_seconds"}
    assert first.model_dump(exclude=exclude) == second.model_dump(exclude=exclude)


def test_different_master_seeds_give_different_replications() -> None:
    """Farkli ana tohumlar farkli replikasyon tohumlari uretmeli."""
    first = run_monte_carlo(_mm1_config(), num_replications=8, master_seed=777)
    second = run_monte_carlo(_mm1_config(), num_replications=8, master_seed=888)

    assert first.replication_seeds != second.replication_seeds
    assert first.metric("avg_wip").mean != second.metric("avg_wip").mean


def test_replication_seeds_are_distinct(report) -> None:
    """Her replikasyon farkli bir tohumla calismali; aksi halde bagimsiz degillerdir."""
    seeds = report.replication_seeds
    assert len(seeds) == report.num_replications
    assert len(set(seeds)) == report.num_replications


def test_config_seed_is_used_when_master_seed_omitted() -> None:
    """Ana tohum verilmezse konfigurasyondaki tohum kullanilmali."""
    explicit = run_monte_carlo(_mm1_config(seed=4321), num_replications=5)
    assert explicit.master_seed == 4321


# --------------------------------------------------------------------------- #
# 4. Replikasyon sayısı planlaması
# --------------------------------------------------------------------------- #


def test_required_replications_follows_inverse_square_law() -> None:
    """Kesinligi ikiye katlamak dort kat replikasyon gerektirmeli."""
    statistic = summarize(
        [float(v) for v in (100, 110, 90, 105, 95, 102, 98, 108, 92, 100)],
        metric="m",
        label="M",
    )
    current = statistic.relative_precision
    assert required_replications(statistic, current / 2.0) == pytest.approx(
        statistic.count * 4, rel=0.05
    )


def test_required_replications_never_shrinks_below_current() -> None:
    """Hedef zaten karsilaniyorsa mevcut sayi dondurulmeli."""
    statistic = summarize([100.0, 100.1, 99.9, 100.05], metric="m", label="M")
    assert required_replications(statistic, 0.5) == statistic.count

    with pytest.raises(ValueError):
        required_replications(statistic, 0.0)


def test_warns_when_below_recommended_replications() -> None:
    """30'un altinda replikasyon icin uyari uretilmeli."""
    few = run_monte_carlo(_mm1_config(), num_replications=5, master_seed=111)
    assert any(
        str(MIN_RECOMMENDED_REPLICATIONS) in warning for warning in few.warnings
    )

    single = run_monte_carlo(_mm1_config(), num_replications=1, master_seed=111)
    assert any("Tek replikasyon" in warning for warning in single.warnings)


def test_warns_when_model_is_unstable() -> None:
    """Kararsiz model uyarisi Monte Carlo raporuna tasinmali."""
    unstable = _mm1_config().model_copy(
        update={
            "stations": [
                Station(
                    id="S",
                    name="Yavas",
                    service_time_distribution=Distribution.constant(2.0),
                )
            ],
            "simulation_duration_minutes": 3_000.0,
            "warmup_period_minutes": 200.0,
        }
    )
    result = run_monte_carlo(unstable, num_replications=3, master_seed=222)
    assert any("kararsiz" in warning for warning in result.warnings)


def test_invalid_replication_count_is_rejected() -> None:
    """Sifir replikasyon reddedilmeli."""
    with pytest.raises(ValueError):
        run_monte_carlo(_mm1_config(), num_replications=0)


def test_engine_reports_dangling_station_reference_clearly() -> None:
    """`model_copy` semayi atladiginda motor anlasilir bir hata vermeli.

    Pydantic'in `model_copy(update=...)` metodu dogrulayicilari calistirmaz;
    bu yolla uretilen tutarsiz bir konfigurasyon motora ulasabilir. Boyle bir
    durumda anlasilmaz bir KeyError yerine sorunu adiyla soyleyen bir hata
    beklenir.
    """
    broken = _mm1_config().model_copy(
        update={
            "stations": [
                Station(
                    id="YENI",
                    name="Yeni",
                    service_time_distribution=Distribution.exponential(1.0),
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="istasyonuna giris yapiyor"):
        run_monte_carlo(broken, num_replications=1, master_seed=1)


# --------------------------------------------------------------------------- #
# 5. Rapor biçimi
# --------------------------------------------------------------------------- #


def test_headline_matches_specification_format(report) -> None:
    """Ana sonuc sartnamedeki tek cumlelik bicimde sunulmali."""
    headline = report.headline

    assert headline.startswith("Beklenen uretim:")
    assert "birim" in headline
    assert "%95 guven araligi:" in headline

    production = report.metric("units_produced")
    assert f"{production.mean:,.0f}" in headline
    assert f"{production.ci_lower:,.0f}" in headline
    assert f"{production.ci_upper:,.0f}" in headline

    # Aralık ortalamayı içermeli ve ortalama tam ortasında olmalı.
    assert production.ci_lower <= production.mean <= production.ci_upper
    assert production.mean - production.ci_lower == pytest.approx(
        production.ci_upper - production.mean
    )


def test_station_summaries_cover_all_stations() -> None:
    """Her istasyon icin ozet uretilmeli."""
    config = _mm1_config().model_copy(
        update={
            "stations": [
                Station(
                    id="A",
                    name="Kesim",
                    service_time_distribution=Distribution.exponential(0.5),
                ),
                Station(
                    id="B",
                    name="Montaj",
                    service_time_distribution=Distribution.exponential(0.9),
                ),
            ],
            "connections": [Connection(from_station_id="A", to_station_id="B")],
            "arrival_process": ArrivalProcess(
                distribution=Distribution.exponential(ARRIVAL_MEAN_MINUTES),
                entry_station_id="A",
            ),
            "simulation_duration_minutes": 15_000.0,
        }
    )
    result = run_monte_carlo(config, num_replications=6, master_seed=333)

    assert [s.station_id for s in result.stations] == ["A", "B"]
    for summary in result.stations:
        metrics = {statistic.metric for statistic in summary.statistics}
        assert "utilization" in metrics
        assert "avg_wait_time" in metrics
        assert summary.metric("utilization").ci_lower <= summary.metric(
            "utilization"
        ).mean


def test_statistics_are_internally_consistent(report) -> None:
    """Her ozet kendi icinde tutarli olmali."""
    for statistic in report.system + [
        s for summary in report.stations for s in summary.statistics
    ]:
        assert statistic.minimum <= statistic.mean <= statistic.maximum
        assert statistic.std_dev >= 0.0
        assert statistic.half_width >= 0.0
        assert statistic.ci_lower <= statistic.ci_upper
        assert statistic.count == report.num_replications


def test_report_monte_carlo_table(report) -> None:
    """Monte Carlo tablosunu rapor olarak yazdirir (`pytest -s`)."""
    lines: List[str] = [
        "",
        format_report(report),
        "",
        "ANALITIK KARSILASTIRMA (M/M/1, lambda=0.8, mu=1.0, rho=0.8)",
        "-" * 66,
        f"{'Metrik':<22}{'Analitik':>11}{'Ortalama':>12}{'Aralik icinde':>20}",
        "-" * 66,
    ]
    comparisons = [
        ("L (ortalama WIP)", ANALYTIC_L, report.metric("avg_wip")),
        ("W (akis suresi)", ANALYTIC_W, report.metric("avg_flow_time")),
        ("Wq (bekleme)", ANALYTIC_WQ, report.station("S").metric("avg_wait_time")),
    ]
    for label, analytic, statistic in comparisons:
        inside = "EVET" if statistic.ci_lower <= analytic <= statistic.ci_upper else "HAYIR"
        lines.append(
            f"{label:<22}{analytic:>11.5f}{statistic.mean:>12.5f}{inside:>20}"
        )
    lines.append("-" * 66)
    production = report.metric("units_produced")
    lines.append(
        f"Hedef kesinlik %{ACCEPTABLE_RELATIVE_PRECISION * 100:.0f} icin gereken "
        f"replikasyon: "
        f"{required_replications(production, ACCEPTABLE_RELATIVE_PRECISION)}"
    )
    lines.append(format_headline(report.metric("avg_flow_time")))
    print("\n".join(lines))
