"""TEST 4 — Darboğaz tutarlılığı (Şartname Bölüm 4).

Şartname, bilinçli olarak bir istasyonu çok yavaş yapan bir senaryoda sistemin
o istasyonu darboğaz olarak tespit etmesini şart koşuyor. Bu dosya bunu ve
tespiti gerçekten sınayan dört ek durumu doğrular:

1. **Darboğaz gezdirme.** Aynı hatta yavaş istasyon sırayla A, B ve C yapılır;
   tespit her seferinde doğru istasyonu göstermelidir. Sabit bir cevabı olan
   tek senaryo, her zaman aynı istasyonu döndüren hatalı bir uygulamayı da
   geçirirdi.
2. **Blokaj tuzağı.** Sonlu tamponlu bir hatta gerçek darboğaz aşağı akıştadır;
   yukarı akıştaki istasyon blokaj nedeniyle "meşgul" görünür. Bloke süre
   kullanıma katılırsa tespit yanlış istasyonu gösterir.
3. **Ziyaret oranı tuzağı.** Yeniden işleme döngüsündeki bir istasyon iş emri
   başına birden çok kez ziyaret edilir; çevrim süresi kısa olsa bile sistem
   çıktısını daha fazla sınırlayabilir.
4. **Teorik azami çıktı.** Darboğazın kapasitesi, simülasyonun ürettiği gerçek
   çıktıyı yukarıdan sınırlamalıdır.
"""

from __future__ import annotations

from typing import List

import pytest

from simulation_engine.analytics.bottleneck import (
    CRITICAL_UTILIZATION,
    DBR_SAFETY_FACTOR,
    analyze,
    format_report,
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

SIMULATION_DURATION_MINUTES: float = 80_000.0
WARMUP_PERIOD_MINUTES: float = 3_000.0

#: Yavaş istasyonun çevrim süresi; diğerlerinin belirgin biçimde üzerinde.
SLOW_CYCLE_MINUTES: float = 2.2
FAST_CYCLE_MINUTES: float = 0.8


def _three_station_line(slow_station_id: str, seed: int) -> SimulationConfig:
    """Uc istasyonlu seri hat; yalnizca `slow_station_id` yavas."""
    cycles = {
        station_id: (
            SLOW_CYCLE_MINUTES if station_id == slow_station_id else FAST_CYCLE_MINUTES
        )
        for station_id in ("A", "B", "C")
    }
    return SimulationConfig(
        stations=[
            Station(
                id="A",
                name="Kesim",
                service_time_distribution=Distribution.exponential(cycles["A"]),
            ),
            Station(
                id="B",
                name="Pres",
                service_time_distribution=Distribution.exponential(cycles["B"]),
            ),
            Station(
                id="C",
                name="Montaj",
                service_time_distribution=Distribution.exponential(cycles["C"]),
            ),
        ],
        connections=[
            Connection(from_station_id="A", to_station_id="B"),
            Connection(from_station_id="B", to_station_id="C"),
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.75), entry_station_id="A"
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=seed,
    )


# --------------------------------------------------------------------------- #
# 1. Şartnamenin TEST 4 kriteri ve darboğaz gezdirme
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("slow_station_id", "seed"), [("A", 11), ("B", 22), ("C", 33)]
)
def test_deliberately_slow_station_is_detected(slow_station_id: str, seed: int) -> None:
    """Bilincli olarak yavaslatilan istasyon darbogaz olarak tespit edilmeli."""
    config = _three_station_line(slow_station_id, seed)
    result = run_replication(config)
    analysis = analyze(result, config)

    assert analysis.bottleneck_station_id == slow_station_id, format_report(analysis)
    assert analysis.station_loads[0].station_id == slow_station_id
    assert analysis.station_loads[0].rank == 1
    # Darboğaz, diğer istasyonlardan belirgin biçimde daha yüklü olmalı.
    for other in analysis.station_loads[1:]:
        assert analysis.bottleneck_utilization > other.utilization


@pytest.mark.parametrize(
    ("slow_station_id", "seed"), [("A", 11), ("B", 22), ("C", 33)]
)
def test_detection_agrees_with_theoretical_load(
    slow_station_id: str, seed: int
) -> None:
    """Olculen kullanim orani ile motorun teorik yuk hesabi ayni istasyonu gostermeli.

    Iki hesap birbirinden bagimsizdir: biri simulasyon sirasinda biriktirilen
    zaman integralinden, digeri calisma oncesi trafik denklemlerinden gelir.
    """
    config = _three_station_line(slow_station_id, seed)
    result = run_replication(config)
    analysis = analyze(result, config)

    theoretical_bottleneck = max(
        result.stability.station_loads, key=lambda key: result.stability.station_loads[key]
    )
    assert analysis.bottleneck_station_id == theoretical_bottleneck


