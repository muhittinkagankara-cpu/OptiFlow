"""Akış motoru ve yöneticiye bağlanışı.

Bu dosya, sprintin ana sözünü korur: gerçek cihaz verisi Live Factory'ye,
OEE'ye ve alarma **aynı kapıdan** ulaşır. Ayrıca değerlendirmenin her olayda
değil aralıkla yapıldığını doğrular — saniyede yüz olay üreten bir hatta
alarmları yüz kez yeniden hesaplamak, aynı sonucu yüz kez üretmek olurdu.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.pipeline.device_events import Metric, Quality
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.stream.backpressure import BoundedEventQueue
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.engine import (
    EVALUATION_INTERVAL_MS,
    StreamEngine,
    build_mqtt_subscriber,
    build_opcua_subscriber,
    build_poller,
)
from simulation_engine.runtime.stream.scheduler import StreamHealth
from simulation_engine.runtime.stream.types import DeviceDataEvent, SourceProtocol
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

ORG = "akis-org"
NOW = 3_000_000


def spec(kind: ConnectionKind = ConnectionKind.REST, connection_id: str = "c1"):
    endpoints = {
        ConnectionKind.REST: "http://127.0.0.1:9/veri",
        ConnectionKind.OPCUA: "opc.tcp://127.0.0.1:4840",
        ConnectionKind.MQTT: "127.0.0.1",
    }
    return ConnectionSpec(
        connection_id=connection_id,
        kind=kind,
        label="TORNA_01",
        endpoint=endpoints[kind],
        topics=["ns=2;i=2"] if kind is ConnectionKind.OPCUA else [],
    )


def engine(clock_ms: int = NOW) -> StreamEngine:
    return StreamEngine(clock=lambda: clock_ms)


def data_event(sequence: int = 1, **overrides) -> DeviceDataEvent:
    defaults = {
        "connector_id": "c1",
        "machine_id": "TORNA_01",
        "field": "production_count",
        "value": 100,
        "timestamp": NOW,
        "source_protocol": SourceProtocol.REST,
        "quality": Quality.GOOD,
        "sequence": sequence,
    }
    defaults.update(overrides)
    return DeviceDataEvent(**defaults)


def run(coro):
    return asyncio.run(coro)


class TestKaynakKurulumu:
    def test_yoklayici_motora_kaydedilir(self):
        motor = engine()
        poller = build_poller(spec(), lambda: "{}", motor)
        assert motor.pollers["c1"] is poller

    def test_yoklayici_motorun_dagiticisini_paylasir(self):
        motor = engine()
        poller = build_poller(spec(), lambda: "{}", motor)
        assert poller.dispatcher is motor.dispatcher

    def test_yoklayici_motorun_plani_paylasir(self):
        motor = engine()
        poller = build_poller(spec(), lambda: "{}", motor)
        assert poller.scheduler is motor.scheduler

    def test_opcua_abonesi_kaydedilir(self):
        motor = engine()
        subscriber = build_opcua_subscriber(
            spec(ConnectionKind.OPCUA, "plc"), None, motor
        )
        assert motor.subscribers["plc"] is subscriber

    def test_mqtt_abonesi_kaydedilir(self):
        motor = engine()
        subscriber = build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        assert motor.subscribers["mq"] is subscriber

    def test_uc_protokol_ayni_dagiticiya_yazar(self):
        """Her protokol kendi yolunu izleseydi, biri yinelemeyi eler öteki elemezdi."""
        motor = engine()
        rest = build_poller(spec(), lambda: "{}", motor)
        opc = build_opcua_subscriber(spec(ConnectionKind.OPCUA, "plc"), None, motor)
        mqtt = build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        assert rest.dispatcher is opc.dispatcher is mqtt.dispatcher

    def test_sira_sayaci_paylasilir(self):
        motor = engine()
        rest = build_poller(spec(), lambda: "{}", motor)
        opc = build_opcua_subscriber(spec(ConnectionKind.OPCUA, "plc"), None, motor)
        assert rest.sequences is opc.sequences

    def test_kaynak_bulunur(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        assert motor.source_for("c1") is not None

    def test_bilinmeyen_kaynak_none(self):
        assert engine().source_for("yok") is None

    def test_kaynak_silinir(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        assert motor.remove("c1") is True
        assert motor.source_for("c1") is None

    def test_silme_planı_temizler(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        motor.remove("c1")
        assert "c1" not in motor.scheduler.entries

    def test_olmayan_kaynak_silinemez(self):
        assert engine().remove("yok") is False

    def test_calisma_durumu_okunur(self):
        motor = engine()
        poller = build_poller(spec(), lambda: "{}", motor)
        assert motor.is_running("c1") is False
        poller.running = True
        assert motor.is_running("c1") is True


class TestAlicilar:
    def test_goruntu_alicisi_ham_olcumu_verir(self):
        """Görüntü boru hattı `DeviceEvent` ile çalışır; yeniden ayrıştırılmaz."""
        motor = engine()
        seen = []
        motor.register_snapshot_sink(seen.append)
        poller = build_poller(spec(), lambda: json.dumps({"production_count": 5}), motor)
        run(poller.poll_once(NOW))
        motor.dispatcher.drain(NOW)
        assert len(seen) == 1
        assert seen[0].metric is Metric.PRODUCTION_COUNT

    def test_ham_olcum_yoksa_goruntu_alicisi_cagrilmaz(self):
        motor = engine()
        seen = []
        motor.register_snapshot_sink(seen.append)
        motor.dispatcher.dispatch(data_event(), NOW)
        assert seen == []

    def test_izleme_alicisi_ilk_olayda_calisir(self):
        motor = engine()
        calls = []
        motor.register_monitoring_sink(calls.append)
        motor.dispatcher.dispatch(data_event(1), NOW)
        assert len(calls) == 1

    def test_izleme_alicisi_aralik_icinde_tekrar_calismaz(self):
        motor = engine()
        calls = []
        motor.register_monitoring_sink(calls.append)
        motor.dispatcher.dispatch(data_event(1), NOW)
        motor.dispatcher.dispatch(data_event(2), NOW)
        assert len(calls) == 1

    def test_aralik_gecince_yeniden_calisir(self):
        anlar = [NOW, NOW + EVALUATION_INTERVAL_MS + 1]
        motor = StreamEngine(clock=lambda: anlar.pop(0) if anlar else NOW)
        calls = []
        motor.register_monitoring_sink(calls.append)
        motor.dispatcher.dispatch(data_event(1), NOW)
        motor.dispatcher.dispatch(data_event(2), NOW)
        assert len(calls) == 2

    def test_degerlendirme_sayilir(self):
        motor = engine()
        motor.register_monitoring_sink(lambda now: None)
        motor.dispatcher.dispatch(data_event(1), NOW)
        assert motor.evaluations == 1

    def test_yayin_alicisi_tamponu_doldurur(self):
        motor = engine()
        motor.register_broadcast_sink()
        motor.dispatcher.dispatch(data_event(1), NOW)
        assert len(motor.recent) == 1

    def test_yayin_alicisi_disari_da_verir(self):
        motor = engine()
        seen = []
        motor.register_broadcast_sink(seen.append)
        motor.dispatcher.dispatch(data_event(1), NOW)
        assert len(seen) == 1

    def test_tampon_sinirlidir(self):
        motor = engine()
        motor.register_broadcast_sink()
        for sequence in range(300):
            motor.dispatcher.dispatch(data_event(sequence + 1), NOW)
        assert len(motor.recent) == 200

    def test_son_olaylar_yeniden_eskiye(self):
        motor = engine()
        motor.register_broadcast_sink()
        motor.dispatcher.dispatch(data_event(1), NOW)
        motor.dispatcher.dispatch(data_event(2), NOW)
        rows = motor.recent_events()
        assert [row["sequence"] for row in rows] == [2, 1]


class TestMotorDurumu:
    def test_bos_motor_durduruldu(self):
        assert engine().health() is StreamHealth.STOPPED

    def test_calisan_akis_bildirilir(self):
        motor = engine()
        poller = build_poller(spec(), lambda: "{}", motor)
        poller.running = True
        assert motor.health() is StreamHealth.IDLE

    def test_en_kotu_durum_kazanir(self):
        """Bir akış hata alıyorsa özet "iyi" olamaz."""
        motor = engine()
        iyi = build_poller(spec(), lambda: "{}", motor)
        iyi.running = True
        iyi.first_data_at_ms = NOW
        kotu = build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        kotu.running = True
        kotu.last_error = "broker kapali"
        assert motor.health() is StreamHealth.FAILING

    def test_baski_hatadan_once_gelir(self):
        motor = StreamEngine(
            clock=lambda: NOW, dispatcher=StreamDispatcher(queue=BoundedEventQueue(1))
        )
        source = build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        source.running = True
        motor.dispatcher.queue.push(data_event())
        assert motor.health() is StreamHealth.BACKPRESSURE

    def test_yoklama_sikligi_ortalamasi(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor, interval_ms=1_000)
        build_poller(spec(connection_id="c2"), lambda: "{}", motor, interval_ms=500)
        assert motor.average_poll_rate_hz() == pytest.approx(1.5)

    def test_yoklayici_yoksa_siklik_none(self):
        """Sıfır dönmek, REST bağlantısı olmayan kurulumu yanlış anlatırdı."""
        assert engine().average_poll_rate_hz() is None

    def test_ozet_alanlari(self):
        payload = engine().stats()
        assert set(payload) == {
            "streams",
            "running",
            "health",
            "poll_rate_hz",
            "schedule",
            "dispatcher",
        }

    def test_akis_sayisi_dogru(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        assert motor.stats()["streams"] == 2

    def test_hepsini_durdurma(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        build_mqtt_subscriber(spec(ConnectionKind.MQTT, "mq"), None, motor)
        assert motor.stop_all() == 2

    def test_temizleme_her_seyi_sifirlar(self):
        motor = engine()
        build_poller(spec(), lambda: "{}", motor)
        motor.register_broadcast_sink()
        motor.dispatcher.dispatch(data_event(), NOW)
        motor.clear()
        assert motor.pollers == {}
        assert motor.recent == []
        assert motor.dispatcher.processed == 0


# -- Yönetici bütünleşmesi --------------------------------------------------


@pytest.fixture
def manager() -> RuntimeManager:
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG
    return instance


def mapping() -> MappingTable:
    return MappingTable(
        entries=[
            MetricMapping("production_count", "TORNA_01", Metric.PRODUCTION_COUNT),
            MetricMapping("machine_status", "TORNA_01", Metric.MACHINE_STATUS),
        ]
    )


class TestYoneticiBaglantisi:
    def test_uc_alici_sirasiyla_kayitli(self):
        """Sıra bir karardır: önce görüntü, sonra yayın, en son izleme.

        Yayın izlemeden sonra gelseydi, ekran alarmı onu doğuran ölçümden
        önce alır ve nedenini gösteremezdi.
        """
        instance = RuntimeManager(adapters={})
        assert instance.stream.dispatcher.sink_names() == [
            "snapshot",
            "broadcast",
            "monitoring",
        ]

    def test_olay_goruntuyu_gunceller(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, value=162, device_event=_measurement(162)), NOW
        )
        snapshots = manager.devices.snapshots_by_machine
        assert snapshots["TORNA_01"].production_count == 162

    def test_olay_sse_akisina_yazilir(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, device_event=_measurement(100)), NOW
        )
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "device_data" in kinds

    def test_bozuk_kalite_yayinlanmaz(self, manager):
        """Bozuk bir ölçümü ekrana göndermek, arızalı sensörü canlı veri saymaktır."""
        manager.stream.dispatcher.dispatch(
            data_event(1, quality=Quality.BAD, device_event=_measurement(100)), NOW
        )
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "device_data" not in kinds

    def test_bozuk_kalite_sayilir(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, quality=Quality.BAD, device_event=_measurement(100)), NOW
        )
        assert manager.stream.dispatcher.unusable == 1

    def test_kiraci_bilinmiyorsa_degerlendirme_yok(self):
        instance = RuntimeManager(adapters={})
        instance.active_org_id = None
        instance.stream.dispatcher.dispatch(
            data_event(1, device_event=_measurement(100)), NOW
        )
        assert instance.monitoring.alarms.active_count == 0

    def test_duran_makine_alarm_uretir(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, field="machine_status", value="down", device_event=_status("down")),
            NOW,
        )
        assert manager.monitoring.alarms.active_count >= 1

    def test_alarm_olayi_yayilir(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, field="machine_status", value="down", device_event=_status("down")),
            NOW,
        )
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "alarm" in kinds

    def test_uretim_guncellemesi_yayilir(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, value=50, device_event=_measurement(50)), NOW
        )
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "production_update" in kinds

    def test_degismeyen_uretim_yeniden_yayilmaz(self, manager):
        """Değişmeyen bir sayıyı yeniden yayınlamak sahte "yeni veri" üretirdi."""
        anlar = iter([NOW, NOW + 10_000, NOW + 20_000])
        manager.stream.clock = lambda: next(anlar, NOW + 30_000)
        manager.stream.dispatcher.dispatch(
            data_event(1, value=50, device_event=_measurement(50)), NOW
        )
        before = _count(manager, "production_update")
        manager.stream.dispatcher.dispatch(
            data_event(2, value=50, device_event=_measurement(50)), NOW + 10_000
        )
        assert _count(manager, "production_update") == before

    def test_pano_akis_kartlarini_tasir(self, manager):
        payload = manager.runtime_dashboard(ORG, NOW)
        assert set(payload["stream"]) >= {"streams", "health", "poll_rate_hz"}

    def test_son_olcumler_kiraciya_gore_suzulur(self, manager):
        manager.stream.dispatcher.dispatch(
            data_event(1, device_event=_measurement(100)), NOW
        )
        # Bağlantı kayıtlı olmadığı için bu kiracıya ait sayılmaz.
        assert manager.recent_device_data(ORG) == []

    def test_kayitli_baglantinin_olcumu_gorunur(self, manager):
        manager.register(ORG, spec())
        manager.stream.dispatcher.dispatch(
            data_event(1, device_event=_measurement(100)), NOW
        )
        assert len(manager.recent_device_data(ORG)) == 1


def _measurement(value):
    from simulation_engine.runtime.pipeline.device_events import DeviceEvent

    return DeviceEvent(
        connection_id="c1",
        machine_id="TORNA_01",
        metric=Metric.PRODUCTION_COUNT,
        value=value,
        at_ms=NOW,
        source=ConnectionKind.REST,
    )


def _status(value):
    from simulation_engine.runtime.pipeline.device_events import DeviceEvent

    return DeviceEvent(
        connection_id="c1",
        machine_id="TORNA_01",
        metric=Metric.MACHINE_STATUS,
        value=value,
        at_ms=NOW,
        source=ConnectionKind.REST,
    )


def _count(manager: RuntimeManager, kind: str) -> int:
    return len([event for event in manager.dispatcher.buffer.all() if event.kind == kind])
