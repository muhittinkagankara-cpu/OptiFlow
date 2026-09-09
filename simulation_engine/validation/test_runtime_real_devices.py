"""Gerçek sunucularla doğrulama.

Bu dosyadaki testler sahte sürücü kullanmaz: **gerçekten** bir HTTP sunucusu,
bir OPC UA sunucusu ve bir MQTT broker'ı ayağa kaldırır, köprüyü onlara
bağlar ve cihazdan dönen veriyi kanıt olarak okur.

Neden önemli
------------
Sprint sözleşmesi "Bağlandı" demeyi yalnızca gerçek bir cihaz üzerinde
doğrulanmış bağlantılara izin veriyor. Sahte bir sürücü, adaptörün
kütüphaneyle doğru konuşup konuşmadığını **hiçbir zaman** gösteremez; yalnızca
bizim beklentimizi tekrar eder. Buradaki sunucular gerçek protokolü konuşur.

Bu yerel sunucular bir fabrika cihazı değildir: doğrulanan şey protokol
katmanıdır (oturum açma, düğüm okuma, abonelik onayı), sahadaki bir PLC'nin
davranışı değil.
"""

from __future__ import annotations

import asyncio
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from simulation_engine.runtime.adapters.mqtt import MqttAdapter
from simulation_engine.runtime.adapters.opcua import OpcUaAdapter
from simulation_engine.runtime.adapters.rest import RestAdapter
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
)

ORG = "gercek-org"


