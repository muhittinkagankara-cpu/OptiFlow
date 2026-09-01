"""Takt time ve hat dengeleme doğrulaması — Şartname Bölüm 3.5.

Hat dengeleme sezgisel bir algoritma olduğu için "doğru cevap" tek bir sayı
değildir. Bu nedenle doğrulama üç katmanda yapılır:

1. **Elle hesaplanabilir değerler.** Pozisyonel ağırlıklar ve takt time,
   kalemle türetilebilecek küçük örneklerde birebir sınanır. Pozisyonel ağırlık
   testi, çok yollu bir grafikte ortak ardılın **bir kez** sayılmasını da
   kontrol eder.
2. **Değişmezler (invariants).** Algoritma hangi çözümü bulursa bulsun şu
   koşullar her zaman sağlanmalıdır: her görev tam bir kez atanır, hiçbir
   istasyon takt'ı aşmaz, öncelik kısıtları ihlal edilmez, istasyon sayısı
   teorik alt sınırın altına inmez.
3. **Bilinen en iyi çözümü olan örnekler.** Mükemmel dengelenebilen hatlarda
   RPW'nin alt sınıra ulaşması beklenir.
"""

from __future__ import annotations

from typing import List

import pytest

from simulation_engine.analytics.takt_time import (
    analyze_takt,
    balance_line,
    compute_positional_weights,
    compute_takt_time,
    format_report,
)
from simulation_engine.core.engine import run_replication
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Distribution,
    SimulationConfig,
    Station,
    Task,
)

#: Şekil olarak bir elmas: A -> {B, C} -> D. Ortak ardıl D iki yoldan
#: erişilebilir; pozisyonel ağırlıkta bir kez sayılmalıdır.
DIAMOND_TASKS: List[Task] = [
    Task(id="A", name="Hazirlik", duration_minutes=5.0),
    Task(id="B", name="Sol Kol", duration_minutes=3.0, predecessors=["A"]),
    Task(id="C", name="Sag Kol", duration_minutes=2.0, predecessors=["A"]),
    Task(id="D", name="Birlestirme", duration_minutes=4.0, predecessors=["B", "C"]),
]

#: Klasik montaj hattı örneği: 11 görev, toplam 63 dakika.
ASSEMBLY_TASKS: List[Task] = [
    Task(id="T1", name="Sase yerlestirme", duration_minutes=12.0),
    Task(id="T2", name="Alt kapak", duration_minutes=6.0, predecessors=["T1"]),
    Task(id="T3", name="Kablo demeti", duration_minutes=6.0, predecessors=["T2"]),
    Task(id="T4", name="Sensor A", duration_minutes=2.0, predecessors=["T3"]),
    Task(id="T5", name="Sensor B", duration_minutes=2.0, predecessors=["T3"]),
    Task(id="T6", name="Ana kart", duration_minutes=12.0, predecessors=["T4", "T5"]),
    Task(id="T7", name="Sogutucu", duration_minutes=7.0, predecessors=["T6"]),
    Task(id="T8", name="Ust kapak", duration_minutes=5.0, predecessors=["T7"]),
    Task(id="T9", name="Etiket", duration_minutes=1.0, predecessors=["T8"]),
    Task(id="T10", name="Test", duration_minutes=4.0, predecessors=["T9"]),
    Task(id="T11", name="Paketleme", duration_minutes=6.0, predecessors=["T10"]),
]


# --------------------------------------------------------------------------- #
# 1. Takt time
# --------------------------------------------------------------------------- #


def test_takt_time_basic_formula() -> None:
    """480 dk vardiya / 60 birim talep = 8 dk takt."""
    assert compute_takt_time(480.0, 60.0) == pytest.approx(8.0, abs=1e-12)
    assert compute_takt_time(450.0, 90.0) == pytest.approx(5.0, abs=1e-12)


@pytest.mark.parametrize(
    ("available", "demand"), [(0.0, 60.0), (-480.0, 60.0), (480.0, 0.0), (480.0, -1.0)]
)
def test_takt_time_rejects_invalid_inputs(available: float, demand: float) -> None:
    """Sifir veya negatif sure/talep reddedilmeli."""
    with pytest.raises(ValueError):
        compute_takt_time(available, demand)


def test_takt_analysis_without_simulation() -> None:
    """Simulasyon verilmezse yalnizca hedef raporlanmali."""
    analysis = analyze_takt(available_time_minutes=480.0, customer_demand_units=120.0)

    assert analysis.takt_time_minutes == pytest.approx(4.0)
    assert analysis.required_throughput_per_minute == pytest.approx(0.25)
    assert analysis.observed_throughput_per_minute is None
    assert analysis.meets_demand is None


