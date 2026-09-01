"""TEST 2 — Little's Law tutarlılık testi (Şartname Bölüm 4).

Little's Law hiçbir dağılım varsayımı gerektirmediği için, birbirinden çok
farklı yapıdaki modellerin hepsinde sağlanmalıdır. Bu test dosyası bağıntıyı
altı ayrı topolojide sınar:

1. M/M/1 — üstel varış ve hizmet
2. M/M/c — çok sunuculu istasyon
3. Sonlu tamponlu seri hat — blokajın devrede olduğu durum
4. Yeniden işleme döngüsü — bir parçanın aynı istasyonu birden çok ziyaret ettiği ağ
5. Fireli hat — parçaların bir kısmının rotayı tamamlamadan çıktığı durum
6. Arızalı makine ve üstel olmayan işlem süresi — M/G/1 benzeri durum

Ayrıca bir **sabotaj testi** bulunur: bilinçli olarak tutarsız hâle getirilmiş
metrikler verildiğinde doğrulayıcının gerçekten "KALDI" demesi beklenir. Bu
olmadan, her zaman "geçti" diyen bir doğrulayıcı da testleri geçerdi.
"""

from __future__ import annotations

from typing import List

import pytest

from simulation_engine.analytics.littles_law import (
    DEFAULT_TOLERANCE_PCT,
    assert_consistent,
    format_report,
    validate,
    validate_station_queue,
    validate_system,
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

#: Uzun koşumlarda istasyon tamponu özdeşliği neredeyse tam sağlanmalıdır;
#: bu sıkı tolerans sınır etkisi dışındaki hataları yakalar.
TIGHT_STATION_TOLERANCE_PCT: float = 0.5

SIMULATION_DURATION_MINUTES: float = 120_000.0
WARMUP_PERIOD_MINUTES: float = 5_000.0


def _config(
    stations: List[Station],
    connections: List[Connection],
    entry_id: str,
    interarrival_mean: float,
    seed: int,
) -> SimulationConfig:
    """Ortak parametrelerle bir senaryo kurar."""
    return SimulationConfig(
        stations=stations,
        connections=connections,
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(interarrival_mean),
            entry_station_id=entry_id,
        ),
        simulation_duration_minutes=SIMULATION_DURATION_MINUTES,
        warmup_period_minutes=WARMUP_PERIOD_MINUTES,
        num_replications=1,
        random_seed=seed,
    )


def _mm1() -> SimulationConfig:
    """Tek sunuculu, ustel hizmetli klasik M/M/1."""
    return _config(
        stations=[
            Station(
                id="S",
                name="M/M/1",
                service_time_distribution=Distribution.exponential(0.8),
            )
        ],
        connections=[],
        entry_id="S",
        interarrival_mean=1.0,
        seed=101,
    )


def _mmc() -> SimulationConfig:
    """Uc paralel sunuculu istasyon."""
    return _config(
        stations=[
            Station(
                id="S",
                name="M/M/3",
                num_servers=3,
                service_time_distribution=Distribution.exponential(2.4),
            )
        ],
        connections=[],
        entry_id="S",
        interarrival_mean=1.0,
        seed=202,
    )


def _blocked_line() -> SimulationConfig:
    """Sonlu tamponlu uc istasyonlu seri hat (blokaj devrede)."""
    return _config(
        stations=[
            Station(
                id="A",
                name="Kesim",
                service_time_distribution=Distribution.triangular(0.5, 0.7, 1.1),
                buffer_capacity_before=5,
            ),
            Station(
                id="B",
                name="Pres",
                service_time_distribution=Distribution.normal(0.9, 0.2),
                buffer_capacity_before=2,
            ),
            Station(
                id="C",
                name="Montaj",
                service_time_distribution=Distribution.constant(0.75),
                buffer_capacity_before=1,
            ),
        ],
        connections=[
            Connection(from_station_id="A", to_station_id="B"),
            Connection(from_station_id="B", to_station_id="C"),
        ],
        entry_id="A",
        interarrival_mean=1.25,
        seed=303,
    )


def _rework_network() -> SimulationConfig:
    """Kalite kontrolden geri donen yeniden isleme dongusu."""
    return _config(
        stations=[
            Station(
                id="P",
                name="Isleme",
                service_time_distribution=Distribution.exponential(0.9),
            ),
            Station(
                id="Q",
                name="Kalite",
                service_time_distribution=Distribution.triangular(0.2, 0.3, 0.6),
            ),
        ],
        connections=[
            Connection(from_station_id="P", to_station_id="Q", routing_probability=1.0),
            Connection(from_station_id="Q", to_station_id="P", routing_probability=0.25),
        ],
        entry_id="P",
        interarrival_mean=1.6,
        seed=404,
    )