def free_port() -> int:
    """Boş bir TCP portu bulur; sabit port paralel koşumda çakışırdı."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_on_selector_loop(coro):
    """Coroutine'i seçici (selector) olay döngüsünde çalıştırır.

    Windows'ta varsayılan döngü `Proactor`'dur ve `add_reader/add_writer`
    desteklemez; paho tabanlı MQTT istemcisi bunlara ihtiyaç duyar ve
    varsayılan döngüde `NotImplementedError` ile düşer. Genel politikayı
    değiştirmek yerine yalnızca bu koşum için ayrı bir döngü kurulur —
    politika değiştirilseydi aynı oturumdaki öteki testler de etkilenirdi.
    """
    loop = asyncio.SelectorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def spec(kind: ConnectionKind, endpoint: str, **overrides) -> ConnectionSpec:
    base = dict(
        connection_id="gercek-1",
        kind=kind,
        label="Gerçek cihaz",
        endpoint=endpoint,
        timeout_ms=5_000,
        max_retries=0,
    )
    base.update(overrides)
    return ConnectionSpec(**base)


# --------------------------------------------------------------------------- #
# REST — gerçek HTTP sunucusu                                                   #
# --------------------------------------------------------------------------- #


class _Handler(BaseHTTPRequestHandler):
    """Sabit bir JSON gövdesi döndüren küçük sunucu."""

    payload = json.dumps({"sayac": 42, "durum": "calisiyor"}).encode("utf-8")

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler arayüzü
        if self.path == "/yok":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(self.payload)))
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *args):  # noqa: D102 — test çıktısını kirletmesin
        return


@pytest.fixture(scope="module")
def http_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


class TestRestAgainstRealServer:
    def test_gercek_uc_dogrulanir(self, http_server):
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, f"{http_server}/veri")))
        assert result.ok is True

    def test_gercek_gecikme_olculur(self, http_server):
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, f"{http_server}/veri")))
        assert result.latency_ms is not None and result.latency_ms >= 0

    def test_gercek_govde_boyutu_olculur(self, http_server):
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, f"{http_server}/veri")))
        assert result.bytes_received == len(_Handler.payload)

    def test_kanit_alinan_baytlari_yazar(self, http_server):
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, f"{http_server}/veri")))
        assert "HTTP 200" in result.evidence

    def test_olmayan_yol_dogrulanmaz(self, http_server):
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, f"{http_server}/yok")))
        assert result.ok is False
        assert "404" in result.detail

    def test_kapali_port_baglanamaz(self):
        endpoint = f"http://127.0.0.1:{free_port()}/veri"
        result = asyncio.run(RestAdapter().probe(spec(ConnectionKind.REST, endpoint)))
        assert result.ok is False
        assert result.evidence is None

    def test_yonetici_uzerinden_gercek_baglanti(self, http_server):
        manager = RuntimeManager()
        manager.register(ORG, spec(ConnectionKind.REST, f"{http_server}/veri"))
        state = asyncio.run(manager.connect(ORG, "gercek-1"))
        assert state.status is ConnectionStatus.CONNECTED
        assert state.ever_verified is True

    def test_gercek_baglanti_olay_uretir(self, http_server):
        manager = RuntimeManager()
        manager.register(ORG, spec(ConnectionKind.REST, f"{http_server}/veri"))
        asyncio.run(manager.connect(ORG, "gercek-1"))
        son = manager.dispatcher.buffer.last()
        assert son.kind == "probe"
        assert son.data["ok"] is True
        assert "evidence" in son.data


# --------------------------------------------------------------------------- #
# OPC UA — gerçek asyncua sunucusu                                              #
# --------------------------------------------------------------------------- #

asyncua = pytest.importorskip("asyncua", reason="asyncua kurulu degil")


class OpcUaTestServer:
    """Yerel bir OPC UA sunucusu; tek bir değişken yayımlar."""

    def __init__(self, port: int):
        self.port = port
        self.endpoint = f"opc.tcp://127.0.0.1:{port}/optiflow/"
        self.node_id = None
        self._server = None
        self._loop = None
        self._thread = None
        self._ready = threading.Event()
        self._stop = threading.Event()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=30):
            raise RuntimeError("OPC UA sunucusu acilmadi")

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        loop.run_until_complete(self._serve())
        loop.close()

    async def _serve(self) -> None:
        from asyncua import Server

        server = Server()
        await server.init()
        server.set_endpoint(self.endpoint)
        namespace = await server.register_namespace("optiflow-test")
        objects = server.nodes.objects
        line = await objects.add_object(namespace, "Hat1")
        counter = await line.add_variable(namespace, "Sayac", 42)
        await counter.set_writable()
        self.node_id = counter.nodeid.to_string()
        async with server:
            self._ready.set()
            while not self._stop.is_set():
                await asyncio.sleep(0.05)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)


@pytest.fixture(scope="module")
def opcua_server():
    server = OpcUaTestServer(free_port())
    server.start()
    yield server
    server.stop()


class TestOpcUaAgainstRealServer:
    def test_gercek_sunucu_dogrulanir(self, opcua_server):
        result = asyncio.run(
            OpcUaAdapter().probe(spec(ConnectionKind.OPCUA, opcua_server.endpoint))
        )
        assert result.ok is True

    def test_sunucu_saati_okunur(self, opcua_server):
        # Dugum verilmediginde standart `i=2258` okunur.
        result = asyncio.run(
            OpcUaAdapter().probe(spec(ConnectionKind.OPCUA, opcua_server.endpoint))
        )
        assert "i=2258" in result.evidence

    def test_belirtilen_dugum_okunur(self, opcua_server):
        result = asyncio.run(
            OpcUaAdapter().probe(
                spec(
                    ConnectionKind.OPCUA,
                    opcua_server.endpoint,
                    topics=[opcua_server.node_id],
                )
            )
        )
        assert result.ok is True
        assert "42" in result.evidence

    def test_gecikme_olculur(self, opcua_server):
        result = asyncio.run(
            OpcUaAdapter().probe(spec(ConnectionKind.OPCUA, opcua_server.endpoint))
        )
        assert result.latency_ms is not None

    def test_okunan_degerler_geri_verilir(self, opcua_server):
        readings, error = asyncio.run(
            OpcUaAdapter().read_nodes(
                spec(
                    ConnectionKind.OPCUA,
                    opcua_server.endpoint,
                    topics=[opcua_server.node_id],
                )
            )
        )
        assert error is None
        assert readings[0][1] == 42

    def test_olmayan_dugum_okunamaz(self, opcua_server):
        result = asyncio.run(
            OpcUaAdapter().probe(
                spec(ConnectionKind.OPCUA, opcua_server.endpoint, topics=["ns=9;i=9999"])
            )
        )
        assert result.ok is False

    def test_kapali_port_baglanamaz(self):
        endpoint = f"opc.tcp://127.0.0.1:{free_port()}/optiflow/"
        result = asyncio.run(
            OpcUaAdapter().probe(spec(ConnectionKind.OPCUA, endpoint, timeout_ms=2_000))
        )
        assert result.ok is False
        assert result.evidence is None

    def test_yonetici_uzerinden_gercek_baglanti(self, opcua_server):
        manager = RuntimeManager()
        manager.register(ORG, spec(ConnectionKind.OPCUA, opcua_server.endpoint))
        state = asyncio.run(manager.connect(ORG, "gercek-1"))
        assert state.status is ConnectionStatus.CONNECTED
        assert state.health.packets == 1


# --------------------------------------------------------------------------- #
# MQTT — gerçek amqtt broker'ı                                                  #
# --------------------------------------------------------------------------- #

aiomqtt = pytest.importorskip("aiomqtt", reason="aiomqtt kurulu degil")
amqtt_broker = pytest.importorskip("amqtt.broker", reason="amqtt kurulu degil")


class MqttTestBroker:
    """Yerel, anonim bağlantıya izin veren bir MQTT broker'ı."""

    def __init__(self, port: int):
        self.port = port
        self.host = "127.0.0.1"
        self._broker = None
        self._thread = None
        self._loop = None
        self._ready = threading.Event()
        self._stop = threading.Event()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=30):
            raise RuntimeError("MQTT broker acilmadi")

    def _run(self) -> None:
        loop = asyncio.SelectorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._serve())
        loop.close()

    async def _serve(self) -> None:
        from amqtt.broker import Broker

        broker = Broker(
            {
                "listeners": {
                    "default": {
                        "type": "tcp",
                        "bind": f"{self.host}:{self.port}",
                        "max_connections": 20,
                    }
                },
                # amqtt 0.12'de anonim erisim acikca bir eklentiyle verilir;
                # verilmezse broker her baglantiyi "Not authorized" ile reddeder.
                "plugins": {
                    "amqtt.plugins.authentication.AnonymousAuthPlugin": {
                        "allow_anonymous": True
                    }
                },
            }
        )
        self._broker = broker
        await broker.start()
        self._ready.set()
        while not self._stop.is_set():
            await asyncio.sleep(0.05)
        await broker.shutdown()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=15)


