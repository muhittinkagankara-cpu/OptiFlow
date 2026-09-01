"""Olay izinin doğrulaması — Faz 1.

Bu dosyanın **birinci ve en önemli görevi** şunu kanıtlamaktır: gözlemci
simülasyonun sonucunu değiştirmez. Animasyon için eklenen bir özelliğin
istatistiksel sonuçları sessizce kaydırması, ürünün bütün bilimsel iddiasını
geçersiz kılardı — üstelik bu tür bir sapma gözle fark edilmez, çünkü sonuçlar
zaten rastgeledir ve "biraz farklı" görünmesi normal karşılanır.

İkinci görev, izin yeniden üretilebilirliğini doğrulamaktır: iz saklanmaz,
gerektiğinde aynı tohumla yeniden üretilir. Kısaltılmış bir koşumun ilk N
dakikası, tam koşumun ilk N dakikasıyla birebir aynı olmalıdır; aksi hâlde
kullanıcı, raporlanan sayıları üretmeyen bir animasyon izlerdi.
"""

from __future__ import annotations

import pytest

from simulation_engine.core.engine import (
    DEFAULT_TRACE_WINDOW_MINUTES,
    EventTraceCollector,
    SimulationEngine,
    capture_trace,
    run_replication,
)
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Connection,
    Distribution,
    SimulationConfig,
    Station,
)

#: İzin kapsadığı pencere; testlerde kısa tutulur.
TRACE_WINDOW: float = 300.0


def line_config(duration: float = 4000.0) -> SimulationConfig:
    """Uc istasyonlu, darbogazi belirgin bir hat."""
    return SimulationConfig(
        stations=[
            Station(
                id="kesim",
                name="Kesim",
                service_time_distribution=Distribution.constant(1.0),
            ),
            Station(
                id="pres",
                name="Pres",
                service_time_distribution=Distribution.exponential(2.2),
                buffer_capacity_before=5,
            ),
            Station(
                id="montaj",
                name="Montaj",
                service_time_distribution=Distribution.triangular(0.6, 0.9, 1.4),
            ),
        ],
        connections=[
            Connection(from_station_id="kesim", to_station_id="pres"),
            Connection(from_station_id="pres", to_station_id="montaj"),
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.6), entry_station_id="kesim"
        ),
        simulation_duration_minutes=duration,
        # Isinma her zaman sureden kisa kalmali; kisa kosumlarda sabit 200
        # dakika sema dogrulamasini duserirdi.
        warmup_period_minutes=min(200.0, duration / 10.0),
        num_replications=3,
        random_seed=4242,
    )


# --------------------------------------------------------------------------- #
# 1. Gözlemci sonuçları etkilemiyor (kabul kriteri 1)
# --------------------------------------------------------------------------- #


def test_trace_does_not_change_results() -> None:
    """Iz acikken ve kapaliyken uretilen sonuclar birebir ayni olmali.

    Sartnamenin en kritik kabul kriteri budur. Gozlemci rastgele sayi cekerse
    ya da akisi etkilerse tum istatistikler kayar; boyle bir sapma sonuclar
    zaten rastgele oldugu icin gozle fark edilmez.
    """
    config = line_config()

    without_trace = SimulationEngine(config).run()
    with_trace = SimulationEngine(
        config, trace_collector=EventTraceCollector(window_minutes=TRACE_WINDOW)
    ).run()

    exclude = {"wall_clock_seconds"}
    assert with_trace.model_dump(exclude=exclude) == without_trace.model_dump(
        exclude=exclude
    )


@pytest.mark.parametrize("replication_index", [0, 1, 2])
def test_trace_neutral_for_every_replication(replication_index: int) -> None:
    """Gozlemcinin etkisizligi tek bir replikasyona ozgu olmamali."""
    config = line_config(duration=2000.0)

    plain = SimulationEngine(config, replication_index=replication_index).run()
    traced = SimulationEngine(
        config,
        replication_index=replication_index,
        trace_collector=EventTraceCollector(window_minutes=TRACE_WINDOW),
    ).run()

    exclude = {"wall_clock_seconds"}
    assert traced.model_dump(exclude=exclude) == plain.model_dump(exclude=exclude)


def test_trace_does_not_consume_randomness() -> None:
    """Gozlemci rastgele sayi akislarindan cekim yapmamali.

    Cekim yapsaydi sonraki tum ornekler kayardi. Dagilimlarin ornek sayaclari
    iki kosumda da ayni olmalidir — bu, esitligin nedenini dogrudan gosterir.
    """
    config = line_config(duration=1500.0)

    plain_engine = SimulationEngine(config)
    plain_engine.run()
    traced_engine = SimulationEngine(
        config, trace_collector=EventTraceCollector(window_minutes=TRACE_WINDOW)
    )
    traced_engine.run()

    for station_id, station in plain_engine.stations.items():
        traced_station = traced_engine.stations[station_id]
        assert (
            station.service_distribution.sample_count
            == traced_station.service_distribution.sample_count
        )
    assert (
        plain_engine._arrival_distribution.sample_count  # noqa: SLF001 - test icin
        == traced_engine._arrival_distribution.sample_count  # noqa: SLF001
    )