def _scrap_line() -> SimulationConfig:
    """Fireli hat: parcalarin bir kismi rotayi tamamlamadan cikar."""
    return _config(
        stations=[
            Station(
                id="A",
                name="Isleme",
                service_time_distribution=Distribution.exponential(0.6),
                scrap_rate=0.3,
            ),
            Station(
                id="B",
                name="Montaj",
                service_time_distribution=Distribution.exponential(0.7),
            ),
        ],
        connections=[Connection(from_station_id="A", to_station_id="B")],
        entry_id="A",
        interarrival_mean=1.0,
        seed=505,
    )


def _unreliable_station() -> SimulationConfig:
    """Arizali makine ve ustel olmayan islem suresi (M/G/1 benzeri)."""
    return _config(
        stations=[
            Station(
                id="M",
                name="Arizali Makine",
                service_time_distribution=Distribution.triangular(0.4, 0.5, 0.9),
                failure_rate=1.0 / 200.0,
                repair_time_distribution=Distribution.exponential(15.0),
            )
        ],
        connections=[],
        entry_id="M",
        interarrival_mean=1.0,
        seed=606,
    )


SCENARIOS = [
    ("M/M/1", _mm1),
    ("M/M/c", _mmc),
    ("sonlu-tampon-hat", _blocked_line),
    ("yeniden-isleme", _rework_network),
    ("fireli-hat", _scrap_line),
    ("arizali-makine", _unreliable_station),
]


@pytest.fixture(scope="module")
def results() -> dict[str, ReplicationResult]:
    """Tüm senaryoları bir kez çalıştırır."""
    return {name: run_replication(builder()) for name, builder in SCENARIOS}


# --------------------------------------------------------------------------- #
# 1. Şartnamenin TEST 2 kriteri: %5 tolerans
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("scenario", [name for name, _ in SCENARIOS])
def test_littles_law_holds_in_every_topology(
    results: dict[str, ReplicationResult], scenario: str
) -> None:
    """Her topolojide sistem ve istasyon duzeyinde L = lambda*W saglanmali."""
    report = validate(results[scenario], tolerance_pct=DEFAULT_TOLERANCE_PCT)
    assert report.passed, format_report(report)
    assert report.max_deviation_pct <= DEFAULT_TOLERANCE_PCT


@pytest.mark.parametrize("scenario", [name for name, _ in SCENARIOS])
def test_scenarios_are_stable(
    results: dict[str, ReplicationResult], scenario: str
) -> None:
    """Little's Law kararli durumda gecerlidir; senaryolar kararli olmali."""
    result = results[scenario]
    assert result.stability.is_stable, result.stability.messages


# --------------------------------------------------------------------------- #
# 2. İstasyon tamponu için daha keskin özdeşlik
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("scenario", [name for name, _ in SCENARIOS])
def test_station_queue_identity_is_near_exact(
    results: dict[str, ReplicationResult], scenario: str
) -> None:
    """Tampon icin INTEGRAL(kuyruk) dt = TOPLAM(bekleme) ozdesligi neredeyse tam olmali.

    Sistem duzeyinde %5 tolerans sonlu pencere etkisi icindir; istasyon
    tamponunda ise iki taraf ayni parca kumesinden turedigi icin sapma sinir
    etkisi disinda sifira yakin olmalidir. Bu sikilik, kuyruk uzunlugu
    integralindeki veya bekleme sayacindaki bir hatayi %5'lik toleransin
    gizleyemeyecegi anlamina gelir.
    """
    result = results[scenario]
    window = result.system.window_duration_minutes
    for metrics in result.stations:
        validation = validate_station_queue(
            metrics, window, tolerance_pct=TIGHT_STATION_TOLERANCE_PCT
        )
        assert validation.passed, validation.message


def test_station_identity_matches_raw_integrals(
    results: dict[str, ReplicationResult],
) -> None:
    """Lq * pencere ile gozlem sayisi * Wq dogrudan karsilastirilir.

    Bu, `validate_station_queue` fonksiyonunun dogru buyuklukleri esledigini
    dogrulayan, modulden bagimsiz bir kontroldur.
    """
    result = results["sonlu-tampon-hat"]
    window = result.system.window_duration_minutes
    for metrics in result.stations:
        queue_integral = metrics.avg_queue_length * window
        waiting_total = metrics.wait_time_observations * metrics.avg_wait_time
        assert queue_integral == pytest.approx(waiting_total, rel=0.005), (
            f"'{metrics.station_id}': kuyruk integrali={queue_integral:.4f}, "
            f"bekleme toplami={waiting_total:.4f}"
        )


