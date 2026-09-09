"""Operasyon uçlarının HTTP davranışı.

Burada gerçek ASGI yığını üzerinden istek atılır: ara katman, hız sınırı ve
güvenlik başlıkları dahil.

Korunan kararlar
----------------
* `/api/health` ve `/api/ready` **token istemez**: bu uçları çağıran bir
  kullanıcı değil altyapıdır (Docker sağlık denetimi, yük dengeleyici).
* Sağlık ve hazırlık uçları hız sınırından **muaftır**: saniyede bir soran bir
  denetim sınırlanırsa, sağlıklı bir kapsayıcı ölü sayılıp yeniden başlatılır.
* Geri yükleme hedefi **her zaman** oturumun kiracısıdır; gövdedeki kimliğe
  güvenilseydi bir kullanıcı başka bir organizasyonun verisini ezebilirdi.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.ops_routes import get_metrics
from simulation_engine.api.simulation_service import app, get_rate_limiters
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import get_runtime_manager
from simulation_engine.runtime.audit import AuditAction
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.ops.security import SECURITY_HEADERS
from simulation_engine.runtime.persistence.repository import StoredConnection
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

ORG_A = "ops-org-a"
ORG_B = "ops-org-b"


@pytest.fixture
def manager():
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG_A
    app.dependency_overrides[get_runtime_manager] = lambda: instance

    previous_org = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: ORG_A

    # Hız sınırı sayaçları testler arasında sızmamalı.
    for limiter in get_rate_limiters():
        limiter.reset()

    yield instance

    app.dependency_overrides.pop(get_runtime_manager, None)
    if previous_org is None:
        app.dependency_overrides.pop(get_current_org, None)
    else:
        app.dependency_overrides[get_current_org] = previous_org
    for limiter in get_rate_limiters():
        limiter.reset()


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


def seed(manager: RuntimeManager) -> None:
    manager.repository.save_connection(
        ORG_A,
        StoredConnection(
            connection_id="plc-1",
            kind="opcua",
            label="Torna PLC",
            endpoint="opc.tcp://127.0.0.1:4840",
        ),
    )
    manager.repository.save_snapshot(
        ORG_A,
        MachineSnapshotRecord(
            machine_id="TORNA_01", status="running", production_count=42.0
        ),
    )


class TestSaglikUcu:
    def test_saglik_200_doner(self, client):
        assert client.get("/api/health").status_code == 200

    def test_saglik_durum_bildirir(self, client):
        assert client.get("/api/health").json()["status"] == "ok"

    def test_saglik_surum_bildirir(self, client):
        assert "version" in client.get("/api/health").json()

    def test_saglik_calisma_suresi_bildirir(self, client):
        assert client.get("/api/health").json()["uptime_ms"] >= 0

    def test_saglik_kimlik_istemez(self, client):
        """Docker sağlık denetimi token taşıyamaz."""
        assert client.get("/api/health").status_code == 200

    def test_saglik_is_verisi_dondurmez(self, client):
        payload = client.get("/api/health").json()
        assert set(payload) == {"status", "version", "uptime_ms"}


class TestHazirlikUcu:
    def test_hazirlik_yanit_verir(self, client):
        assert client.get("/api/ready").status_code in (200, 503)

    def test_gelistirmede_hazir(self, client):
        payload = client.get("/api/ready").json()
        assert payload["ready"] is True

    def test_yoklamalari_listeler(self, client):
        names = {item["name"] for item in client.get("/api/ready").json()["checks"]}
        assert names == {"configuration", "database"}

    def test_ortam_adini_bildirir(self, client):
        assert client.get("/api/ready").json()["environment"] == "development"

    def test_uyarilari_tasir(self, client):
        """DATABASE_URL yokken uyarı görünmeli ama hazırlık düşmemeli."""
        payload = client.get("/api/ready").json()
        assert isinstance(payload["warnings"], list)


class TestGuvenlikBasliklari:
    def test_butun_basliklar_eklenir(self, client):
        response = client.get("/api/health")
        for key in SECURITY_HEADERS:
            assert key.lower() in {name.lower() for name in response.headers}

    def test_icerik_turu_tahmini_kapali(self, client):
        assert client.get("/api/health").headers["x-content-type-options"] == "nosniff"

    def test_cerceveleme_kapali(self, client):
        assert client.get("/api/health").headers["x-frame-options"] == "DENY"

    def test_gelistirmede_hsts_yok(self, client):
        assert "strict-transport-security" not in {
            name.lower() for name in client.get("/api/health").headers
        }

    def test_hata_yanitlarinda_da_baslik_var(self, client):
        response = client.get("/api/runtime/status")
        assert response.headers.get("x-content-type-options") == "nosniff"


class TestHizSiniri:
    def test_sinir_asilinca_429(self, client):
        codes = [client.get("/api/runtime/dashboard").status_code for _ in range(60)]
        assert 429 in codes

    def test_429_bekleme_suresi_verir(self, client):
        for _ in range(60):
            response = client.get("/api/runtime/dashboard")
            if response.status_code == 429:
                assert int(response.headers["retry-after"]) >= 1
                return
        pytest.fail("Hiz siniri tetiklenmedi")

    def test_429_aciklama_doner(self, client):
        for _ in range(60):
            response = client.get("/api/runtime/dashboard")
            if response.status_code == 429:
                assert "yeniden deneyin" in response.json()["detail"]
                return
        pytest.fail("Hiz siniri tetiklenmedi")

    def test_saglik_ucu_muaf(self, client):
        """Sınırlanırsa sağlıklı bir kapsayıcı ölü sayılıp yeniden başlatılır."""
        for _ in range(60):
            client.get("/api/runtime/dashboard")
        assert client.get("/api/health").status_code == 200

    def test_hazirlik_ucu_muaf(self, client):
        for _ in range(60):
            client.get("/api/runtime/dashboard")
        assert client.get("/api/ready").status_code in (200, 503)

    def test_yazma_kotasi_daha_dar(self, client):
        """Yazma isteği diske yazar; okuma kadar sık yapılamamalı."""
        write_codes = [
            client.post("/api/runtime/alarms/acknowledge", json={"alarm_id": "yok"}).status_code
            for _ in range(20)
        ]
        assert 429 in write_codes


class TestOlcumUcu:
    def test_olcumler_donulur(self, client):
        payload = client.get("/api/ops/metrics").json()
        assert set(payload) == {
            "process",
            "stream",
            "connections",
            "audit",
            "environment",
        }

    def test_surec_olcumleri_var(self, client):
        payload = client.get("/api/ops/metrics").json()["process"]
        assert payload["uptime_ms"] >= 0

    def test_olculemeyen_alan_null(self, client):
        """`psutil` yoksa bellek uydurulmaz."""
        payload = client.get("/api/ops/metrics").json()["process"]
        assert payload["memory_mb"] is None or payload["memory_mb"] > 0

    def test_akis_olcumleri_var(self, client):
        assert "dispatcher" in client.get("/api/ops/metrics").json()["stream"]

    def test_ortam_raporu_var(self, client):
        assert "ok" in client.get("/api/ops/metrics").json()["environment"]

    def test_ortam_ucu_calisir(self, client):
        assert client.get("/api/ops/environment").json()["environment"] == "development"


class TestYedeklemeUcu:
    def test_yedek_alinir(self, client, manager):
        seed(manager)
        payload = client.post("/api/ops/backup").json()
        assert payload["summary"]["counts"]["connections"] == 1

    def test_yedek_saglama_tasir(self, client, manager):
        seed(manager)
        payload = client.post("/api/ops/backup").json()
        assert payload["backup"]["checksum"]

    def test_yedek_denetime_yazilir(self, client, manager):
        seed(manager)
        client.post("/api/ops/backup")
        actions = [item.action for item in manager.audit.entries(ORG_A)]
        assert AuditAction.BACKUP_CREATED in actions

    def test_dogrulama_ucu_saglami_onaylar(self, client, manager):
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        result = client.post("/api/ops/backup/verify", json=backup).json()
        assert result["ok"] is True

    def test_dogrulama_ucu_bozugu_yakalar(self, client, manager):
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        backup["checksum"] = "bozuk"
        result = client.post("/api/ops/backup/verify", json=backup).json()
        assert result["ok"] is False

    def test_geri_yukleme_calisir(self, client, manager):
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        manager.repository.delete_connection(ORG_A, "plc-1")

        response = client.post("/api/ops/restore", json={"backup": backup})

        assert response.status_code == 200
        assert len(manager.repository.list_connections(ORG_A)) == 1

    def test_bozuk_yedek_400_doner(self, client, manager):
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        backup["checksum"] = "bozuk"
        response = client.post("/api/ops/restore", json={"backup": backup})
        assert response.status_code == 400

    def test_geri_yukleme_denetime_yazilir(self, client, manager):
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        client.post("/api/ops/restore", json={"backup": backup})
        actions = [item.action for item in manager.audit.entries(ORG_A)]
        assert AuditAction.BACKUP_RESTORED in actions

    def test_hedef_kiraci_oturumdan_gelir(self, client, manager):
        """Gövdedeki kimliğe güvenilseydi başka kiracının verisi ezilebilirdi."""
        seed(manager)
        backup = client.post("/api/ops/backup").json()["backup"]
        manager.repository.delete_connection(ORG_A, "plc-1")

        client.post(
            "/api/ops/restore",
            json={"backup": backup, "target_org_id": ORG_B},
        )

        assert len(manager.repository.list_connections(ORG_B)) == 0
        assert len(manager.repository.list_connections(ORG_A)) == 1

    def test_bos_kiracinin_yedegi_alinabilir(self, client):
        payload = client.post("/api/ops/backup").json()
        assert payload["summary"]["total_rows"] == 0


class TestDenetimUcu:
    def test_bos_gunlukte_kayit_yok(self, client):
        payload = client.get("/api/audit").json()
        assert payload["count"] == 0

    def test_kayitlar_donulur(self, client, manager):
        manager.audit.record(ORG_A, AuditAction.CONNECTOR_CONNECT, "plc-1")
        payload = client.get("/api/audit").json()
        assert payload["count"] == 1

    def test_kayit_alanlari_tam(self, client, manager):
        manager.audit.record(
            ORG_A, AuditAction.ALARM_ACKNOWLEDGE, "a1", actor="Ayşe"
        )
        row = client.get("/api/audit").json()["entries"][0]
        assert row["actor"] == "Ayşe"
        assert row["action"] == "alarm_acknowledge"
        assert row["action_label"]

    def test_eyleme_gore_suzulur(self, client, manager):
        manager.audit.record(ORG_A, AuditAction.CONNECTOR_CONNECT, "plc-1")
        manager.audit.record(ORG_A, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        payload = client.get(
            "/api/audit", params={"action": "alarm_acknowledge"}
        ).json()
        assert payload["count"] == 1

    def test_tanimsiz_eylem_400(self, client):
        assert client.get("/api/audit", params={"action": "yok"}).status_code == 400

    def test_sinir_uygulanir(self, client, manager):
        for index in range(10):
            manager.audit.record(ORG_A, AuditAction.CONNECTOR_CONNECT, f"c{index}")
        assert client.get("/api/audit", params={"limit": 3}).json()["count"] == 3

    def test_gecersiz_sinir_reddedilir(self, client):
        assert client.get("/api/audit", params={"limit": 0}).status_code == 422

    def test_ozet_donulur(self, client, manager):
        manager.audit.record(ORG_A, AuditAction.CONNECTOR_CONNECT, "plc-1")
        assert client.get("/api/audit").json()["summary"]["total"] == 1

    def test_silme_ucu_yok(self, client):
        """Değiştirilemezlik: bu uçta silme yoktur."""
        assert client.delete("/api/audit").status_code in (404, 405)

    def test_hassas_alan_yanitta_gizli(self, client, manager):
        manager.audit.record(
            ORG_A,
            AuditAction.CONNECTOR_CONNECT,
            "plc-1",
            details={"password": "gizli"},
        )
        row = client.get("/api/audit").json()["entries"][0]
        assert row["details"]["password"] == "***"


class TestGovdeBoyutu:
    def test_buyuk_govde_413_doner(self, client):
        """Sınırsız gövde, tek istekle belleği doldurmanın en kolay yolu."""
        response = client.post(
            "/api/ops/backup/verify",
            content=b"x" * 10,
            headers={"content-length": str(5 * 1024 * 1024)},
        )
        assert response.status_code == 413
