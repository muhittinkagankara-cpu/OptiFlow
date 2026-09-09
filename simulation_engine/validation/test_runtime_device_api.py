"""Cihaz verisi uçları: abonelik, akış durumu ve Data Explorer."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import get_runtime_manager
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    Metric,
    PipelineProblem,
)
from simulation_engine.runtime.types import ConnectionKind, ProbeResult

ORG_B = "cihaz-org-b"


class FakeAdapter:
    kind = "fake"

    async def probe(self, spec):
        return ProbeResult(
            ok=True,
            latency_ms=4.0,
            detail="uc yanit verdi",
            evidence="ns=2;i=2 = 1240",
            bytes_received=8,
        )


@pytest.fixture
def manager():
    adapter = FakeAdapter()
    instance = RuntimeManager(
        adapters={
            ConnectionKind.REST: adapter,
            ConnectionKind.OPCUA: adapter,
            ConnectionKind.MQTT: adapter,
        },
        sleep=lambda seconds: asyncio.sleep(0),
    )
    app.dependency_overrides[get_runtime_manager] = lambda: instance
    yield instance
    app.dependency_overrides.pop(get_runtime_manager, None)


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


def connect(client, connection_id="plc-1", kind="opcua"):
    return client.post(
        "/api/runtime/connect",
        json={
            "connection_id": connection_id,
            "kind": kind,
            "label": "Hat 1 PLC",
            "endpoint": "opc.tcp://127.0.0.1:4840/optiflow/"
            if kind == "opcua"
            else "http://127.0.0.1:9/veri",
            "topics": ["ns=2;i=2"] if kind == "opcua" else [],
            "max_retries": 0,
        },
    )


def device_event(machine="TORNA_01", value=1240, connection_id="plc-1", at_ms=1_000):
    return DeviceEvent(
        connection_id=connection_id,
        machine_id=machine,
        metric=Metric.PRODUCTION_COUNT,
        value=value,
        at_ms=at_ms,
        source=ConnectionKind.OPCUA,
    )


class TestSubscribeEndpoint:
    def test_olmayan_baglanti_dort_yuz_dort(self, client):
        response = client.post("/api/runtime/subscribe", json={"connection_id": "yok"})
        assert response.status_code == 404

    def test_dogrulanmamis_baglantida_akis_acilmaz(self, client, manager):
        # Hic yanit vermemis bir cihazi dinlemeye almak, ekranda "akis
        # calisiyor" yazip hicbir veri gostermemek olurdu.
        manager.register("test-org-00000000000000000000000000", _spec("ham"))
        response = client.post("/api/runtime/subscribe", json={"connection_id": "ham"})
        assert response.status_code == 200
        assert response.json()["started"] is False
        assert "doğrulanmadı" in response.json()["reason"]

    def test_dogrulanmis_baglantida_akis_denenir(self, client):
        connect(client)
        response = client.post("/api/runtime/subscribe", json={"connection_id": "plc-1"})
        assert response.status_code == 200
        assert "started" in response.json()

    def test_esleme_tablosu_kaydedilir(self, client, manager):
        connect(client)
        client.post(
            "/api/runtime/subscribe",
            json={
                "connection_id": "plc-1",
                "mapping": [
                    {
                        "origin": "ns=2;i=2",
                        "machine_id": "TORNA_01",
                        "metric": "production_count",
                    }
                ],
            },
        )
        table = manager.mapping_for("plc-1")
        assert table is not None
        assert table.entries[0].machine_id == "TORNA_01"

    def test_bilinen_makineler_kaydedilir(self, client, manager):
        connect(client)
        client.post(
            "/api/runtime/subscribe",
            json={"connection_id": "plc-1", "known_machine_ids": ["torna_01"]},
        )
        assert manager.devices.known_machine_ids == ["torna_01"]

    def test_gecersiz_olcum_reddedilir(self, client):
        connect(client)
        response = client.post(
            "/api/runtime/subscribe",
            json={
                "connection_id": "plc-1",
                "mapping": [
                    {"origin": "a", "machine_id": "b", "metric": "sicaklik"}
                ],
            },
        )
        assert response.status_code == 422

    def test_cok_kisa_aralik_reddedilir(self, client):
        connect(client)
        response = client.post(
            "/api/runtime/subscribe", json={"connection_id": "plc-1", "interval_ms": 5}
        )
        assert response.status_code == 422

    def test_yanit_akis_durumlarini_tasir(self, client):
        connect(client)
        payload = client.post(
            "/api/runtime/subscribe", json={"connection_id": "plc-1"}
        ).json()
        assert "streams" in payload


class TestUnsubscribeEndpoint:
    def test_olmayan_baglanti_dort_yuz_dort(self, client):
        response = client.post("/api/runtime/unsubscribe", json={"connection_id": "yok"})
        assert response.status_code == 404

    def test_acik_akis_yoksa_bildirilir(self, client):
        connect(client)
        payload = client.post(
            "/api/runtime/unsubscribe", json={"connection_id": "plc-1"}
        ).json()
        assert payload["stopped"] is False
        assert "açık bir akış yok" in payload["reason"]


class TestDevicesEndpoint:
    def test_bos_durumda_olay_yok(self, client):
        payload = client.get("/api/runtime/devices").json()
        assert payload["events"] == []
        assert payload["machines"] == []

    def test_bos_durumda_uretim_none(self, client):
        # Hic olcum yoksa uretim toplami sifir degil, bilinmiyordur.
        assert client.get("/api/runtime/devices").json()["summary"]["production_count"] is None

    def test_cihaz_olaylari_gorunur(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event()])
        payload = client.get("/api/runtime/devices").json()
        assert len(payload["events"]) == 1
        assert payload["events"][0]["machine_id"] == "TORNA_01"

    def test_makine_goruntuleri_gorunur(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event()])
        machines = client.get("/api/runtime/devices").json()["machines"]
        assert machines[0]["production_count"] == 1240

    def test_olculmeyen_alan_null_doner(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event()])
        machine = client.get("/api/runtime/devices").json()["machines"][0]
        assert machine["queue_length"] is None
        assert machine["throughput_per_hour"] is None

    def test_tanilama_kayitlari_gorunur(self, client, manager):
        connect(client)
        manager.devices.record_problem(
            PipelineProblem(connection_id="plc-1", reason="bozuk yük", at_ms=1)
        )
        payload = client.get("/api/runtime/devices").json()
        assert payload["problems"][0]["reason"] == "bozuk yük"

    def test_esleme_uyarilari_gorunur(self, client, manager):
        connect(client)
        manager.devices.known_machine_ids = ["kaynak"]
        manager.devices.dispatch([device_event()])
        payload = client.get("/api/runtime/devices").json()
        assert len(payload["mapping_warnings"]) == 1

    def test_sinir_uygulanir(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event(at_ms=i) for i in range(10)])
        payload = client.get("/api/runtime/devices?limit=3").json()
        assert len(payload["events"]) == 3

    def test_gecersiz_sinir_reddedilir(self, client):
        assert client.get("/api/runtime/devices?limit=0").status_code == 422

    def test_olmayan_baglanti_dort_yuz_dort(self, client):
        assert client.get("/api/runtime/devices?connection_id=yok").status_code == 404

    def test_baska_organizasyonun_olaylari_gorunmez(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event()])
        with as_org(ORG_B):
            payload = client.get("/api/runtime/devices").json()
        assert payload["events"] == []

    def test_baska_organizasyonun_kimligi_dort_yuz_dort(self, client):
        connect(client)
        with as_org(ORG_B):
            response = client.get("/api/runtime/devices?connection_id=plc-1")
        assert response.status_code == 404


class TestDeviceEventsInStream:
    def test_cihaz_olayi_sse_tamponuna_duser(self, client, manager):
        connect(client)
        manager.devices.dispatch([device_event()])
        events = client.get("/api/runtime/events").json()["events"]
        kinds = [event["kind"] for event in events]
        assert "device_data" in kinds

    def test_cihaz_olayi_replay_edilebilir(self, client, manager):
        # Backend tamponu artik gercek cihaz olaylarini da sakliyor.
        connect(client)
        manager.devices.dispatch([device_event(value=99)])
        events = client.get("/api/runtime/events?since=0").json()["events"]
        device = [event for event in events if event["kind"] == "device_data"][0]
        assert device["data"]["value"] == 99

    def test_tanilama_olayi_akista_gorunur(self, client, manager):
        connect(client)
        manager.devices.record_problem(
            PipelineProblem(connection_id="plc-1", reason="bozuk", at_ms=1)
        )
        events = client.get("/api/runtime/events").json()["events"]
        assert "diagnostic" in [event["kind"] for event in events]

    def test_tum_uclar_kayitli(self):
        paths = {p for p in app.openapi()["paths"] if p.startswith("/api/runtime")}
        assert "/api/runtime/subscribe" in paths
        assert "/api/runtime/unsubscribe" in paths
        assert "/api/runtime/devices" in paths


def _spec(connection_id: str):
    from simulation_engine.runtime.types import ConnectionSpec

    return ConnectionSpec(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label=connection_id,
        endpoint="http://127.0.0.1:9/veri",
    )
