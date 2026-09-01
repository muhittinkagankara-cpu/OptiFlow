"""Kuyruk teorisi modülünün doğrulaması — Şartname Bölüm 3.1 ve 3.2.

Erlang-C'nin doğru uygulanması kritiktir: yanlış bir Erlang-C hesabı tüm
çok-istasyonlu sonuçları geçersiz kılar. Bu nedenle modül dört bağımsız
yoldan sınanır:

1. **Elle hesaplanabilir kesin değerler.** İki M/M/c örneği rasyonel sayılarla
   çözülebilecek şekilde seçilmiştir (P0 = 1/3 ve P0 = 1/7); beklenen değerler
   kodun kendisinden değil, kalemle türetilmiştir.
2. **c = 1 özel durumu.** M/M/c formülleri c = 1'de M/M/1 formülleriyle
   matematiksel olarak özdeş olmalıdır. Ortak bir hata bu testi geçemez,
   çünkü iki formül seti tamamen farklı yollardan hesaplanır.
3. **İç özdeşlikler.** L = lambda * W, Lq = lambda * Wq, L = Lq + a ve
   Erlang-B / Erlang-C ilişkisi.
4. **Simülasyonla karşılaştırma.** Bağımsız olarak yazılmış DES motorunun
   ürettiği değerlerle uyum.
"""

from __future__ import annotations

from fractions import Fraction
from typing import List

import pytest

from simulation_engine.analytics.queueing_theory import (
    NOTATION_MM1,
    analyze,
    erlang_b,
    erlang_c,
    mm1_metrics,
    mmc_metrics,
    probability_system_empty,
    verify_erlang_consistency,
)
from simulation_engine.core.engine import run_replication
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Distribution,
    SimulationConfig,
    Station,
)

#: Analitik-analitik karşılaştırmalarda kayan nokta toleransı.
EXACT_TOLERANCE: float = 1e-12

#: Simülasyon-analitik karşılaştırmalarda kabul edilen bağıl sapma.
SIMULATION_TOLERANCE: float = 0.05


# --------------------------------------------------------------------------- #
# 1. M/M/1 — Şartname Bölüm 3.1
# --------------------------------------------------------------------------- #


def test_mm1_textbook_values() -> None:
    """lambda=4, mu=5 icin ders kitabi degerleri (rho=0.8)."""
    metrics = mm1_metrics(arrival_rate=4.0, service_rate=5.0)

    assert metrics.notation == NOTATION_MM1
    assert metrics.is_stable
    assert metrics.utilization == pytest.approx(0.8, abs=EXACT_TOLERANCE)
    assert metrics.probability_system_empty == pytest.approx(0.2, abs=EXACT_TOLERANCE)
    assert metrics.l_system == pytest.approx(4.0, abs=EXACT_TOLERANCE)
    assert metrics.l_queue == pytest.approx(3.2, abs=EXACT_TOLERANCE)
    assert metrics.w_system == pytest.approx(1.0, abs=EXACT_TOLERANCE)
    assert metrics.w_queue == pytest.approx(0.8, abs=EXACT_TOLERANCE)
    assert not metrics.warnings


