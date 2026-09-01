"""OEE'nin tanım gereği sınırları — aşırı yüklü senaryolar.

OEE bir zaman oranıdır: planlanan üretim süresinin ne kadarının tam verimli
geçtiğini söyler. Bu yüzden %100'ü **hiçbir koşulda** aşamaz. Aşarsa sayı
yanlış olmakla kalmaz, raporun tamamına duyulan güveni zedeler — "%100,5
verimlilik" gören bir kullanıcı diğer sayılara da haklı olarak şüpheyle bakar.

Sınırın aşılabildiği yer doygun istasyonlardır. Net çalışma süresi, üretim
adedini dağılımın **teorik** ortalamasıyla çarparak bulunur; çalışma süresi ise
**gerçek** geçen süredir. %100 dolu çalışan bir istasyonda gerçekleşen ortalama
işlem süresi tesadüfen teorik ortalamanın altına düşerse, makine saatin izin
verdiğinden fazla üretmiş gibi görünür. Bu bir model hatası değil, sonlu koşum
uzunluğundan gelen örnekleme dalgalanmasıdır ve yaklaşık **yarı yarıya** bir
olasılıkla gerçekleşir; tek bir tohumla test etmek hatayı kaçırırdı. Bu yüzden
buradaki testler çok sayıda tohum üzerinden çalışır.

Sınırlama yapılırken zaman merdiveni de aynı ölçekte tutulmalıdır: aksi hâlde
`OEE == tam verimli süre / planlanan süre` özdeşliği bozulur ve bileşenler
merdivenle çelişir. Bu dosya her iki şeyi birden kilitler.
"""

from __future__ import annotations

import pytest

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

#: Hatanın yarı yarıya bir olasılıkla ortaya çıkması nedeniyle geniş tutulur.
SEEDS = tuple(range(24))


def overloaded_config(
    seed: int,
    *,
    interarrival_mean: float = 1.0,
    num_servers: int = 1,
    scrap_rate: float = 0.0,
    duration: float = 5000.0,
) -> SimulationConfig:
    """Ilk istasyonu bilincli olarak doygun birakan iki istasyonluk hat.

    Varislar arasi sure islem suresinden cok kisadir; bu yuzden 'a' istasyonu
    penceredeki tum zamani islem yaparak gecirir ve mesgul sure calisma
    suresine esitlenir. Sinirin asilabildigi tek rejim budur.
    """
    return SimulationConfig(
        stations=[
            Station(
                id="a",
                name="A",
                num_servers=num_servers,
                service_time_distribution=Distribution.exponential(5.0),
                scrap_rate=scrap_rate,
            ),
            Station(
                id="b",
                name="B",
                service_time_distribution=Distribution.constant(0.5),
            ),
        ],
        connections=[Connection(from_station_id="a", to_station_id="b")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(interarrival_mean),
            entry_station_id="a",
        ),
        simulation_duration_minutes=duration,
        warmup_period_minutes=duration / 10.0,
        num_replications=1,
        random_seed=seed,
    )


def run(config: SimulationConfig) -> ReplicationResult:
    return run_replication(config, replication_index=0)


# --------------------------------------------------------------------------- #
# 1. Ana kabul kriteri: OEE hiçbir koşulda 1.0'ı aşmaz
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", SEEDS)
def test_oee_never_exceeds_one_under_overload(seed: int) -> None:
    """Doygun bir istasyonda OEE ve bilesenleri 1.0'i asmamalidir."""
    result = run(overloaded_config(seed))

    for metrics in result.stations:
        oee = compute_station_oee(metrics)
        assert oee.availability <= 1.0, f"{oee.station_id}: {oee.availability}"
        assert oee.performance <= 1.0, f"{oee.station_id}: {oee.performance}"
        assert oee.quality <= 1.0, f"{oee.station_id}: {oee.quality}"
        assert oee.oee <= 1.0, f"{oee.station_id}: OEE = {oee.oee}"


@pytest.mark.parametrize("seed", SEEDS)
def test_line_oee_never_exceeds_one_under_overload(seed: int) -> None:
    """Rapor duzeyinde de sinir korunur; hattin OEE'si darbogazdan gelir."""
    report = compute_oee_report(run(overloaded_config(seed)))
    assert report.line_oee <= 1.0, f"line_oee = {report.line_oee}"


@pytest.mark.parametrize("num_servers", [1, 2, 5])
def test_bound_holds_for_parallel_machines(num_servers: int) -> None:
    """Paralel makineli doygun istasyonlarda da sinir korunur.

    Planlanan sure sunucu sayisiyla olceklendigi icin bu rejim ayrica
    sinanmalidir; olcekleme yanlis olsaydi Performance sunucu sayisi kadar
    buyurdu.
    """
    for seed in SEEDS[:8]:
        config = overloaded_config(
            seed, interarrival_mean=0.6, num_servers=num_servers
        )
        for metrics in run(config).stations:
            oee = compute_station_oee(metrics)
            assert oee.performance <= 1.0
            assert oee.oee <= 1.0


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_bound_holds_with_scrap(seed: int) -> None:
    """Fire varken de sinir korunur; Quality carpani sinirlamayi bozmamali."""
    config = overloaded_config(seed, scrap_rate=0.15)
    for metrics in run(config).stations:
        oee = compute_station_oee(metrics)
        assert oee.oee <= 1.0
        assert oee.quality <= 1.0


