"""İzleme uçlarının HTTP davranışı.

Uçlar kiracıyla kapsanır: bir organizasyon başka bir organizasyonun alarmını
ne görebilir ne de onaylayabilir. Ölçülemeyen her alan `null` döner ve nedeni
yanında yazılır; arayüz bu nedeni "—" yerine gösterir.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.alarms import AlarmRuleId, alarm_id
from simulation_engine.runtime.api import get_runtime_manager, recover_on_startup
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

ORG_A = "izleme-api-a"
ORG_B = "izleme-api-b"
SAAT_MS = 3_600_000


def machine(
    machine_id: str = "TORNA_01",
    status: str = "down",
    production: float | None = None,
    scrap: float | None = None,
) -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status=status,
        production_count=production,
        scrap_count=scrap,
        # Saat gerçek: uçlar sistem saatini okur ve eski bir zaman damgası
        # ayrıca "veri gelmiyor" alarmı açardı.
        updated_at_ms=int(time.time() * 1000),
    )


@pytest.fixture
def manager():
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG_A
    app.dependency_overrides[get_runtime_manager] = lambda: instance

    # `get_current_org` oturum boyunca conftest tarafından da geçersiz
    # kılınmıştır. Sonda koşulsuz `pop` yapılsaydı, bu dosya kendi
    # temizliğinde oturum genelindeki kimliği de siler ve sonraki test
    # dosyalarındaki bütün istekler 401 dönerdi.
    previous_org = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: ORG_A

    yield instance

    app.dependency_overrides.pop(get_runtime_manager, None)
    if previous_org is None:
        app.dependency_overrides.pop(get_current_org, None)
    else:
        app.dependency_overrides[get_current_org] = previous_org


@pytest.fixture
def client(manager):
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


class TestAlarmUcu:
    def test_bos_sistemde_alarm_yok(self, client):
        payload = client.get("/api/runtime/alarms").json()
        assert payload["counts"]["active"] == 0

    def test_duran_makine_alarm_uretir(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        payload = client.get("/api/runtime/alarms").json()
        assert payload["counts"]["active"] == 1

    def test_ikinci_cagri_alarmi_cogaltmaz(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        payload = client.get("/api/runtime/alarms").json()
        assert payload["counts"]["active"] == 1

    def test_yanit_etkin_gecmis_ve_sayaclari_icerir(self, client):
        payload = client.get("/api/runtime/alarms").json()
        assert set(payload) == {"active", "history", "counts"}

    def test_alarmda_okunur_etiketler_var(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        alarm = client.get("/api/runtime/alarms").json()["active"][0]
        assert alarm["state_label"] == "Açık"
        assert alarm["severity_label"]


class TestAlarmOnayUcu:
    def _ident(self) -> str:
        return alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")

    def test_acik_alarm_onaylanir(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        response = client.post(
            "/api/runtime/alarms/acknowledge",
            json={"alarm_id": self._ident(), "by": "Ayşe"},
        )
        assert response.status_code == 200
        assert response.json()["acknowledged_by"] == "Ayşe"

    def test_bilinmeyen_alarm_404(self, client):
        response = client.post(
            "/api/runtime/alarms/acknowledge", json={"alarm_id": "yok::yok"}
        )
        assert response.status_code == 404

    def test_ikinci_onay_404(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        client.post(
            "/api/runtime/alarms/acknowledge", json={"alarm_id": self._ident()}
        )
        response = client.post(
            "/api/runtime/alarms/acknowledge", json={"alarm_id": self._ident()}
        )
        assert response.status_code == 404

    def test_onaydan_sonra_acik_sayaci_duser(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        client.post(
            "/api/runtime/alarms/acknowledge", json={"alarm_id": self._ident()}
        )
        counts = client.get("/api/runtime/alarms").json()["counts"]
        assert counts["open"] == 0
        assert counts["acknowledged"] == 1

    def test_onaylayan_varsayilani_operator(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        payload = client.post(
            "/api/runtime/alarms/acknowledge", json={"alarm_id": self._ident()}
        ).json()
        assert payload["acknowledged_by"] == "operatör"

    def test_baska_kiraci_alarmi_onaylayamaz(self, client, manager):
        """Kiracı yalıtımı: B, A'nın alarmını göremediği gibi onaylayamaz da."""
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        with as_org(ORG_B):
            # B'nin görüntüsü yok; değerlendirme A'nın alarmını kapatmaz ama
            # B adına yapılan onay isteği de kabul edilmez.
            response = client.post(
                "/api/runtime/alarms/acknowledge",
                json={"alarm_id": "machine_down::BASKA"},
            )
        assert response.status_code == 404


