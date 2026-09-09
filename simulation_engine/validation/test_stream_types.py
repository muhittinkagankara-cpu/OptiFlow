"""Akış olayı ve sıra numarası.

Sıra numarası bu sprintin en kritik parçasıdır: yineleme denetimi ona
dayanır. Bu dosyanın koruduğu davranışlar:

* Numara **bağlantı içinde** monoton artar; iki bağlantı birbirini etkilemez.
* Kurtarmadan sonra numaralandırma diskteki son numaradan sürer ve **geri
  alınmaz**.
* Bozuk kaliteli ya da değersiz bir ölçüm metrik güncellemez.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    Metric,
    Quality,
)
from simulation_engine.runtime.stream.types import (
    SOURCE_PROTOCOL_LABEL,
    DeviceDataEvent,
    SequenceCounter,
    SourceProtocol,
    dedup_key,
    from_device_event,
    protocol_of,
)
from simulation_engine.runtime.types import ConnectionKind


def data_event(**overrides) -> DeviceDataEvent:
    defaults = {
        "connector_id": "c1",
        "machine_id": "TORNA_01",
        "field": "production_count",
        "value": 100,
        "timestamp": 1_000,
        "source_protocol": SourceProtocol.REST,
        "quality": Quality.GOOD,
        "sequence": 1,
    }
    defaults.update(overrides)
    return DeviceDataEvent(**defaults)


class TestProtokolCevirisi:
    @pytest.mark.parametrize(
        "kind,protocol",
        [
            (ConnectionKind.REST, SourceProtocol.REST),
            (ConnectionKind.OPCUA, SourceProtocol.OPCUA),
            (ConnectionKind.MQTT, SourceProtocol.MQTT),
        ],
    )
    def test_bilinen_tur_cevrilir(self, kind, protocol):
        assert protocol_of(kind) is protocol

    def test_her_protokolun_etiketi_var(self):
        for protocol in SourceProtocol:
            assert SOURCE_PROTOCOL_LABEL[protocol]

    def test_bilinmeyen_etiketi_uydurmaz(self):
        assert SOURCE_PROTOCOL_LABEL[SourceProtocol.UNKNOWN] == "Bilinmeyen kaynak"


class TestYinelemeAnahtari:
    def test_anahtar_baglanti_ve_siradan_olusur(self):
        assert dedup_key("c1", 7) == "c1::7"

    def test_iki_baglanti_ayni_sirada_catismaz(self):
        assert dedup_key("c1", 7) != dedup_key("c2", 7)

    def test_olay_kendi_anahtarini_bilir(self):
        assert data_event(sequence=9).key == "c1::9"

    def test_anahtar_kararli(self):
        assert data_event().key == data_event().key


class TestOlayKullanilabilirligi:
    def test_iyi_kalite_kullanilabilir(self):
        assert data_event().is_usable is True

    def test_belirsiz_kalite_kullanilabilir(self):
        """Belirsiz bir ölçüm şüphelidir ama okunabilir; atılmaz."""
        assert data_event(quality=Quality.UNCERTAIN).is_usable is True

    def test_bozuk_kalite_kullanilamaz(self):
        assert data_event(quality=Quality.BAD).is_usable is False

    def test_degersiz_olay_kullanilamaz(self):
        assert data_event(value=None).is_usable is False

    def test_olculmus_sifir_kullanilabilir(self):
        """Ölçülmüş sıfır gerçek bir ölçümdür."""
        assert data_event(value=0).is_usable is True


class TestOlaySozlugu:
    def test_butun_alanlar_yazilir(self):
        payload = data_event().to_dict()
        assert set(payload) == {
            "connector_id",
            "machine_id",
            "field",
            "value",
            "timestamp",
            "source_protocol",
            "source_label",
            "quality",
            "sequence",
            "origin",
            "unit",
            "usable",
        }

    def test_protokol_metne_cevrilir(self):
        assert data_event().to_dict()["source_protocol"] == "rest"

    def test_okunur_etiket_yazilir(self):
        assert data_event().to_dict()["source_label"] == "REST yoklama"

    def test_kalite_metne_cevrilir(self):
        assert data_event(quality=Quality.BAD).to_dict()["quality"] == "bad"

    def test_kullanilabilirlik_yazilir(self):
        assert data_event(quality=Quality.BAD).to_dict()["usable"] is False

    def test_ham_adres_tasinir(self):
        assert data_event(origin="ns=2;i=2").to_dict()["origin"] == "ns=2;i=2"


class TestSiraSayaci:
    def test_birden_baslar(self):
        assert SequenceCounter().next("c1") == 1

    def test_monoton_artar(self):
        counter = SequenceCounter()
        assert [counter.next("c1") for _ in range(5)] == [1, 2, 3, 4, 5]

    def test_baglantilar_ayri_sayilir(self):
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c1")
        assert counter.next("c2") == 1

    def test_bir_baglantinin_sayaci_otekini_etkilemez(self):
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c2")
        assert counter.next("c1") == 2

    def test_hic_kullanilmamis_baglanti_sifir(self):
        assert SequenceCounter().current("c1") == 0

    def test_son_numara_okunur(self):
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c1")
        assert counter.current("c1") == 2

    def test_kurtarmada_verilen_noktadan_surer(self):
        counter = SequenceCounter()
        counter.resume_from("c1", 120)
        assert counter.next("c1") == 121

    def test_geri_alma_yapilmaz(self):
        """Geri alınsaydı kurtarma, işlenmiş numaraları yeniden üretirdi."""
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c1")
        counter.next("c1")
        counter.resume_from("c1", 1)
        assert counter.next("c1") == 4

    def test_negatif_devam_noktasi_sifir_sayilir(self):
        counter = SequenceCounter()
        counter.resume_from("c1", -50)
        assert counter.next("c1") == 1

    def test_tek_baglanti_sifirlanir(self):
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c2")
        counter.reset("c1")
        assert counter.current("c1") == 0
        assert counter.current("c2") == 1

    def test_hepsi_sifirlanir(self):
        counter = SequenceCounter()
        counter.next("c1")
        counter.next("c2")
        counter.reset()
        assert counter.current("c1") == 0
        assert counter.current("c2") == 0

    def test_bin_cagri_monoton_kalir(self):
        counter = SequenceCounter()
        values = [counter.next("c1") for _ in range(1_000)]
        assert values == sorted(values)
        assert len(set(values)) == 1_000


class TestOlcumdenOlaya:
    def _measurement(self, **overrides) -> DeviceEvent:
        defaults = {
            "connection_id": "c1",
            "machine_id": "TORNA_01",
            "metric": Metric.PRODUCTION_COUNT,
            "value": 162,
            "at_ms": 5_000,
            "source": ConnectionKind.OPCUA,
            "quality": Quality.GOOD,
            "origin": "ns=2;i=2",
        }
        defaults.update(overrides)
        return DeviceEvent(**defaults)

    def test_alanlar_tasinir(self):
        event = from_device_event(self._measurement(), 7)
        assert event.connector_id == "c1"
        assert event.machine_id == "TORNA_01"
        assert event.field == "production_count"
        assert event.value == 162

    def test_zaman_damgasi_olcumden_gelir(self):
        """`timestamp` cihazın ölçüm anıdır; dönüştürme anı değil."""
        assert from_device_event(self._measurement(), 1).timestamp == 5_000

    def test_protokol_cevrilir(self):
        event = from_device_event(self._measurement(), 1)
        assert event.source_protocol is SourceProtocol.OPCUA

    def test_kalite_tasinir(self):
        event = from_device_event(self._measurement(quality=Quality.BAD), 1)
        assert event.quality is Quality.BAD

    def test_sira_numarasi_verilir(self):
        assert from_device_event(self._measurement(), 42).sequence == 42

    def test_ham_adres_tasinir(self):
        assert from_device_event(self._measurement(), 1).origin == "ns=2;i=2"

    def test_ham_olcum_saklanir(self):
        """Görüntü boru hattı ham ölçümle çalışır; yeniden ayrıştırılmaz."""
        measurement = self._measurement()
        assert from_device_event(measurement, 1).device_event is measurement

    def test_bilinmeyen_metrik_alan_adi_olur(self):
        event = from_device_event(self._measurement(metric=Metric.UNKNOWN), 1)
        assert event.field == "unknown"