@pytest.mark.parametrize("duration", [1000.0, 2000.0, 20000.0])
def test_bound_holds_for_short_and_long_runs(duration: float) -> None:
    """Kisa kosumlarda dalgalanma buyuktur; sinir yine de asilmamalidir."""
    for seed in SEEDS[:8]:
        config = overloaded_config(seed, duration=duration)
        for metrics in run(config).stations:
            assert compute_station_oee(metrics).oee <= 1.0


# --------------------------------------------------------------------------- #
# 2. Sınırlama zaman merdivenini bozmamalı
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_time_ladder_identity_survives_clamping(seed: int) -> None:
    """`OEE == tam verimli sure / planlanan sure` ozdesligi korunmalidir.

    Yalnizca raporlanan OEE sinirlanip merdiven oldugu gibi birakilsaydi bu
    ozdeslik bozulur ve kirilim ekrani bilesenlerle celisen sayilar gosterirdi.
    """
    for metrics in run(overloaded_config(seed, scrap_rate=0.1)).stations:
        oee = compute_station_oee(metrics)
        assert verify_oee_identity(oee), (
            f"{oee.station_id}: OEE = {oee.oee}, "
            f"tam verimli / planlanan = "
            f"{oee.fully_productive_time_minutes / oee.planned_production_time_minutes}"
        )


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_ladder_stays_ordered_under_overload(seed: int) -> None:
    """Merdiven basamaklari azalan sirada kalmalidir.

    Planlanan >= calisma >= net calisma >= tam verimli. Sinirlama net calisma
    suresini kirptigi icin bu siranin hala saglandigi dogrulanmalidir.
    """
    for metrics in run(overloaded_config(seed, scrap_rate=0.1)).stations:
        oee = compute_station_oee(metrics)
        assert oee.planned_production_time_minutes >= oee.run_time_minutes
        assert oee.run_time_minutes >= oee.net_operating_time_minutes
        assert oee.net_operating_time_minutes >= oee.fully_productive_time_minutes


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_loss_minutes_never_negative(seed: int) -> None:
    """Kayip sureleri negatif olamaz."""
    for metrics in run(overloaded_config(seed, scrap_rate=0.1)).stations:
        oee = compute_station_oee(metrics)
        assert oee.availability_loss_minutes >= 0.0
        assert oee.performance_loss_minutes >= 0.0
        assert oee.quality_loss_minutes >= 0.0


# --------------------------------------------------------------------------- #
# 3. Sınırlama yalnızca gerektiğinde devreye girmeli
# --------------------------------------------------------------------------- #


def test_light_load_is_untouched_by_clamping() -> None:
    """Hafif yukte sinirlama devreye girmez ve Performance 1'in belirgin altinda kalir.

    Sinirlamanin her kosumda calismasi, Performance'i sessizce %100'e cekerek
    gercek hiz kaybini gizlerdi; bu test bunun olmadigini gosterir.
    """
    for seed in SEEDS[:8]:
        config = overloaded_config(seed, interarrival_mean=20.0)
        station = next(m for m in run(config).stations if m.station_id == "a")
        oee = compute_station_oee(station)
        # lambda x E[S] = 5 / 20 = 0,25 civari bir mesguliyet beklenir.
        assert oee.performance < 0.6
        assert oee.warnings == []


def test_clamped_run_explains_itself() -> None:
    """Sinirlama kayda deger oldugunda kullaniciya nedeni bildirilmelidir.

    Sessizce kirpmak, kullanicinin %100 Performance'i gercek bir olcum sanmasina
    yol acardi. Uyari metni nedeni ornekleme dalgalanmasi olarak adlandirmali ve
    yapilabilecek seyi (kosumu uzatmak) soylemelidir.
    """
    mesajlar = []
    for seed in range(40):
        # Kisa kosum, dalgalanmayi buyutur ve sinirlamayi kayda deger kilar.
        config = overloaded_config(seed, duration=400.0)
        for metrics in run(config).stations:
            mesajlar.extend(compute_station_oee(metrics).warnings)

    sinirlama = [m for m in mesajlar if "sinirlandi" in m]
    assert sinirlama, "Kisa ve asiri yuklu kosumlarda sinirlama bildirilmedi."
    ornek = sinirlama[0]
    assert "ornekleme dalgalanmasidir" in ornek
    assert "Simulasyon suresini uzatmak" in ornek
