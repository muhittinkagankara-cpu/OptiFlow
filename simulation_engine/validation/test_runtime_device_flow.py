"""Gerçek sunucularla uçtan uca veri akışı.

    Device → Runtime → DeviceEvent → Dispatcher → (SSE'ye giden olay)

Bu dosyadaki testler sahte kaynak kullanmaz: gerçek bir OPC UA sunucusu,
gerçek bir MQTT broker'ı ve gerçek bir HTTP ucu ayağa kalkar, değer değişir ve
zincirin sonunda ekrana gidecek olayın oluştuğu doğrulanır.

Yerel sunucular bir fabrika cihazı değildir: doğrulanan şey protokol ve boru
hattıdır, sahadaki bir PLC'nin davranışı değil.
"""

from __future__ import annotations

import asyncio
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from simulation_engine.runtime.events import EventDispatcher
from simulation_engine.runtime.pipeline.device_events import MachineState, Metric
from simulation_engine.runtime.pipeline.dispatcher import DeviceDispatcher
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.sources import (
    mqtt_message_source,
    opcua_subscription_source,
    rest_fetch,
    source_availability,
)
from simulation_engine.runtime.streaming import (
    MqttStreamRunner,
    OpcUaSubscriptionRunner,
    RestPollingRunner,
)
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_on_selector_loop(coro):
    """Coroutine'i seçici olay döngüsünde çalıştırır (bkz. SALES-9 notu)."""
    loop = (
        asyncio.SelectorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    )
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def spec(kind: ConnectionKind, endpoint: str, **overrides) -> ConnectionSpec:
    base = dict(
        connection_id="akis-1",
        kind=kind,
        label="Hat 1",
        endpoint=endpoint,
        timeout_ms=5_000,
        max_retries=0,
    )
    base.update(overrides)
    return ConnectionSpec(**base)


def new_dispatcher() -> DeviceDispatcher:
    return DeviceDispatcher(EventDispatcher())


# --------------------------------------------------------------------------- #
# REST — gerçek HTTP sunucusu üzerinden yoklama                                 #
# --------------------------------------------------------------------------- #


class _Handler(BaseHTTPRequestHandler):
    """Her istekte artan bir üretim sayacı döndürür."""

    counter = {"value": 1000}

    def do_GET(self):  # noqa: N802
        _Handler.counter["value"] += 5
        payload = json.dumps(
            {
                "machine_id": "TORNA_01",
                "production_count": _Handler.counter["value"],
                "queue": 2,
                "status": "running",
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # noqa: D102
        return


@pytest.fixture(scope="module")
def http_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/uretim"
    server.shutdown()
    server.server_close()


class TestRestPollingAgainstRealServer:
    def test_gercek_ucdan_veri_akar(self, http_server):
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.REST, http_server)
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        state = asyncio.run(runner.run(max_cycles=2))
        assert state.payloads == 2
        assert state.has_data is True

    def test_uretim_sayaci_ekrana_gider(self, http_server):
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.REST, http_server)
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=1))
        snapshot = dispatcher.snapshots()["TORNA_01"]
        assert snapshot.production_count is not None
        assert snapshot.production_count > 1000

    def test_makine_durumu_okunur(self, http_server):
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.REST, http_server)
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=1))
        assert dispatcher.snapshots()["TORNA_01"].state is MachineState.RUNNING

    def test_kuyruk_okunur(self, http_server):
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.REST, http_server)
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=1))
        assert dispatcher.snapshots()["TORNA_01"].queue_length == 2

    def test_device_data_olayi_yayilir(self, http_server):
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.REST, http_server)
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=1))
        kinds = [event.kind for event in dispatcher._dispatcher.buffer.all()]
        assert "device_data" in kinds

    def test_kapali_uc_veri_uretmez(self):
        dispatcher = new_dispatcher()
        item = spec(
            ConnectionKind.REST, f"http://127.0.0.1:{free_port()}/uretim", timeout_ms=1_000
        )
        runner = RestPollingRunner(
            spec=item,
            fetch=rest_fetch(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            sleep=lambda seconds: asyncio.sleep(0),
        )
        state = asyncio.run(runner.run(max_cycles=1))
        assert state.has_data is False
        assert state.consecutive_failures == 1


# --------------------------------------------------------------------------- #
# OPC UA — gerçek abonelik                                                      #
# --------------------------------------------------------------------------- #

asyncua = pytest.importorskip("asyncua", reason="asyncua kurulu degil")


class OpcUaCounterServer:
    """Sayacı dışarıdan artırılabilen yerel OPC UA sunucusu."""

    def __init__(self, port: int):
        self.port = port
        self.endpoint = f"opc.tcp://127.0.0.1:{port}/optiflow/"
        self.node_id = None
        self._loop = None
        self._counter = None
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
        namespace = await server.register_namespace("optiflow-akis")
        line = await server.nodes.objects.add_object(namespace, "Hat1")
        counter = await line.add_variable(namespace, "Sayac", 1000)
        await counter.set_writable()
        self._counter = counter
        self.node_id = counter.nodeid.to_string()
        async with server:
            self._ready.set()
            while not self._stop.is_set():
                await asyncio.sleep(0.05)

    def bump(self, value: int) -> None:
        """Değeri değiştirir; abone tarafında bildirim tetiklenir."""
        assert self._loop is not None and self._counter is not None
        future = asyncio.run_coroutine_threadsafe(
            self._counter.write_value(value), self._loop
        )
        future.result(timeout=10)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)


