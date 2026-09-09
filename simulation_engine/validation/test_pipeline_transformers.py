"""Protokol yüklerinin ortak modele çevrilmesi.

En önemli davranış: hiçbir sorun sessizce yutulmaz. Bozuk bir JSON, tanınmayan
bir alan ya da eşlenmemiş bir düğüm, `problems` listesinde görünür.
"""

from __future__ import annotations

import json

from simulation_engine.runtime.pipeline.device_events import Metric, Quality
from simulation_engine.runtime.pipeline.transformers import (
    IDENTITY_FIELDS,
    MAX_DEPTH,
    MappingTable,
    MetricMapping,
    flatten,
    from_mqtt_message,
    from_opcua_value,
    from_rest_payload,
    identity_of,
    leaf_name,
    parse_json,
    sample_of,
)


def mapping(*entries: MetricMapping) -> MappingTable:
    return MappingTable(entries=list(entries))


class TestFlatten:
    def test_duz_sozluk_acilir(self):
        assert flatten({"a": 1}) == [("a", 1)]

    def test_ic_ice_sozluk_nokta_ile_acilir(self):
        assert flatten({"a": {"b": 2}}) == [("a.b", 2)]

    def test_dizi_koseli_parantezle_acilir(self):
        assert flatten([1, 2]) == [("[0]", 1), ("[1]", 2)]

    def test_dizi_icindeki_sozluk_acilir(self):
        assert flatten({"m": [{"x": 1}]}) == [("m[0].x", 1)]

    def test_yaprak_olmayan_dugum_sonuca_girmez(self):
        yollar = [path for path, _ in flatten({"a": {"b": {"c": 3}}})]
        assert yollar == ["a.b.c"]

    def test_derinlik_siniri_uygulanir(self):
        derin = {"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}
        assert flatten(derin) == []

    def test_sinirin_altindaki_derinlik_acilir(self):
        assert flatten({"a": {"b": {"c": 1}}}) == [("a.b.c", 1)]

    def test_max_derinlik_bes(self):
        assert MAX_DEPTH == 5

    def test_bos_sozluk_bos_doner(self):
        assert flatten({}) == []


class TestLeafName:
    def test_son_parca_doner(self):
        assert leaf_name("a.b.count") == "count"

    def test_dizi_indeksi_atilir(self):
        assert leaf_name("m[0].adet") == "adet"

    def test_tek_parca_kendisidir(self):
        assert leaf_name("adet") == "adet"


class TestParseJson:
    def test_gecerli_json_cozulur(self):
        document, error = parse_json(b'{"a":1}')
        assert document == {"a": 1}
        assert error is None

    def test_bozuk_json_neden_doner(self):
        document, error = parse_json(b"{bozuk")
        assert document is None
        assert "JSON çözülemedi" in error

    def test_utf8_olmayan_yuk_bildirilir(self):
        document, error = parse_json(b"\xff\xfe\x00")
        assert document is None
        assert "UTF-8" in error

    def test_metin_girdi_de_kabul_edilir(self):
        assert parse_json('{"a":2}')[0] == {"a": 2}


class TestIdentity:
    def test_makine_kimligi_alinir(self):
        machine, rest = identity_of({"machine_id": "TORNA_01", "adet": 5})
        assert machine == "TORNA_01"
        assert rest == {"adet": 5}

    def test_kimlik_alani_yukten_cikarilir(self):
        # Cikarilmasaydi `machine_id` bir olcum sanilir ve tanilamaya duserdi.
        _, rest = identity_of({"machine": "X", "adet": 1})
        assert "machine" not in rest

    def test_kimlik_yoksa_none(self):
        machine, rest = identity_of({"adet": 5})
        assert machine is None
        assert rest == {"adet": 5}

    def test_bos_kimlik_yok_sayilir(self):
        assert identity_of({"machine_id": "   ", "adet": 1})[0] is None

    def test_sayisal_kimlik_yok_sayilir(self):
        assert identity_of({"id": 5, "adet": 1})[0] is None

    def test_sozluk_olmayan_yuk_degismez(self):
        assert identity_of([1, 2]) == (None, [1, 2])

    def test_yaygin_alan_adlari_taninir(self):
        for field_name in ("machine_id", "station", "makine"):
            assert field_name in IDENTITY_FIELDS


class TestSampleOf:
    def test_bayt_yuk_metne_cevrilir(self):
        assert sample_of(b'{"a":1}') == '{"a":1}'

    def test_uzun_yuk_kirpilir(self):
        assert len(sample_of("x" * 500)) <= 160

    def test_bosluklar_sadelestirilir(self):
        assert sample_of("a\n\n  b") == "a b"


class TestMqttTransform:
    def test_duz_yuk_cevrilir(self):
        result = from_mqtt_message("c1", "fabrika/torna/olcum", b'{"production_count": 12}', 100)
        assert result.ok is True
        assert result.events[0].metric is Metric.PRODUCTION_COUNT
        assert result.events[0].value == 12

    def test_makine_konudan_cikarilir(self):
        result = from_mqtt_message("c1", "fabrika/torna/olcum", b'{"queue": 3}', 100)
        assert result.events[0].machine_id == "torna"

    def test_kimlik_alani_konuyu_yener(self):
        result = from_mqtt_message(
            "c1", "fabrika/torna/olcum", b'{"machine_id": "TORNA_01", "queue": 3}', 100
        )
        assert result.events[0].machine_id == "TORNA_01"

    def test_ic_ice_yuk_cevrilir(self):
        result = from_mqtt_message(
            "c1", "fab/hat", b'{"istasyonlar": {"torna": {"adet": 10}}}', 100
        )
        assert result.events[0].machine_id == "torna"
        assert result.events[0].value == 10

    def test_dizi_yuk_her_satiri_cevirir(self):
        payload = json.dumps(
            [
                {"machine_id": "TORNA_01", "adet": 5},
                {"machine_id": "KAYNAK_01", "adet": 9},
            ]
        ).encode()
        result = from_mqtt_message("c1", "fab/hat", payload, 100)
        assert [event.machine_id for event in result.events] == ["TORNA_01", "KAYNAK_01"]

    def test_coklu_alan_coklu_olay_uretir(self):
        result = from_mqtt_message(
            "c1", "fab/torna", b'{"adet": 5, "kuyruk": 2, "durum": "running"}', 100
        )
        assert len(result.events) == 3

    def test_bozuk_json_tanilamaya_duser(self):
        # Sessizce yutulsaydi hic veri gelmedigi fark edilmezdi.
        result = from_mqtt_message("c1", "fab/torna", b"{bozuk", 100)
        assert result.events == []
        assert "JSON çözülemedi" in result.problems[0].reason

    def test_taninmayan_alan_tanilamaya_duser(self):
        result = from_mqtt_message("c1", "fab/torna", b'{"sicaklik": 80}', 100)
        assert result.events == []
        assert "tanınmadı" in result.problems[0].reason

    def test_bir_bozuk_alan_otekileri_iptal_etmez(self):
        result = from_mqtt_message("c1", "fab/torna", b'{"adet": 5, "sicaklik": 80}', 100)
        assert len(result.events) == 1
        assert len(result.problems) == 1

    def test_sayisal_olmayan_uretim_tanilamaya_duser(self):
        result = from_mqtt_message("c1", "fab/torna", b'{"adet": "cok"}', 100)
        assert result.usable_events == []
        assert "sayısal olmalı" in result.problems[0].reason

    def test_zaman_disaridan_gelir(self):
        result = from_mqtt_message("c1", "fab/torna", b'{"adet": 1}', 7_777)
        assert result.events[0].at_ms == 7_777

    def test_kaynak_mqtt_olarak_isaretlenir(self):
        result = from_mqtt_message("c1", "fab/torna", b'{"adet": 1}', 100)
        assert result.events[0].source.value == "mqtt"

    def test_esleme_tablosu_alan_adini_yener(self):
        table = mapping(
            MetricMapping(origin="sicaklik", machine_id="FIRIN", metric=Metric.OEE)
        )
        result = from_mqtt_message("c1", "fab/firin", b'{"sicaklik": 0.9}', 100, table)
        assert result.events[0].machine_id == "FIRIN"
        assert result.events[0].metric is Metric.OEE

    def test_esleme_birimi_tasir(self):
        table = mapping(
            MetricMapping(
                origin="adet", machine_id="T", metric=Metric.PRODUCTION_COUNT, unit="parça"
            )
        )
        result = from_mqtt_message("c1", "fab/t", b'{"adet": 3}', 100, table)
        assert result.events[0].unit == "parça"

    def test_bos_yuk_sorun_uretir(self):
        result = from_mqtt_message("c1", "fab/t", b"{}", 100)
        assert result.events == []
        assert "okunabilir hiçbir alan yok" in result.problems[0].reason

    def test_ciplak_deger_esleme_olmadan_reddedilir(self):
        result = from_mqtt_message("c1", "fabrika/torna/adet", b"42", 100)
        assert result.events == []
        assert "çıplak değer" in result.problems[0].reason

    def test_ciplak_deger_esleme_ile_cevrilir(self):
        table = mapping(
            MetricMapping(
                origin="fabrika/torna/adet",
                machine_id="TORNA_01",
                metric=Metric.PRODUCTION_COUNT,
            )
        )
        result = from_mqtt_message("c1", "fabrika/torna/adet", b"42", 100, table)
        assert result.events[0].value == 42
        assert result.events[0].machine_id == "TORNA_01"


class TestOpcUaTransform:
    def test_eslenmemis_dugum_tanilamaya_duser(self):
        # Dugum kimligi olcumun adini tasimaz; esleme zorunludur.
        result = from_opcua_value("c1", "ns=2;i=5", 1240, 100)
        assert result.events == []
        assert "eşlenmemiş" in result.problems[0].reason

    def test_eslenmis_dugum_cevrilir(self):
        table = mapping(
            MetricMapping(
                origin="ns=2;i=5", machine_id="TORNA_01", metric=Metric.PRODUCTION_COUNT
            )
        )
        result = from_opcua_value("c1", "ns=2;i=5", 1240, 100, table)
        assert result.ok is True
        assert result.events[0].value == 1240

    def test_kaynak_opcua_olarak_isaretlenir(self):
        table = mapping(
            MetricMapping(origin="ns=2;i=5", machine_id="T", metric=Metric.QUEUE_LENGTH)
        )
        result = from_opcua_value("c1", "ns=2;i=5", 3, 100, table)
        assert result.events[0].source.value == "opcua"

    def test_bozuk_kalite_kullanilamaz_ama_kaydedilir(self):
        table = mapping(
            MetricMapping(origin="ns=2;i=5", machine_id="T", metric=Metric.PRODUCTION_COUNT)
        )
        result = from_opcua_value("c1", "ns=2;i=5", 5, 100, table, quality=Quality.BAD)
        assert result.usable_events == []
        assert result.events != []
        assert "kalite" in result.problems[0].reason

    def test_sayisal_olmayan_deger_bildirilir(self):
        table = mapping(
            MetricMapping(origin="ns=2;i=5", machine_id="T", metric=Metric.PRODUCTION_COUNT)
        )
        result = from_opcua_value("c1", "ns=2;i=5", "yok", 100, table)
        assert result.usable_events == []
        assert "okunamadı" in result.problems[0].reason

    def test_durum_dugumu_metin_kabul_eder(self):
        table = mapping(
            MetricMapping(origin="ns=2;i=7", machine_id="T", metric=Metric.MACHINE_STATUS)
        )
        result = from_opcua_value("c1", "ns=2;i=7", "running", 100, table)
        assert result.ok is True
        assert result.events[0].value == "running"

    def test_dugum_kimligi_adres_olarak_saklanir(self):
        table = mapping(
            MetricMapping(origin="ns=2;i=5", machine_id="T", metric=Metric.QUEUE_LENGTH)
        )
        result = from_opcua_value("c1", "ns=2;i=5", 1, 100, table)
        assert result.events[0].origin == "ns=2;i=5"

    def test_sonek_eslemesi_calisir(self):
        table = mapping(
            MetricMapping(origin="i=5", machine_id="T", metric=Metric.QUEUE_LENGTH)
        )
        result = from_opcua_value("c1", "ns=2;i=5", 1, 100, table)
        assert result.ok is True


class TestRestTransform:
    def test_duz_yanit_cevrilir(self):
        result = from_rest_payload("c1", b'{"production_count": 40}', 100)
        assert result.events[0].value == 40

    def test_kaynak_rest_olarak_isaretlenir(self):
        result = from_rest_payload("c1", b'{"adet": 1}', 100)
        assert result.events[0].source.value == "rest"

    def test_varsayilan_makine_kullanilir(self):
        result = from_rest_payload("c1", b'{"adet": 1}', 100, default_machine="HAT_1")
        assert result.events[0].machine_id == "HAT_1"

    def test_makine_yoksa_baglanti_kimligi_kullanilir(self):
        result = from_rest_payload("c1", b'{"adet": 1}', 100)
        assert result.events[0].machine_id == "c1"

    def test_dizi_yaniti_cevrilir(self):
        payload = b'[{"station": "TORNA", "adet": 2}, {"station": "KAYNAK", "adet": 3}]'
        result = from_rest_payload("c1", payload, 100)
        assert len(result.events) == 2

    def test_metin_yuk_de_kabul_edilir(self):
        result = from_rest_payload("c1", '{"adet": 4}', 100)
        assert result.events[0].value == 4


class TestMappingTable:
    def test_bos_tablo_isaretlenir(self):
        assert MappingTable().is_empty is True

    def test_birebir_esleme_bulunur(self):
        table = mapping(MetricMapping(origin="a/b", machine_id="M", metric=Metric.OEE))
        assert table.find("a/b") is not None

    def test_olmayan_adres_none(self):
        assert MappingTable().find("a") is None

    def test_sonek_eslemesi_bulunur(self):
        table = mapping(MetricMapping(origin="adet", machine_id="M", metric=Metric.OEE))
        assert table.find_suffix("fabrika/torna/adet") is not None

    def test_sonek_eslemesi_uymayan_adres_icin_none(self):
        table = mapping(MetricMapping(origin="adet", machine_id="M", metric=Metric.OEE))
        assert table.find_suffix("fabrika/torna/kuyruk") is None