# --------------------------------------------------------------------------- #
# 2. Kayıt penceresi ve sınırlar (kabul kriteri 2)
# --------------------------------------------------------------------------- #


def test_events_stay_within_window() -> None:
    """Hicbir olay pencere disinda kaydedilmemeli."""
    trace = capture_trace(line_config(), window_minutes=TRACE_WINDOW)

    assert trace.events, "pencere icinde olay uretilmeliydi"
    assert all(event.timestamp <= TRACE_WINDOW for event in trace.events)
    assert trace.duration_minutes <= TRACE_WINDOW


def test_events_are_chronologically_ordered() -> None:
    """Olaylar zaman sirasinda olmali; animasyon bunu varsayar."""
    trace = capture_trace(line_config(), window_minutes=TRACE_WINDOW)
    timestamps = [event.timestamp for event in trace.events]

    assert timestamps == sorted(timestamps)


def test_trace_size_is_reasonable() -> None:
    """500 dakikalik iz makul boyutta kalmali (kabul kriteri 2).

    Sinir asilirsa animasyon verisi ag uzerinden tasinamayacak kadar buyur.
    """
    trace = capture_trace(line_config(duration=10000.0))
    payload = trace.model_dump_json()

    assert len(trace.events) > 0
    assert len(payload) < 600_000, f"iz cok buyuk: {len(payload):,} bayt"


def test_event_limit_truncates_and_flags() -> None:
    """Olay sayisi sinira ulasirsa kayit durmali ve iz isaretlenmeli."""
    collector = EventTraceCollector(window_minutes=1000.0, max_events=25)
    SimulationEngine(line_config(), trace_collector=collector).run()

    assert len(collector.events) == 25
    assert collector.truncated

    trace = collector.build(0, 3, ["kesim"])
    assert trace.truncated
    # Kesilmis izde kapsanan sure, son olayin zamaniyla sinirlidir; aksi halde
    # animasyon var olmayan bir donemi bos gecirirdi.
    assert trace.duration_minutes <= collector.events[-1].timestamp


def test_window_never_exceeds_simulation_duration() -> None:
    """Pencere, simulasyon suresinden uzun istenirse kisaltilmali."""
    trace = capture_trace(line_config(duration=120.0), window_minutes=500.0)
    assert trace.duration_minutes <= 120.0


# --------------------------------------------------------------------------- #
# 3. Yeniden üretilebilirlik — iz saklanmaz, yeniden üretilir
# --------------------------------------------------------------------------- #


def test_truncated_run_matches_full_run_events() -> None:
    """Kisaltilmis kosumun olaylari, tam kosumun ilk penceresiyle ayni olmali.

    Iz saklanmayip yeniden uretildigi icin bu ozellik zorunludur: aksi halde
    kullanici, raporlanan sayilari uretmeyen bir animasyon izlerdi. Sureyi
    kisaltmak olay dizisini degistirmemelidir, cunku rastgele sayi akislari
    tohum ve etikete gore turetilir; sureye bagli degildir.
    """
    config = line_config(duration=4000.0)

    # Tam kosum, ama yalnizca ilk pencere kaydediliyor.
    full_collector = EventTraceCollector(window_minutes=TRACE_WINDOW)
    SimulationEngine(config, trace_collector=full_collector).run()

    # Kisaltilmis kosum (capture_trace'in yaptigi sey).
    regenerated = capture_trace(config, window_minutes=TRACE_WINDOW)

    assert [event.model_dump() for event in regenerated.events] == [
        event.model_dump() for event in full_collector.events
    ]


def test_trace_is_reproducible_with_same_seed() -> None:
    """Ayni tohum ayni izi uretmeli."""
    config = line_config()
    first = capture_trace(config, window_minutes=TRACE_WINDOW)
    second = capture_trace(config, window_minutes=TRACE_WINDOW)

    assert first.model_dump() == second.model_dump()


def test_trace_differs_with_different_seed() -> None:
    """Farkli tohum farkli iz uretmeli; aksi halde kayit sahte olurdu."""
    config = line_config()
    first = capture_trace(config, master_seed=1, window_minutes=TRACE_WINDOW)
    second = capture_trace(config, master_seed=2, window_minutes=TRACE_WINDOW)

    assert first.model_dump() != second.model_dump()