# --------------------------------------------------------------------------- #
# 3. Sabotaj testi — doğrulayıcı gerçekten yakalıyor mu?
# --------------------------------------------------------------------------- #


def test_validator_detects_deliberate_inconsistency(
    results: dict[str, ReplicationResult],
) -> None:
    """Bilincli olarak bozulmus metrikler denetimden KALMALI.

    Her zaman "gecti" diyen bir dogrulayici da diger testleri gecerdi; bu test
    dogrulayicinin ayirt etme gucunu kanitlar. WIP ortalamasi %20 sisirilir —
    bu, sistemden cikan bir parcanin sayactan dusurulmemesi durumunda ortaya
    cikacak tipik hatadir.
    """
    healthy = results["M/M/1"]
    sabotaged = healthy.model_copy(
        update={
            "system": healthy.system.model_copy(
                update={"avg_wip": healthy.system.avg_wip * 1.20}
            )
        },
        deep=True,
    )

    assert validate_system(healthy).passed
    validation = validate_system(sabotaged)
    assert not validation.passed
    assert validation.deviation_pct > DEFAULT_TOLERANCE_PCT
    assert "TUTARSIZLIK" in validation.message

    report = validate(sabotaged)
    assert not report.passed
    assert report.messages

    with pytest.raises(AssertionError):
        assert_consistent(sabotaged)


def test_validator_detects_missing_flow_time_observations(
    results: dict[str, ReplicationResult],
) -> None:
    """Akis suresi gozleminin eksik kaydedilmesi de yakalanmali.

    W degeri %15 dusuruldugunde lambda*W carpimi L'nin altinda kalir; bu,
    bazi parcalarin akis suresinin hic kaydedilmemesi hâlinde gorulecek
    belirtidir.
    """
    healthy = results["M/M/c"]
    sabotaged = healthy.model_copy(
        update={
            "system": healthy.system.model_copy(
                update={"avg_flow_time": healthy.system.avg_flow_time * 0.85}
            )
        },
        deep=True,
    )
    validation = validate_system(sabotaged)

    assert not validation.passed
    assert validation.predicted_l < validation.observed_l


def test_empty_system_passes_without_division_error() -> None:
    """Hicbir parca islenmemis bir pencere sifira bolme hatasi vermemeli."""
    config = _config(
        stations=[
            Station(
                id="S", name="Bos", service_time_distribution=Distribution.constant(1.0)
            )
        ],
        connections=[],
        entry_id="S",
        interarrival_mean=1_000_000.0,
        seed=707,
    )
    result = run_replication(
        config.model_copy(
            update={
                "simulation_duration_minutes": 100.0,
                "warmup_period_minutes": 10.0,
            }
        )
    )
    report = validate(result)

    assert report.passed
    assert report.max_deviation_pct == 0.0


# --------------------------------------------------------------------------- #
# 4. Rapor
# --------------------------------------------------------------------------- #


def test_report_all_scenarios(results: dict[str, ReplicationResult]) -> None:
    """Tum senaryolarin Little's Law tablosunu yazdirir (`pytest -s`)."""
    lines: List[str] = [
        "\nLITTLE'S LAW TUTARLILIK TESTI (TEST 2)",
        f"{SIMULATION_DURATION_MINUTES:,.0f} dk "
        f"(isinma {WARMUP_PERIOD_MINUTES:,.0f} dk), tolerans %{DEFAULT_TOLERANCE_PCT:.0f}",
        "-" * 84,
        f"{'Senaryo':<20}{'Kapsam':<12}{'Olculen L':>13}{'lambda*W':>13}"
        f"{'Sapma':>10}{'Sonuc':>9}",
        "-" * 84,
    ]
    for name, _ in SCENARIOS:
        report = validate(results[name])
        for index, validation in enumerate([report.system, *report.stations]):
            scenario_label = name if index == 0 else ""
            verdict = "GECTI" if validation.passed else "KALDI"
            lines.append(
                f"{scenario_label:<20}{validation.scope:<12}"
                f"{validation.observed_l:>13.6f}{validation.predicted_l:>13.6f}"
                f"{f'%{validation.deviation_pct:.3f}':>10}{verdict:>9}"
            )
        lines.append("")
    lines.append("-" * 84)
    worst = max(validate(results[name]).max_deviation_pct for name, _ in SCENARIOS)
    lines.append(f"Tum senaryolarda azami sapma: %{worst:.3f}")
    print("\n".join(lines))