@pytest.mark.parametrize("utilization", [0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
def test_mm1_internal_identities(utilization: float) -> None:
    """M/M/1'de L = lambda*W, Lq = lambda*Wq ve L = Lq + rho saglanmali."""
    service_rate = 1.0
    arrival_rate = utilization * service_rate
    metrics = mm1_metrics(arrival_rate, service_rate)

    assert metrics.l_system == pytest.approx(arrival_rate * metrics.w_system)
    assert metrics.l_queue == pytest.approx(arrival_rate * metrics.w_queue)
    assert metrics.l_system == pytest.approx(metrics.l_queue + metrics.utilization)
    assert metrics.w_system == pytest.approx(metrics.w_queue + 1.0 / service_rate)


def test_mm1_rejects_unstable_system() -> None:
    """rho >= 1 sessizce sayi uretmemeli, acik uyari vermeli (TEST 3)."""
    metrics = mm1_metrics(arrival_rate=6.0, service_rate=5.0)

    assert not metrics.is_stable
    assert metrics.l_queue == float("inf")
    assert metrics.w_queue == float("inf")
    assert metrics.warnings
    assert "KARARSIZ" in metrics.warnings[0]


@pytest.mark.parametrize(
    ("arrival_rate", "service_rate", "servers"),
    [(0.0, 5.0, 1), (-1.0, 5.0, 1), (4.0, 0.0, 1), (4.0, -2.0, 1), (4.0, 5.0, 0)],
)
def test_invalid_parameters_are_rejected(
    arrival_rate: float, service_rate: float, servers: int
) -> None:
    """Fiziksel olarak anlamsiz parametreler hata yukseltmeli."""
    with pytest.raises(ValueError):
        mmc_metrics(arrival_rate, service_rate, servers)


# --------------------------------------------------------------------------- #
# 2. M/M/c — Erlang-C, elle hesaplanmış kesin değerler
# --------------------------------------------------------------------------- #


def test_mmc_exact_case_two_servers_unit_rates() -> None:
    """c=2, lambda=1, mu=1 icin kalemle turetilmis kesin degerler.

    a = 1, rho = 0.5
    P0 = 1 / (1 + 1 + (1/2) / (1/2)) = 1/3
    C  = (a^2 / 2! / (1 - rho)) * P0 = (0.5 / 0.5) * (1/3) = 1/3
    Lq = C * rho / (1 - rho) = (1/3) * 1 = 1/3
    Wq = Lq / lambda = 1/3
    W  = Wq + 1/mu = 4/3
    L  = lambda * W = 4/3  (= Lq + a = 1/3 + 1)
    """
    metrics = mmc_metrics(arrival_rate=1.0, service_rate=1.0, num_servers=2)

    assert metrics.probability_system_empty == pytest.approx(1 / 3, abs=EXACT_TOLERANCE)
    assert metrics.probability_of_waiting == pytest.approx(1 / 3, abs=EXACT_TOLERANCE)
    assert metrics.l_queue == pytest.approx(1 / 3, abs=EXACT_TOLERANCE)
    assert metrics.w_queue == pytest.approx(1 / 3, abs=EXACT_TOLERANCE)
    assert metrics.w_system == pytest.approx(4 / 3, abs=EXACT_TOLERANCE)
    assert metrics.l_system == pytest.approx(4 / 3, abs=EXACT_TOLERANCE)


def test_mmc_exact_case_two_servers_rational() -> None:
    """c=2, lambda=3, mu=2 icin kesin rasyonel degerler.

    a = 3/2, rho = 3/4
    P0 = 1/7,  C = 9/14,  Lq = 27/14,  Wq = 9/14,  W = 8/7,  L = 24/7
    """
    metrics = mmc_metrics(arrival_rate=3.0, service_rate=2.0, num_servers=2)

    assert metrics.probability_system_empty == pytest.approx(
        float(Fraction(1, 7)), abs=EXACT_TOLERANCE
    )
    assert metrics.probability_of_waiting == pytest.approx(
        float(Fraction(9, 14)), abs=EXACT_TOLERANCE
    )
    assert metrics.l_queue == pytest.approx(float(Fraction(27, 14)), abs=EXACT_TOLERANCE)
    assert metrics.w_queue == pytest.approx(float(Fraction(9, 14)), abs=EXACT_TOLERANCE)
    assert metrics.w_system == pytest.approx(float(Fraction(8, 7)), abs=EXACT_TOLERANCE)
    assert metrics.l_system == pytest.approx(float(Fraction(24, 7)), abs=EXACT_TOLERANCE)


@pytest.mark.parametrize("utilization", [0.1, 0.4, 0.7, 0.9, 0.97])
def test_mmc_with_one_server_reduces_to_mm1(utilization: float) -> None:
    """c=1'de M/M/c formulleri M/M/1 ile ozdes sonuc vermeli.

    Iki formul seti tamamen farkli yollardan hesaplanir (biri Erlang-C
    ozyinelemesi, digeri kapali form); ozdeslik bu yuzden guclu bir kanittir.
    """
    service_rate = 2.0
    arrival_rate = utilization * service_rate
    single = mm1_metrics(arrival_rate, service_rate)
    general = mmc_metrics(arrival_rate, service_rate, num_servers=1)

    assert general.probability_system_empty == pytest.approx(
        single.probability_system_empty, abs=EXACT_TOLERANCE
    )
    assert general.probability_of_waiting == pytest.approx(
        single.probability_of_waiting, abs=EXACT_TOLERANCE
    )
    assert general.l_system == pytest.approx(single.l_system, abs=EXACT_TOLERANCE)
    assert general.l_queue == pytest.approx(single.l_queue, abs=EXACT_TOLERANCE)
    assert general.w_system == pytest.approx(single.w_system, abs=EXACT_TOLERANCE)
    assert general.w_queue == pytest.approx(single.w_queue, abs=EXACT_TOLERANCE)


@pytest.mark.parametrize(
    ("servers", "offered_load"),
    [(1, 0.5), (2, 1.5), (3, 2.4), (5, 4.0), (10, 8.5), (25, 20.0), (200, 180.0)],
)
def test_erlang_c_two_independent_computations_agree(
    servers: int, offered_load: float
) -> None:
    """P0 uzerinden ve Erlang-B ozyinelemesi uzerinden Erlang-C uyusmali.

    c=200 durumu, faktoriyel tabanli naif bir uygulamanin tasacagi bolgedir;
    artimli terim yontemi bu bolgede de dogru calismalidir.
    """
    assert verify_erlang_consistency(servers, offered_load)


def test_erlang_b_known_closed_forms() -> None:
    """Erlang-B ozyinelemesi kucuk c icin kapali formla uyusmali."""
    load = 2.0
    # B(1, a) = a / (1 + a)
    assert erlang_b(1, load) == pytest.approx(load / (1 + load), abs=EXACT_TOLERANCE)
    # B(2, a) = (a^2 / 2) / (1 + a + a^2 / 2)
    expected_two = (load**2 / 2) / (1 + load + load**2 / 2)
    assert erlang_b(2, load) == pytest.approx(expected_two, abs=EXACT_TOLERANCE)
    # B(0, a) = 1 (sunucu yoksa her parca kaybolur)
    assert erlang_b(0, load) == 1.0


def test_erlang_c_is_one_when_unstable() -> None:
    """rho >= 1 iken her parca beklemek zorundadir."""
    assert erlang_c(num_servers=2, offered_load=2.0) == 1.0
    assert erlang_c(num_servers=2, offered_load=3.0) == 1.0
    assert probability_system_empty(num_servers=2, offered_load=2.0) == 0.0


@pytest.mark.parametrize("servers", [1, 2, 3, 5, 8])
def test_mmc_internal_identities(servers: int) -> None:
    """L = lambda*W, Lq = lambda*Wq ve L = Lq + a her c icin saglanmali."""
    service_rate = 1.5
    arrival_rate = 0.8 * servers * service_rate  # rho = 0.8
    metrics = mmc_metrics(arrival_rate, service_rate, servers)

    assert metrics.l_system == pytest.approx(arrival_rate * metrics.w_system)
    assert metrics.l_queue == pytest.approx(arrival_rate * metrics.w_queue)
    assert metrics.l_system == pytest.approx(metrics.l_queue + metrics.offered_load)
    assert not metrics.warnings


def test_adding_servers_reduces_waiting() -> None:
    """Sunucu eklemek bekleme suresini ve bekleme olasiligini azaltmali.

    Bu monotonluk, formullerin yon olarak dogru oldugunu gosteren basit ama
    etkili bir akil saglamasidir.
    """
    arrival_rate, service_rate = 8.0, 3.0
    previous_wait = float("inf")
    previous_probability = 1.0
    for servers in range(3, 9):
        metrics = mmc_metrics(arrival_rate, service_rate, servers)
        assert metrics.w_queue < previous_wait
        assert metrics.probability_of_waiting < previous_probability
        previous_wait = metrics.w_queue
        previous_probability = metrics.probability_of_waiting


def test_analyze_selects_correct_model() -> None:
    """`analyze` islem suresinden dogru modeli secmeli."""
    single = analyze(arrival_rate=4.0, service_time_mean=1.0 / 5.0, num_servers=1)
    assert single.notation == "M/M/1"
    assert single.l_system == pytest.approx(4.0, abs=EXACT_TOLERANCE)

    multi = analyze(arrival_rate=8.0, service_time_mean=1.0 / 3.0, num_servers=3)
    assert multi.notation == "M/M/c"
    assert multi.num_servers == 3

    with pytest.raises(ValueError):
        analyze(arrival_rate=1.0, service_time_mean=0.0, num_servers=1)


# --------------------------------------------------------------------------- #
# 3. Simülasyonla karşılaştırma
# --------------------------------------------------------------------------- #


def _run_station(arrival_rate: float, service_rate: float, servers: int):
    """Verilen parametrelerle tek istasyonlu bir simülasyon çalıştırır."""
    config = SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Test",
                num_servers=servers,
                service_time_distribution=Distribution.exponential_rate(service_rate),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential_rate(arrival_rate),
            entry_station_id="S",
        ),
        simulation_duration_minutes=150_000.0,
        warmup_period_minutes=5_000.0,
        num_replications=1,
        random_seed=808,
    )
    return run_replication(config)


