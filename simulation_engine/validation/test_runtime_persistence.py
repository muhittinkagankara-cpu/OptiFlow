"""Runtime kalıcılığı: depolar, göçler ve kurtarma.

Bellek ve veritabanı depoları **aynı testlerden** geçer: ikisinin davranışı
ayrışırsa, testlerin çoğu bellekte koştuğu için ayrışma yayına çıkana kadar
fark edilmezdi.
"""

from __future__ import annotations

import os
import tempfile

import pytest
from sqlalchemy import create_engine, inspect

from simulation_engine.runtime.persistence.migrations import (
    drop_runtime_tables,
    ensure_runtime_tables,
    missing_tables,
    runtime_schema_ready,
)
from simulation_engine.runtime.persistence.models import (
    RUNTIME_TABLE_NAMES,
    scoped_id,
)
from simulation_engine.runtime.persistence.repository import (
    MAX_PERSISTED_EVENTS,
    PERSISTABLE_STATUSES,
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
    StoredConnection,
    StoredEvent,
    StoredHealth,
    create_runtime_repository,
    persisted_status,
)
from simulation_engine.runtime.persistence.snapshots import (
    RUNNING,
    MachineSnapshotRecord,
)

ORG_A = "org-a"
ORG_B = "org-b"


def connection(connection_id: str = "plc-1", **overrides) -> StoredConnection:
    base = dict(
        connection_id=connection_id,
        kind="opcua",
        label="Hat 1 PLC",
        endpoint="opc.tcp://127.0.0.1:4840",
        topics=["ns=2;i=2"],
    )
    base.update(overrides)
    return StoredConnection(**base)


def snapshot(machine_id: str = "TORNA_01", **overrides) -> MachineSnapshotRecord:
    base = dict(machine_id=machine_id, updated_at_ms=1_000)
    base.update(overrides)
    return MachineSnapshotRecord(**base)


@pytest.fixture(params=["memory", "database"])
def repository(request):
    """Aynı testleri iki depoda da koşturur."""
    if request.param == "memory":
        yield InMemoryRuntimeRepository()
        return

    path = os.path.join(tempfile.mkdtemp(), "runtime.db")
    store = DatabaseRuntimeRepository(f"sqlite:///{path}")
    yield store
    store.clear()


class TestPersistedStatus:
    def test_bagli_durum_diske_yazilmaz(self):
        # Yeniden baslatmadan sonra o soket yoktur; "connected" yazmak,
        # hic denenmemis bir baglantiyi bagli gostermek olurdu.
        assert persisted_status("connected") == "idle"

    def test_ara_durumlar_da_yazilmaz(self):
        assert persisted_status("connecting") == "idle"
        assert persisted_status("retrying") == "idle"

    def test_kalici_durumlar_korunur(self):
        assert persisted_status("failed") == "failed"
        assert persisted_status("disconnected") == "disconnected"
        assert persisted_status("idle") == "idle"

    def test_bagli_durum_listede_yok(self):
        assert "connected" not in PERSISTABLE_STATUSES