def test_trace_matches_reported_results() -> None:
    """Iz, raporlanan sonuclari ureten kosumun ta kendisi olmali.

    `capture_trace` ile `run_replication` ayni tohumu kullanir; izdeki varis
    sayisi, ayni pencereye kadar calistirilan bir kosumun urettigi varis
    sayisiyla uyusmalidir.
    """
    config = line_config()
    trace = capture_trace(config, window_minutes=TRACE_WINDOW)

    windowed = config.model_copy(
        update={
            "simulation_duration_minutes": TRACE_WINDOW,
            "warmup_period_minutes": 0.0,
        }
    )
    result = run_replication(windowed)

    arrivals_in_trace = sum(1 for event in trace.events if event.event_type == "arrival")
    assert arrivals_in_trace == result.system.entities_created


# --------------------------------------------------------------------------- #
# 4. Olayların içeriği — animasyonun ihtiyacı
# --------------------------------------------------------------------------- #


def test_every_entity_starts_with_arrival() -> None:
    """Her parcanin ilk olayi 'arrival' olmali.

    Animasyon parcayi ilk olayda ekrana koyar; ilk olay 'queue_enter' olsaydi
    parca bir yerden aniden belirmis gorunurdu.
    """
    trace = capture_trace(line_config(), window_minutes=TRACE_WINDOW)

    first_event: dict[str, str] = {}
    for event in trace.events:
        first_event.setdefault(event.entity_id, event.event_type)

    assert first_event, "iz bos olmamali"
    assert all(kind == "arrival" for kind in first_event.values())


def test_arrival_has_no_station_others_do() -> None:
    """Varis olayi sistem geneli, digerleri istasyona bagli olmali."""
    trace = capture_trace(line_config(), window_minutes=TRACE_WINDOW)

    for event in trace.events:
        if event.event_type == "arrival":
            assert event.station_id is None
        elif event.event_type != "system_exit":
            assert event.station_id is not None


def test_station_ids_are_known() -> None:
    """Olaylardaki istasyon kimlikleri modelde tanimli olmali."""
    config = line_config()
    trace = capture_trace(config, window_minutes=TRACE_WINDOW)
    known = {station.id for station in config.stations}

    assert set(trace.station_ids) == known
    for event in trace.events:
        if event.station_id is not None:
            assert event.station_id in known


def test_service_start_follows_queue_or_arrival() -> None:
    """Bir parca hizmete girmeden once ya kuyruga girmis ya yeni gelmis olmali."""
    trace = capture_trace(line_config(), window_minutes=TRACE_WINDOW)

    seen: dict[str, list[str]] = {}
    for event in trace.events:
        history = seen.setdefault(event.entity_id, [])
        if event.event_type == "service_start":
            assert history, "hizmet baslangicindan once olay bulunmali"
        history.append(event.event_type)


def test_blocked_events_appear_on_constrained_line() -> None:
    """Sonlu tamponlu bir darbogazda blokaj olayi uretilmeli.

    Blokaj, animasyonda darbogaz hissini veren olaydir; hic uretilmiyorsa
    animasyon tikanmayi gosteremez.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="hizli",
                name="Hizli",
                service_time_distribution=Distribution.constant(0.4),
            ),
            Station(
                id="yavas",
                name="Yavas",
                service_time_distribution=Distribution.constant(2.0),
                buffer_capacity_before=1,
            ),
        ],
        connections=[Connection(from_station_id="hizli", to_station_id="yavas")],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0), entry_station_id="hizli"
        ),
        simulation_duration_minutes=600.0,
        warmup_period_minutes=50.0,
        num_replications=1,
        random_seed=99,
    )
    trace = capture_trace(config, window_minutes=TRACE_WINDOW)
    blocked = [event for event in trace.events if event.event_type == "blocked"]

    assert blocked, "sonlu tamponlu darbogazda blokaj beklenirdi"
    assert all(event.station_id == "hizli" for event in blocked)


def test_trace_metadata_is_honest_about_sampling() -> None:
    """Iz, tek replikasyondan alindigini ve toplam sayiyi bildirmeli.

    Kullaniciya "bu temsili bir ornektir" diyebilmek icin arayuzun bu iki
    bilgiye ihtiyaci vardir.
    """
    config = line_config()
    trace = capture_trace(config, window_minutes=TRACE_WINDOW)

    assert trace.replication_index == 0
    assert trace.total_replications == config.num_replications
    assert trace.total_replications > 1


def test_default_window_constant() -> None:
    """Varsayilan pencere sartnamedeki araliga uymalı."""
    assert 200.0 <= DEFAULT_TRACE_WINDOW_MINUTES <= 500.0
