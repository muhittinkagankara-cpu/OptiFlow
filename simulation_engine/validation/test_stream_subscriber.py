"""Abonelik motorları: OPC UA ve MQTT.

Bu dosyanın koruduğu iki ayrım:

* **OPC UA'da yalnızca değişim olay üretir.** Aynı değeri her yayın
  aralığında yeniden işlemek, üretim sayacı değişmediği hâlde ekranı sürekli
  "yeni veri" gösterir hâle getirirdi.
* **MQTT'de aynı değer yeniden olay üretir.** Bir cihazın aynı değeri yeniden
  yayınlaması, hâlâ yayında olduğunu söyleyen bir bilgidir ve "veri gelmiyor"
  alarmını kapatan tek şeydir.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from simulation_engine.runtime.pipeline.device_events import Metric
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.stream.backpressure import BoundedEventQueue
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.scheduler import StreamHealth
from simulation_engine.runtime.stream.subscriber import (
    MqttSubscriber,
    OpcUaSubscriber,
    SubscriptionOutcome,
    _unpack_opcua,
)
from simulation_engine.runtime.stream.types import SequenceCounter
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

NOW = 2_000_000


def opc_spec() -> ConnectionSpec:
    return ConnectionSpec(
        connection_id="plc",
        kind=ConnectionKind.OPCUA,
        label="TORNA_01",
        endpoint="opc.tcp://127.0.0.1:4840",
        topics=["ns=2;i=2"],
    )


def mqtt_spec() -> ConnectionSpec:
    return ConnectionSpec(
        connection_id="mq",
        kind=ConnectionKind.MQTT,
        label="FREZE_01",
        endpoint="127.0.0.1",
        topics=["fabrika/hat1/#"],
    )


def node_mapping() -> MappingTable:
    return MappingTable(
        entries=[
            MetricMapping(
                origin="ns=2;i=2",
                machine_id="TORNA_01",
                metric=Metric.PRODUCTION_COUNT,
            )
        ]
    )


def opc_subscriber(**overrides) -> OpcUaSubscriber:
    defaults = {
        "spec": opc_spec(),
        "dispatcher": StreamDispatcher(),
        "sequences": SequenceCounter(),
        "mapping": node_mapping(),
        "clock": lambda: NOW,
    }
    defaults.update(overrides)
    return OpcUaSubscriber(**defaults)


def mqtt_subscriber(**overrides) -> MqttSubscriber:
    defaults = {
        "spec": mqtt_spec(),
        "dispatcher": StreamDispatcher(),
        "sequences": SequenceCounter(),
        "clock": lambda: NOW,
    }
    defaults.update(overrides)
    return MqttSubscriber(**defaults)


def run(coro):
    return asyncio.run(coro)


class TestOpcUaDegisimi:
    def test_ilk_deger_olay_uretir(self):
        subscriber = opc_subscriber()
        outcome = subscriber.on_value("ns=2;i=2", 100, NOW)
        assert outcome is not None
        assert outcome.events == 1

    def test_ayni_deger_olay_uretmez(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        assert subscriber.on_value("ns=2;i=2", 100, NOW + 500) is None

    def test_degisen_deger_olay_uretir(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        assert subscriber.on_value("ns=2;i=2", 105, NOW + 500) is not None

    def test_eski_degere_donus_de_degisimdir(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        subscriber.on_value("ns=2;i=2", 105, NOW + 1)
        assert subscriber.on_value("ns=2;i=2", 100, NOW + 2) is not None

    def test_farkli_dugumler_ayri_izlenir(self):
        subscriber = opc_subscriber(
            mapping=MappingTable(
                entries=[
                    MetricMapping("ns=2;i=2", "TORNA_01", Metric.PRODUCTION_COUNT),
                    MetricMapping("ns=2;i=3", "TORNA_01", Metric.QUEUE_LENGTH),
                ]
            )
        )
        subscriber.on_value("ns=2;i=2", 100, NOW)
        assert subscriber.on_value("ns=2;i=3", 100, NOW) is not None

    def test_yuz_ayni_bildirim_tek_olay_birakir(self):
        subscriber = opc_subscriber()
        for step in range(100):
            subscriber.on_value("ns=2;i=2", 100, NOW + step)
        assert subscriber.dispatcher.queue.depth == 1

    def test_sira_numaralari_artar(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        subscriber.on_value("ns=2;i=2", 101, NOW + 1)
        events = subscriber.dispatcher.drain(NOW + 2)
        assert [item.sequence for item in events] == [1, 2]

    def test_protokol_opcua_isaretlenir(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        assert subscriber.dispatcher.drain(NOW)[0].source_protocol.value == "opcua"

    def test_ham_adres_dugum_kimligi(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        assert subscriber.dispatcher.drain(NOW)[0].origin == "ns=2;i=2"

    def test_eslenmemis_dugum_sorun_uretir(self):
        """Eşlenmemiş bir düğüm için makine ve metrik uydurulmaz."""
        subscriber = opc_subscriber(mapping=None)
        outcome = subscriber.on_value("ns=9;i=9", 100, NOW)
        assert outcome.events == 0
        assert outcome.problems == 1

    def test_saat_verilmezse_kendi_saati_kullanilir(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100)
        assert subscriber.dispatcher.drain(NOW)[0].timestamp == NOW

    def test_bildirim_sayilir(self):
        subscriber = opc_subscriber()
        subscriber.on_value("ns=2;i=2", 100, NOW)
        subscriber.on_value("ns=2;i=2", 101, NOW + 1)
        assert subscriber.notifications == 2


class TestOpcUaDongusu:
    def test_kaynak_yoksa_hata(self):
        with pytest.raises(RuntimeError):
            run(opc_subscriber().run())

    def test_bildirimler_islenir(self):
        async def source():
            for value in (100, 101, 102):
                yield ("ns=2;i=2", value, NOW)

        subscriber = opc_subscriber(notifications_source=source)
        run(subscriber.run(max_notifications=3))
        assert subscriber.notifications == 3

    def test_dongu_sonunda_durur(self):
        async def source():
            yield ("ns=2;i=2", 100, NOW)

        subscriber = opc_subscriber(notifications_source=source)
        run(subscriber.run(max_notifications=1))
        assert subscriber.running is False

    def test_kaynak_hatasi_kaydedilir(self):
        async def source():
            raise ConnectionError("oturum koptu")
            yield  # pragma: no cover

        subscriber = opc_subscriber(notifications_source=source)
        run(subscriber.run())
        assert subscriber.last_error == "oturum koptu"

    def test_durdurma_donguye_girmez(self):
        async def source():
            yield ("ns=2;i=2", 100, NOW)

        subscriber = opc_subscriber(notifications_source=source)
        subscriber.stop()
        run(subscriber.run())
        assert subscriber.notifications == 0

    def test_dongu_olaylari_dagitir(self):
        async def source():
            yield ("ns=2;i=2", 100, NOW)

        subscriber = opc_subscriber(notifications_source=source)
        seen = []
        subscriber.dispatcher.register("izle", seen.append)
        run(subscriber.run(max_notifications=1))
        assert len(seen) == 1


class TestBildirimCozumu:
    def test_ucluden_cozulur(self):
        assert _unpack_opcua(("ns=2;i=2", 100, 5_000)) == ("ns=2;i=2", 100, 5_000)

    def test_ikiliden_cozulur(self):
        assert _unpack_opcua(("ns=2;i=2", 100)) == ("ns=2;i=2", 100, None)

    def test_damgasiz_bildirimde_zaman_uydurulmaz(self):
        assert _unpack_opcua(("ns=2;i=2", 100))[2] is None

    def test_tanimsiz_bicim_hata_verir(self):
        with pytest.raises(ValueError):
            _unpack_opcua("gecersiz")

    def test_tek_elemanli_dizi_hata_verir(self):
        with pytest.raises(ValueError):
            _unpack_opcua(("yalniz",))


class TestMqttAboneligi:
    def test_mesaj_olaya_cevrilir(self):
        subscriber = mqtt_subscriber()
        outcome = subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 18}), NOW
        )
        assert outcome.events == 1

    def test_ayni_mesaj_yeniden_olay_uretir(self):
        """Aynı değerin yeniden yayını, cihazın hâlâ yayında olduğunu söyler."""
        subscriber = mqtt_subscriber()
        payload = json.dumps({"queue_length": 18})
        subscriber.on_message("fabrika/hat1/queue_length", payload, NOW)
        outcome = subscriber.on_message(
            "fabrika/hat1/queue_length", payload, NOW + 1_000
        )
        assert outcome.events == 1

    def test_sira_numaralari_artar(self):
        subscriber = mqtt_subscriber()
        payload = json.dumps({"queue_length": 18})
        subscriber.on_message("fabrika/hat1/queue_length", payload, NOW)
        subscriber.on_message("fabrika/hat1/queue_length", payload, NOW + 1)
        events = subscriber.dispatcher.drain(NOW + 2)
        assert [item.sequence for item in events] == [1, 2]

    def test_protokol_mqtt_isaretlenir(self):
        subscriber = mqtt_subscriber()
        subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 3}), NOW
        )
        assert subscriber.dispatcher.drain(NOW)[0].source_protocol.value == "mqtt"

    def test_bozuk_yuk_sorun_uretir(self):
        subscriber = mqtt_subscriber()
        outcome = subscriber.on_message("fabrika/hat1/x", "bu json degil", NOW)
        assert outcome.problems >= 1

    def test_saat_verilmezse_kendi_saati(self):
        subscriber = mqtt_subscriber()
        subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 1})
        )
        assert subscriber.dispatcher.drain(NOW)[0].timestamp == NOW

    def test_ilk_veri_ani_kaydedilir(self):
        subscriber = mqtt_subscriber()
        subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 1}), NOW
        )
        assert subscriber.first_data_at_ms == NOW


class TestMqttDongusu:
    def test_kaynak_yoksa_hata(self):
        with pytest.raises(RuntimeError):
            run(mqtt_subscriber().run())

    def test_mesajlar_islenir(self):
        async def source():
            for value in (1, 2, 3):
                yield ("fabrika/hat1/queue_length", json.dumps({"queue_length": value}))

        subscriber = mqtt_subscriber(messages_source=source)
        run(subscriber.run(max_messages=3))
        assert subscriber.notifications == 3

    def test_kaynak_hatasi_kaydedilir(self):
        async def source():
            raise ConnectionError("broker kapali")
            yield  # pragma: no cover

        subscriber = mqtt_subscriber(messages_source=source)
        run(subscriber.run())
        assert subscriber.last_error == "broker kapali"

    def test_durdurma_donguye_girmez(self):
        async def source():
            yield ("fabrika/hat1/x", json.dumps({"queue_length": 1}))

        subscriber = mqtt_subscriber(messages_source=source)
        subscriber.stop()
        run(subscriber.run())
        assert subscriber.notifications == 0


class TestAbonelikSagligi:
    def test_calismayan_abone_durduruldu(self):
        assert mqtt_subscriber().health is StreamHealth.STOPPED

    def test_veri_gelmeden_bekleniyor(self):
        """Açık bir abonelik, akan veri demek değildir."""
        subscriber = mqtt_subscriber()
        subscriber.running = True
        assert subscriber.health is StreamHealth.IDLE

    def test_veri_gelince_calisiyor(self):
        subscriber = mqtt_subscriber()
        subscriber.running = True
        subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 1}), NOW
        )
        assert subscriber.health is StreamHealth.RUNNING

    def test_hata_alan_abone_isaretlenir(self):
        subscriber = mqtt_subscriber()
        subscriber.running = True
        subscriber.last_error = "broker kapali"
        assert subscriber.health is StreamHealth.FAILING

    def test_dolu_kuyruk_baski_bildirir(self):
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=1))
        subscriber = mqtt_subscriber(dispatcher=dispatcher)
        subscriber.running = True
        subscriber.on_message(
            "fabrika/hat1/queue_length", json.dumps({"queue_length": 1}), NOW
        )
        assert subscriber.health is StreamHealth.BACKPRESSURE

    def test_durum_iki_kimlik_tasir(self):
        state = mqtt_subscriber().state()
        assert state["connector_id"] == "mq"
        assert state["connection_id"] == "mq"

    def test_durum_protokolu_tasir(self):
        assert opc_subscriber().state()["protocol"] == "opcua"

    def test_sonuclar_sinirlanir(self):
        subscriber = mqtt_subscriber()
        for step in range(60):
            subscriber.on_message(
                "fabrika/hat1/queue_length",
                json.dumps({"queue_length": step}),
                NOW + step,
            )
        assert len(subscriber.outcomes) == 50

    def test_sonuc_sozlugu_alanlari(self):
        outcome = SubscriptionOutcome(connector_id="mq", at_ms=NOW, origin="konu")
        assert set(outcome.to_dict()) == {
            "connector_id",
            "at_ms",
            "origin",
            "events",
            "accepted",
            "duplicates",
            "problems",
        }
