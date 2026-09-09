"""Canlı akış uçlarının HTTP davranışı.

`/live/stream` yalnızca üretim ekranının anladığı dört olayı yayar:
`device_data`, `alarm`, `oee_update`, `production_update`. Bütün runtime
olaylarını yayan `/stream`'den ayrı olmasının nedeni gürültüdür: Live
Factory'nin her bağlantı denemesini işlemesi gereksiz, her tanılama satırını
çizmesi ise zararlıdır.

Kiracı yalıtımı burada da sürer: bir organizasyon başka bir organizasyonun
cihaz ölçümünü göremez.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import (
    LIVE_EVENT_KINDS,
    get_runtime_manager,
    live_event_stream,
    runtime_live_stream,
)
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.pipeline.device_events import DeviceEvent, Metric, Quality
from simulation_engine.runtime.stream.types import DeviceDataEvent, SourceProtocol
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

ORG_A = "akis-api-a"
ORG_B = "akis-api-b"
NOW = 4_000_000


def spec(connection_id: str = "c1") -> ConnectionSpec:
    return ConnectionSpec(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label="TORNA_01",
        endpoint="http://127.0.0.1:9/veri",
    )


def measurement(value=100, connection_id: str = "c1") -> DeviceEvent:
    return DeviceEvent(
        connection_id=connection_id,
        machine_id="TORNA_01",
        metric=Metric.PRODUCTION_COUNT,
        value=value,
        at_ms=NOW,
        source=ConnectionKind.REST,
    )


def data_event(sequence: int = 1, connection_id: str = "c1", **overrides):
    defaults = {
        "connector_id": connection_id,
        "machine_id": "TORNA_01",
        "field": "production_count",
        "value": 100,
        "timestamp": NOW,
        "source_protocol": SourceProtocol.REST,
        "quality": Quality.GOOD,
        "sequence": sequence,
        "device_event": measurement(connection_id=connection_id),
    }
    defaults.update(overrides)
    return DeviceDataEvent(**defaults)


@pytest.fixture
def manager():
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG_A
    app.dependency_overrides[get_runtime_manager] = lambda: instance

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


class FakeRequest:
    """Bağlantısı belirli sayıda okumadan sonra kopan istemci."""

    def __init__(self, disconnect_after: int = 5):
        self.disconnect_after = disconnect_after
        self.calls = 0

    async def is_disconnected(self) -> bool:
        self.calls += 1
        return self.calls > self.disconnect_after


class TestCanliAkisSozlesmesi:
    def test_dort_olay_turu_yayilir(self):
        assert LIVE_EVENT_KINDS == {
            "device_data",
            "alarm",
            "oee_update",
            "production_update",
        }

    def test_yanit_sse_icerik_turu(self, manager):
        response = asyncio.run(
            runtime_live_stream(FakeRequest(), org_id=ORG_A, manager=manager)
        )
        assert response.media_type == "text/event-stream"

    def test_tamponlama_kapatilir(self, manager):
        """Araya giren vekil sunucu tamponlarsa olaylar dakikalarca gecikir."""
        response = asyncio.run(
            runtime_live_stream(FakeRequest(), org_id=ORG_A, manager=manager)
        )
        assert response.headers["x-accel-buffering"] == "no"
        assert response.headers["cache-control"] == "no-cache"

    def test_baglanti_canli_tutulur(self, manager):
        response = asyncio.run(
            runtime_live_stream(FakeRequest(), org_id=ORG_A, manager=manager)
        )
        assert response.headers["connection"] == "keep-alive"


class TestCanliAkisIcerigi:
    def test_akis_acilis_yorumuyla_baslar(self, manager):
        async def senaryo():
            stream = live_event_stream(FakeRequest(), manager, ORG_A)
            first = await stream.__anext__()
            await stream.aclose()
            return first

        assert asyncio.run(senaryo()).startswith(":")

    def test_cihaz_olcumu_iletilir(self, manager):
        async def senaryo():
            manager.register(ORG_A, spec())
            stream = live_event_stream(FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.stream.dispatcher.dispatch(data_event(), NOW)
            frame = await stream.__anext__()
            await stream.aclose()
            return frame

        frame = asyncio.run(senaryo())
        assert "device_data" in frame

    def test_olcum_yuku_sira_numarasi_tasir(self, manager):
        async def senaryo():
            manager.register(ORG_A, spec())
            stream = live_event_stream(FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.stream.dispatcher.dispatch(data_event(sequence=7), NOW)
            frame = await stream.__anext__()
            await stream.aclose()
            return frame

        frame = asyncio.run(senaryo())
        payload = json.loads(
            [line for line in frame.splitlines() if line.startswith("data:")][0][5:]
        )
        assert payload["data"]["sequence"] == 7

    def test_ilgisiz_olay_iletilmez(self, manager):
        """`probe` gibi olaylar üretim ekranını ilgilendirmez."""

        async def senaryo():
            manager.register(ORG_A, spec())
            stream = live_event_stream(FakeRequest(disconnect_after=2), manager, ORG_A)
            await stream.__anext__()
            manager.dispatcher.emit("c1", "probe", "cihaz yanit verdi")
            frames = []
            try:
                async for frame in stream:
                    frames.append(frame)
            except (StopAsyncIteration, RuntimeError):
                pass
            return frames

        frames = asyncio.run(senaryo())
        assert all("probe" not in frame for frame in frames)

    def test_baska_kiracinin_olcumu_iletilmez(self, manager):
        async def senaryo():
            manager.register(ORG_B, spec("baska"))
            stream = live_event_stream(FakeRequest(disconnect_after=2), manager, ORG_A)
            await stream.__anext__()
            manager.stream.dispatcher.dispatch(
                data_event(connection_id="baska"), NOW
            )
            frames = []
            try:
                async for frame in stream:
                    frames.append(frame)
            except (StopAsyncIteration, RuntimeError):
                pass
            return frames

        frames = asyncio.run(senaryo())
        assert all("device_data" not in frame for frame in frames)

    def test_hat_geneli_olaylar_kiraci_suzgecine_takilmaz(self, manager):
        """Alarm ve OEE tek bir cihazdan değil, hattın tamamından çıkar."""

        async def senaryo():
            stream = live_event_stream(FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.dispatcher.emit("runtime", "oee_update", "OEE tazelendi")
            frame = await stream.__anext__()
            await stream.aclose()
            return frame

        assert "oee_update" in asyncio.run(senaryo())

    def test_sessizlikte_kalp_atisi_gonderilir(self, manager):
        async def senaryo():
            import simulation_engine.runtime.api as api

            previous = api.HEARTBEAT_SECONDS
            api.HEARTBEAT_SECONDS = 0.01
            try:
                stream = live_event_stream(FakeRequest(), manager, ORG_A)
                await stream.__anext__()
                second = await stream.__anext__()
                await stream.aclose()
                return second
            finally:
                api.HEARTBEAT_SECONDS = previous

        assert asyncio.run(senaryo()).startswith(":")

    def test_akis_kapaninca_abone_silinir(self, manager):
        async def senaryo():
            stream = live_event_stream(FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            await stream.aclose()
            return manager.dispatcher.subscriber_count

        assert asyncio.run(senaryo()) == 0


class TestCihazVerisiUcu:
    def test_bos_sistemde_olcum_yok(self, client):
        payload = client.get("/api/runtime/device-data").json()
        assert payload["events"] == []
        assert payload["count"] == 0

    def test_kayitli_baglantinin_olcumu_gorunur(self, client, manager):
        manager.register(ORG_A, spec())
        manager.stream.dispatcher.dispatch(data_event(), NOW)
        payload = client.get("/api/runtime/device-data").json()
        assert payload["count"] == 1

    def test_olcum_alanlari_tam(self, client, manager):
        manager.register(ORG_A, spec())
        manager.stream.dispatcher.dispatch(data_event(), NOW)
        row = client.get("/api/runtime/device-data").json()["events"][0]
        assert row["field"] == "production_count"
        assert row["source_protocol"] == "rest"
        assert row["sequence"] == 1

    def test_baska_kiracinin_olcumu_gizli(self, client, manager):
        manager.register(ORG_B, spec("baska"))
        manager.stream.dispatcher.dispatch(data_event(connection_id="baska"), NOW)
        with as_org(ORG_A):
            payload = client.get("/api/runtime/device-data").json()
        assert payload["count"] == 0

    def test_sinir_uygulanir(self, client, manager):
        manager.register(ORG_A, spec())
        for sequence in range(10):
            manager.stream.dispatcher.dispatch(data_event(sequence + 1), NOW)
        payload = client.get("/api/runtime/device-data", params={"limit": 3}).json()
        assert payload["count"] == 3

    def test_gecersiz_sinir_reddedilir(self, client):
        assert client.get("/api/runtime/device-data", params={"limit": 0}).status_code == 422

    def test_ust_sinir_asilamaz(self, client):
        assert (
            client.get("/api/runtime/device-data", params={"limit": 5_000}).status_code
            == 422
        )

    def test_en_yeni_olcum_once_gelir(self, client, manager):
        manager.register(ORG_A, spec())
        manager.stream.dispatcher.dispatch(data_event(1), NOW)
        manager.stream.dispatcher.dispatch(data_event(2), NOW)
        rows = client.get("/api/runtime/device-data").json()["events"]
        assert rows[0]["sequence"] == 2


class TestAkisIstatistikleriUcu:
    def test_bos_sistemde_akis_yok(self, client):
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["streams"] == 0
        assert payload["health"] == "stopped"

    def test_yoklama_sikligi_olculmemisse_null(self, client):
        """Sıfır dönmek, REST bağlantısı olmayan kurulumu yanlış anlatırdı."""
        assert client.get("/api/runtime/stream-stats").json()["poll_rate_hz"] is None

    def test_olay_hizi_olculmemisse_null(self, client):
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["dispatcher"]["events_per_second"] is None

    def test_kuyruk_derinligi_bildirilir(self, client):
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["dispatcher"]["queue"]["depth"] == 0

    def test_kuyruk_siniri_bildirilir(self, client):
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["dispatcher"]["queue"]["capacity"] == 1_000

    def test_islenen_olay_sayilir(self, client, manager):
        manager.stream.dispatcher.dispatch(data_event(), NOW)
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["dispatcher"]["processed"] == 1

    def test_yineleme_sayilir(self, client, manager):
        manager.stream.dispatcher.dispatch(data_event(1), NOW)
        manager.stream.dispatcher.submit(data_event(1))
        payload = client.get("/api/runtime/stream-stats").json()
        assert payload["dispatcher"]["duplicates"] == 1

    def test_alicilar_listelenir(self, client):
        payload = client.get("/api/runtime/stream-stats").json()
        names = {item["name"] for item in payload["dispatcher"]["sinks"]}
        assert names == {"snapshot", "monitoring", "broadcast"}


class TestPanoAkisKartlari:
    def test_pano_akis_bolumu_tasir(self, client):
        payload = client.get("/api/runtime/dashboard").json()
        assert "stream" in payload

    def test_pano_kuyruk_derinligini_gosterir(self, client):
        payload = client.get("/api/runtime/dashboard").json()
        assert payload["stream"]["dispatcher"]["queue"]["depth"] == 0

    def test_pano_akis_sagligini_gosterir(self, client):
        payload = client.get("/api/runtime/dashboard").json()
        assert payload["stream"]["health"] == "stopped"

    def test_eski_akis_ucu_hala_calisir(self, client):
        """`/stream` bütün runtime olaylarını yaymayı sürdürür."""
        from simulation_engine.runtime.api import runtime_stream

        response = asyncio.run(
            runtime_stream(FakeRequest(), org_id=ORG_A, manager=None)
        )
        assert response.media_type == "text/event-stream"

    def test_canli_json_ucu_korunur(self, client):
        """`/live` anlık durumu döndürmeyi sürdürür; SSE ayrı uçtadır."""
        payload = client.get("/api/runtime/live").json()
        assert "runtime_kpi" in payload