# --------------------------------------------------------------------------- #
# 2. Pozisyonel ağırlıklar
# --------------------------------------------------------------------------- #


def test_positional_weights_count_shared_successor_once() -> None:
    """Elmas grafikte ortak ardil D, A'nin agirliginda bir kez sayilmali.

    PW(D) = 4
    PW(B) = 3 + 4 = 7
    PW(C) = 2 + 4 = 6
    PW(A) = 5 + (3 + 2 + 4) = 14   <- D iki yoldan erisilebilir ama bir kez sayilir
    Naif bir uygulama D'yi iki kez sayip PW(A) = 18 bulurdu.
    """
    weights = compute_positional_weights(DIAMOND_TASKS)

    assert weights["D"] == pytest.approx(4.0)
    assert weights["B"] == pytest.approx(7.0)
    assert weights["C"] == pytest.approx(6.0)
    assert weights["A"] == pytest.approx(14.0)


def test_positional_weights_on_pure_chain() -> None:
    """Zincir yapida agirlik, gorevin kendisi ve sonrasindaki her seyin toplamidir."""
    weights = compute_positional_weights(ASSEMBLY_TASKS)

    assert weights["T11"] == pytest.approx(6.0)
    assert weights["T10"] == pytest.approx(4.0 + 6.0)
    assert weights["T1"] == pytest.approx(63.0)  # tum hattin toplami
    # T4 ve T5 esit sureli paralel gorevler; agirliklari da esit olmali.
    assert weights["T4"] == pytest.approx(weights["T5"])


def test_positional_weight_is_never_less_than_own_duration() -> None:
    """Her gorevin agirligi en az kendi suresi kadar olmali."""
    weights = compute_positional_weights(ASSEMBLY_TASKS)
    for task in ASSEMBLY_TASKS:
        assert weights[task.id] >= task.duration_minutes


# --------------------------------------------------------------------------- #
# 3. Girdi doğrulaması
# --------------------------------------------------------------------------- #


def test_cycle_in_precedence_graph_is_rejected() -> None:
    """Dongulu oncelik grafigi fiziksel olarak imkansizdir, reddedilmeli."""
    cyclic = [
        Task(id="X", name="X", duration_minutes=1.0, predecessors=["Z"]),
        Task(id="Y", name="Y", duration_minutes=1.0, predecessors=["X"]),
        Task(id="Z", name="Z", duration_minutes=1.0, predecessors=["Y"]),
    ]
    with pytest.raises(ValueError, match="dongu"):
        balance_line(cyclic, takt_time_minutes=5.0)


def test_unknown_predecessor_is_rejected() -> None:
    """Var olmayan bir oncule atif hata vermeli."""
    broken = [Task(id="X", name="X", duration_minutes=1.0, predecessors=["YOK"])]
    with pytest.raises(ValueError, match="onculu bilinmiyor"):
        balance_line(broken, takt_time_minutes=5.0)


def test_duplicate_task_id_is_rejected() -> None:
    """Yinelenen gorev kimligi reddedilmeli."""
    duplicated = [
        Task(id="X", name="Birinci", duration_minutes=1.0),
        Task(id="X", name="Ikinci", duration_minutes=2.0),
    ]
    with pytest.raises(ValueError, match="Yinelenen"):
        balance_line(duplicated, takt_time_minutes=5.0)


def test_self_predecessor_is_rejected() -> None:
    """Bir gorev kendi onculu olamaz."""
    with pytest.raises(ValueError, match="kendi onculu"):
        balance_line(
            [Task(id="X", name="X", duration_minutes=1.0, predecessors=["X"])],
            takt_time_minutes=5.0,
        )


def test_task_longer_than_takt_is_flagged_infeasible() -> None:
    """Takt'tan uzun bolunemez bir gorev cozumu imkansiz kilar.

    Sistem sessizce yanlis bir hat onermek yerine durumu acikca bildirmeli ve
    somut cikis yollarini (gorevi bol, paralel istasyon, takt'i buyut) soylemeli.
    """
    tasks = [
        Task(id="A", name="Kisa", duration_minutes=3.0),
        Task(id="B", name="Cok Uzun", duration_minutes=12.0, predecessors=["A"]),
    ]
    result = balance_line(tasks, takt_time_minutes=8.0)

    assert not result.is_feasible
    assert result.warnings
    assert "COZUM YOK" in result.warnings[0]
    assert "B" in result.warnings[0]


