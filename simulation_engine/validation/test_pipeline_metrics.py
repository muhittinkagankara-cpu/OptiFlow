"""Üretim metrikleri ve dağıtıcı.

Bu dosyadaki testler tek bir kuralı korur: **ölçülemeyen alan `None`'dır.**
Sıfır yazmak, duran bir hattı ölçülmemiş bir hattan ayırt edilemez kılar.
"""

from __future__ import annotations

from simulation_engine.runtime.events import EventDispatcher
from simulation_engine.runtime.pipeline.aggregators import (
    MIN_THROUGHPUT_SAMPLES,
    MIN_THROUGHPUT_WINDOW_MS,
    aggregate,
    latest_value,
    line_totals,
    machine_state,
    production_delta,
    snapshot_for,
    throughput_per_hour,
)
from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    MachineState,
    Metric,
    PipelineProblem,
    Quality,
    TransformResult,
)
from simulation_engine.runtime.pipeline.dispatcher import (
    DeviceDispatcher,
    detect_source_conflicts,
    verify_mapping,
)
from simulation_engine.runtime.types import ConnectionKind

MINUTE = 60_000


def event(metric=Metric.PRODUCTION_COUNT, value=10, at_ms=1_000, machine="TORNA_01", **rest):
    return DeviceEvent(
        connection_id="c1",
        machine_id=machine,
        metric=metric,
        value=value,
        at_ms=at_ms,
        source=ConnectionKind.OPCUA,
        **rest,
    )


class TestLatestValue:
    def test_hic_okuma_yoksa_none(self):
        assert latest_value([], Metric.PRODUCTION_COUNT) is None

    def test_son_okuma_doner(self):
        events = [event(value=10, at_ms=1_000), event(value=20, at_ms=2_000)]
        assert latest_value(events, Metric.PRODUCTION_COUNT) == 20

    def test_sira_zamana_gore(self):
        # Liste karisik gelse de en yeni okuma secilir.
        events = [event(value=20, at_ms=2_000), event(value=10, at_ms=1_000)]
        assert latest_value(events, Metric.PRODUCTION_COUNT) == 20

    def test_baska_olcum_karismaz(self):
        events = [event(metric=Metric.QUEUE_LENGTH, value=3)]
        assert latest_value(events, Metric.PRODUCTION_COUNT) is None

    def test_kullanilamaz_okuma_sayilmaz(self):
        events = [event(value=5, quality=Quality.BAD)]
        assert latest_value(events, Metric.PRODUCTION_COUNT) is None


class TestProductionDelta:
    def test_tek_okumada_artis_bilinmez(self):
        assert production_delta([event(value=10)]) is None

    def test_iki_okuma_arasindaki_fark(self):
        events = [event(value=10, at_ms=1_000), event(value=25, at_ms=2_000)]
        assert production_delta(events) == 15

    def test_sayac_sifirlanirsa_artis_bilinmez(self):
        # Fark mutlak degere cevrilseydi sahte bir uretim patlamasi gorunurdu.
        events = [event(value=900, at_ms=1_000), event(value=5, at_ms=2_000)]
        assert production_delta(events) is None

    def test_degismeyen_sayacta_artis_sifir(self):
        events = [event(value=10, at_ms=1_000), event(value=10, at_ms=2_000)]
        assert production_delta(events) == 0

    def test_bos_listede_none(self):
        assert production_delta([]) is None


class TestThroughput:
    def test_tek_okumada_hiz_hesaplanmaz(self):
        assert throughput_per_hour([event(value=10)]) is None

    def test_kisa_aralikta_hiz_hesaplanmaz(self):
        # Bir dakikadan kisa aralikta olcum gurultusu hizi yuzlerce kat sisirir.
        events = [event(value=10, at_ms=0), event(value=12, at_ms=5_000)]
        assert throughput_per_hour(events) is None

    def test_yeterli_aralikta_hiz_hesaplanir(self):
        events = [event(value=0, at_ms=0), event(value=60, at_ms=60 * MINUTE)]
        assert throughput_per_hour(events) == 60

    def test_yarim_saatte_iki_kat_hiz(self):
        events = [event(value=0, at_ms=0), event(value=30, at_ms=30 * MINUTE)]
        assert throughput_per_hour(events) == 60

    def test_cihaz_bildirirse_o_deger_kullanilir(self):
        events = [event(metric=Metric.THROUGHPUT_PER_HOUR, value=42)]
        assert throughput_per_hour(events) == 42

    def test_bildirilen_deger_hesaplananı_yener(self):
        events = [
            event(value=0, at_ms=0),
            event(value=60, at_ms=60 * MINUTE),
            event(metric=Metric.THROUGHPUT_PER_HOUR, value=42, at_ms=60 * MINUTE),
        ]
        assert throughput_per_hour(events) == 42

    def test_sayac_sifirlanirsa_hiz_hesaplanmaz(self):
        events = [event(value=900, at_ms=0), event(value=5, at_ms=60 * MINUTE)]
        assert throughput_per_hour(events) is None

    def test_sabitler_belgelenmis(self):
        assert MIN_THROUGHPUT_SAMPLES == 2
        assert MIN_THROUGHPUT_WINDOW_MS == 60_000


