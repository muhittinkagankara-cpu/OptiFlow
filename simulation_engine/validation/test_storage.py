"""Depolama katmanının doğrulaması — kalıcılık, geri düşüş ve temizlik.

Kalıcılığın asıl sınavı şudur: **sunucu yeniden başladığında sonuç hâlâ
okunabiliyor mu?** Bu, testte yeni bir depo örneği oluşturularak taklit edilir.
Aynı örnek üzerinden yazıp okumak yalnızca sözlük davranışını sınardı; yeni bir
örnek, verinin gerçekten süreç dışına yazıldığını kanıtlar.

Testler PostgreSQL yerine geçici bir SQLite dosyası kullanır. Bu bilinçli bir
tercihtir: sınanan mantık (serileştirme, yeni bağlantıdan okuma, saklama süresi
temizliği) veritabanı motorundan bağımsızdır ve testlerin çalışması için
kimsenin makinesinde PostgreSQL kurulu olması gerekmez. Üretimde JSONB
kullanılır; SQLAlchemy tip eşlemesi bunu kendisi seçer.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from simulation_engine.analytics.bottleneck import analyze as analyze_bottleneck
from simulation_engine.analytics.monte_carlo import (
    run_replications,
    summarize_replications,
)
from simulation_engine.analytics.oee import compute_oee_report
from simulation_engine.api.storage import (
    DATABASE_URL_ENV,
    JSON_INFINITY_SENTINEL,
    DatabaseSimulationStore,
    SimulationRecord,
    SimulationStore,
    StoredSimulation,
    create_simulation_store,
    deserialize_record,
    new_simulation_id,
    normalize_database_url,
    serialize_record,
)
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Distribution,
    SimulationConfig,
    Station,
)


def build_config() -> SimulationConfig:
    """Kucuk ve hizli bir M/M/1 senaryosu."""
    return SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Tek Istasyon",
                service_time_distribution=Distribution.exponential(0.8),
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0), entry_station_id="S"
        ),
        simulation_duration_minutes=2000.0,
        warmup_period_minutes=200.0,
        num_replications=3,
        random_seed=7,
    )


#: Depo mekanigini sinayan testler bir organizasyon baglaminda calisir.
#: Bos bir `org_id` artik depo katmaninda reddedilir (bkz. `require_org_id`):
#: kimlik dogrulama oncesinden kalma NULL satirlarin kimseye gorunmemesi icin.
ORG_ID = "test-org"


@pytest.fixture(scope="module")
def record() -> StoredSimulation:
    """Gercek bir simulasyon kosumundan uretilmis kayit."""
    config = build_config()
    replications, master_seed, elapsed = run_replications(config)
    return StoredSimulation(
        simulation_id=new_simulation_id(),
        config=config,
        replications=replications,
        monte_carlo=summarize_replications(replications, master_seed, elapsed),
        bottleneck=analyze_bottleneck(replications[0], config),
        oee=compute_oee_report(replications[0]),
        duration_seconds=elapsed,
        org_id=ORG_ID,
    )


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    """Her test icin ayri bir gecici SQLite dosyasi."""
    return f"sqlite:///{tmp_path / 'simulations.db'}"


# --------------------------------------------------------------------------- #
# 1. Kalıcılık — "sunucu yeniden başlatıldı" senaryosu
# --------------------------------------------------------------------------- #


def test_record_survives_store_restart(record: StoredSimulation, database_url: str) -> None:
    """Yeni bir depo ornegi, onceki ornegin yazdigi kaydi okuyabilmeli.

    Kabul kriteri 1'in test karsiligidir: Railway'de servis yeniden
    baslatildiginda daha once calistirilmis bir simulasyonun doğrulama raporu
    hâlâ erisilebilir olmalidir.
    """
    writer = DatabaseSimulationStore(database_url)
    writer.save(record)

    # "Sunucu yeniden basladi": tamamen yeni bir depo ornegi, yeni bir bağlantı.
    reader = DatabaseSimulationStore(database_url)
    restored = reader.get(ORG_ID, record.simulation_id)

    assert restored.simulation_id == record.simulation_id
    assert restored.config == record.config
    assert len(restored.replications) == len(record.replications)


def test_restored_record_supports_validation_report(
    record: StoredSimulation, database_url: str
) -> None:
    """Geri yuklenen kayit, dogrulama raporu uretmeye yetecek bilgiyi tasimali.

    Yalnizca ozet saklansaydi bu test duserdi: dogrulama raporu Little's Law
    denetimini **her replikasyon uzerinde** yeniden calistirir ve kararlilik
    bilgisini replikasyonlardan okur.
    """
    DatabaseSimulationStore(database_url).save(record)
    restored = DatabaseSimulationStore(database_url).get(ORG_ID, record.simulation_id)

    from simulation_engine.api.simulation_service import _build_validation_report

    report = _build_validation_report(restored)
    original = _build_validation_report(record)

    assert report.simulation_id == original.simulation_id
    assert report.passed == original.passed
    assert report.littles_law_summary.replications_checked == len(record.replications)
    assert report.master_seed == original.master_seed


def test_restored_record_reproduces_run_response(
    record: StoredSimulation, database_url: str
) -> None:
    """Geri yuklenen kayittan uretilen yanit, ozgunuyle ayni olmali."""
    DatabaseSimulationStore(database_url).save(record)
    restored = DatabaseSimulationStore(database_url).get(ORG_ID, record.simulation_id)

    from simulation_engine.api.simulation_service import _build_run_response

    original = _build_run_response(record)
    from_database = _build_run_response(restored)

    exclude = {"duration_seconds"}
    assert from_database.model_dump(exclude=exclude) == original.model_dump(
        exclude=exclude
    )


def test_missing_record_raises_key_error(database_url: str) -> None:
    """Bulunamayan kayit, bellek deposuyla ayni hatayi yukseltmeli.

    API katmani `KeyError` yakalayip 404 dondurur ve deponun turunu bilmez;
    farkli bir hata turu 500'e donusurdu.
    """
    store = DatabaseSimulationStore(database_url)
    with pytest.raises(KeyError):
        store.get(ORG_ID, "olmayan-kimlik")


def test_save_is_idempotent(record: StoredSimulation, database_url: str) -> None:
    """Ayni kimlik iki kez yazildiginda kayit cogalmamali."""
    store = DatabaseSimulationStore(database_url)
    store.save(record)
    store.save(record)

    assert len(store) == 1


# --------------------------------------------------------------------------- #
# 2. Serileştirme
# --------------------------------------------------------------------------- #


def test_serialization_round_trip_is_lossless(record: StoredSimulation) -> None:
    """Serilestirme ve geri yukleme kayipsiz olmali."""
    payload = serialize_record(record)
    restored = deserialize_record(
        record.simulation_id, payload["config"], payload["results"]
    )

    assert restored.config == record.config
    assert restored.replications == record.replications
    assert restored.monte_carlo == record.monte_carlo
    assert restored.bottleneck == record.bottleneck
    assert restored.oee == record.oee


def test_infinite_values_are_made_json_safe() -> None:
    """Sonsuz degerler JSON'a yazilabilir hale getirilmeli.

    Ulasilamayan bir istasyonun ziyaret orani sifirdir ve sistem kapasitesi
    sonsuz gorunur. JSON standardi `Infinity` tanimadigi icin PostgreSQL boyle
    bir belgeyi tumuyle reddeder — donusum yapilmazsa kayit hic yazilamazdi.
    """
    from simulation_engine.api.storage import _make_json_safe

    payload = _make_json_safe(
        {
            "sonsuz": math.inf,
            "eksi_sonsuz": -math.inf,
            "tanimsiz": math.nan,
            "normal": 3.5,
            "ic_ice": [{"deger": math.inf}],
        }
    )

    assert payload["sonsuz"] == JSON_INFINITY_SENTINEL
    assert payload["eksi_sonsuz"] == -JSON_INFINITY_SENTINEL
    assert payload["tanimsiz"] == 0.0
    assert payload["normal"] == 3.5
    assert payload["ic_ice"][0]["deger"] == JSON_INFINITY_SENTINEL
    # Donusen degerlerin hepsi sonlu olmali; aksi halde JSON yazimi patlardi.
    assert all(math.isfinite(value) for value in [payload["sonsuz"], payload["tanimsiz"]])


def test_unreachable_station_config_can_be_stored(database_url: str) -> None:
    """Ulasilamayan istasyon iceren bir model de saklanabilmeli.

    Bu senaryo sonsuz kapasite uretir; sanitasyon olmadan kayit yazilamazdi.
    """
    config = SimulationConfig(
        stations=[
            Station(
                id="S", name="Ana", service_time_distribution=Distribution.exponential(0.8)
            ),
            Station(
                id="KOPUK",
                name="Baglantisiz",
                service_time_distribution=Distribution.exponential(0.5),
            ),
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0), entry_station_id="S"
        ),
        simulation_duration_minutes=1000.0,
        warmup_period_minutes=100.0,
        num_replications=2,
        random_seed=11,
    )
    replications, seed, elapsed = run_replications(config)
    record = StoredSimulation(
        simulation_id=new_simulation_id(),
        config=config,
        replications=replications,
        monte_carlo=summarize_replications(replications, seed, elapsed),
        bottleneck=analyze_bottleneck(replications[0], config),
        oee=compute_oee_report(replications[0]),
        duration_seconds=elapsed,
        org_id=ORG_ID,
    )

    store = DatabaseSimulationStore(database_url)
    store.save(record)
    assert (
        store.get(ORG_ID, record.simulation_id).simulation_id == record.simulation_id
    )


# --------------------------------------------------------------------------- #
# 3. Bağlantı adresi normalleştirme
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "postgres://user:pw@host:5432/db",
            "postgresql://user:pw@host:5432/db",
        ),
        (
            "postgresql://user:pw@host:5432/db",
            "postgresql://user:pw@host:5432/db",
        ),
        ("sqlite:///yerel.db", "sqlite:///yerel.db"),
    ],
)
def test_database_url_normalization(raw: str, expected: str) -> None:
    """Railway ve Heroku'nun verdigi `postgres://` onekleri duzeltilmeli.

    SQLAlchemy 2 bu semayi tanimaz ve `NoSuchModuleError` ile basarisiz olur;
    dagitimda en sik karsilasilan baglanti hatasi budur.
    """
    assert normalize_database_url(raw) == expected


# --------------------------------------------------------------------------- #
# 4. Saklama süresi temizliği
# --------------------------------------------------------------------------- #


def test_expired_records_are_deleted_on_save(
    record: StoredSimulation, database_url: str
) -> None:
    """Saklama suresi dolmus kayitlar, yeni kayit eklendiginde silinmeli."""
    store = DatabaseSimulationStore(database_url, retention_days=30)
    store.save(record)

    # Mevcut kaydin tarihini geriye alarak "eski" hale getir.
    with store._session_factory.begin() as session:  # noqa: SLF001 - test icin
        row = session.get(SimulationRecord, record.simulation_id)
        row.created_at = datetime.now(timezone.utc) - timedelta(days=31)

    assert len(store) == 1

    fresh = StoredSimulation(
        simulation_id=new_simulation_id(),
        config=record.config,
        replications=record.replications,
        monte_carlo=record.monte_carlo,
        bottleneck=record.bottleneck,
        oee=record.oee,
        duration_seconds=record.duration_seconds,
        org_id=ORG_ID,
    )
    store.save(fresh)

    # Eski kayit silindi, yenisi duruyor.
    assert len(store) == 1
    with pytest.raises(KeyError):
        store.get(ORG_ID, record.simulation_id)
    assert store.get(ORG_ID, fresh.simulation_id).simulation_id == fresh.simulation_id


def test_recent_records_are_kept(record: StoredSimulation, database_url: str) -> None:
    """Suresi dolmamis kayitlar temizlikten etkilenmemeli."""
    store = DatabaseSimulationStore(database_url, retention_days=30)
    store.save(record)

    fresh = StoredSimulation(
        simulation_id=new_simulation_id(),
        config=record.config,
        replications=record.replications,
        monte_carlo=record.monte_carlo,
        bottleneck=record.bottleneck,
        oee=record.oee,
        duration_seconds=record.duration_seconds,
        org_id=ORG_ID,
    )
    store.save(fresh)

    assert len(store) == 2


def test_table_stores_expected_columns(
    record: StoredSimulation, database_url: str
) -> None:
    """Satir, sartnamede belirtilen sutunlari tasimali."""
    store = DatabaseSimulationStore(database_url)
    store.save(record)

    with store._session_factory() as session:  # noqa: SLF001 - test icin
        row = session.execute(select(SimulationRecord)).scalar_one()

    assert row.id == record.simulation_id
    assert row.status == "completed"
    assert isinstance(row.created_at, datetime)
    assert row.config["stations"][0]["id"] == "S"
    assert "replications" in row.results


# --------------------------------------------------------------------------- #
# 5. Bellek moduna geri düşüş
# --------------------------------------------------------------------------- #


def test_falls_back_to_memory_without_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DATABASE_URL yoksa bellek deposu kullanilmali.

    Kabul kriteri 2: yerel gelistirmede hicbir sey bozulmamalidir. PostgreSQL
    kurmak zorunda kalmak, projeye katki vermenin onunde gereksiz bir engeldir.
    """
    monkeypatch.delenv(DATABASE_URL_ENV, raising=False)
    store = create_simulation_store()

    assert isinstance(store, SimulationStore)
    assert not isinstance(store, DatabaseSimulationStore)