@pytest.fixture(scope="module")
def opcua_server():
    server = OpcUaCounterServer(free_port())
    server.start()
    yield server
    server.stop()


def opcua_mapping(node_id: str) -> MappingTable:
    return MappingTable(
        entries=[
            MetricMapping(
                origin=node_id, machine_id="TORNA_01", metric=Metric.PRODUCTION_COUNT
            )
        ]
    )


class TestOpcUaSubscriptionAgainstRealServer:
    def _collect(self, server, expected: int = 2, bumps=(1100, 1200)):
        """Aboneliği açar, değeri değiştirir ve gelen olayları toplar."""
        dispatcher = new_dispatcher()
        item = spec(ConnectionKind.OPCUA, server.endpoint, topics=[server.node_id])
        runner = OpcUaSubscriptionRunner(
            spec=item,
            notifications=lambda: opcua_subscription_source(item, publish_interval_ms=100),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
            mapping=opcua_mapping(server.node_id),
        )

        async def senaryo():
            task = asyncio.ensure_future(runner.run(max_notifications=expected))
            await asyncio.sleep(1.0)
            for value in bumps:
                server.bump(value)
                await asyncio.sleep(0.4)
            try:
                await asyncio.wait_for(task, timeout=10)
            except asyncio.TimeoutError:
                runner.stop()
                task.cancel()
            return runner.state

        state = asyncio.run(senaryo())
        return dispatcher, runner, state

    def test_abonelik_gercek_bildirim_alir(self, opcua_server):
        _, runner, state = self._collect(opcua_server)
        assert state.payloads >= 1
        assert runner.items[opcua_server.node_id].notifications >= 1

    def test_degisen_deger_cihaz_olayina_donusur(self, opcua_server):
        dispatcher, _, _ = self._collect(opcua_server, bumps=(1300,), expected=1)
        assert len(dispatcher.events) >= 1
        assert dispatcher.events[-1].metric is Metric.PRODUCTION_COUNT

    def test_okunan_deger_makine_goruntusune_yazilir(self, opcua_server):
        dispatcher, _, _ = self._collect(opcua_server, bumps=(1400,), expected=1)
        snapshot = dispatcher.snapshots().get("TORNA_01")
        assert snapshot is not None
        assert snapshot.production_count is not None

    def test_akis_veri_geldigini_isaretler(self, opcua_server):
        _, _, state = self._collect(opcua_server, bumps=(1500,), expected=1)
        assert state.has_data is True

    def test_izlenen_oge_sayisi_bildirilir(self, opcua_server):
        _, runner, _ = self._collect(opcua_server, bumps=(1600,), expected=1)
        assert (runner.state.monitored_items or 0) >= 1

    def test_kaynak_uygunlugu_opcua_icin_acik(self, opcua_server):
        item = spec(ConnectionKind.OPCUA, opcua_server.endpoint)
        assert source_availability(item) is None