class TestMachineStateResolution:
    def test_bildirilmemis_durum_bilinmiyor(self):
        assert machine_state([]) is MachineState.UNKNOWN

    def test_son_bildirilen_durum_kullanilir(self):
        events = [
            event(metric=Metric.MACHINE_STATUS, value="running", at_ms=1_000),
            event(metric=Metric.MACHINE_STATUS, value="down", at_ms=2_000),
        ]
        assert machine_state(events) is MachineState.DOWN

    def test_bozuk_kaliteli_durum_sayilmaz(self):
        events = [
            event(metric=Metric.MACHINE_STATUS, value="running", at_ms=1_000),
            event(
                metric=Metric.MACHINE_STATUS,
                value="down",
                at_ms=2_000,
                quality=Quality.BAD,
            ),
        ]
        assert machine_state(events) is MachineState.RUNNING

    def test_plc_kodu_cevrilir(self):
        events = [event(metric=Metric.MACHINE_STATUS, value=1)]
        assert machine_state(events) is MachineState.RUNNING


class TestSnapshot:
    def test_veri_yoksa_alanlar_none(self):
        snapshot = snapshot_for("TORNA_01", [])
        assert snapshot.production_count is None
        assert snapshot.queue_length is None
        assert snapshot.throughput_per_hour is None
        assert snapshot.downtime_minutes is None

    def test_veri_yoksa_neden_yazilir(self):
        snapshot = snapshot_for("TORNA_01", [])
        assert "hiç gelmedi" in snapshot.notes["production_count"]
        assert "bildirilmedi" in snapshot.notes["state"]

    def test_uretim_okunur(self):
        snapshot = snapshot_for("TORNA_01", [event(value=1240)])
        assert snapshot.production_count == 1240

    def test_ornek_sayisi_sayilir(self):
        events = [event(value=1), event(value=2, at_ms=2_000)]
        assert snapshot_for("TORNA_01", events).sample_count == 2

    def test_son_gorulme_ani_kaydedilir(self):
        events = [event(at_ms=1_000), event(at_ms=9_000)]
        assert snapshot_for("TORNA_01", events).last_seen_ms == 9_000

    def test_veri_yoksa_son_gorulme_none(self):
        assert snapshot_for("TORNA_01", []).last_seen_ms is None

    def test_baska_makinenin_verisi_karismaz(self):
        events = [event(machine="KAYNAK_01", value=99)]
        assert snapshot_for("TORNA_01", events).production_count is None

    def test_tek_okumada_hiz_nedeni_yazilir(self):
        snapshot = snapshot_for("TORNA_01", [event(value=5)])
        assert "en az iki" in snapshot.notes["throughput_per_hour"]

    def test_kisa_pencerede_hiz_nedeni_yazilir(self):
        events = [event(value=1, at_ms=0), event(value=2, at_ms=1_000)]
        snapshot = snapshot_for("TORNA_01", events)
        assert "bir dakikadan kısa" in snapshot.notes["throughput_per_hour"]

    def test_sozluge_cevrilir(self):
        payload = snapshot_for("TORNA_01", [event(value=7)]).to_dict()
        assert payload["machine_id"] == "TORNA_01"
        assert payload["production_count"] == 7
        assert payload["state"] == "unknown"


class TestAggregate:
    def test_makineler_ayrilir(self):
        events = [event(machine="A"), event(machine="B")]
        assert set(aggregate(events).keys()) == {"A", "B"}

    def test_bos_listede_bos_doner(self):
        assert aggregate([]) == {}

    def test_her_makine_kendi_olcumunu_alir(self):
        events = [event(machine="A", value=5), event(machine="B", value=9)]
        snapshots = aggregate(events)
        assert snapshots["A"].production_count == 5
        assert snapshots["B"].production_count == 9


