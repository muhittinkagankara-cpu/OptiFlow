# -*- coding: utf-8 -*-
"""SALES-15 uclarinin HTTP davranisi.

Telemetri trendleri, tanilama, alarm susturma, bakim penceresi ve cihaz
kesfi. Uclarin tamami kiraciyla kapsanir; olculemeyen her alan `null` doner
ve nedeni yaninda yazilir.

Kesif ucu **uydurmaz**: uctan yanit alinamadiginda `ok=false` doner ve `tags`
bos kalir.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.alarms import AlarmRuleId, alarm_id
from simulation_engine.runtime.api import get_discovery_cache, get_runtime_manager
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord
from simulation_engine.runtime.provisioning import DiscoveryCache
from simulation_engine.runtime.telemetry import TelemetryPoint

ORG_A = "sales15-a"
ORG_B = "sales15-b"
SAAT_MS = 3_600_000


def machine(machine_id: str = "TORNA_01", status: str = "down") -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status=status,
        updated_at_ms=int(time.time() * 1000),
    )


@pytest.fixture
def manager():
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG_A
    app.dependency_overrides[get_runtime_manager] = lambda: instance

    previous_org = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: ORG_A

    cache = DiscoveryCache()
    app.dependency_overrides[get_discovery_cache] = lambda: cache

    yield instance

    app.dependency_overrides.pop(get_runtime_manager, None)
    app.dependency_overrides.pop(get_discovery_cache, None)
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


def write_points(manager, org_id: str = ORG_A, count: int = 5) -> int:
    now_ms = int(time.time() * 1000)
    points = [
        TelemetryPoint(
            timestamp_ms=now_ms - index * 60_000,
            device="TORNA_01",
            tag="production_count",
            value=float(index),
            source="plc-1",
        )
        for index in range(count)
    ]
    return manager.repository.write_telemetry(org_id, points)


# ------------------------------------------------------------- telemetri


class TestTelemetriUclari:
    def test_bos_sistemde_etiket_yok(self, client):
        assert client.get("/api/runtime/telemetry/tags").json()["count"] == 0

    def test_yazilan_etiket_gorunur(self, client, manager):
        write_points(manager)
        payload = client.get("/api/runtime/telemetry/tags").json()
        assert payload["tags"][0]["device"] == "TORNA_01"

    def test_baska_kiracinin_etiketi_gorunmez(self, client, manager):
        write_points(manager, ORG_B)
        assert client.get("/api/runtime/telemetry/tags").json()["count"] == 0

    def test_uc_pencere_listelenir(self, client):
        payload = client.get("/api/runtime/telemetry/windows").json()
        assert {item["id"] for item in payload["windows"]} == {"1h", "24h", "7d"}

    def test_pencere_etiketleri_turkce(self, client):
        payload = client.get("/api/runtime/telemetry/windows").json()
        labels = {item["id"]: item["label"] for item in payload["windows"]}
        assert labels["24h"] == "Son 24 saat"

    def test_taninmayan_pencere_400(self, client):
        response = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count", "window": "30d"},
        )
        assert response.status_code == 400

    def test_taninmayan_pencerede_gecerliler_yazilir(self, client):
        response = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count", "window": "30d"},
        )
        assert "1h" in response.json()["detail"]

    def test_bos_seri_veri_yok_der(self, client):
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["has_data"] is False

    def test_bos_seride_ortalama_null(self, client):
        # Sifir donseydi, bos bir grafik "ortalama sifir" diye okunurdu.
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["summary"]["average"] is None

    def test_bos_seride_neden_yazilir(self, client):
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["summary"]["reason"]

    def test_yazilan_veri_trende_duser(self, client, manager):
        write_points(manager)
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["total_points"] == 5

    def test_kaynak_telemetri_olarak_isaretlenir(self, client):
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["origin"] == "telemetry"

    def test_kovalar_pencereyi_kapsar(self, client):
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert len(payload["buckets"]) == 60

    def test_baska_kiracinin_verisi_trende_girmez(self, client, manager):
        write_points(manager, ORG_B)
        payload = client.get(
            "/api/runtime/telemetry/trend",
            params={"device": "TORNA_01", "tag": "production_count"},
        ).json()
        assert payload["total_points"] == 0

    def test_temizlik_ucu_calisir(self, client):
        assert client.post("/api/runtime/telemetry/cleanup").status_code == 200

    def test_temizlik_silinen_sayisini_bildirir(self, client):
        assert client.post("/api/runtime/telemetry/cleanup").json()["deleted"] == 0

    def test_temizlik_kesim_anini_bildirir(self, client):
        assert client.post("/api/runtime/telemetry/cleanup").json()["cutoff_ms"] > 0


# -------------------------------------------------------------- tanilama


class TestTanilamaUcu:
    def test_tanilama_okunur(self, client):
        assert client.get("/api/runtime/diagnostics").status_code == 200

    def test_sekiz_olcut(self, client):
        assert client.get("/api/runtime/diagnostics").json()["metric_count"] == 8

    def test_olculmeyen_olcut_null(self, client):
        payload = client.get("/api/runtime/diagnostics").json()
        unmeasured = [item for item in payload["metrics"] if not item["measured"]]
        assert all(item["value"] is None for item in unmeasured)

    def test_olculmeyen_olcut_neden_tasir(self, client):
        payload = client.get("/api/runtime/diagnostics").json()
        unmeasured = [item for item in payload["metrics"] if not item["measured"]]
        assert all(item["reason"] for item in unmeasured)

    def test_kalicilik_modu_bildirilir(self, client):
        assert client.get("/api/runtime/diagnostics").json()["persistence_mode"] in {
            "memory",
            "database",
        }

    def test_bos_tabloda_en_eski_null(self, client):
        assert client.get("/api/runtime/diagnostics").json()["oldest_telemetry_ms"] is None

    def test_satir_sayisi_bildirilir(self, client, manager):
        write_points(manager)
        assert client.get("/api/runtime/diagnostics").json()["telemetry_rows"] == 5

    def test_temizlik_sayaclari_raporda(self, client):
        assert "policy" in client.get("/api/runtime/diagnostics").json()["cleanup"]

    def test_kesintisizlik_ucu(self, client):
        assert client.get("/api/runtime/continuity").json()["streams"] == []

    def test_kesintisizlik_ani_bildirir(self, client):
        assert client.get("/api/runtime/continuity").json()["at_ms"] > 0


# ------------------------------------------------------- alarm susturma


class TestSusturmaUcu:
    def _raise_alarm(self, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = machine()
        manager.evaluate_monitoring(ORG_A)
        return alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")

    def test_olmayan_alarm_404(self, client):
        response = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": "yok", "by": "operator"},
        )
        assert response.status_code == 404

    def test_alarm_susturulur(self, client, manager):
        identifier = self._raise_alarm(manager)
        response = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator"},
        )
        assert response.json()["state"] == "SILENCED"

    def test_susturan_kisi_yanitta(self, client, manager):
        identifier = self._raise_alarm(manager)
        payload = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "ayse"},
        ).json()
        assert payload["silenced_by"] == "ayse"

    def test_susturma_bitisi_yazilir(self, client, manager):
        identifier = self._raise_alarm(manager)
        payload = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator", "duration_ms": 60_000},
        ).json()
        assert payload["silenced_until_ms"] is not None

    def test_susturma_neden_tasir(self, client, manager):
        identifier = self._raise_alarm(manager)
        payload = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator", "reason": "Bakım"},
        ).json()
        assert payload["silence_reason"] == "Bakım"

    def test_sifir_sure_reddedilir(self, client, manager):
        # Suresiz susturma yoktur; sifir sure gecerli bir istek degildir.
        identifier = self._raise_alarm(manager)
        response = client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator", "duration_ms": 0},
        )
        assert response.status_code == 422

    def test_susturulmus_alarm_etkin_kalir(self, client, manager):
        identifier = self._raise_alarm(manager)
        client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator"},
        )
        assert client.get("/api/runtime/alarms").json()["counts"]["silenced"] == 1

    def test_geri_alma(self, client, manager):
        identifier = self._raise_alarm(manager)
        client.post(
            "/api/runtime/alarms/silence",
            json={"alarm_id": identifier, "by": "operator"},
        )
        payload = client.post(
            "/api/runtime/alarms/unsilence", json={"alarm_id": identifier}
        ).json()
        assert payload["state"] == "OPEN"

    def test_susturulmamis_alarm_geri_alinamaz(self, client, manager):
        identifier = self._raise_alarm(manager)
        response = client.post(
            "/api/runtime/alarms/unsilence", json={"alarm_id": identifier}
        )
        assert response.status_code == 404


class TestBakimUcu:
    def test_bos_sistemde_pencere_yok(self, client):
        assert client.get("/api/runtime/maintenance").json()["windows"] == []

    def test_pencere_acilir(self, client):
        now_ms = int(time.time() * 1000)
        response = client.post(
            "/api/runtime/maintenance",
            json={"subject": "TORNA_01", "start_ms": now_ms, "end_ms": now_ms + SAAT_MS},
        )
        assert response.json()["subject"] == "TORNA_01"

    def test_ters_pencere_reddedilir(self, client):
        now_ms = int(time.time() * 1000)
        response = client.post(
            "/api/runtime/maintenance",
            json={"subject": "TORNA_01", "start_ms": now_ms, "end_ms": now_ms - 1},
        )
        assert response.status_code == 400

    def test_acik_pencere_listelenir(self, client):
        now_ms = int(time.time() * 1000)
        client.post(
            "/api/runtime/maintenance",
            json={"subject": "TORNA_01", "start_ms": now_ms, "end_ms": now_ms + SAAT_MS},
        )
        assert len(client.get("/api/runtime/maintenance").json()["windows"]) == 1

    def test_bakim_alarmi_susturur(self, client, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = machine()
        manager.evaluate_monitoring(ORG_A)
        now_ms = int(time.time() * 1000)
        client.post(
            "/api/runtime/maintenance",
            json={"subject": "TORNA_01", "start_ms": now_ms, "end_ms": now_ms + SAAT_MS},
        )
        assert client.get("/api/runtime/alarms").json()["counts"]["silenced"] == 1

    def test_pencere_kapatilir(self, client):
        now_ms = int(time.time() * 1000)
        client.post(
            "/api/runtime/maintenance",
            json={"subject": "TORNA_01", "start_ms": now_ms, "end_ms": now_ms + SAAT_MS},
        )
        assert client.delete("/api/runtime/maintenance/TORNA_01").json()["closed"] is True

    def test_olmayan_pencere_kapatilamaz(self, client):
        assert client.delete("/api/runtime/maintenance/YOK").json()["closed"] is False


# ------------------------------------------------------------ devreye alma


class TestDevreyeAlmaUcu:
    def test_adimlar_listelenir(self, client):
        payload = client.get("/api/runtime/provisioning/steps").json()
        assert [item["id"] for item in payload["steps"]] == [
            "endpoint",
            "discovery",
            "tags",
            "mapping",
            "test",
            "save",
        ]

    def test_adim_etiketleri_turkce(self, client):
        payload = client.get("/api/runtime/provisioning/steps").json()
        labels = {item["id"]: item["label"] for item in payload["steps"]}
        assert labels["discovery"] == "Keşif"

    def test_ulasilamayan_uc_basarisiz(self, client):
        # Gercek bir ag denemesi: 127.0.0.1:9 kapali bir kapidir.
        payload = client.post(
            "/api/runtime/provisioning/discover",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["ok"] is False

    def test_basarisiz_kesifte_etiket_yok(self, client):
        # Ornek uretilseydi, kullanici olmayan bir dugumu eslerdi.
        payload = client.post(
            "/api/runtime/provisioning/discover",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["tags"] == []

    def test_basarisiz_kesifte_neden_yazilir(self, client):
        payload = client.post(
            "/api/runtime/provisioning/discover",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["detail"]

    def test_basarisiz_kesifte_parmak_izi_yok(self, client):
        payload = client.post(
            "/api/runtime/provisioning/discover",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["fingerprint"] is None

    def test_gecersiz_uc_reddedilir(self, client):
        payload = client.post(
            "/api/runtime/provisioning/discover",
            json={"kind": "rest", "endpoint": "ftp://x", "timeout_ms": 500},
        ).json()
        assert payload["ok"] is False

    def test_bos_uc_422(self, client):
        response = client.post(
            "/api/runtime/provisioning/discover",
            json={"kind": "rest", "endpoint": ""},
        )
        assert response.status_code == 422

    def test_surucusuz_kimlik_denemesi(self, client):
        # Bu testte yonetici surucusuz kuruldu; deneme yapilamaz ve bu yazilir.
        payload = client.post(
            "/api/runtime/provisioning/test",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["ok"] is False

    def test_surucusuz_denemede_gecikme_null(self, client):
        payload = client.post(
            "/api/runtime/provisioning/test",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "timeout_ms": 500,
            },
        ).json()
        assert payload["latency_ms"] is None

    def test_kimlik_denemesinde_parola_donmez(self, client):
        payload = client.post(
            "/api/runtime/provisioning/test",
            json={
                "kind": "rest",
                "endpoint": "http://127.0.0.1:9/veri",
                "username": "opc",
                "password": "gizli",
                "timeout_ms": 500,
            },
        ).json()
        assert "password" not in payload and "gizli" not in str(payload)


class TestKiraciKapsami:
    def test_baska_kiraci_kendi_etiketlerini_gorur(self, client, manager):
        write_points(manager, ORG_B)
        with as_org(ORG_B):
            assert client.get("/api/runtime/telemetry/tags").json()["count"] == 1

    def test_baska_kiraci_tanilamayi_okur(self, client):
        with as_org(ORG_B):
            assert client.get("/api/runtime/diagnostics").status_code == 200

    def test_baska_kiracinin_satir_sayisi_ayri(self, client, manager):
        write_points(manager, ORG_A)
        with as_org(ORG_B):
            assert client.get("/api/runtime/diagnostics").json()["telemetry_rows"] == 0