def test_falls_back_to_memory_on_connection_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Baglanti kurulamazsa uygulama cokmemeli, bellek moduna dusmeli."""
    monkeypatch.setenv(
        DATABASE_URL_ENV, "postgresql://kullanici:parola@olmayan-sunucu-12345:5432/db"
    )
    store = create_simulation_store()

    assert isinstance(store, SimulationStore)
    assert not isinstance(store, DatabaseSimulationStore)


def test_uses_database_when_url_is_valid(database_url: str) -> None:
    """Gecerli bir adres verildiginde kalici depo secilmeli."""
    store = create_simulation_store(database_url)
    assert isinstance(store, DatabaseSimulationStore)


def test_memory_store_interface_matches_database_store() -> None:
    """Iki deponun arayuzu birebir ayni olmali.

    API katmani deponun turunu bilmez; bir metodun yalnizca birinde bulunmasi,
    kalici moda gecildiginde ortaya cikacak bir hataya yol acardi.
    """
    memory_methods = {name for name in dir(SimulationStore) if not name.startswith("_")}
    database_methods = {
        name for name in dir(DatabaseSimulationStore) if not name.startswith("_")
    }
    assert memory_methods == database_methods
    for name in ("save", "get", "clear"):
        assert name in memory_methods


def test_dispose_releases_connections(record: StoredSimulation, database_url: str) -> None:
    """`dispose` cagrisi baglanti havuzunu kapatmali.

    Uzun omurlu bir sunucuda gerekmez; testlerde cok sayida depo
    olusturuldugunda baglantilar birikir ve Windows'ta acik bir baglanti,
    veritabani dosyasinin silinmesini engeller.
    """
    store = DatabaseSimulationStore(database_url)
    store.save(record)
    store.dispose()

    # Kapatildiktan sonra yeni bir depo ayni veriyi okuyabilmeli: `dispose`
    # veriyi degil yalnizca baglantilari serbest birakir.
    assert (
        DatabaseSimulationStore(database_url).get(ORG_ID, record.simulation_id) is not None
    )


def test_memory_store_dispose_is_harmless() -> None:
    """Bellek deposunda `dispose` cagirmak bir sey bozmamali."""
    store = SimulationStore()
    store.dispose()
    assert len(store) == 0