def test_theoretical_maximum_bounds_observed_throughput() -> None:
    """Darbogaz kapasitesi gercek ciktiyi yukaridan sinirlamali."""
    config = _three_station_line("B", 22)
    result = run_replication(config)
    analysis = analyze(result, config)

    assert analysis.observed_throughput_per_minute <= (
        analysis.theoretical_max_throughput_per_minute
    )
    assert 0.0 < analysis.capacity_utilization_pct <= 100.0

    # Darboğaz B: kapasite = 1 sunucu / 2.2 dk = 0.4545 parça/dk.
    assert analysis.theoretical_max_throughput_per_minute == pytest.approx(
        1.0 / SLOW_CYCLE_MINUTES, rel=1e-9
    )


def test_secondary_bottleneck_is_reported() -> None:
    """Ikinci en yuklu istasyon da raporlanmali (kisit genisletilince oraya kayar)."""
    config = _three_station_line("B", 22)
    analysis = analyze(run_replication(config), config)

    assert analysis.secondary_bottleneck_station_id is not None
    assert analysis.secondary_bottleneck_station_id != analysis.bottleneck_station_id
    assert analysis.station_loads[1].station_id == analysis.secondary_bottleneck_station_id


# --------------------------------------------------------------------------- #
# 2. Blokaj tuzağı
# --------------------------------------------------------------------------- #


def test_blocked_upstream_station_is_not_mistaken_for_bottleneck() -> None:
    """Blokaj nedeniyle mesgul gorunen yukari akis istasyonu darbogaz sayilmamali.

    A hizli (0,5 dk) ama tamponsuz bir B'ye (2,0 dk) besleme yapiyor; B yavas
    oldugu icin A surekli bloke kaliyor. Bloke sure kullanima katilirsa A
    yanlislikla darbogaz gorunur. Gercek kisit B'dir.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="A",
                name="Hizli Besleyici",
                service_time_distribution=Distribution.constant(0.5),
            ),
            Station(
                id="B",
                name="Yavas Kisit",
                service_time_distribution=Distribution.constant(2.0),
                buffer_capacity_before=1,
            ),
        ],
        connections=[Connection(from_station_id="A", to_station_id="B")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.5), entry_station_id="A"
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=44,
    )
    result = run_replication(config)
    analysis = analyze(result, config)

    assert analysis.bottleneck_station_id == "B", format_report(analysis)

    # A gerçekten bloke kalmış olmalı; aksi hâlde test tuzağı kurmamış olurdu.
    load_a = next(load for load in analysis.station_loads if load.station_id == "A")
    assert load_a.blocked_fraction > 0.25

    # Blokaj A'yı olduğundan çok daha meşgul gösterir: doluluk oranı, işlem
    # yaparak geçirdiği sürenin iki katından fazladır. Tespit yine de doğru
    # istasyonu bulur, çünkü kullanım oranı yalnızca işlem süresini sayar.
    assert load_a.utilization + load_a.blocked_fraction > 2 * load_a.utilization
    assert load_a.utilization < analysis.bottleneck_utilization

    # Kullanım oranının tanımı doğrudan doğrulanır: bloke süre paya girmez.
    metrics_a = result.station("A")
    assert metrics_a.utilization == pytest.approx(
        metrics_a.busy_minutes / metrics_a.planned_production_time_minutes, rel=1e-12
    )
    assert metrics_a.blocked_minutes > 0.0
    assert metrics_a.busy_minutes + metrics_a.blocked_minutes == pytest.approx(
        metrics_a.planned_production_time_minutes - metrics_a.idle_minutes, rel=1e-9
    )


# --------------------------------------------------------------------------- #
# 3. Ziyaret oranı tuzağı
# --------------------------------------------------------------------------- #


def test_visit_ratio_is_accounted_for_in_system_capacity() -> None:
    """Cok ziyaret edilen istasyonun sistem kapasitesi ziyaret oranina bolunmeli.

    P istasyonu kalite kontrolden %50 geri donus aldigi icin is emri basina
    v_P = 2 kez ziyaret edilir. Kendi kapasitesi yuksek olsa da sistem ciktisini
    yarisi kadar sinirlar.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="P",
                name="Isleme",
                service_time_distribution=Distribution.exponential(0.9),
            ),
            Station(
                id="Q",
                name="Kalite",
                service_time_distribution=Distribution.exponential(0.5),
            ),
        ],
        connections=[
            Connection(from_station_id="P", to_station_id="Q", routing_probability=1.0),
            Connection(from_station_id="Q", to_station_id="P", routing_probability=0.5),
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.2), entry_station_id="P"
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=55,
    )
    result = run_replication(config)
    analysis = analyze(result, config)

    load_p = next(load for load in analysis.station_loads if load.station_id == "P")
    load_q = next(load for load in analysis.station_loads if load.station_id == "Q")

    # v_P = v_Q = 1 / (1 - 0.5) = 2
    assert load_p.visit_ratio == pytest.approx(2.0, rel=1e-9)
    assert load_q.visit_ratio == pytest.approx(2.0, rel=1e-9)

    # Sistem kapasitesi kendi kapasitesinin yarısı olmalı.
    assert load_p.system_capacity_per_minute == pytest.approx(
        load_p.capacity_per_minute / 2.0, rel=1e-9
    )
    assert analysis.bottleneck_station_id == "P"
    assert "ziyaret" in analysis.diagnosis