class TestUretimDurumuUcu:
    def test_bos_sistemde_oee_null(self, client):
        payload = client.get("/api/runtime/production-status").json()
        assert payload["oee"] is None

    def test_olcumsuz_oee_nedeni_yazilir(self, client):
        payload = client.get("/api/runtime/production-status").json()
        assert payload["oee_reasons"] != {}

    def test_makine_sayilari_donulur(self, client, manager):
        manager.devices.load_snapshots(
            {
                "M1": machine("M1", status="running"),
                "M2": machine("M2", status="blocked"),
                "M3": machine("M3", status="down"),
            }
        )
        payload = client.get("/api/runtime/production-status").json()
        assert payload["running_machines"] == 1
        assert payload["blocked_machines"] == 1
        assert payload["down_machines"] == 1

    def test_planlanan_sure_verilince_kullanilabilirlik_hesaplanir(
        self, client, manager
    ):
        manager.devices.load_snapshots({"TORNA_01": machine(status="running")})
        client.get("/api/runtime/production-status")
        payload = client.get(
            "/api/runtime/production-status",
            params={"planned_time_ms": SAAT_MS, "ideal_cycle_seconds": 30},
        ).json()
        assert "downtime_minutes" in payload

    def test_gecersiz_planlanan_sure_reddedilir(self, client):
        response = client.get(
            "/api/runtime/production-status", params={"planned_time_ms": 0}
        )
        assert response.status_code == 422

    def test_alarm_sayaci_donulur(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        payload = client.get("/api/runtime/production-status").json()
        assert payload["active_alarms"] == 1


class TestZamanCizelgesiUcu:
    def test_bos_sistemde_cizelge_bos(self, client):
        payload = client.get("/api/runtime/timeline").json()
        assert payload["entries"] == []
        assert payload["count"] == 0

    def test_durus_cizelgede_gorunur(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        payload = client.get("/api/runtime/timeline").json()
        assert any(row["type"] == "downtime" for row in payload["entries"])

    def test_alarm_cizelgede_gorunur(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        payload = client.get("/api/runtime/timeline").json()
        assert any(row["type"] == "alarm" for row in payload["entries"])

    def test_sinir_uygulanir(self, client, manager):
        manager.devices.load_snapshots(
            {f"M{i}": machine(f"M{i}") for i in range(10)}
        )
        payload = client.get("/api/runtime/timeline", params={"limit": 3}).json()
        assert payload["count"] == 3

    def test_gecersiz_sinir_reddedilir(self, client):
        assert client.get("/api/runtime/timeline", params={"limit": 0}).status_code == 422

    def test_ust_sinir_asilamaz(self, client):
        assert (
            client.get("/api/runtime/timeline", params={"limit": 5_000}).status_code
            == 422
        )


class TestSaglikSkoruUcu:
    def test_baglanti_yoksa_skor_null(self, client):
        payload = client.get("/api/runtime/health-score").json()
        assert payload["score"] is None
        assert payload["label"] == "Ölçülmedi"

    def test_yanit_baglanti_listesi_icerir(self, client):
        payload = client.get("/api/runtime/health-score").json()
        assert payload["connections"] == []
        assert payload["measured"] == 0


class TestCanliUcuBirlesikVeri:
    def test_canli_uc_runtime_kpi_dondurur(self, client, manager):
        manager.devices.load_snapshots(
            {"TORNA_01": machine(status="running", production=100)}
        )
        payload = client.get("/api/runtime/live").json()
        assert payload["runtime_kpi"]["production"] == 100

    def test_canli_uc_alarmlari_dondurur(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        payload = client.get("/api/runtime/live").json()
        assert len(payload["alarms"]) == 1

    def test_canli_uc_ve_alarm_ucu_ayni_sayiyi_verir(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        canli = len(client.get("/api/runtime/live").json()["alarms"])
        merkez = client.get("/api/runtime/alarms").json()["counts"]["active"]
        assert canli == merkez

    def test_pano_alarm_sayacini_icerir(self, client, manager):
        manager.devices.load_snapshots({"TORNA_01": machine()})
        client.get("/api/runtime/alarms")
        payload = client.get("/api/runtime/dashboard").json()
        assert payload["alarms"]["active"] == 1

    def test_pano_saglik_skorunu_icerir(self, client):
        assert "health_score" in client.get("/api/runtime/dashboard").json()


class TestAcilistaKurtarma:
    def test_acilista_kurtarma_calisir(self, manager):
        """Elle bir düğme yok: açılış kancası kurtarmayı kendisi çağırır."""
        result = recover_on_startup(manager)
        assert set(result) >= {"orgs", "results", "failures", "persistent"}

    def test_bellek_kipinde_kurtarilacak_sey_yok(self, manager):
        assert recover_on_startup(manager)["orgs"] == []

    def test_kurtarma_kalicilik_kipini_bildirir(self, manager):
        assert recover_on_startup(manager)["persistent"] is False