class TestLineTotals:
    def test_olcum_yoksa_toplam_none(self):
        totals = line_totals(aggregate([]))
        assert totals.production_count is None
        assert totals.total_machines == 0

    def test_toplam_olculen_makinelerden_alinir(self):
        events = [event(machine="A", value=5), event(machine="B", value=9)]
        totals = line_totals(aggregate(events))
        assert totals.production_count == 14
        assert totals.measured_machines == 2

    def test_olculmeyen_makine_sifir_sayilmaz(self):
        # Sifir sayilsaydi hattin uretimi oldugundan dusuk gorunurdu.
        events = [
            event(machine="A", value=5),
            event(machine="B", metric=Metric.QUEUE_LENGTH, value=2),
        ]
        totals = line_totals(aggregate(events))
        assert totals.production_count == 5
        assert totals.measured_machines == 1
        assert totals.total_machines == 2

    def test_durum_sayaclari(self):
        events = [
            event(machine="A", metric=Metric.MACHINE_STATUS, value="running"),
            event(machine="B", metric=Metric.MACHINE_STATUS, value="down"),
            event(machine="C", value=1),
        ]
        totals = line_totals(aggregate(events))
        assert totals.machines_running == 1
        assert totals.machines_down == 1
        assert totals.machines_unknown == 1


class TestVerifyMapping:
    def test_eslesen_makine_uyari_uretmez(self):
        assert verify_mapping([event(machine="torna")], ["torna"]) == []

    def test_eslesmeyen_makine_uyari_uretir(self):
        warnings = verify_mapping([event(machine="TORNA_09")], ["torna"])
        assert len(warnings) == 1
        assert "hiçbir ekrana yazılmıyor" in warnings[0].reason

    def test_buyuk_kucuk_harf_duyarsiz(self):
        # PLC "TORNA_01" yazar, modelde "torna_01" durur.
        assert verify_mapping([event(machine="TORNA_01")], ["torna_01"]) == []

    def test_olcum_sayisi_bildirilir(self):
        events = [event(machine="X"), event(machine="X", at_ms=2_000)]
        assert verify_mapping(events, [])[0].sample_count == 2

    def test_bos_olay_listesi_uyari_uretmez(self):
        assert verify_mapping([], ["torna"]) == []

    def test_uyari_sozluge_cevrilir(self):
        payload = verify_mapping([event(machine="X")], [])[0].to_dict()
        assert payload["machine_id"] == "X"
        assert payload["sample_count"] == 1


class TestDeviceDispatcher:
    def _dispatcher(self) -> DeviceDispatcher:
        return DeviceDispatcher(EventDispatcher())

    def test_kullanilabilir_olay_yayilir(self):
        dispatcher = self._dispatcher()
        assert dispatcher.dispatch([event()]) == 1

    def test_yayilan_olay_device_data_turunde(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event()])
        assert dispatcher._dispatcher.buffer.last().kind == "device_data"

    def test_olay_verisi_makine_ve_olcum_tasir(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(value=1240)])
        data = dispatcher._dispatcher.buffer.last().data
        assert data["machine_id"] == "TORNA_01"
        assert data["metric"] == "production_count"
        assert data["value"] == 1240

    def test_kullanilamaz_olay_yayilmaz(self):
        dispatcher = self._dispatcher()
        assert dispatcher.dispatch([event(quality=Quality.BAD)]) == 0

    def test_kullanilamaz_olay_tanilamaya_duser(self):
        # Sessizce atilsaydi "veri gelmiyor" ile "veri bozuk" ayirt edilemezdi.
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(quality=Quality.BAD)])
        assert len(dispatcher.problems) == 1

    def test_tanilama_olayi_uyari_seviyesinde(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(value=None)])
        assert dispatcher._dispatcher.buffer.last().level.value == "warning"

    def test_saklanan_olaylar_okunur(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(), event(at_ms=2_000)])
        assert len(dispatcher.events) == 2

    def test_pencere_asilinca_eski_olay_duser(self):
        dispatcher = DeviceDispatcher(EventDispatcher(), max_events=2)
        dispatcher.dispatch([event(value=1), event(value=2), event(value=3)])
        assert len(dispatcher.events) == 2

    def test_recent_en_yeniden_eskiye_doner(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(value=1, at_ms=1_000), event(value=2, at_ms=2_000)])
        assert dispatcher.recent()[0].value == 2

    def test_recent_baglantiya_gore_suzer(self):
        dispatcher = self._dispatcher()
        other = DeviceEvent(
            connection_id="c2",
            machine_id="X",
            metric=Metric.QUEUE_LENGTH,
            value=1,
            at_ms=1_000,
            source=ConnectionKind.MQTT,
        )
        dispatcher.dispatch([event(), other])
        assert len(dispatcher.recent(connection_id="c2")) == 1

    def test_ingest_sonucu_bolumler(self):
        dispatcher = self._dispatcher()
        result = TransformResult(
            events=[event()],
            problems=[PipelineProblem(connection_id="c1", reason="x", at_ms=1)],
        )
        assert dispatcher.ingest(result) == {"published": 1, "problems": 1}

    def test_makine_goruntuleri_uretilir(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(machine="A"), event(machine="B")])
        assert set(dispatcher.snapshots().keys()) == {"A", "B"}

    def test_esleme_uyarilari_uretilir(self):
        dispatcher = self._dispatcher()
        dispatcher.known_machine_ids = ["kaynak"]
        dispatcher.dispatch([event(machine="TORNA_01")])
        assert len(dispatcher.mapping_warnings()) == 1

    def test_bilinen_makine_uyari_uretmez(self):
        dispatcher = self._dispatcher()
        dispatcher.known_machine_ids = ["torna_01"]
        dispatcher.dispatch([event(machine="TORNA_01")])
        assert dispatcher.mapping_warnings() == []

    def test_ozet_sayilari_verir(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event(value=5)])
        summary = dispatcher.summary()
        assert summary["device_events"] == 1
        assert summary["machines"] == 1
        assert summary["production_count"] == 5

    def test_bos_ozette_uretim_none(self):
        # Hic olcum yoksa uretim toplami sifir degil, bilinmiyordur.
        assert self._dispatcher().summary()["production_count"] is None

    def test_temizleme_hepsini_siler(self):
        dispatcher = self._dispatcher()
        dispatcher.dispatch([event()])
        dispatcher.clear()
        assert dispatcher.events == [] and dispatcher.problems == []

    def test_tanilama_penceresi_sinirli(self):
        dispatcher = DeviceDispatcher(EventDispatcher(), max_problems=2)
        for index in range(5):
            dispatcher.record_problem(
                PipelineProblem(connection_id="c1", reason=str(index), at_ms=index)
            )
        assert len(dispatcher.problems) == 2


