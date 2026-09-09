"""Kurtarma, kalıcı yeniden oynatma ve runtime panosu.

Bu dosyanın koruduğu kural: **geri yüklenen bir bağlantı bağlı sayılmaz.**
Yeniden başlatmadan sonra soket yoktur; tanım geri gelir, doğrulama yeniden
yapılır.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import get_runtime_manager
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
)
from simulation_engine.runtime.persistence.snapshots import RUNNING
from simulation_engine.runtime.pipeline.device_events import DeviceEvent, Metric
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    ProbeResult,
)

ORG = "kurtarma-org"
ORG_B = "kurtarma-org-b"


class OkAdapter:
    kind = "fake"

    async def probe(self, spec):
        return ProbeResult(
            ok=True,
            latency_ms=6.0,
            detail="uc yanit verdi",
            evidence="ns=2;i=2 = 1240",
            bytes_received=12,
        )


def spec(connection_id: str = "plc-1", **overrides) -> ConnectionSpec:
    base = dict(
        connection_id=connection_id,
        kind=ConnectionKind.OPCUA,
        label="Hat 1 PLC",
        endpoint="opc.tcp://127.0.0.1:4840/optiflow/",
        topics=["ns=2;i=2"],
        max_retries=0,
    )
    base.update(overrides)
    return ConnectionSpec(**base)


def device_event(machine="TORNA_01", metric=Metric.PRODUCTION_COUNT, value=1240, at_ms=1_000):
    return DeviceEvent(
        connection_id="plc-1",
        machine_id=machine,
        metric=metric,
        value=value,
        at_ms=at_ms,
        source=ConnectionKind.OPCUA,
    )


def manager_with(repository=None) -> RuntimeManager:
    adapter = OkAdapter()
    return RuntimeManager(
        adapters={
            ConnectionKind.REST: adapter,
            ConnectionKind.OPCUA: adapter,
            ConnectionKind.MQTT: adapter,
        },
        sleep=lambda seconds: asyncio.sleep(0),
        repository=repository if repository is not None else InMemoryRuntimeRepository(),
    )


def sqlite_repository(name: str) -> DatabaseRuntimeRepository:
    path = os.path.join(tempfile.mkdtemp(), name)
    return DatabaseRuntimeRepository(f"sqlite:///{path}")


class TestPersistenceOnRegister:
    def test_kayit_diske_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        assert manager.repository.get_connection(ORG, "plc-1") is not None

    def test_kayit_baglandi_yazmaz(self):
        manager = manager_with()
        manager.register(ORG, spec())
        assert manager.repository.get_connection(ORG, "plc-1").status == "idle"

    def test_dogrulama_diske_yansir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        assert manager.repository.get_connection(ORG, "plc-1").ever_verified is True

    def test_dogrulanan_baglanti_yine_idle_saklanir(self):
        # Bagli olmak surece aittir; diske yazilan durum "idle" kalir.
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        assert manager.repository.get_connection(ORG, "plc-1").status == "idle"

    def test_saglik_diske_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        health = manager.repository.get_health(ORG, "plc-1")
        assert health is not None
        assert health.packets == 1

    def test_parola_diske_yazilmaz(self):
        manager = manager_with()
        manager.register(ORG, spec(password="gizli"))
        stored = manager.repository.get_connection(ORG, "plc-1")
        assert stored.has_password is True
        assert "gizli" not in str(stored.to_dict())

    def test_silme_diskten_de_siler(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.forget(ORG, "plc-1")
        assert manager.repository.get_connection(ORG, "plc-1") is None

    def test_olay_kalici_gunluge_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        assert manager.repository.event_count(ORG) >= 1


class TestSnapshotPersistence:
    def test_cihaz_olcumu_goruntuye_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        assert manager.devices.snapshots_by_machine["TORNA_01"].production_count == 1240

    def test_goruntu_diske_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        stored = manager.repository.list_snapshots(ORG)
        assert stored["TORNA_01"].production_count == 1240

    def test_durum_goruntuye_islenir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch(
            [device_event(metric=Metric.MACHINE_STATUS, value="running")]
        )
        assert manager.devices.snapshots_by_machine["TORNA_01"].status == RUNNING

    def test_organizasyon_bilinmiyorsa_yazilmaz(self):
        # Yanlis kiraciya veri yazmaktansa yazmamak yegdir.
        manager = manager_with()
        manager.devices.dispatch([device_event()])
        assert manager.repository.list_snapshots(ORG) == {}

    def test_ustune_yazma_kaydedilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        other = DeviceEvent(
            connection_id="mqtt-1",
            machine_id="TORNA_01",
            metric=Metric.PRODUCTION_COUNT,
            value=78,
            at_ms=2_000,
            source=ConnectionKind.MQTT,
        )
        manager.devices.dispatch([other])
        assert len(manager.devices.overwrites) == 1
        assert manager.devices.overwrites[0]["previous_source"] == "plc-1"

    def test_ayni_kaynak_ustune_yazma_sayilmaz(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event(), device_event(value=1300, at_ms=2_000)])
        assert manager.devices.overwrites == []


class TestRecovery:
    def test_baglantilar_geri_yuklenir(self):
        repository = sqlite_repository("recover1.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        asyncio.run(first.connect(ORG, "plc-1"))

        second = manager_with(DatabaseRuntimeRepository(repository._engine.url.render_as_string(hide_password=False)))
        result = second.recover(ORG)
        assert result["connections"] == ["plc-1"]

    def test_geri_yuklenen_baglanti_bagli_sayilmaz(self):
        repository = sqlite_repository("recover2.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        asyncio.run(first.connect(ORG, "plc-1"))

        second = manager_with(repository)
        second.recover(ORG)
        state = second.state_of(ORG, "plc-1")
        assert state.status is ConnectionStatus.IDLE

    def test_dogrulama_gecmisi_korunur(self):
        repository = sqlite_repository("recover3.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        asyncio.run(first.connect(ORG, "plc-1"))

        second = manager_with(repository)
        second.recover(ORG)
        assert second.state_of(ORG, "plc-1").ever_verified is True

    def test_goruntuler_geri_yuklenir(self):
        repository = sqlite_repository("recover4.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        first.devices.dispatch([device_event()])

        second = manager_with(repository)
        result = second.recover(ORG)
        assert result["snapshots"] == 1
        assert second.devices.snapshots_by_machine["TORNA_01"].production_count == 1240

    def test_esleme_geri_yuklenir(self):
        repository = sqlite_repository("recover5.db")
        first = manager_with(repository)
        first.set_mapping(
            "plc-1",
            MappingTable(
                entries=[
                    MetricMapping(
                        origin="ns=2;i=2",
                        machine_id="TORNA_01",
                        metric=Metric.PRODUCTION_COUNT,
                    )
                ]
            ),
        )
        first.register(ORG, spec())

        second = manager_with(repository)
        second.recover(ORG)
        mapping = second.mapping_for("plc-1")
        assert mapping is not None
        assert mapping.entries[0].machine_id == "TORNA_01"

    def test_saglik_sayaclari_geri_yuklenir(self):
        repository = sqlite_repository("recover6.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        asyncio.run(first.connect(ORG, "plc-1"))

        second = manager_with(repository)
        second.recover(ORG)
        assert second.state_of(ORG, "plc-1").health.packets == 1

    def test_kurtarma_sayaci_artar(self):
        repository = sqlite_repository("recover7.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        asyncio.run(first.connect(ORG, "plc-1"))

        second = manager_with(repository)
        second.recover(ORG)
        second.recover(ORG)
        assert repository.get_health(ORG, "plc-1").recoveries == 2

    def test_kurtarma_olay_uretir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.recover(ORG)
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "recovered" in kinds

    def test_kurtarma_baglanti_yeniden_dogrulanmali_der(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.recover(ORG)
        message = [
            event.message
            for event in manager.dispatcher.buffer.all()
            if event.kind == "recovered"
        ][0]
        assert "yeniden doğrulanmalı" in message

    def test_baska_kiracinin_kaydi_yuklenmez(self):
        repository = sqlite_repository("recover8.db")
        first = manager_with(repository)
        first.register(ORG, spec())

        second = manager_with(repository)
        result = second.recover(ORG_B)
        assert result["connections"] == []

    def test_bos_veritabaninda_kurtarma_bos(self):
        manager = manager_with()
        assert manager.recover(ORG)["connections"] == []

    def test_kurtarma_kalicilik_modunu_bildirir(self):
        manager = manager_with()
        assert manager.recover(ORG)["mode"] == "memory"
        assert manager.recover(ORG)["persistent"] is False


class TestLiveState:
    def test_bos_hatta_kpi_none(self):
        manager = manager_with()
        kpi = manager.live_state(ORG)["kpi"]
        assert kpi["production"] is None
        assert kpi["availability"] is None

    def test_olcum_kpiya_yansir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event(value=100)])
        assert manager.live_state(ORG)["kpi"]["production"] == 100

    def test_makineler_listelenir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event(machine="A"), device_event(machine="B")])
        assert len(manager.live_state(ORG)["machines"]) == 2

    def test_kalicilik_durumu_bildirilir(self):
        manager = manager_with()
        assert manager.live_state(ORG)["persistence"]["mode"] == "memory"

    def test_ustune_yazmalar_bildirilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        manager.devices.dispatch(
            [
                DeviceEvent(
                    connection_id="mqtt-1",
                    machine_id="TORNA_01",
                    metric=Metric.PRODUCTION_COUNT,
                    value=5,
                    at_ms=3_000,
                    source=ConnectionKind.MQTT,
                )
            ]
        )
        assert len(manager.live_state(ORG)["overwrites"]) == 1


class TestDashboard:
    def test_bos_panoda_sayilar_sifir(self):
        dashboard = manager_with().runtime_dashboard(ORG)
        assert dashboard["connections"] == 0
        assert dashboard["snapshots"] == 0

    def test_olay_hizi_olculemezse_none(self):
        # Bir saniyelik pencereden hiz cikarmak olcum degil tahmin olurdu.
        assert manager_with().runtime_dashboard(ORG)["events_per_second"] is None

    def test_baglanti_sayisi_bildirilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        assert manager.runtime_dashboard(ORG)["connections"] == 1

    def test_dogrulanan_sayisi_bildirilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        assert manager.runtime_dashboard(ORG)["verified"] == 1

    def test_kalicilik_modu_bildirilir(self):
        manager = manager_with()
        assert manager.runtime_dashboard(ORG)["persistence_mode"] == "memory"
        assert manager.runtime_dashboard(ORG)["persistent"] is False

    def test_veritabani_modunda_kalicilik_dogrulanir(self):
        manager = manager_with(sqlite_repository("dashboard.db"))
        assert manager.runtime_dashboard(ORG)["persistent"] is True

    def test_goruntu_sayisi_bildirilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event(machine="A"), device_event(machine="B")])
        assert manager.runtime_dashboard(ORG)["snapshots"] == 2

    def test_kalici_olay_sayisi_bildirilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        asyncio.run(manager.connect(ORG, "plc-1"))
        assert manager.runtime_dashboard(ORG)["persisted_events"] >= 1


# --------------------------------------------------------------------------- #
# HTTP uçları                                                                   #
# --------------------------------------------------------------------------- #


@pytest.fixture
def api_manager():
    instance = manager_with()
    app.dependency_overrides[get_runtime_manager] = lambda: instance
    yield instance
    app.dependency_overrides.pop(get_runtime_manager, None)


@pytest.fixture
def client(api_manager):
    with TestClient(app) as test_client:
        yield test_client


@contextmanager
def as_org(org_id: str):
    previous = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: org_id
    try:
        yield
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_org, None)
        else:
            app.dependency_overrides[get_current_org] = previous


def connect_body(connection_id="plc-1"):
    return {
        "connection_id": connection_id,
        "kind": "opcua",
        "label": "Hat 1 PLC",
        "endpoint": "opc.tcp://127.0.0.1:4840/optiflow/",
        "topics": ["ns=2;i=2"],
        "max_retries": 0,
    }


class TestLiveEndpoint:
    def test_bos_durumda_kpi_null(self, client):
        payload = client.get("/api/runtime/live").json()
        assert payload["kpi"]["production"] is None
        assert payload["machines"] == []

    def test_olcum_kpiya_yansir(self, client, api_manager):
        client.post("/api/runtime/connect", json=connect_body())
        api_manager.devices.dispatch([device_event(value=250)])
        payload = client.get("/api/runtime/live").json()
        assert payload["kpi"]["production"] == 250

    def test_makine_durumu_etiketli_doner(self, client, api_manager):
        client.post("/api/runtime/connect", json=connect_body())
        api_manager.devices.dispatch(
            [device_event(metric=Metric.MACHINE_STATUS, value="running")]
        )
        machine = client.get("/api/runtime/live").json()["machines"][0]
        assert machine["status"] == "running"
        assert machine["status_label"] == "Çalışıyor"

    def test_kalicilik_durumu_doner(self, client):
        assert client.get("/api/runtime/live").json()["persistence"]["mode"] == "memory"


class TestDashboardEndpoint:
    def test_pano_doner(self, client):
        payload = client.get("/api/runtime/dashboard").json()
        assert payload["connections"] == 0
        assert payload["persistent"] is False

    def test_baglanti_sayilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        assert client.get("/api/runtime/dashboard").json()["connections"] == 1


class TestRecoverEndpoint:
    def test_kurtarma_calisir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.post("/api/runtime/recover", json={}).json()
        assert payload["connections"] == ["plc-1"]

    def test_kurtarma_akislari_kendiliginden_baslatmaz(self, client):
        # Akis baslatmak cihaza gercek istek gonderir; kullanici istemelidir.
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.post("/api/runtime/recover", json={}).json()
        assert payload["resumed"] == []

    def test_akis_istenirse_denenir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.post(
            "/api/runtime/recover", json={"resume_streams": True}
        ).json()
        assert isinstance(payload["resumed"], list)

    def test_baska_kiraci_kendi_kayitlarini_gorur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            payload = client.post("/api/runtime/recover", json={}).json()
        assert payload["connections"] == []


class TestReplayEndpoint:
    def test_bos_gunlukte_olay_yok(self, client):
        payload = client.get("/api/runtime/replay").json()
        assert payload["events"] == []
        assert payload["total"] == 0

    def test_olaylar_okunur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.get("/api/runtime/replay").json()
        assert len(payload["events"]) >= 1

    def test_since_uygulanir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        last = client.get("/api/runtime/replay").json()["last_sequence"]
        payload = client.get(f"/api/runtime/replay?since={last}").json()
        assert payload["events"] == []

    def test_kalicilik_durumu_bildirilir(self, client):
        payload = client.get("/api/runtime/replay").json()
        assert payload["persistent"] is False
        assert payload["mode"] == "memory"

    def test_negatif_since_reddedilir(self, client):
        assert client.get("/api/runtime/replay?since=-1").status_code == 422

    def test_sinir_uygulanir(self, client):
        assert client.get("/api/runtime/replay?limit=0").status_code == 422

    def test_kiraci_yalitimi(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            payload = client.get("/api/runtime/replay").json()
        assert payload["events"] == []


class TestPersistentEventLog:
    """Kalıcı olay günlüğü.

    Yeniden oynatmanın yalnızca RAM'de yaşaması, sunucu yeniden başladığında
    geçmişin kaybolması demekti. Artık her olay diske de yazılır.
    """

    def test_kayit_olayi_gunluge_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        kinds = [item.kind for item in manager.repository.events_since(ORG, 0)]
        assert "registered" in kinds

    def test_cihaz_olayi_gunluge_yazilir(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        kinds = [item.kind for item in manager.repository.events_since(ORG, 0)]
        assert "device_data" in kinds

    def test_cihaz_olayinin_verisi_korunur(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event(value=1240)])
        events = [
            item
            for item in manager.repository.events_since(ORG, 0)
            if item.kind == "device_data"
        ]
        assert events[0].data["value"] == 1240

    def test_organizasyon_bilinmiyorsa_yazilmaz(self):
        # Yanlis kiracinin gunlugune olay eklemektense hic eklememek yegdir.
        manager = manager_with()
        manager.dispatcher.emit("c1", "probe", "x")
        assert manager.repository.event_count(ORG) == 0

    def test_sira_numaralari_artar(self):
        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.dispatch([device_event()])
        sequences = [item.sequence for item in manager.repository.events_since(ORG, 0)]
        assert sequences == sorted(sequences)

    def test_yeniden_baslatmada_gunluk_durur(self):
        repository = sqlite_repository("eventlog.db")
        first = manager_with(repository)
        first.register(ORG, spec())
        first.devices.dispatch([device_event()])

        second = manager_with(repository)
        assert second.repository.event_count(ORG) >= 2

    def test_tanilama_olayi_da_yazilir(self):
        from simulation_engine.runtime.pipeline.device_events import PipelineProblem

        manager = manager_with()
        manager.register(ORG, spec())
        manager.devices.record_problem(
            PipelineProblem(connection_id="plc-1", reason="bozuk", at_ms=1)
        )
        kinds = [item.kind for item in manager.repository.events_since(ORG, 0)]
        assert "diagnostic" in kinds