# --------------------------------------------------------------------------- #
# 4. Dengeleme değişmezleri
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("takt", [12.0, 15.0, 18.0, 20.0, 24.0, 32.0])
def test_balancing_invariants_hold(takt: float) -> None:
    """Hangi cozum bulunursa bulunsun dort degismez saglanmali."""
    result = balance_line(ASSEMBLY_TASKS, takt_time_minutes=takt)
    assert result.is_feasible, format_report(result)

    # (1) Her görev tam bir kez atanmış olmalı.
    assigned: List[str] = []
    for station in result.stations:
        assigned.extend(station.task_ids)
    assert sorted(assigned) == sorted(task.id for task in ASSEMBLY_TASKS)
    assert len(assigned) == len(set(assigned))

    # (2) Hiçbir istasyon takt'ı aşmamalı.
    for station in result.stations:
        assert station.total_time_minutes <= takt + 1e-9, station

    # (3) Öncelik kısıtları ihlal edilmemeli: her görevin öncülleri aynı ya da
    #     daha önceki bir istasyonda olmalı.
    station_of = {
        task_id: station.index
        for station in result.stations
        for task_id in station.task_ids
    }
    for task in ASSEMBLY_TASKS:
        for predecessor in task.predecessors:
            assert station_of[predecessor] <= station_of[task.id], (
                f"'{predecessor}' gorevi '{task.id}' gorevinden sonraki bir "
                f"istasyonda: {station_of[predecessor]} > {station_of[task.id]}"
            )

    # (4) İstasyon sayısı teorik alt sınırın altına inemez.
    assert result.assigned_stations >= result.theoretical_minimum_stations


def test_station_time_totals_are_consistent() -> None:
    """Istasyon sureleri, atanan gorev surelerinin toplamina esit olmali."""
    result = balance_line(ASSEMBLY_TASKS, takt_time_minutes=18.0)
    durations = {task.id: task.duration_minutes for task in ASSEMBLY_TASKS}

    for station in result.stations:
        expected = sum(durations[task_id] for task_id in station.task_ids)
        assert station.total_time_minutes == pytest.approx(expected)
        assert station.idle_time_minutes == pytest.approx(
            result.takt_time_minutes - expected
        )
        assert station.utilization == pytest.approx(expected / result.takt_time_minutes)

    total = sum(station.total_time_minutes for station in result.stations)
    assert total == pytest.approx(result.total_task_time_minutes)
    assert result.total_task_time_minutes == pytest.approx(63.0)


def test_balancing_is_deterministic() -> None:
    """Ayni girdi her zaman ayni cozumu vermeli (bilimsel tekrarlanabilirlik)."""
    first = balance_line(ASSEMBLY_TASKS, takt_time_minutes=15.0)
    shuffled = list(reversed(ASSEMBLY_TASKS))
    second = balance_line(shuffled, takt_time_minutes=15.0)

    assert [s.task_ids for s in first.stations] == [s.task_ids for s in second.stations]


def test_efficiency_metrics_are_consistent() -> None:
    """Hat verimliligi, denge kaybi ve duzgunluk indeksi tanimlariyla uyusmali."""
    result = balance_line(ASSEMBLY_TASKS, takt_time_minutes=18.0)

    expected_efficiency = result.total_task_time_minutes / (
        result.assigned_stations * result.takt_time_minutes
    )
    assert result.line_efficiency == pytest.approx(expected_efficiency)
    assert result.balance_delay == pytest.approx(1.0 - expected_efficiency)
    assert 0.0 < result.line_efficiency <= 1.0

    busiest = max(station.total_time_minutes for station in result.stations)
    expected_smoothness = (
        sum((busiest - s.total_time_minutes) ** 2 for s in result.stations) ** 0.5
    )
    assert result.smoothness_index == pytest.approx(expected_smoothness)

    bottleneck = next(
        s for s in result.stations if s.index == result.bottleneck_station_index
    )
    assert bottleneck.total_time_minutes == pytest.approx(busiest)


# --------------------------------------------------------------------------- #
# 5. Bilinen en iyi çözüm
# --------------------------------------------------------------------------- #


def test_perfectly_balanceable_chain_reaches_lower_bound() -> None:
    """Tam bolunebilen bir zincirde RPW teorik alt sinira ulasmali.

    Dort esit gorev (5 dk) ve 10 dk takt: alt sinir 2 istasyon ve RPW oncelik
    sirasina uyarak [A,B] ve [C,D] atamalidir. Duzgunluk indeksi 0 cikmali —
    is yuku tam esit dagilmistir.
    """
    chain = [
        Task(id="A", name="A", duration_minutes=5.0),
        Task(id="B", name="B", duration_minutes=5.0, predecessors=["A"]),
        Task(id="C", name="C", duration_minutes=5.0, predecessors=["B"]),
        Task(id="D", name="D", duration_minutes=5.0, predecessors=["C"]),
    ]
    result = balance_line(chain, takt_time_minutes=10.0)

    assert result.theoretical_minimum_stations == 2
    assert result.assigned_stations == 2
    assert [s.task_ids for s in result.stations] == [["A", "B"], ["C", "D"]]
    assert result.line_efficiency == pytest.approx(1.0)
    assert result.balance_delay == pytest.approx(0.0)
    assert result.smoothness_index == pytest.approx(0.0)
    assert not result.warnings