class TestConnectionStore:
    def test_kayit_saklanir(self, repository):
        repository.save_connection(ORG_A, connection())
        assert len(repository.list_connections(ORG_A)) == 1

    def test_kayit_okunur(self, repository):
        repository.save_connection(ORG_A, connection(label="Hat 7"))
        assert repository.get_connection(ORG_A, "plc-1").label == "Hat 7"

    def test_olmayan_kayit_none(self, repository):
        assert repository.get_connection(ORG_A, "yok") is None

    def test_kayit_guncellenir(self, repository):
        repository.save_connection(ORG_A, connection())
        repository.save_connection(ORG_A, connection(label="Yeni ad"))
        assert len(repository.list_connections(ORG_A)) == 1
        assert repository.get_connection(ORG_A, "plc-1").label == "Yeni ad"

    def test_bagli_durum_diske_yazilmaz(self, repository):
        repository.save_connection(ORG_A, connection(status="connected"))
        assert repository.get_connection(ORG_A, "plc-1").status == "idle"

    def test_dogrulama_gecmisi_korunur(self, repository):
        repository.save_connection(ORG_A, connection(ever_verified=True))
        assert repository.get_connection(ORG_A, "plc-1").ever_verified is True

    def test_parola_alani_yok(self, repository):
        # Sifrelenmemis bir cihaz parolasini diske yazmak, yedegi ele geciren
        # birine fabrika erisimi vermek olurdu.
        repository.save_connection(ORG_A, connection(has_password=True))
        stored = repository.get_connection(ORG_A, "plc-1")
        assert stored.has_password is True
        assert not hasattr(stored, "password")

    def test_konular_korunur(self, repository):
        repository.save_connection(ORG_A, connection(topics=["a", "b"]))
        assert repository.get_connection(ORG_A, "plc-1").topics == ["a", "b"]

    def test_esleme_korunur(self, repository):
        mapping = [{"origin": "ns=2;i=2", "machine_id": "T", "metric": "production_count"}]
        repository.save_connection(ORG_A, connection(mapping=mapping))
        assert repository.get_connection(ORG_A, "plc-1").mapping == mapping

    def test_akis_bayragi_korunur(self, repository):
        repository.save_connection(ORG_A, connection(stream_enabled=True))
        assert repository.get_connection(ORG_A, "plc-1").stream_enabled is True

    def test_kayit_silinir(self, repository):
        repository.save_connection(ORG_A, connection())
        assert repository.delete_connection(ORG_A, "plc-1") is True
        assert repository.get_connection(ORG_A, "plc-1") is None

    def test_olmayan_kayit_silinmez(self, repository):
        assert repository.delete_connection(ORG_A, "yok") is False

    def test_kiraci_yalitimi(self, repository):
        repository.save_connection(ORG_A, connection())
        assert repository.get_connection(ORG_B, "plc-1") is None
        assert repository.list_connections(ORG_B) == []

    def test_ayni_kimlik_farkli_kiraci(self, repository):
        repository.save_connection(ORG_A, connection(label="A firmasi"))
        repository.save_connection(ORG_B, connection(label="B firmasi"))
        assert repository.get_connection(ORG_A, "plc-1").label == "A firmasi"
        assert repository.get_connection(ORG_B, "plc-1").label == "B firmasi"


class TestSnapshotStore:
    def test_goruntu_saklanir(self, repository):
        repository.save_snapshot(ORG_A, snapshot(production_count=1240))
        assert repository.list_snapshots(ORG_A)["TORNA_01"].production_count == 1240

    def test_olculmeyen_alan_none_kalir(self, repository):
        repository.save_snapshot(ORG_A, snapshot(production_count=5))
        stored = repository.list_snapshots(ORG_A)["TORNA_01"]
        assert stored.queue_length is None
        assert stored.oee is None

    def test_olculmus_sifir_korunur(self, repository):
        repository.save_snapshot(ORG_A, snapshot(queue_length=0))
        assert repository.list_snapshots(ORG_A)["TORNA_01"].queue_length == 0

    def test_durum_korunur(self, repository):
        repository.save_snapshot(ORG_A, snapshot(status=RUNNING))
        assert repository.list_snapshots(ORG_A)["TORNA_01"].status == RUNNING

    def test_kaynaklar_korunur(self, repository):
        repository.save_snapshot(ORG_A, snapshot(sources={"production_count": "plc-1"}))
        stored = repository.list_snapshots(ORG_A)["TORNA_01"]
        assert stored.sources["production_count"] == "plc-1"

    def test_goruntu_guncellenir(self, repository):
        repository.save_snapshot(ORG_A, snapshot(production_count=1))
        repository.save_snapshot(ORG_A, snapshot(production_count=9))
        snapshots = repository.list_snapshots(ORG_A)
        assert len(snapshots) == 1
        assert snapshots["TORNA_01"].production_count == 9

    def test_kiraci_yalitimi(self, repository):
        repository.save_snapshot(ORG_A, snapshot())
        assert repository.list_snapshots(ORG_B) == {}

    def test_temizleme_sayar(self, repository):
        repository.save_snapshot(ORG_A, snapshot("A"))
        repository.save_snapshot(ORG_A, snapshot("B"))
        assert repository.clear_snapshots(ORG_A) == 2
        assert repository.list_snapshots(ORG_A) == {}


