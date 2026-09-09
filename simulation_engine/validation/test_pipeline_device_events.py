"""Cihaz veri modeli: ölçüm türleri, kalite ve kullanılabilirlik."""

from __future__ import annotations

from simulation_engine.runtime.pipeline.device_events import (
    MACHINE_STATE_LABEL,
    METRIC_LABEL,
    NUMERIC_METRICS,
    DeviceEvent,
    MachineState,
    Metric,
    PipelineProblem,
    Quality,
    TransformResult,
    metric_from_name,
    parse_machine_state,
)
from simulation_engine.runtime.types import ConnectionKind


def event(**overrides) -> DeviceEvent:
    base = dict(
        connection_id="c1",
        machine_id="TORNA_01",
        metric=Metric.PRODUCTION_COUNT,
        value=1240,
        at_ms=1_000,
        source=ConnectionKind.OPCUA,
    )
    base.update(overrides)
    return DeviceEvent(**base)


class TestMetricCatalog:
    def test_her_olcumun_etiketi_var(self):
        for metric in Metric:
            assert metric in METRIC_LABEL and METRIC_LABEL[metric]

    def test_sayisal_olcumler_listede(self):
        assert Metric.PRODUCTION_COUNT in NUMERIC_METRICS
        assert Metric.QUEUE_LENGTH in NUMERIC_METRICS

    def test_makine_durumu_sayisal_degil(self):
        # Durum bir metindir; sayisal beklemek "calisiyor" degerini duserdi.
        assert Metric.MACHINE_STATUS not in NUMERIC_METRICS

    def test_bilinmeyen_olcum_sayisal_degil(self):
        assert Metric.UNKNOWN not in NUMERIC_METRICS


class TestMetricFromName:
    def test_tam_ad_taninir(self):
        assert metric_from_name("production_count") is Metric.PRODUCTION_COUNT

    def test_kisa_ad_taninir(self):
        assert metric_from_name("count") is Metric.PRODUCTION_COUNT

    def test_turkce_ad_taninir(self):
        assert metric_from_name("üretim") is Metric.PRODUCTION_COUNT
        assert metric_from_name("kuyruk") is Metric.QUEUE_LENGTH
        assert metric_from_name("fire") is Metric.SCRAP_COUNT

    def test_buyuk_harf_taninir(self):
        assert metric_from_name("QUEUE") is Metric.QUEUE_LENGTH

    def test_tire_ve_bosluk_normallesir(self):
        assert metric_from_name("cycle-time") is Metric.CYCLE_TIME_SECONDS
        assert metric_from_name("machine status") is Metric.MACHINE_STATUS

    def test_taninmayan_ad_unknown(self):
        # Serbest metin kabul edilseydi yazim hatasi yeni bir olcum yaratirdi.
        assert metric_from_name("sicaklik") is Metric.UNKNOWN

    def test_bos_ad_unknown(self):
        assert metric_from_name("   ") is Metric.UNKNOWN


class TestMachineState:
    def test_her_durumun_etiketi_var(self):
        for state in MachineState:
            assert state in MACHINE_STATE_LABEL

    def test_ingilizce_sozcuk_taninir(self):
        assert parse_machine_state("running") is MachineState.RUNNING

    def test_turkce_sozcuk_taninir(self):
        assert parse_machine_state("arıza") is MachineState.DOWN
        assert parse_machine_state("boşta") is MachineState.IDLE

    def test_buyuk_harf_ve_bosluk_taninir(self):
        assert parse_machine_state("  SETUP ") is MachineState.SETUP

    def test_plc_kodlari_taninir(self):
        assert parse_machine_state(0) is MachineState.DOWN
        assert parse_machine_state(1) is MachineState.RUNNING
        assert parse_machine_state(2) is MachineState.IDLE
        assert parse_machine_state(3) is MachineState.SETUP

    def test_bilinmeyen_kod_unknown(self):
        # Tahmin yurutmek duran bir makineyi calisiyor gosterirdi.
        assert parse_machine_state(9) is MachineState.UNKNOWN

    def test_bool_deger_taninir(self):
        assert parse_machine_state(True) is MachineState.RUNNING
        assert parse_machine_state(False) is MachineState.DOWN

    def test_taninmayan_metin_unknown(self):
        assert parse_machine_state("mavi") is MachineState.UNKNOWN

    def test_none_unknown(self):
        assert parse_machine_state(None) is MachineState.UNKNOWN