# --------------------------------------------------------------------------- #
# 4. Drum-Buffer-Rope
# --------------------------------------------------------------------------- #


def test_dbr_buffer_grows_with_upstream_variation() -> None:
    """Yukari akis degiskenligi arttikca onerilen tampon buyumeli.

    Ayni hat iki kez calistirilir: ilkinde besleyici istasyonun islem suresi
    sabit, ikincisinde ayni ortalamaya sahip ama yuksek varyansli. Darbogaz
    her iki durumda ayni olmasina ragmen tampon onerisi ikincisinde daha
    buyuk olmalidir.
    """

    def build(feeder_distribution: Distribution, seed: int) -> SimulationConfig:
        return SimulationConfig(
            stations=[
                Station(
                    id="F",
                    name="Besleyici",
                    service_time_distribution=feeder_distribution,
                ),
                Station(
                    id="BN",
                    name="Darbogaz",
                    service_time_distribution=Distribution.constant(2.0),
                    buffer_capacity_before=2,
                ),
            ],
            connections=[Connection(from_station_id="F", to_station_id="BN")],
            arrival_process=ArrivalProcess(
                distribution=Distribution.exponential(2.5), entry_station_id="F"
            ),
            simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
            warmup_period_minutes=WARMUP_PERIOD_MINUTES,
            num_replications=1,
            random_seed=seed,
        )

    steady = build(Distribution.constant(1.0), 66)
    variable = build(Distribution.triangular(0.1, 0.5, 2.4), 66)

    steady_analysis = analyze(run_replication(steady), steady)
    variable_analysis = analyze(run_replication(variable), variable)

    assert steady_analysis.bottleneck_station_id == "BN"
    assert variable_analysis.bottleneck_station_id == "BN"

    steady_dbr = steady_analysis.drum_buffer_rope
    variable_dbr = variable_analysis.drum_buffer_rope
    assert steady_dbr is not None and variable_dbr is not None

    assert steady_dbr.upstream_station_id == "F"
    assert steady_dbr.upstream_variation_minutes == pytest.approx(0.0, abs=1e-9)
    assert variable_dbr.upstream_variation_minutes > 0.4
    assert (
        variable_dbr.recommended_buffer_units >= steady_dbr.recommended_buffer_units
    )
    assert variable_dbr.safety_factor == DBR_SAFETY_FACTOR
    assert variable_dbr.recommended_time_buffer_minutes == pytest.approx(
        variable_dbr.upstream_variation_minutes * DBR_SAFETY_FACTOR, rel=1e-9
    )


