"""Akışın gerçek yerel sunucularla doğrulanması.

Buradaki hiçbir test sahte veri kullanmaz: gerçek bir HTTP sunucusu, gerçek
bir OPC UA sunucusu ve gerçek bir MQTT broker'ı başlatılır, gerçek soketler
üzerinden konuşulur ve ölçümler gerçekten akar.

Neden gerekli
-------------
Sahte kaynaklarla yazılmış bir akış motoru, protokolün kendi davranışını hiç
görmez: OPC UA'nın değişim bildirimi, MQTT'nin konu eşleşmesi ve REST'in gövde
biçimi ancak gerçek bir sunucuda ortaya çıkar. SALES-9'da bu ayrım olmadığı
için "bağlandı" diyen bir ekran, hiçbir cihazla konuşmamıştı.

Sunucu kurulamıyorsa test **atlanır**, geçmiş sayılmaz.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from simulation_engine.runtime.pipeline.device_events import Metric
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.engine import StreamEngine, build_poller
from simulation_engine.runtime.stream.scheduler import StreamHealth
from simulation_engine.runtime.stream.subscriber import MqttSubscriber, OpcUaSubscriber
from simulation_engine.runtime.stream.types import SequenceCounter
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# -- Gerçek HTTP sunucusu ---------------------------------------------------


class _Counter:
    """Her istekte artan gerçek bir üretim sayacı."""

    value = 0


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler sözleşmesi
        _Counter.value += 1
        body = json.dumps(
            {"production_count": _Counter.value, "queue_length": 3}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D102 — test çıktısı kirlenmesin
        return


@pytest.fixture
def http_server():
    _Counter.value = 0
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()


def rest_spec(url: str) -> ConnectionSpec:
    return ConnectionSpec(
        connection_id="rest-1",
        kind=ConnectionKind.REST,
        label="TORNA_01",
        endpoint=f"{url}/veri",
    )


class TestGercekRestYoklamasi:
    def test_gercek_sunucudan_veri_akar(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)

        outcome = asyncio.run(poller.poll_once())

        assert outcome.ok is True
        assert outcome.events == 2

    def test_gercek_sayac_artisi_gorulur(self, http_server):
        """Sunucudaki sayaç her istekte artar; akış bu artışı taşımalı."""
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)

        asyncio.run(poller.poll_once())
        asyncio.run(poller.poll_once())
        events = motor.dispatcher.drain(0)

        counts = [
            item.value for item in events if item.field == "production_count"
        ]
        assert counts == [1, 2]

    def test_sira_numaralari_gercek_akista_artar(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)

        asyncio.run(poller.poll_once())
        asyncio.run(poller.poll_once())
        events = motor.dispatcher.drain(0)

        assert [item.sequence for item in events] == [1, 2, 3, 4]

    def test_gercek_akista_yineleme_yok(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)

        asyncio.run(poller.poll_once())
        asyncio.run(poller.poll_once())

        assert motor.dispatcher.duplicates == 0

    def test_dongu_gercek_sunucuda_calisir(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor, interval_ms=250)
        poller.sleep = lambda seconds: asyncio.sleep(0)

        asyncio.run(poller.run(max_cycles=3))

        assert len([item for item in poller.outcomes if item.ok]) == 3

    def test_gercek_akista_saglik_calisiyor(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)
        poller.running = True
        asyncio.run(poller.poll_once())

        assert poller.health is StreamHealth.RUNNING

    def test_kapali_port_hata_verir(self):
        """Gerçekten kapalı bir port; benzetim değil."""
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(f"http://127.0.0.1:{free_port()}")
        poller = build_poller(spec, rest_fetch(spec), motor)

        outcome = asyncio.run(poller.poll_once())

        assert outcome.ok is False
        assert outcome.error is not None

    def test_gecikme_gercekten_olculur(self, http_server):
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)
        asyncio.run(poller.poll_once())
        motor.dispatcher.drain(motor.clock())

        assert motor.dispatcher.average_latency_ms() is not None

    def test_uctan_uca_goruntu_guncellenir(self, http_server):
        """Gerçek sunucudan gelen ölçüm makine görüntüsüne yansımalı."""
        from simulation_engine.runtime.pipeline.dispatcher import DeviceDispatcher
        from simulation_engine.runtime.events import EventDispatcher
        from simulation_engine.runtime.sources import rest_fetch

        motor = StreamEngine()
        devices = DeviceDispatcher(EventDispatcher())
        motor.register_snapshot_sink(lambda event: devices.dispatch([event], emit=False))

        spec = rest_spec(http_server)
        poller = build_poller(spec, rest_fetch(spec), motor)
        asyncio.run(poller.poll_once())
        motor.dispatcher.drain(motor.clock())

        assert devices.snapshots_by_machine["TORNA_01"].production_count == 1


# -- Gerçek OPC UA sunucusu -------------------------------------------------


@pytest.fixture
def opcua_server():
    asyncua = pytest.importorskip("asyncua", reason="asyncua kurulu degil")
    port = free_port()
    endpoint = f"opc.tcp://127.0.0.1:{port}/optiflow/"
    state = {"node_id": None, "variable": None, "loop": None}
    ready = threading.Event()
    stop = threading.Event()

    async def serve():
        server = asyncua.Server()
        await server.init()
        server.set_endpoint(endpoint)
        namespace = await server.register_namespace("optiflow-test")
        objects = server.nodes.objects
        machine = await objects.add_object(namespace, "Torna")
        variable = await machine.add_variable(namespace, "ProductionCount", 100)
        await variable.set_writable()
        state["node_id"] = variable.nodeid.to_string()
        state["variable"] = variable
        state["loop"] = asyncio.get_running_loop()

        async with server:
            ready.set()
            while not stop.is_set():
                await asyncio.sleep(0.05)

    thread = threading.Thread(target=lambda: asyncio.run(serve()), daemon=True)
    thread.start()
    if not ready.wait(timeout=25):
        stop.set()
        pytest.skip("OPC UA sunucusu acilmadi")

    try:
        yield {"endpoint": endpoint, "state": state}
    finally:
        stop.set()
        thread.join(timeout=10)


def opc_spec(endpoint: str, node_id: str) -> ConnectionSpec:
    return ConnectionSpec(
        connection_id="opc-1",
        kind=ConnectionKind.OPCUA,
        label="TORNA_01",
        endpoint=endpoint,
        topics=[node_id],
    )


def opc_mapping(node_id: str) -> MappingTable:
    return MappingTable(
        entries=[
            MetricMapping(node_id, "TORNA_01", Metric.PRODUCTION_COUNT),
        ]
    )


class TestGercekOpcUaAboneligi:
    def test_gercek_sunucudan_degisim_gelir(self, opcua_server):
        from simulation_engine.runtime.sources import opcua_subscription_source

        node_id = opcua_server["state"]["node_id"]
        spec = opc_spec(opcua_server["endpoint"], node_id)
        motor = StreamEngine()
        # Döngü her bildirimden sonra kuyruğu boşaltır; olaylar bu yüzden
        # kuyruktan değil **alıcıdan** toplanır.
        toplanan = []
        motor.dispatcher.register("test", toplanan.append)
        subscriber = OpcUaSubscriber(
            spec=spec,
            dispatcher=motor.dispatcher,
            sequences=motor.sequences,
            mapping=opc_mapping(node_id),
            notifications_source=lambda: opcua_subscription_source(spec),
        )

        async def drive():
            task = asyncio.ensure_future(subscriber.run(max_notifications=2))
            await asyncio.sleep(1.5)
            variable = opcua_server["state"]["variable"]
            loop = opcua_server["state"]["loop"]
            asyncio.run_coroutine_threadsafe(variable.write_value(205), loop).result(10)
            await asyncio.wait_for(task, timeout=15)

        asyncio.run(drive())

        values = [item.value for item in toplanan]
        assert 205 in values

    def test_gercek_olay_opcua_isaretlenir(self, opcua_server):
        from simulation_engine.runtime.sources import opcua_subscription_source

        node_id = opcua_server["state"]["node_id"]
        spec = opc_spec(opcua_server["endpoint"], node_id)
        motor = StreamEngine()
        # Döngü her bildirimden sonra kuyruğu boşaltır; olaylar bu yüzden
        # kuyruktan değil **alıcıdan** toplanır.
        toplanan = []
        motor.dispatcher.register("test", toplanan.append)
        subscriber = OpcUaSubscriber(
            spec=spec,
            dispatcher=motor.dispatcher,
            sequences=motor.sequences,
            mapping=opc_mapping(node_id),
            notifications_source=lambda: opcua_subscription_source(spec),
        )

        asyncio.run(subscriber.run(max_notifications=1))

        assert toplanan
        assert toplanan[0].source_protocol.value == "opcua"

    def test_gercek_dugum_kimligi_tasinir(self, opcua_server):
        from simulation_engine.runtime.sources import opcua_subscription_source

        node_id = opcua_server["state"]["node_id"]
        spec = opc_spec(opcua_server["endpoint"], node_id)
        motor = StreamEngine()
        # Döngü her bildirimden sonra kuyruğu boşaltır; olaylar bu yüzden
        # kuyruktan değil **alıcıdan** toplanır.
        toplanan = []
        motor.dispatcher.register("test", toplanan.append)
        subscriber = OpcUaSubscriber(
            spec=spec,
            dispatcher=motor.dispatcher,
            sequences=motor.sequences,
            mapping=opc_mapping(node_id),
            notifications_source=lambda: opcua_subscription_source(spec),
        )

        asyncio.run(subscriber.run(max_notifications=1))

        assert toplanan[0].origin == node_id


# -- Gerçek MQTT broker'ı ---------------------------------------------------


@pytest.fixture
def mqtt_broker():
    pytest.importorskip("amqtt", reason="amqtt kurulu degil")
    from amqtt.broker import Broker

    port = free_port()
    ready = threading.Event()
    stop = threading.Event()
    holder = {"loop": None}

    async def serve():
        broker = Broker(
            {
                "listeners": {
                    "default": {
                        "type": "tcp",
                        "bind": f"127.0.0.1:{port}",
                        "max_connections": 50,
                    }
                },
                "sys_interval": 0,
                "auth": {"allow-anonymous": True},
                "topic-check": {"enabled": False},
            }
        )
        await broker.start()
        holder["loop"] = asyncio.get_running_loop()
        ready.set()
        while not stop.is_set():
            await asyncio.sleep(0.05)
        await broker.shutdown()

    thread = threading.Thread(target=lambda: asyncio.run(serve()), daemon=True)
    thread.start()
    if not ready.wait(timeout=25):
        stop.set()
        pytest.skip("MQTT broker acilmadi")

    try:
        yield {"port": port, "loop": holder["loop"]}
    finally:
        stop.set()
        thread.join(timeout=10)


class TestGercekMqttAboneligi:
    def test_gercek_broker_mesaji_olaya_donusur(self, mqtt_broker):
        """Gerçek bir broker'a gerçekten yayın yapılır ve akış onu okur."""
        from amqtt.client import MQTTClient

        port = mqtt_broker["port"]
        spec = ConnectionSpec(
            connection_id="mqtt-1",
            kind=ConnectionKind.MQTT,
            label="FREZE_01",
            endpoint="127.0.0.1",
            port=port,
            topics=["fabrika/hat1/#"],
        )
        motor = StreamEngine()
        toplanan = []
        motor.dispatcher.register("test", toplanan.append)
        subscriber = MqttSubscriber(
            spec=spec,
            dispatcher=motor.dispatcher,
            sequences=motor.sequences,
        )

        async def publish_and_read():
            from simulation_engine.runtime.sources import mqtt_message_source

            subscriber.messages_source = lambda: mqtt_message_source(spec)
            task = asyncio.ensure_future(subscriber.run(max_messages=1))
            await asyncio.sleep(1.5)

            client = MQTTClient()
            await client.connect(f"mqtt://127.0.0.1:{port}/")
            await client.publish(
                "fabrika/hat1/queue_length",
                json.dumps({"queue_length": 18}).encode("utf-8"),
                qos=1,
            )
            await asyncio.wait_for(task, timeout=20)
            await client.disconnect()

        asyncio.run(publish_and_read())

        assert [item.value for item in toplanan] == [18]

    def test_gercek_mqtt_olayi_isaretlenir(self, mqtt_broker):
        from amqtt.client import MQTTClient

        port = mqtt_broker["port"]
        spec = ConnectionSpec(
            connection_id="mqtt-2",
            kind=ConnectionKind.MQTT,
            label="FREZE_01",
            endpoint="127.0.0.1",
            port=port,
            topics=["fabrika/hat2/#"],
        )
        motor = StreamEngine()
        toplanan = []
        motor.dispatcher.register("test", toplanan.append)
        subscriber = MqttSubscriber(
            spec=spec,
            dispatcher=motor.dispatcher,
            sequences=motor.sequences,
        )

        async def publish_and_read():
            from simulation_engine.runtime.sources import mqtt_message_source

            subscriber.messages_source = lambda: mqtt_message_source(spec)
            task = asyncio.ensure_future(subscriber.run(max_messages=1))
            await asyncio.sleep(1.5)

            client = MQTTClient()
            await client.connect(f"mqtt://127.0.0.1:{port}/")
            await client.publish(
                "fabrika/hat2/production_count",
                json.dumps({"production_count": 7}).encode("utf-8"),
                qos=1,
            )
            await asyncio.wait_for(task, timeout=20)
            await client.disconnect()

        asyncio.run(publish_and_read())

        assert toplanan
        assert toplanan[0].source_protocol.value == "mqtt"