# --------------------------------------------------------------------------- #
# MQTT — gerçek broker üzerinden akış                                           #
# --------------------------------------------------------------------------- #

aiomqtt = pytest.importorskip("aiomqtt", reason="aiomqtt kurulu degil")
amqtt_broker = pytest.importorskip("amqtt.broker", reason="amqtt kurulu degil")


class MqttTestBroker:
    def __init__(self, port: int):
        self.port = port
        self.host = "127.0.0.1"
        self._thread = None
        self._ready = threading.Event()
        self._stop = threading.Event()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=30):
            raise RuntimeError("MQTT broker acilmadi")

    def _run(self) -> None:
        loop = (
            asyncio.SelectorEventLoop()
            if sys.platform == "win32"
            else asyncio.new_event_loop()
        )
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
                "plugins": {
                    "amqtt.plugins.authentication.AnonymousAuthPlugin": {
                        "allow_anonymous": True
                    }
                },
            }
        )
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


class TestMqttStreamAgainstRealBroker:
    def _run_stream(self, broker, payloads, topic="fabrika/torna/olcum"):
        """Dinlemeyi açar, mesaj yayınlar ve gelen olayları toplar."""
        dispatcher = new_dispatcher()
        item = spec(
            ConnectionKind.MQTT,
            broker.host,
            port=broker.port,
            topics=["fabrika/#"],
        )
        runner = MqttStreamRunner(
            spec=item,
            messages=lambda: mqtt_message_source(item),
            on_result=lambda result, at_ms: dispatcher.ingest(result),
        )

        async def senaryo():
            task = asyncio.ensure_future(runner.run(max_messages=len(payloads)))
            await asyncio.sleep(1.0)
            import aiomqtt as client_lib

            async with client_lib.Client(hostname=broker.host, port=broker.port) as pub:
                for payload in payloads:
                    await pub.publish(topic, payload, qos=1)
                    await asyncio.sleep(0.2)
            try:
                await asyncio.wait_for(task, timeout=10)
            except asyncio.TimeoutError:
                runner.stop()
                task.cancel()
            return runner.state

        state = run_on_selector_loop(senaryo())
        return dispatcher, state

    def test_yayinlanan_mesaj_cihaz_olayina_donusur(self, mqtt_broker):
        dispatcher, state = self._run_stream(
            mqtt_broker, [b'{"machine_id": "TORNA_01", "production_count": 1240}']
        )
        assert state.payloads >= 1
        assert any(event.machine_id == "TORNA_01" for event in dispatcher.events)

    def test_olcum_makine_goruntusune_yazilir(self, mqtt_broker):
        dispatcher, _ = self._run_stream(
            mqtt_broker, [b'{"machine_id": "KAYNAK_01", "queue": 4}']
        )
        snapshot = dispatcher.snapshots().get("KAYNAK_01")
        assert snapshot is not None
        assert snapshot.queue_length == 4

    def test_bozuk_yuk_tanilamaya_duser(self, mqtt_broker):
        # Sessizce yutulsaydi "veri gelmiyor" sanilirdi.
        dispatcher, state = self._run_stream(mqtt_broker, [b"{bozuk"])
        assert state.problems >= 1
        assert dispatcher.problems != []

    def test_ic_ice_yuk_cozulur(self, mqtt_broker):
        dispatcher, _ = self._run_stream(
            mqtt_broker, [b'{"istasyonlar": {"pres": {"adet": 12}}}']
        )
        assert dispatcher.snapshots().get("pres") is not None

    def test_akis_veri_geldigini_isaretler(self, mqtt_broker):
        _, state = self._run_stream(mqtt_broker, [b'{"machine_id": "M1", "adet": 3}'])
        assert state.has_data is True

    def test_kaynak_uygunlugu_mqtt_icin_acik(self, mqtt_broker):
        item = spec(
            ConnectionKind.MQTT, mqtt_broker.host, port=mqtt_broker.port, topics=["a/b"]
        )
        assert source_availability(item) is None

    def test_konusuz_mqtt_akisi_reddedilir(self):
        item = spec(ConnectionKind.MQTT, "broker.local", topics=[])
        assert "geçerli bir konu yok" in (source_availability(item) or "")