def test_dbr_includes_repair_time_in_variation() -> None:
    """Besleyicideki arizalar da degiskenlik suresine katilmali.

    Ortalama onarim suresi (MTTR) tampona dahil edilmezse, arizali bir
    besleyicinin darbogazi ac birakma riski goz ardi edilir.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="F",
                name="Arizali Besleyici",
                service_time_distribution=Distribution.constant(1.0),
                failure_rate=1.0 / 150.0,
                repair_time_distribution=Distribution.exponential(12.0),
            ),
            Station(
                id="BN",
                name="Darbogaz",
                service_time_distribution=Distribution.constant(2.0),
                buffer_capacity_before=2,
            ),
        ],
        connections=[Connection(from_station_id="F", to_station_id="BN")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.5), entry_station_id="F"
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=77,
    )
    analysis = analyze(run_replication(config), config)
    dbr = analysis.drum_buffer_rope
    assert dbr is not None

    # İşlem süresi sabit olduğundan değişkenliğin tamamı MTTR'den gelir (~12 dk).
    assert dbr.upstream_variation_minutes == pytest.approx(12.0, rel=0.25)
    assert dbr.recommended_buffer_units >= 8
    assert not dbr.is_current_buffer_sufficient
    assert "YETERSIZ" in dbr.rationale


def test_external_constraint_is_not_confused_with_capacity_shortage() -> None:
    """Darbogazin bos kapasitesi varsa oneri 'kisit disarida' demeli.

    Hafif yuklu bir hatta darbogaz bile kapasitesinin bir kismini kullanir; bu
    durumda sistem ciktisini sinirlayan sey talep, kapasite degildir. Darbogazi
    hizlandirmayi veya tamponunu buyutmeyi onermek yaniltici olur — tampon zaten
    sinirsizdir ve aclik besleme yetersizliginden kaynaklanir.
    """
    config = _three_station_line("C", 33)
    analysis = analyze(run_replication(config), config)

    assert analysis.bottleneck_station_id == "C"
    assert analysis.bottleneck_utilization < CRITICAL_UTILIZATION
    assert any("KISIT DISARIDA" in item for item in analysis.recommendations)
    assert "KISIT DISARIDA" in analysis.diagnosis
    # Kapasite kısıtlı olmadığı için "kısıtı yükselt" önerilmemeli.
    assert not any("KISITI YUKSELT" in item for item in analysis.recommendations)


def test_capacity_constrained_line_gets_elevation_recommendation() -> None:
    """Darbogaz gercekten doymussa 'kisiti yukselt' onerisi uretilmeli.

    Varis hizi yukseltilerek ayni hat kapasite kisitli hale getirilir; artik
    darbogazi genisletmek sistem ciktisini dogrudan artirir.
    """
    config = _three_station_line("B", 22).model_copy(
        update={
            "arrival_process": ArrivalProcess(
                distribution=Distribution.exponential(2.3), entry_station_id="A"
            )
        }
    )
    result = run_replication(config)
    analysis = analyze(result, config)

    assert analysis.bottleneck_station_id == "B"
    assert analysis.bottleneck_utilization >= CRITICAL_UTILIZATION
    assert result.stability.is_stable
    assert any("KISITI YUKSELT" in item for item in analysis.recommendations)
    assert not any("KISIT DISARIDA" in item for item in analysis.recommendations)
    # Kapasite kısıtlı hatta gerçekleşen çıktı teorik azamiye yaklaşmalı.
    assert analysis.capacity_utilization_pct > 90.0


def test_single_station_analysis_does_not_crash() -> None:
    """Tek istasyonlu modelde ikincil darbogaz olmamali, analiz yine calismali."""
    config = SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Tek",
                service_time_distribution=Distribution.exponential(0.8),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0), entry_station_id="S"
        ),
        simulation_duration_minutes=20_000.0,
        warmup_period_minutes=1_000.0,
        num_replications=1,
        random_seed=88,
    )
    analysis = analyze(run_replication(config), config)

    assert analysis.bottleneck_station_id == "S"
    assert analysis.secondary_bottleneck_station_id is None
    assert len(analysis.station_loads) == 1
    assert analysis.bottleneck_utilization >= CRITICAL_UTILIZATION - 0.1


def test_analyze_without_config_still_works() -> None:
    """Konfigurasyon verilmese de darbogaz tespiti calismali."""
    config = _three_station_line("B", 22)
    analysis = analyze(run_replication(config))

    assert analysis.bottleneck_station_id == "B"
    assert analysis.drum_buffer_rope is not None
    assert analysis.drum_buffer_rope.upstream_station_id is None


def test_report_bottleneck_table() -> None:
    """Darbogaz tablosunu rapor olarak yazdirir (`pytest -s`)."""
    config = _three_station_line("B", 22)
    analysis = analyze(run_replication(config), config)
    print("\n" + format_report(analysis))
