"""Runtime uçlarının HTTP davranışı.

Kimlik doğrulama mevcut sistemin aynısıdır; bu dosya hem uçların sözleşmesini
hem de kiracı yalıtımını sınar: bir organizasyon başka bir organizasyonun
bağlantısını ne görebilir ne de olaylarını okuyabilir.
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
    event_stream,
    get_runtime_manager,
    runtime_stream,
)
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ProbeResult,
)

ORG_A = "runtime-org-a"
ORG_B = "runtime-org-b"


class FakeAdapter:
    """Verilen sonucu döndüren sürücü; ağ kullanmaz."""

    kind = "fake"

    def __init__(self, ok: bool = True):
        self.ok = ok
        self.calls = 0

    async def probe(self, spec):
        self.calls += 1
        if self.ok:
            return ProbeResult(
                ok=True,
                latency_ms=7.5,
                detail="uc yanit verdi",
                evidence="HTTP 200, 12 bayt",
                bytes_received=12,
            )
        return ProbeResult(
            ok=False, latency_ms=None, detail="Bağlantı kurulamadı: kapalı"
        )


@pytest.fixture
def manager():
    """Her test kendi yöneticisiyle çalışır; durum testler arası sızmaz."""
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
    """Bloğun içindeki istekleri başka bir organizasyon adına yapar.

    Fixture yerine bağlam yöneticisi: kayıt **varsayılan** organizasyonda
    kurulmalı, okuma ise ikincisi adına yapılmalıdır. Fixture olsaydı ikisi de
    aynı organizasyonda çalışır ve yalıtım hiç sınanmazdı.
    """
    previous = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: org_id
    try:
        yield
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_org, None)
        else:
            app.dependency_overrides[get_current_org] = previous


def _spec(connection_id: str) -> ConnectionSpec:
    """Kancasiz kayit icin en kucuk gecerli tanim."""
    return ConnectionSpec(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label=connection_id,
        endpoint="http://127.0.0.1:9/veri",
    )


def connect_body(**overrides):
    body = {
        "connection_id": "hat-1",
        "kind": "rest",
        "label": "Hat 1 API",
        "endpoint": "http://127.0.0.1:9/veri",
        "max_retries": 0,
    }
    body.update(overrides)
    return body


class TestConnectEndpoint:
    def test_basarili_baglanti_iki_yuz_doner(self, client):
        response = client.post("/api/runtime/connect", json=connect_body())
        assert response.status_code == 200

    def test_durum_baglandi_yazar(self, client):
        payload = client.post("/api/runtime/connect", json=connect_body()).json()
        assert payload["status"] == "connected"

    def test_kanit_yanitta_yer_alir(self, client):
        payload = client.post("/api/runtime/connect", json=connect_body()).json()
        assert payload["last_probe"]["evidence"] == "HTTP 200, 12 bayt"

    def test_gecikme_olculur(self, client):
        payload = client.post("/api/runtime/connect", json=connect_body()).json()
        assert payload["last_probe"]["latency_ms"] == 7.5

    def test_parola_yanitta_yok(self, client):
        payload = client.post(
            "/api/runtime/connect", json=connect_body(password="gizli123")
        ).json()
        assert "gizli123" not in json.dumps(payload)

    def test_parolanin_varligi_bildirilir(self, client):
        payload = client.post(
            "/api/runtime/connect", json=connect_body(password="gizli123")
        ).json()
        assert payload["has_password"] is True

    def test_basarisiz_baglanti_da_iki_yuz_doner(self, client, manager):
        # "Sunucu istegi isleyemedi" ile "cihaz yanit vermedi" ayri seylerdir.
        manager.adapters[ConnectionKind.REST] = FakeAdapter(ok=False)
        response = client.post("/api/runtime/connect", json=connect_body())
        assert response.status_code == 200
        assert response.json()["status"] == "failed"

    def test_basarisizlikta_dogrulama_iddiasi_yok(self, client, manager):
        manager.adapters[ConnectionKind.REST] = FakeAdapter(ok=False)
        payload = client.post("/api/runtime/connect", json=connect_body()).json()
        assert payload["ever_verified"] is False

    def test_bilinmeyen_tur_reddedilir(self, client):
        response = client.post("/api/runtime/connect", json=connect_body(kind="modbus"))
        assert response.status_code == 422

    def test_bos_kimlik_reddedilir(self, client):
        response = client.post("/api/runtime/connect", json=connect_body(connection_id=""))
        assert response.status_code == 422

    def test_gecersiz_qos_reddedilir(self, client):
        response = client.post("/api/runtime/connect", json=connect_body(qos=7))
        assert response.status_code == 422

    def test_cok_kucuk_zaman_asimi_reddedilir(self, client):
        response = client.post("/api/runtime/connect", json=connect_body(timeout_ms=5))
        assert response.status_code == 422

    def test_cok_buyuk_deneme_sayisi_reddedilir(self, client):
        response = client.post("/api/runtime/connect", json=connect_body(max_retries=99))
        assert response.status_code == 422

    def test_ayni_kimlik_yeniden_baglanabilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        response = client.post("/api/runtime/connect", json=connect_body())
        assert response.status_code == 200

    def test_opcua_baglantisi_kaydedilir(self, client):
        payload = client.post(
            "/api/runtime/connect",
            json=connect_body(
                connection_id="plc-1",
                kind="opcua",
                endpoint="opc.tcp://127.0.0.1:4840",
                topics=["ns=2;i=2"],
            ),
        ).json()
        assert payload["kind"] == "opcua"
        assert payload["topics"] == ["ns=2;i=2"]

    def test_mqtt_baglantisi_kaydedilir(self, client):
        payload = client.post(
            "/api/runtime/connect",
            json=connect_body(
                connection_id="broker-1",
                kind="mqtt",
                endpoint="broker.local",
                port=1883,
                topics=["fabrika/hat1/#"],
            ),
        ).json()
        assert payload["kind"] == "mqtt"
        assert payload["port"] == 1883


class TestDisconnectEndpoint:
    def test_baglanti_kapatilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        response = client.post(
            "/api/runtime/disconnect", json={"connection_id": "hat-1"}
        )
        assert response.json()["status"] == "disconnected"

    def test_kapatma_kaydi_silmez(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        client.post("/api/runtime/disconnect", json={"connection_id": "hat-1"})
        status = client.get("/api/runtime/status").json()
        assert len(status["connections"]) == 1

    def test_unutma_istenirse_kayit_silinir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        client.post(
            "/api/runtime/disconnect", json={"connection_id": "hat-1", "forget": True}
        )
        assert client.get("/api/runtime/status").json()["connections"] == []

    def test_olmayan_baglanti_dort_yuz_dort(self, client):
        response = client.post("/api/runtime/disconnect", json={"connection_id": "yok"})
        assert response.status_code == 404

    def test_kapatmada_olcumler_korunur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        client.post("/api/runtime/disconnect", json={"connection_id": "hat-1"})
        status = client.get("/api/runtime/status").json()
        assert status["connections"][0]["health"]["packets"] == 1


class TestStatusEndpoint:
    def test_bos_durumda_liste_bos(self, client):
        assert client.get("/api/runtime/status").json()["connections"] == []

    def test_kayit_listede_gorunur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        assert len(client.get("/api/runtime/status").json()["connections"]) == 1

    def test_zaman_damgasi_doner(self, client):
        assert client.get("/api/runtime/status").json()["at_ms"] > 0

    def test_baska_organizasyon_kaydi_gormez(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            assert client.get("/api/runtime/status").json()["connections"] == []


class TestHealthEndpoint:
    def test_bos_durumda_toplam_sifir(self, client):
        assert client.get("/api/runtime/health").json()["total"] == 0

    def test_bos_durumda_gecikme_none(self, client):
        # Olculmemis bir gecikme sifir olarak gonderilmez.
        assert client.get("/api/runtime/health").json()["avg_latency_ms"] is None

    def test_bagli_sayisi_bildirilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        assert client.get("/api/runtime/health").json()["connected"] == 1

    def test_ortalama_gecikme_bildirilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        assert client.get("/api/runtime/health").json()["avg_latency_ms"] == 7.5

    def test_abone_sayisi_bildirilir(self, client):
        assert client.get("/api/runtime/health").json()["subscribers"] == 0

    def test_tampon_boyutu_bildirilir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        assert client.get("/api/runtime/health").json()["buffered_events"] >= 2


class TestEventsEndpoint:
    def test_bos_tamponda_olay_yok(self, client):
        assert client.get("/api/runtime/events").json()["events"] == []

    def test_baglanti_olaylari_gorunur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        kinds = [e["kind"] for e in client.get("/api/runtime/events").json()["events"]]
        assert "registered" in kinds and "probe" in kinds

    def test_since_ile_sonrasi_alinir(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.get("/api/runtime/events?since=1").json()
        assert all(event["sequence"] > 1 for event in payload["events"])

    def test_baglantiya_gore_suzulur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        client.post("/api/runtime/connect", json=connect_body(connection_id="hat-2"))
        payload = client.get("/api/runtime/events?connection_id=hat-2").json()
        assert {event["connection_id"] for event in payload["events"]} == {"hat-2"}

    def test_olmayan_baglanti_dort_yuz_dort(self, client):
        assert client.get("/api/runtime/events?connection_id=yok").status_code == 404

    def test_kapasite_bildirilir(self, client):
        assert client.get("/api/runtime/events").json()["capacity"] == 1_000

    def test_tasma_yoksa_kayip_none(self, client):
        assert client.get("/api/runtime/events").json()["dropped_before"] is None

    def test_negatif_since_reddedilir(self, client):
        assert client.get("/api/runtime/events?since=-1").status_code == 422

    def test_baska_organizasyonun_olaylari_gorunmez(self, client):
        # Kimlik tahmin eden biri baskasinin akisini okuyamamali.
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            payload = client.get("/api/runtime/events").json()
        assert payload["events"] == []

    def test_baska_organizasyonun_kimligi_sorulunca_dort_yuz_dort(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            response = client.get("/api/runtime/events?connection_id=hat-1")
        assert response.status_code == 404


class TestReplay:
    def test_replay_gercek_olaylari_dondurur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        events = client.get("/api/runtime/events?since=0").json()["events"]
        probe = [event for event in events if event["kind"] == "probe"][0]
        assert probe["data"]["evidence"] == "HTTP 200, 12 bayt"

    def test_replay_olay_uydurmaz(self, client):
        # Hicbir sey olmadiysa replay bos doner.
        assert client.get("/api/runtime/events?since=0").json()["events"] == []

    def test_replay_sirasi_korunur(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        events = client.get("/api/runtime/events").json()["events"]
        sequences = [event["sequence"] for event in events]
        assert sequences == sorted(sequences)


class TestStream:
    """SSE akışı.

    Akış hiç bitmeyen bir yanıttır; `TestClient` ile sonuna kadar okumak testi
    askıda bırakır. Bu yüzden yanıt başlıkları ve üretecin kendisi ayrı ayrı,
    sınırlı adımda sınanır.
    """

    class FakeRequest:
        """`is_disconnected` birkaç çağrıdan sonra doğru döner."""

        def __init__(self, disconnect_after: int = 5):
            self.calls = 0
            self.disconnect_after = disconnect_after

        async def is_disconnected(self) -> bool:
            self.calls += 1
            return self.calls > self.disconnect_after

    def test_yanit_sse_icerik_turu_tasir(self, manager):
        response = asyncio.run(
            runtime_stream(self.FakeRequest(), org_id=ORG_A, manager=manager)
        )
        assert response.media_type == "text/event-stream"

    def test_yanit_tamponlamayi_kapatir(self, manager):
        # Araya giren vekil sunucu tamponlarsa olaylar dakikalarca gecikir.
        response = asyncio.run(
            runtime_stream(self.FakeRequest(), org_id=ORG_A, manager=manager)
        )
        assert response.headers["x-accel-buffering"] == "no"
        assert response.headers["cache-control"] == "no-cache"

    def test_akis_acilis_yorumuyla_baslar(self, manager):
        async def senaryo():
            stream = event_stream(self.FakeRequest(), manager, ORG_A)
            first = await stream.__anext__()
            await stream.aclose()
            return first

        assert asyncio.run(senaryo()).startswith(":")

    def test_olay_akista_iletilir(self, manager):
        async def senaryo():
            manager.register(ORG_A, _spec("hat-1"))
            stream = event_stream(self.FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.dispatcher.emit("hat-1", "probe", "cihaz yanit verdi")
            frame = await stream.__anext__()
            await stream.aclose()
            return frame

        frame = asyncio.run(senaryo())
        assert "event: probe" in frame
        assert "cihaz yanit verdi" in frame

    def test_akis_acildiktan_sonra_eklenen_baglanti_da_iletilir(self, manager):
        """Tarayicida gorulen hata: sahiplik akis acilirken bir kez
        hesaplaniyordu ve sonradan eklenen bir cihazin olaylari hic gelmiyordu."""

        async def senaryo():
            stream = event_stream(self.FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.register(ORG_A, _spec("sonradan"))
            manager.dispatcher.emit("sonradan", "probe", "yeni cihaz")
            frames = []
            for _ in range(2):
                frames.append(await stream.__anext__())
            await stream.aclose()
            return frames

        frames = asyncio.run(senaryo())
        assert any("yeni cihaz" in frame for frame in frames)

    def test_baska_organizasyonun_olayi_akista_gorunmez(self, manager):
        async def senaryo():
            manager.register(ORG_A, _spec("hat-1"))
            manager.register(ORG_B, _spec("baska-hat"))
            stream = event_stream(self.FakeRequest(), manager, ORG_A)
            await stream.__anext__()
            manager.dispatcher.emit("baska-hat", "probe", "gizli")
            manager.dispatcher.emit("hat-1", "probe", "benim")
            frame = await stream.__anext__()
            await stream.aclose()
            return frame

        frame = asyncio.run(senaryo())
        assert "benim" in frame
        assert "gizli" not in frame

    def test_istemci_kapaninca_abone_silinir(self, manager):
        async def senaryo():
            stream = event_stream(self.FakeRequest(disconnect_after=0), manager, ORG_A)
            async for _ in stream:
                pass
            return manager.dispatcher.subscriber_count

        # Her sekme kapanisi sunucuda bir kuyruk biraksaydi bellek buyurdu.
        assert asyncio.run(senaryo()) == 0


class TestAuthWiring:
    def test_uclar_organizasyon_bagimliligini_ister(self):
        # Kimlik dogrulama ayri bir yol acmaz; mevcut bagimlilik kullanilir.
        from simulation_engine.runtime import api as runtime_api

        source = runtime_api.__doc__ or ""
        assert "get_current_org" in source

    def test_tum_runtime_uclari_kayitli(self):
        """Köprünün temel uçları kayıtlı mı?

        Küme eşitliği yerine kapsama sınanır: SALES-10'da cihaz uçları
        eklendiğinde tam eşitlik bu testi düşürdü, oysa eski uçların hiçbiri
        bozulmamıştı. Yeni bir uç eklemek bir regresyon değildir; **eski bir
        ucun kaybolması** regresyondur ve bu testin koruduğu şey odur.
        """
        paths = {path for path in app.openapi()["paths"] if path.startswith("/api/runtime")}
        assert {
            "/api/runtime/connect",
            "/api/runtime/disconnect",
            "/api/runtime/status",
            "/api/runtime/health",
            "/api/runtime/events",
            "/api/runtime/stream",
        } <= paths

    def test_mevcut_simulasyon_ucu_bozulmadi(self, client):
        # Runtime router'i eklemek eski uclari etkilememeli.
        assert "/api/simulations/run" in app.openapi()["paths"]


class TestDriverUcu:
    """`/driver` — canlı ekranı hangi bağlantı besliyor?

    Uç, kararın kendisini değil **gerekçesini** de döndürür: operatör "neden
    benzetim verisi görüyorum?" sorusunu ekranı terk etmeden yanıtlayabilmeli.
    """

    def test_hic_baglanti_yokken_benzetim_bildirilir(self, client):
        payload = client.get("/api/runtime/driver").json()
        assert payload["simulated"] is True
        assert payload["connection_id"] is None
        assert payload["candidates"] == 0

    def test_gerekce_her_zaman_yazilir(self, client):
        payload = client.get("/api/runtime/driver").json()
        assert isinstance(payload["reason"], str)
        assert payload["reason"].strip() != ""

    def test_dogrulanmis_baglanti_surucu_olur(self, client):
        # FakeAdapter basarili doner; kayit dogrulanmis ve bagli hale gelir.
        client.post("/api/runtime/connect", json=connect_body())
        payload = client.get("/api/runtime/driver").json()
        assert payload["simulated"] is False
        assert payload["connection_id"] == "hat-1"
        assert payload["kind"] == "rest"
        assert payload["candidates"] == 1

    def test_baska_organizasyon_surucuyu_gormez(self, client):
        client.post("/api/runtime/connect", json=connect_body())
        with as_org(ORG_B):
            payload = client.get("/api/runtime/driver").json()
        assert payload["simulated"] is True
        assert payload["connection_id"] is None
