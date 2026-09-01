"""OEE doğrulaması — Şartname Bölüm 3.4.

Test senaryosu analitik olarak öngörülebilir seçilmiştir; böylece OEE'nin üç
bileşeni de kapalı form beklentiyle karşılaştırılabilir.

Referans istasyon
-----------------
Tek sunucu, **sabit** 1,0 dakikalık işlem süresi, MTBF = 100 dk, MTTR = 10 dk,
fire oranı %10 ve varış hızı lambda = 0,6 parça/dk. Bu parametrelerle:

    Availability = MTBF / (MTBF + MTTR) = 100 / 110       = 0,90909
    Quality      = 1 - scrap_rate       = 1 - 0,10        = 0,90000

Performance için önce meşgul süre oranını bulmak gerekir. İşlem süresi sabit
1,0 dk olduğundan ve sistem kararlı olduğundan (etkin kapasite
1 x (1/1,0) x 0,90909 = 0,909 parça/dk > 0,6) gelen her parça işlenir:

    meşgul oranı = lambda x E[S] = 0,6 x 1,0             = 0,60000
    Performance  = meşgul oranı / Availability
                 = 0,60000 / 0,90909                     = 0,66000
    OEE          = A x P x Q = 0,60000 x 0,90000         = 0,54000

Son satırdaki sadeleşme dikkat çekicidir: A x P zaten meşgul süre oranına
eşittir, dolayısıyla bu senaryoda OEE = lambda x E[S] x (1 - fire oranı)
olur. Bu, testin motordan bağımsız bir çıpası olarak kullanılır.

Sabit işlem süresi bilinçli seçilmiştir: ideal çevrim süresi tam olarak
1,0 dakika olduğu için Performance bileşeni dağılım varyansından etkilenmez ve
beklenen değer kesin biçimde hesaplanabilir.
"""

from __future__ import annotations

from typing import List

import pytest
from pydantic import ValidationError

from simulation_engine.analytics.oee import (
    compute_oee_report,
    compute_station_oee,
    verify_oee_identity,
)
from simulation_engine.core.engine import run_replication
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Connection,
    Distribution,
    ReplicationResult,
    SimulationConfig,
    Station,
)

# --------------------------------------------------------------------------- #
# Senaryo sabitleri
# --------------------------------------------------------------------------- #

STATION_ID: str = "M1"
SERVICE_TIME_MINUTES: float = 1.0
ARRIVAL_RATE_PER_MINUTE: float = 0.6
MTBF_MINUTES: float = 100.0
MTTR_MINUTES: float = 10.0
SCRAP_RATE: float = 0.10

SIMULATION_DURATION_MINUTES: float = 200_000.0
WARMUP_PERIOD_MINUTES: float = 5_000.0
RANDOM_SEED: int = 4242

#: Kabul toleransı. Arıza süreci üstel olduğu için kullanılabilirlik yavaş
#: yakınsar; %2 bağıl sapma 200.000 dakikalık koşum için makul bir sınırdır.
RELATIVE_TOLERANCE: float = 0.02

# --- Analitik beklentiler ---
EXPECTED_AVAILABILITY: float = MTBF_MINUTES / (MTBF_MINUTES + MTTR_MINUTES)
EXPECTED_QUALITY: float = 1.0 - SCRAP_RATE
EXPECTED_BUSY_FRACTION: float = ARRIVAL_RATE_PER_MINUTE * SERVICE_TIME_MINUTES
EXPECTED_PERFORMANCE: float = EXPECTED_BUSY_FRACTION / EXPECTED_AVAILABILITY
EXPECTED_OEE: float = EXPECTED_BUSY_FRACTION * EXPECTED_QUALITY


def _relative_deviation(observed: float, expected: float) -> float:
    """İki değer arasındaki bağıl sapmayı oran olarak döndürür."""
    return abs(observed - expected) / abs(expected)