class TestUsability:
    def test_iyi_kaliteli_sayi_kullanilabilir(self):
        assert event().is_usable is True

    def test_bozuk_kalite_kullanilamaz(self):
        # Arizali bir sensorun son degeri gercek uretim gibi gosterilemez.
        assert event(quality=Quality.BAD).is_usable is False

    def test_belirsiz_kalite_kullanilabilir_ama_isaretli(self):
        item = event(quality=Quality.UNCERTAIN)
        assert item.is_usable is True
        assert item.quality is Quality.UNCERTAIN

    def test_degersiz_olcum_kullanilamaz(self):
        assert event(value=None).is_usable is False

    def test_sayisal_olcumde_metin_kullanilamaz(self):
        assert event(value="cok").is_usable is False

    def test_sayisal_olcumde_bool_kullanilamaz(self):
        # `True` Python'da 1'dir; uretim sayaci olarak kabul edilmemeli.
        assert event(value=True).is_usable is False

    def test_durum_olcumunde_metin_kullanilabilir(self):
        assert event(metric=Metric.MACHINE_STATUS, value="running").is_usable is True

    def test_sifir_uretim_kullanilabilir(self):
        # Olculmus sifir gecerlidir; olculmemis olan `None`'dir.
        assert event(value=0).is_usable is True


class TestNumericValue:
    def test_tam_sayi_donusur(self):
        assert event(value=5).numeric_value() == 5.0

    def test_ondalik_korunur(self):
        assert event(value=0.82, metric=Metric.OEE).numeric_value() == 0.82

    def test_metin_none_doner(self):
        assert event(value="x", metric=Metric.MACHINE_STATUS).numeric_value() is None

    def test_bool_none_doner(self):
        assert event(value=True).numeric_value() is None


class TestSerialization:
    def test_sozluk_alanlari_tam(self):
        payload = event(unit="adet", origin="ns=2;i=2").to_dict()
        assert payload["machine_id"] == "TORNA_01"
        assert payload["metric"] == "production_count"
        assert payload["unit"] == "adet"
        assert payload["origin"] == "ns=2;i=2"
        assert payload["usable"] is True

    def test_kalite_metin_olarak_doner(self):
        assert event(quality=Quality.UNCERTAIN).to_dict()["quality"] == "uncertain"

    def test_kaynak_metin_olarak_doner(self):
        assert event(source=ConnectionKind.MQTT).to_dict()["source"] == "mqtt"

    def test_olay_degistirilemez(self):
        item = event()
        try:
            item.value = 9  # type: ignore[misc]
        except Exception as error:
            assert isinstance(error, (AttributeError, TypeError))
        else:  # pragma: no cover
            raise AssertionError("DeviceEvent degistirilebilir olmamali")


class TestPipelineProblem:
    def test_sozluge_cevrilir(self):
        problem = PipelineProblem(
            connection_id="c1", reason="bozuk", at_ms=5, origin="a/b", sample="{"
        )
        payload = problem.to_dict()
        assert payload["reason"] == "bozuk"
        assert payload["origin"] == "a/b"

    def test_ornek_ve_adres_opsiyonel(self):
        payload = PipelineProblem(connection_id="c", reason="x", at_ms=1).to_dict()
        assert payload["origin"] is None
        assert payload["sample"] is None


class TestTransformResult:
    def test_sorunsuz_sonuc_ok(self):
        assert TransformResult(events=[], problems=[]).ok is True

    def test_sorunlu_sonuc_ok_degil(self):
        problem = PipelineProblem(connection_id="c", reason="x", at_ms=1)
        assert TransformResult(events=[], problems=[problem]).ok is False

    def test_kullanilabilir_olaylar_suzulur(self):
        result = TransformResult(events=[event(), event(value=None)], problems=[])
        assert len(result.usable_events) == 1