def test_diamond_graph_respects_precedence() -> None:
    """Elmas grafikte A once, D en son atanmali."""
    result = balance_line(DIAMOND_TASKS, takt_time_minutes=7.0)
    station_of = {
        task_id: station.index
        for station in result.stations
        for task_id in station.task_ids
    }

    assert station_of["A"] <= station_of["B"]
    assert station_of["A"] <= station_of["C"]
    assert station_of["B"] <= station_of["D"]
    assert station_of["C"] <= station_of["D"]
    # Toplam 14 dk / takt 7 dk = 2 istasyon alt siniri
    assert result.theoretical_minimum_stations == 2


def test_larger_takt_never_needs_more_stations() -> None:
    """Takt buyudukce gereken istasyon sayisi artmamali (monotonluk)."""
    previous = None
    for takt in (12.0, 15.0, 18.0, 24.0, 32.0, 63.0):
        result = balance_line(ASSEMBLY_TASKS, takt_time_minutes=takt)
        if previous is not None:
            assert result.assigned_stations <= previous
        previous = result.assigned_stations
    assert previous == 1  # takt = toplam sure ise tek istasyon yeter


# --------------------------------------------------------------------------- #
# 6. Simülasyonla karşılaştırma
# --------------------------------------------------------------------------- #


def _line_config(cycle_minutes: float, interarrival_mean: float) -> SimulationConfig:
    """Tek istasyonlu basit bir hat kurar."""
    return SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Hat",
                service_time_distribution=Distribution.constant(cycle_minutes),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(interarrival_mean),
            entry_station_id="S",
        ),
        simulation_duration_minutes=40_000.0,
        warmup_period_minutes=2_000.0,
        num_replications=1,
        random_seed=909,
    )


def test_takt_analysis_detects_demand_shortfall() -> None:
    """Cevrim suresi takt'i asan bir hat 'talep karsilanmiyor' demeli."""
    # Talep: 40.000 dk'da 8.000 birim -> takt 5 dk. Hattin cevrimi 8 dk.
    result = run_replication(_line_config(cycle_minutes=8.0, interarrival_mean=4.0))
    analysis = analyze_takt(
        available_time_minutes=40_000.0, customer_demand_units=8_000.0, result=result
    )

    assert analysis.takt_time_minutes == pytest.approx(5.0)
    assert analysis.meets_demand is False
    assert analysis.throughput_gap_per_minute > 0.0
    assert "TALEP KARSILANMIYOR" in analysis.message
    assert analysis.stations_exceeding_takt == ["S"]


def test_takt_analysis_confirms_demand_is_met() -> None:
    """Yeterli kapasiteli hat talebi karsiladigini bildirmeli."""
    # Talep: 40.000 dk'da 4.000 birim -> takt 10 dk. Hattin cevrimi 2 dk.
    result = run_replication(_line_config(cycle_minutes=2.0, interarrival_mean=5.0))
    analysis = analyze_takt(
        available_time_minutes=40_000.0, customer_demand_units=4_000.0, result=result
    )

    assert analysis.takt_time_minutes == pytest.approx(10.0)
    assert analysis.meets_demand is True
    assert analysis.throughput_gap_per_minute < 0.0
    assert analysis.stations_exceeding_takt == []
    assert "karsiliyor" in analysis.message


def test_report_balancing_table() -> None:
    """Hat dengeleme tablosunu rapor olarak yazdirir (`pytest -s`)."""
    takt = compute_takt_time(available_time_minutes=480.0, customer_demand_units=30.0)
    result = balance_line(ASSEMBLY_TASKS, takt_time_minutes=takt)
    weights = result.positional_weights

    lines = [
        f"\nTAKT TIME = 480 dk / 30 birim = {takt:.4f} dk/birim",
        "",
        "POZISYONEL AGIRLIKLAR (azalan sira = RPW atama sirasi)",
        "  " + "  ".join(
            f"{task_id}:{weights[task_id]:.0f}"
            for task_id in sorted(weights, key=lambda k: (-weights[k], k))
        ),
        "",
        format_report(result),
    ]
    print("\n".join(lines))