def build_reference_config(scrap_rate: float = SCRAP_RATE) -> SimulationConfig:
    """Modül açıklamasındaki referans istasyonu kurar."""
    return SimulationConfig(
        stations=[
            Station(
                id=STATION_ID,
                name="Referans Makine",
                num_servers=1,
                service_time_distribution=Distribution.constant(SERVICE_TIME_MINUTES),
                failure_rate=1.0 / MTBF_MINUTES,
                repair_time_distribution=Distribution.exponential(MTTR_MINUTES),
                scrap_rate=scrap_rate,
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(ARRIVAL_RATE_PER_MINUTE),
            entry_station_id=STATION_ID,
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=RANDOM_SEED,
    )


@pytest.fixture(scope="module")
def reference_result() -> ReplicationResult:
    """Referans senaryoyu bir kez çalıştırır ve tüm testlerle paylaşır."""
    return run_replication(build_reference_config())


# --------------------------------------------------------------------------- #
# 1. Üç bileşenin analitik doğrulaması
# --------------------------------------------------------------------------- #


def test_scenario_is_stable(reference_result: ReplicationResult) -> None:
    """Analitik beklentiler yalnızca kararlı sistemde geçerlidir."""
    assert reference_result.stability.is_stable, reference_result.stability.messages
    assert not reference_result.warnings


def test_quality_matches_scrap_rate(reference_result: ReplicationResult) -> None:
    """Quality bileşeni 1 - scrap_rate değerine yakınsamalı.

    Şartname Bölüm 3.4'teki Quality = İyi Ürün / Toplam Üretim tanımının,
    motorun `scrap_rate` alanından gerçekten beslendiğini doğrular.
    """
    oee = compute_station_oee(reference_result.station(STATION_ID))
    deviation = _relative_deviation(oee.quality, EXPECTED_QUALITY)

    assert deviation < RELATIVE_TOLERANCE, (
        f"Quality: beklenen={EXPECTED_QUALITY:.5f}, olculen={oee.quality:.5f}, "
        f"sapma=%{deviation * 100:.2f} "
        f"(uretim={oee.units_produced:,}, hurda={oee.units_scrapped:,})"
    )
    assert oee.units_scrapped > 0, "Fire orani %10 iken hic hurda uretilmedi."
    assert oee.units_good == oee.units_produced - oee.units_scrapped


def test_availability_matches_mtbf_mttr(reference_result: ReplicationResult) -> None:
    """Availability bileşeni MTBF / (MTBF + MTTR) değerine yakınsamalı."""
    oee = compute_station_oee(reference_result.station(STATION_ID))
    deviation = _relative_deviation(oee.availability, EXPECTED_AVAILABILITY)

    assert deviation < RELATIVE_TOLERANCE, (
        f"Availability: beklenen={EXPECTED_AVAILABILITY:.5f}, "
        f"olculen={oee.availability:.5f}, sapma=%{deviation * 100:.2f}"
    )


def test_performance_matches_offered_load(reference_result: ReplicationResult) -> None:
    """Performance bileşeni (lambda x E[S]) / Availability değerine yakınsamalı."""
    oee = compute_station_oee(reference_result.station(STATION_ID))
    deviation = _relative_deviation(oee.performance, EXPECTED_PERFORMANCE)

    assert deviation < RELATIVE_TOLERANCE, (
        f"Performance: beklenen={EXPECTED_PERFORMANCE:.5f}, "
        f"olculen={oee.performance:.5f}, sapma=%{deviation * 100:.2f}"
    )


def test_overall_oee_matches_closed_form(reference_result: ReplicationResult) -> None:
    """OEE, lambda x E[S] x (1 - fire oranı) çıpasına yakınsamalı."""
    oee = compute_station_oee(reference_result.station(STATION_ID))
    deviation = _relative_deviation(oee.oee, EXPECTED_OEE)

    assert deviation < RELATIVE_TOLERANCE, (
        f"OEE: beklenen={EXPECTED_OEE:.5f}, olculen={oee.oee:.5f}, "
        f"sapma=%{deviation * 100:.2f}"
    )


def test_oee_time_ladder_identity(reference_result: ReplicationResult) -> None:
    """OEE = Tam Verimli Süre / Planlanan Üretim Süresi özdeşliği sağlanmalı.

    Bu, üç bileşen formülünün birbiriyle tutarlı olduğunu gösteren iç denetimdir:
    çarpım ile zaman oranı ayrışırsa formüllerden biri hatalıdır.
    """
    oee = compute_station_oee(reference_result.station(STATION_ID))
    assert verify_oee_identity(oee), (
        f"Ozdeslik bozuldu: OEE={oee.oee:.9f}, "
        f"tam verimli/planlanan="
        f"{oee.fully_productive_time_minutes / oee.planned_production_time_minutes:.9f}"
    )


def test_loss_breakdown_sums_to_planned_time(reference_result: ReplicationResult) -> None:
    """Üç kayıp + tam verimli süre, planlanan üretim süresine eşit olmalı.

    Zaman merdiveninin her basamağı bir kaybı düştüğü için toplam korunmalıdır;
    bu, kullanıcıya sunulan kırılımın "kayıp yeri" bakımından eksiksiz olduğunu
    garanti eder.
    """
    oee = compute_station_oee(reference_result.station(STATION_ID))
    total = (
        oee.availability_loss_minutes
        + oee.performance_loss_minutes
        + oee.quality_loss_minutes
        + oee.fully_productive_time_minutes
    )
    assert total == pytest.approx(oee.planned_production_time_minutes, rel=1e-9), (
        f"Kayip kirilimi toplami={total:.6f}, "
        f"planlanan={oee.planned_production_time_minutes:.6f}"
    )


def test_diagnosis_identifies_starvation(reference_result: ReplicationResult) -> None:
    """Kırılım, en düşük bileşeni ve performans kaybının nedenini göstermeli.

    Referans senaryoda Performance (0,66) en düşük bileşendir ve kaybın tamamına
    yakını açlıktan (istasyon parça bekliyor) kaynaklanır — istasyon hiçbir zaman
    bloke olmaz, çünkü aşağı akışı yoktur. Şartnamenin "kullanıcı 'neden düşük'
    sorusuna cevap bulabilmeli" gereksinimi budur.
    """
    oee = compute_station_oee(reference_result.station(STATION_ID))
    assert oee.limiting_component == "performance"
    assert oee.blocking_minutes == 0.0
    assert oee.starvation_minutes > 0.0
    assert "ACLIK" in oee.diagnosis, oee.diagnosis


# --------------------------------------------------------------------------- #
# 2. Fire modelinin motor üzerindeki etkileri
# --------------------------------------------------------------------------- #


def test_zero_scrap_rate_yields_perfect_quality() -> None:
    """`scrap_rate = 0` (varsayılan) Quality bileşenini tam 1.0 yapmalı."""
    result = run_replication(
        build_reference_config(scrap_rate=0.0).model_copy(
            update={"simulation_duration_minutes": 20_000.0}
        )
    )
    oee = compute_station_oee(result.station(STATION_ID))

    assert oee.units_scrapped == 0
    assert oee.quality == 1.0
    assert oee.quality_loss_minutes == 0.0
    assert result.system.entities_scrapped == 0
    assert result.system.entities_completed == result.system.entities_departed


def test_scrap_rate_defaults_to_zero() -> None:
    """Fire alanı verilmediğinde varsayılan 0 olmalı (geriye dönük uyumluluk)."""
    station = Station(
        id="X", name="X", service_time_distribution=Distribution.constant(1.0)
    )
    assert station.scrap_rate == 0.0


def test_scrap_free_model_is_bit_identical_to_pre_scrap_behaviour() -> None:
    """Fire içermeyen bir modelin sonucu, fire alanının eklenmesinden etkilenmemeli.

    Fire için ayrılan rastgele sayı akışı yalnızca `scrap_rate > 0` olan
    istasyonlarda oluşturulur ve yalnızca orada çekim yapılır. Bu test, fire
    alanının mevcut senaryoların rastgele sayı dizisini kaydırmadığını doğrular.
    """
    base = build_reference_config(scrap_rate=0.0).model_copy(
        update={"simulation_duration_minutes": 20_000.0}
    )
    explicit = run_replication(base)
    implicit = run_replication(base.model_copy(deep=True))

    assert explicit.model_dump(exclude={"wall_clock_seconds"}) == implicit.model_dump(
        exclude={"wall_clock_seconds"}
    )


@pytest.mark.parametrize("invalid_rate", [-0.01, 1.01, 2.0, -1.0])
def test_schema_rejects_out_of_range_scrap_rate(invalid_rate: float) -> None:
    """`scrap_rate` yalnızca [0, 1] aralığında kabul edilmeli."""
    with pytest.raises(ValidationError):
        Station(
            id="X",
            name="X",
            service_time_distribution=Distribution.constant(1.0),
            scrap_rate=invalid_rate,
        )


def test_scrapped_parts_do_not_reach_downstream_station() -> None:
    """Hurdaya ayrılan parça hattan çıkarılmalı, bir sonraki istasyona gitmemeli.

    A istasyonunda %25 fire varsa, B istasyonuna giren parça sayısı A'nın
    ürettiğinin yaklaşık %75'i olmalıdır. Bu, fire modelinin yalnızca bir sayaç
    olmadığını, gerçek malzeme akışını da değiştirdiğini gösterir.
    """
    scrap_rate = 0.25
    config = SimulationConfig(
        stations=[
            Station(
                id="A",
                name="Isleme",
                service_time_distribution=Distribution.constant(1.0),
                scrap_rate=scrap_rate,
            ),
            Station(
                id="B",
                name="Montaj",
                service_time_distribution=Distribution.constant(1.0),
            ),
        ],
        connections=[Connection(from_station_id="A", to_station_id="B")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(0.7), entry_station_id="A"
        ),
        simulation_duration_minutes=100_000.0,
        warmup_period_minutes=2_000.0,
        num_replications=1,
        random_seed=17,
    )
    result = run_replication(config)
    station_a = result.station("A")
    station_b = result.station("B")

    observed_scrap_fraction = station_a.units_scrapped / station_a.units_produced
    assert observed_scrap_fraction == pytest.approx(scrap_rate, rel=0.02)

    expected_downstream = station_a.units_produced - station_a.units_scrapped
    assert station_b.entries == pytest.approx(expected_downstream, rel=0.01)

    # Ziyaret oranları da fireyi hesaba katmalı: v_B = v_A x (1 - scrap_rate).
    assert result.stability.visit_ratios["B"] == pytest.approx(1.0 - scrap_rate)

    # Sistemden çıkan iyi ürün sayısı B'nin ürettiğine eşit olmalı.
    assert result.system.entities_completed == station_b.units_produced
    assert result.system.entities_scrapped == station_a.units_scrapped
    assert (
        result.system.entities_departed
        == result.system.entities_completed + result.system.entities_scrapped
    )


def test_littles_law_holds_with_scrap() -> None:
    """Fire varken de L = lambda * W sağlanmalı.

    Hurdaya ayrılan parça sistemde gerçek bir süre geçirmiştir; akış süresi
    gözlemi kaydedilmezse veya WIP sayacı düşürülmezse özdeşlik bozulur.
    """
    result = run_replication(
        build_reference_config().model_copy(
            update={"simulation_duration_minutes": 100_000.0}
        )
    )
    system = result.system
    deviation = abs(
        system.avg_wip - system.effective_arrival_rate * system.avg_flow_time
    ) / system.avg_wip

    assert deviation < 0.05, (
        f"Little's Law sapmasi %{deviation * 100:.3f}: "
        f"L={system.avg_wip:.5f}, lambda*W="
        f"{system.effective_arrival_rate * system.avg_flow_time:.5f}"
    )


# --------------------------------------------------------------------------- #
# 3. Hat düzeyi rapor
# --------------------------------------------------------------------------- #


def test_quality_limited_station_is_diagnosed() -> None:
    """Kalite en düşük bileşen olduğunda teşhis bunu göstermeli."""
    config = SimulationConfig(
        stations=[
            Station(
                id="Q1",
                name="Fireli Makine",
                service_time_distribution=Distribution.constant(1.0),
                scrap_rate=0.40,
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(0.85), entry_station_id="Q1"
        ),
        simulation_duration_minutes=100_000.0,
        warmup_period_minutes=2_000.0,
        num_replications=1,
        random_seed=31,
    )
    oee = compute_station_oee(run_replication(config).station("Q1"))

    assert oee.quality == pytest.approx(0.60, rel=0.02)
    assert oee.availability == 1.0, "Ariza modeli yokken Availability tam 1.0 olmali."
    assert oee.limiting_component == "quality"
    assert "KALITE" in oee.diagnosis, oee.diagnosis
    assert oee.quality_loss_minutes > 0.0


def test_line_oee_is_measured_at_the_bottleneck() -> None:
    """Hat OEE'si darboğazda ölçülmeli, en düşük OEE'li istasyonda değil.

    Senaryo bu ayrımı bilinçli olarak ortaya çıkarır:

    - A: çevrim 0,5 dk, fire yok  -> meşgul %40, OEE = 0,40
    - B: çevrim 1,1 dk, fire %20  -> meşgul %88, OEE = 0,88 x 0,80 = 0,70

    En düşük OEE A'dadır ama A kısıt değildir; sadece parça bekliyordur. Hattın
    çıktısını B belirler. Hattı 0,40 ile raporlamak, kısıt olmayan istasyona
    yatırım yapılmasına yol açan yerel optimizasyon hatasıdır.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="A",
                name="Hizli",
                service_time_distribution=Distribution.constant(0.5),
            ),
            Station(
                id="B",
                name="Fireli Darbogaz",
                service_time_distribution=Distribution.constant(1.1),
                scrap_rate=0.20,
            ),
        ],
        connections=[Connection(from_station_id="A", to_station_id="B")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(0.8), entry_station_id="A"
        ),
        simulation_duration_minutes=60_000.0,
        warmup_period_minutes=2_000.0,
        num_replications=1,
        random_seed=53,
    )
    result = run_replication(config)
    report = compute_oee_report(result)

    assert len(report.stations) == 2

    # Darboğaz kullanım oranıyla belirlenir.
    assert report.bottleneck_station_id == "B"
    assert result.station("B").utilization > result.station("A").utilization
    assert report.line_oee == report.station("B").oee
    assert report.line_oee == pytest.approx(0.70, rel=0.05)

    # En düşük OEE aç kalan A'dadır ve hat OEE'siyle karıştırılmamalıdır.
    assert report.lowest_oee_station_id == "A"
    assert report.lowest_oee < report.line_oee
    assert report.station("A").limiting_component == "performance"
    assert "ACLIK" in report.station("A").diagnosis

    assert report.station("A").quality == 1.0
    assert report.station("B").quality == pytest.approx(0.80, rel=0.03)
    for station in report.stations:
        assert verify_oee_identity(station), station.station_id


def test_report_oee_breakdown(reference_result: ReplicationResult) -> None:
    """OEE kırılım tablosunu rapor olarak yazdırır (`pytest -s` ile görünür)."""
    oee = compute_station_oee(reference_result.station(STATION_ID))
    rows: List[tuple[str, float, float]] = [
        ("Availability", EXPECTED_AVAILABILITY, oee.availability),
        ("Performance", EXPECTED_PERFORMANCE, oee.performance),
        ("Quality", EXPECTED_QUALITY, oee.quality),
        ("OEE", EXPECTED_OEE, oee.oee),
    ]

    lines = [
        f"\nOEE DOGRULAMASI — '{oee.station_name}'",
        f"islem suresi {SERVICE_TIME_MINUTES} dk sabit | MTBF {MTBF_MINUTES:.0f} dk | "
        f"MTTR {MTTR_MINUTES:.0f} dk | fire %{SCRAP_RATE * 100:.0f} | "
        f"lambda {ARRIVAL_RATE_PER_MINUTE}/dk",
        f"{SIMULATION_DURATION_MINUTES:,.0f} dk (isinma {WARMUP_PERIOD_MINUTES:,.0f} dk), "
        f"seed={RANDOM_SEED}",
        "-" * 62,
        f"{'Bilesen':<16}{'Analitik':>12}{'Simulasyon':>14}{'Sapma':>10}",
        "-" * 62,
    ]
    for name, expected, observed in rows:
        deviation = _relative_deviation(observed, expected) * 100
        lines.append(
            f"{name:<16}{expected:>12.5f}{observed:>14.5f}{f'%{deviation:.2f}':>10}"
        )

    lines.append("-" * 62)
    lines.append("ZAMAN MERDIVENI (dakika)")
    lines.append(
        f"  Planlanan uretim suresi : {oee.planned_production_time_minutes:>12,.1f}"
    )
    lines.append(
        f"    - ariza kaybi         : {oee.availability_loss_minutes:>12,.1f}"
    )
    lines.append(f"  = Calisma suresi        : {oee.run_time_minutes:>12,.1f}")
    lines.append(
        f"    - performans kaybi    : {oee.performance_loss_minutes:>12,.1f}  "
        f"(aclik {oee.starvation_minutes:,.0f} / blokaj {oee.blocking_minutes:,.0f})"
    )
    lines.append(
        f"  = Net calisma suresi    : {oee.net_operating_time_minutes:>12,.1f}"
    )
    lines.append(f"    - kalite kaybi        : {oee.quality_loss_minutes:>12,.1f}")
    lines.append(
        f"  = Tam verimli sure      : {oee.fully_productive_time_minutes:>12,.1f}"
    )
    lines.append("-" * 62)
    lines.append(
        f"Uretim: {oee.units_produced:,} birim | iyi: {oee.units_good:,} | "
        f"hurda: {oee.units_scrapped:,}"
    )
    lines.append(f"En kisitlayici bilesen: {oee.limiting_component}")
    lines.append(f"Teshis: {oee.diagnosis}")

    print("\n".join(lines))