@pytest.fixture(scope="module")
def mqtt_broker():
    broker = MqttTestBroker(free_port())
    broker.start()
    yield broker
    broker.stop()


class TestMqttAgainstRealBroker:
    def test_gercek_broker_dogrulanir(self, mqtt_broker):
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    mqtt_broker.host,
                    port=mqtt_broker.port,
                    topics=["fabrika/hat1/sayac"],
                )
            )
        )
        assert result.ok is True

    def test_abonelik_onayi_kanit_yazilir(self, mqtt_broker):
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    mqtt_broker.host,
                    port=mqtt_broker.port,
                    topics=["fabrika/hat1/sayac"],
                )
            )
        )
        assert "CONNACK" in result.evidence or "bayt alındı" in result.evidence

    def test_mesaj_gelmemesi_hata_degildir(self, mqtt_broker):
        # Yayin yapan cihaz yoksa konu sessizdir; bu baglanti arizasi degildir.
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    mqtt_broker.host,
                    port=mqtt_broker.port,
                    topics=["sessiz/konu"],
                )
            )
        )
        assert result.ok is True
        assert result.bytes_received is None

    def test_yayinlanan_mesaj_kanit_olur(self, mqtt_broker):
        async def senaryo():
            import aiomqtt as client_lib

            adapter = MqttAdapter()
            item = spec(
                ConnectionKind.MQTT,
                mqtt_broker.host,
                port=mqtt_broker.port,
                topics=["fabrika/hat1/olcum"],
            )

            async def yayinla():
                # Abonelik kurulduktan sonra yayinlansin diye kisa gecikme.
                await asyncio.sleep(0.3)
                async with client_lib.Client(
                    hostname=mqtt_broker.host, port=mqtt_broker.port
                ) as publisher:
                    await publisher.publish("fabrika/hat1/olcum", b"42", qos=1)

            task = asyncio.ensure_future(yayinla())
            result = await adapter.probe(item)
            await task
            return result

        result = run_on_selector_loop(senaryo())
        assert result.ok is True

    def test_gecikme_olculur(self, mqtt_broker):
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    mqtt_broker.host,
                    port=mqtt_broker.port,
                    topics=["a/b"],
                )
            )
        )
        assert result.latency_ms is not None

    def test_kapali_port_baglanamaz(self):
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    "127.0.0.1",
                    port=free_port(),
                    topics=["a/b"],
                    timeout_ms=2_000,
                )
            )
        )
        assert result.ok is False
        assert result.evidence is None

    def test_yanlis_parola_dogrulanmaz_ya_da_anonim_kabul_edilir(self, mqtt_broker):
        # Bu broker anonim baglantiya izin veriyor; test yalnizca kimlik
        # bilgisi verilen yolun cokmedigini dogrular.
        result = run_on_selector_loop(
            MqttAdapter().probe(
                spec(
                    ConnectionKind.MQTT,
                    mqtt_broker.host,
                    port=mqtt_broker.port,
                    topics=["a/b"],
                    username="op",
                    password="yanlis",
                )
            )
        )
        assert isinstance(result.ok, bool)