@pytest.mark.parametrize(
    ("arrival_rate", "service_rate", "servers"),
    [(4.0, 5.0, 1), (8.0, 3.0, 3), (5.0, 2.0, 4)],
)
def test_analytical_matches_simulation(
    arrival_rate: float, service_rate: float, servers: int
) -> None:
    """Bagimsiz yazilmis DES motoru ile analitik formuller uyusmali."""
    analytical = mmc_metrics(arrival_rate, service_rate, servers)
    result = _run_station(arrival_rate, service_rate, servers)
    station = result.station("S")

    comparisons = [
        ("rho", analytical.utilization, station.utilization),
        ("Lq", analytical.l_queue, station.avg_queue_length),
        ("Wq", analytical.w_queue, station.avg_wait_time),
        ("L", analytical.l_system, result.system.avg_wip),
        ("W", analytical.w_system, result.system.avg_flow_time),
    ]
    for name, expected, observed in comparisons:
        deviation = abs(observed - expected) / expected
        assert deviation < SIMULATION_TOLERANCE, (
            f"c={servers} {name}: analitik={expected:.5f}, simulasyon={observed:.5f}, "
            f"sapma=%{deviation * 100:.2f}"
        )


def test_report_erlang_table() -> None:
    """Erlang-C tablosunu rapor olarak yazdirir (`pytest -s` ile gorunur)."""
    arrival_rate, service_rate = 8.0, 3.0
    lines: List[str] = [
        f"\nM/M/c ERLANG-C TABLOSU — lambda={arrival_rate}, mu={service_rate}, "
        f"a={arrival_rate / service_rate:.4f} erlang",
        "-" * 72,
        f"{'c':>3}{'rho':>10}{'P0':>10}{'C(c,a)':>10}{'Lq':>11}{'Wq':>11}{'W':>11}",
        "-" * 72,
    ]
    for servers in range(3, 10):
        metrics = mmc_metrics(arrival_rate, service_rate, servers)
        lines.append(
            f"{servers:>3}{metrics.utilization:>10.4f}"
            f"{metrics.probability_system_empty:>10.5f}"
            f"{metrics.probability_of_waiting:>10.4f}"
            f"{metrics.l_queue:>11.5f}{metrics.w_queue:>11.5f}{metrics.w_system:>11.5f}"
        )
    lines.append("-" * 72)
    unstable = mmc_metrics(arrival_rate, service_rate, 2)
    lines.append(f"c=2 (rho={unstable.utilization:.4f}): {unstable.warnings[0][:70]}...")
    print("\n".join(lines))