class TestSourceConflicts:
    """Aynı ölçümün iki kaynaktan gelmesi.

    Uçtan uca koşumda görüldü: iki bağlantı aynı makinenin üretim sayacını
    bildirince değerler birbirinin üstüne yazıldı ve saatlik çıktı anlamsız
    çıktı. Sessizce harmanlamak yerine uyarı üretilir.
    """

    def _other(self, machine="TORNA_01", metric=Metric.PRODUCTION_COUNT):
        return DeviceEvent(
            connection_id="c2",
            machine_id=machine,
            metric=metric,
            value=99,
            at_ms=2_000,
            source=ConnectionKind.MQTT,
        )

    def test_tek_kaynakta_uyari_yok(self):
        assert detect_source_conflicts([event(), event(at_ms=2_000)]) == []

    def test_iki_kaynak_uyari_uretir(self):
        warnings = detect_source_conflicts([event(), self._other()])
        assert len(warnings) == 1
        assert "2 ayrı" in warnings[0].reason

    def test_uyari_kaynak_adlarini_yazar(self):
        warning = detect_source_conflicts([event(), self._other()])[0]
        assert "c1" in warning.reason and "c2" in warning.reason

    def test_farkli_olcumler_cakisma_sayilmaz(self):
        # Biri uretimi, oteki kuyrugu bildiriyorsa cakisma yoktur.
        events = [event(), self._other(metric=Metric.QUEUE_LENGTH)]
        assert detect_source_conflicts(events) == []

    def test_farkli_makineler_cakisma_sayilmaz(self):
        events = [event(), self._other(machine="KAYNAK_01")]
        assert detect_source_conflicts(events) == []

    def test_olcum_sayisi_bildirilir(self):
        warning = detect_source_conflicts([event(), event(at_ms=2), self._other()])[0]
        assert warning.sample_count == 3

    def test_bos_listede_uyari_yok(self):
        assert detect_source_conflicts([]) == []

    def test_dagitici_cakismalari_bildirir(self):
        dispatcher = DeviceDispatcher(EventDispatcher())
        dispatcher.known_machine_ids = ["TORNA_01"]
        dispatcher.dispatch([event(), self._other()])
        assert len(dispatcher.mapping_warnings()) == 1

    def test_veri_atilmaz(self):
        # Hangi kaynagin dogru oldugunu kullanici bilir; veri silinmez.
        dispatcher = DeviceDispatcher(EventDispatcher())
        dispatcher.dispatch([event(), self._other()])
        assert len(dispatcher.events) == 2