class TestEventLog:
    def _event(self, sequence: int) -> StoredEvent:
        return StoredEvent(
            sequence=sequence,
            connection_id="plc-1",
            kind="device_data",
            level="info",
            message=f"olay {sequence}",
            at_ms=1_000 + sequence,
            data={"value": sequence},
        )

    def test_olay_saklanir(self, repository):
        repository.append_event(ORG_A, self._event(1))
        assert repository.event_count(ORG_A) == 1

    def test_since_sonrasi_okunur(self, repository):
        for index in range(1, 6):
            repository.append_event(ORG_A, self._event(index))
        events = repository.events_since(ORG_A, 3)
        assert [item.sequence for item in events] == [4, 5]

    def test_veri_alani_korunur(self, repository):
        repository.append_event(ORG_A, self._event(1))
        assert repository.events_since(ORG_A, 0)[0].data["value"] == 1

    def test_son_sira_okunur(self, repository):
        repository.append_event(ORG_A, self._event(7))
        assert repository.last_sequence(ORG_A) == 7

    def test_bos_gunlukte_sira_sifir(self, repository):
        assert repository.last_sequence(ORG_A) == 0

    def test_sinir_uygulanir(self, repository):
        events = repository.events_since(ORG_A, 0, limit=2)
        assert events == []

    def test_kiraci_yalitimi(self, repository):
        repository.append_event(ORG_A, self._event(1))
        assert repository.events_since(ORG_B, 0) == []
        assert repository.event_count(ORG_B) == 0

    def test_sinir_sabiti_belgelenmis(self):
        assert MAX_PERSISTED_EVENTS == 5_000


class TestHealthStore:
    def test_saglik_saklanir(self, repository):
        repository.save_health(ORG_A, StoredHealth(connection_id="plc-1", packets=5))
        assert repository.get_health(ORG_A, "plc-1").packets == 5

    def test_olculmeyen_gecikme_none(self, repository):
        repository.save_health(ORG_A, StoredHealth(connection_id="plc-1"))
        assert repository.get_health(ORG_A, "plc-1").avg_latency_ms is None

    def test_kurtarma_sayaci_korunur(self, repository):
        repository.save_health(ORG_A, StoredHealth(connection_id="plc-1", recoveries=3))
        assert repository.get_health(ORG_A, "plc-1").recoveries == 3

    def test_liste_okunur(self, repository):
        repository.save_health(ORG_A, StoredHealth(connection_id="a"))
        repository.save_health(ORG_A, StoredHealth(connection_id="b"))
        assert len(repository.list_health(ORG_A)) == 2

    def test_kiraci_yalitimi(self, repository):
        repository.save_health(ORG_A, StoredHealth(connection_id="plc-1"))
        assert repository.get_health(ORG_B, "plc-1") is None


class TestRepositoryMode:
    def test_bellek_deposu_kalici_degil(self):
        store = InMemoryRuntimeRepository()
        assert store.mode == "memory"
        assert store.is_persistent is False

    def test_veritabani_deposu_kalici(self):
        path = os.path.join(tempfile.mkdtemp(), "mode.db")
        store = DatabaseRuntimeRepository(f"sqlite:///{path}")
        assert store.mode == "database"
        assert store.is_persistent is True

    def test_adres_yoksa_bellek_deposu(self):
        assert isinstance(create_runtime_repository(""), InMemoryRuntimeRepository)

    def test_gecersiz_adres_bellek_deposuna_duser(self):
        # Sessizce duserse kullanici durumun kalici oldugunu sanardi; gunluge
        # yazilir ve arayuzde "Dogrulanmadi" gorunur.
        store = create_runtime_repository("postgresql://yok:5432/yok")
        assert isinstance(store, InMemoryRuntimeRepository)

    def test_adres_verilirse_veritabani(self):
        path = os.path.join(tempfile.mkdtemp(), "created.db")
        store = create_runtime_repository(f"sqlite:///{path}")
        assert store.is_persistent is True


class TestPersistenceAcrossRestart:
    """Sunucu yeniden başladığında durum korunur.

    Yeni bir depo örneği açmak, süreç yeniden başlamış gibidir: bellekte
    hiçbir şey kalmaz, yalnızca diskteki kayıtlar okunur.
    """

    def test_baglanti_yeniden_acilista_durur(self):
        path = os.path.join(tempfile.mkdtemp(), "restart.db")
        url = f"sqlite:///{path}"

        first = DatabaseRuntimeRepository(url)
        first.save_connection(ORG_A, connection(ever_verified=True))

        second = DatabaseRuntimeRepository(url)
        stored = second.get_connection(ORG_A, "plc-1")
        assert stored is not None
        assert stored.ever_verified is True

    def test_goruntu_yeniden_acilista_durur(self):
        path = os.path.join(tempfile.mkdtemp(), "restart2.db")
        url = f"sqlite:///{path}"

        first = DatabaseRuntimeRepository(url)
        first.save_snapshot(ORG_A, snapshot(production_count=1240, status=RUNNING))

        second = DatabaseRuntimeRepository(url)
        stored = second.list_snapshots(ORG_A)["TORNA_01"]
        assert stored.production_count == 1240
        assert stored.status == RUNNING

    def test_olay_gunlugu_yeniden_acilista_durur(self):
        path = os.path.join(tempfile.mkdtemp(), "restart3.db")
        url = f"sqlite:///{path}"

        first = DatabaseRuntimeRepository(url)
        first.append_event(
            ORG_A,
            StoredEvent(
                sequence=1,
                connection_id="plc-1",
                kind="device_data",
                level="info",
                message="olcum",
                at_ms=1_000,
                data={"value": 42},
            ),
        )

        second = DatabaseRuntimeRepository(url)
        events = second.events_since(ORG_A, 0)
        assert len(events) == 1
        assert events[0].data["value"] == 42

    def test_bellek_deposu_yeniden_acilista_bos(self):
        # Karsit ornek: bellek modu kalici degildir ve bu boyle raporlanir.
        first = InMemoryRuntimeRepository()
        first.save_connection(ORG_A, connection())
        second = InMemoryRuntimeRepository()
        assert second.list_connections(ORG_A) == []


class TestMigrations:
    def _engine(self, name: str):
        path = os.path.join(tempfile.mkdtemp(), name)
        return create_engine(f"sqlite:///{path}")

    def test_on_tablo_tanimli(self):
        assert set(RUNTIME_TABLE_NAMES) == {
            "runtime_connections",
            "device_snapshots",
            "runtime_events",
            "runtime_health",
            "runtime_downtime_events",
            "runtime_audit_log",
            "telemetry",
            "licenses",
            "install_tokens",
            "machine_labels",
        }

    def test_bos_veritabaninda_hepsi_eksik(self):
        engine = self._engine("missing.db")
        assert set(missing_tables(engine)) == set(RUNTIME_TABLE_NAMES)

    def test_tablolar_olusturulur(self):
        engine = self._engine("create.db")
        created = ensure_runtime_tables(engine)
        assert set(created) == set(RUNTIME_TABLE_NAMES)
        assert runtime_schema_ready(engine) is True

    def test_ikinci_cagri_bos_doner(self):
        engine = self._engine("idempotent.db")
        ensure_runtime_tables(engine)
        assert ensure_runtime_tables(engine) == []

    def test_dusurme_tablolari_siler(self):
        engine = self._engine("drop.db")
        ensure_runtime_tables(engine)
        drop_runtime_tables(engine)
        assert runtime_schema_ready(engine) is False

    def test_dusurme_sonrasi_yeniden_olusturulur(self):
        engine = self._engine("recreate.db")
        ensure_runtime_tables(engine)
        drop_runtime_tables(engine)
        assert set(ensure_runtime_tables(engine)) == set(RUNTIME_TABLE_NAMES)

    def test_tablolar_gercekten_olusur(self):
        engine = self._engine("inspect.db")
        ensure_runtime_tables(engine)
        names = set(inspect(engine).get_table_names())
        assert set(RUNTIME_TABLE_NAMES) <= names


class TestScopedId:
    def test_kiraci_ile_kapsanir(self):
        assert scoped_id("org", "hat-1") == "org::hat-1"

    def test_farkli_kiracilar_farkli_anahtar(self):
        assert scoped_id("a", "x") != scoped_id("b", "x")
