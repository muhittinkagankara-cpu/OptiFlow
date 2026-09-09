# -*- coding: utf-8 -*-
"""Esleme sihirbazi 2.0, saha tanilama ve disa aktarma testleri.

Uc kural savunulur:

1. **Guven puani bir olasilik degildir.** Kac kanita dayandigini soyler;
   "%80 ihtimalle dogru" demek olculmemis bir sayi uydurmak olurdu.
2. **Olculemeyen tanilama satiri sifir gostermez.** Ping olculemediyse "0 ms"
   yazmak, agin kusursuz oldugunu soylemek olurdu.
3. **Disa aktarmada `None` bos hucredir.** Sifir goren biri onu olculmus bir
   sifir sanardi.
"""

from __future__ import annotations

import csv
import io

import pytest

from simulation_engine.runtime.ops.export import (
    DELIMITER,
    EXPORT_KINDS,
    EXPORT_KIND_LABEL,
    MAX_ROWS,
    export_alarms,
    export_oee,
    export_telemetry,
    is_supported,
    render_csv,
)
from simulation_engine.runtime.ops.fielddiag import (
    CLOCK_SKEW_MS,
    FieldInput,
    LOSSY_RATIO,
    PROBE_STATE_LABEL,
    ProbeState,
    SLOW_PING_MS,
    SLOW_PROTOCOL_MS,
    build,
    clock_line,
    last_data_line,
    latency_line,
    loss_line,
    protocol_line,
    unmeasured,
    worst_state,
)
from simulation_engine.runtime.provisioning.mapping import (
    EVIDENCE_LABEL,
    EVIDENCE_MACHINE,
    EVIDENCE_METRIC,
    EVIDENCE_TYPE,
    MAX_EVIDENCE,
    MappingEntry,
    apply_suggestions,
    review,
    suggest,
    suggest_all,
    type_matches,
    undo,
    undo_suggestions,
)
from simulation_engine.runtime.provisioning.types import DiscoveredTag, TagKind
from simulation_engine.runtime.telemetry import TelemetryPoint

NOW = 1_700_000_000_000


def etiket(address: str, kind: TagKind = TagKind.COUNTER) -> DiscoveredTag:
    return DiscoveredTag(address=address, name=address, kind=kind, value=1)


# --------------------------------------------------------- esleme 2.0


class TestTurUyumu:
    def test_sayac_sayisal_metrige_uyar(self):
        assert type_matches(TagKind.COUNTER, "production_count") is True

    def test_olcum_sayisal_metrige_uyar(self):
        assert type_matches(TagKind.GAUGE, "queue_length") is True

    def test_metin_sayisal_metrige_uymaz(self):
        assert type_matches(TagKind.TEXT, "production_count") is False

    def test_metin_durum_metrigine_uyar(self):
        assert type_matches(TagKind.TEXT, "status") is True

    def test_mantiksal_durum_metrigine_uyar(self):
        assert type_matches(TagKind.BOOLEAN, "status") is True

    def test_bilinmeyen_tur_uymus_sayilmaz(self):
        # Deger okunamadiginda uyum bir varsayimdir, kanit degil.
        assert type_matches(TagKind.UNKNOWN, "production_count") is False

    def test_metriksiz_uyum_yok(self):
        assert type_matches(TagKind.COUNTER, None) is False

    def test_taninmayan_metrik_uymaz(self):
        assert type_matches(TagKind.COUNTER, "bilinmeyen_metrik") is False


class TestOneri:
    def test_uc_kanitli_oneri(self):
        oneri = suggest(etiket("Hat1.FREZE_01.UretimSayaci"))
        assert oneri.score == MAX_EVIDENCE

    def test_uc_kanitli_oneri_eksiksiz(self):
        oneri = suggest(etiket("Hat1.FREZE_01.UretimSayaci"))
        assert oneri.complete is True

    def test_makine_kaniti_bulunur(self):
        oneri = suggest(etiket("Hat1.FREZE_01.UretimSayaci"))
        assert EVIDENCE_MACHINE in oneri.evidence

    def test_metrik_kaniti_bulunur(self):
        oneri = suggest(etiket("fabrika/uretim"))
        assert EVIDENCE_METRIC in oneri.evidence

    def test_tur_kaniti_bulunur(self):
        oneri = suggest(etiket("fabrika/uretim", TagKind.COUNTER))
        assert EVIDENCE_TYPE in oneri.evidence

    def test_makinesiz_adreste_iki_kanit(self):
        oneri = suggest(etiket("fabrika/uretim", TagKind.COUNTER))
        assert oneri.score == 2

    def test_makinesiz_oneri_eksiksiz_degil(self):
        assert suggest(etiket("fabrika/uretim")).complete is False

    def test_anlasilmayan_adreste_kanit_yok(self):
        assert suggest(etiket("ns=2;i=1005", TagKind.UNKNOWN)).score == 0

    def test_metin_etiketinde_tur_kaniti_yok(self):
        oneri = suggest(etiket("fabrika/uretim", TagKind.TEXT))
        assert EVIDENCE_TYPE not in oneri.evidence

    def test_her_kanitin_etiketi_var(self):
        oneri = suggest(etiket("Hat1.FREZE_01.UretimSayaci"))
        payload = oneri.to_dict()
        assert len(payload["evidence_labels"]) == payload["score"]

    def test_kanit_etiketleri_turkce(self):
        assert EVIDENCE_LABEL[EVIDENCE_MACHINE].startswith("Adreste makine")

    def test_puan_olasilik_degil(self):
        # Sozlukte en yuksek puan da yazar; "%80" gibi bir sayi uretilmez.
        payload = suggest(etiket("fabrika/uretim")).to_dict()
        assert payload["max_score"] == MAX_EVIDENCE

    def test_toplu_oneri(self):
        assert len(suggest_all([etiket("a/uretim"), etiket("b/hurda")])) == 2


class TestOneriUygulama:
    def _oneriler(self):
        return suggest_all(
            [
                etiket("Hat1.FREZE_01.UretimSayaci"),
                etiket("fabrika/uretim"),
                etiket("ns=2;i=9", TagKind.UNKNOWN),
            ]
        )

    def test_yeterli_kanitli_oneri_uygulanir(self):
        sonuc = apply_suggestions([], self._oneriler(), ["Hat1.FREZE_01.UretimSayaci"])
        assert len(sonuc) == 1

    def test_eksik_oneri_uygulanmaz(self):
        # Makinesi belirsiz bir metrik yazmak, veriyi yanlis makineye baglardi.
        sonuc = apply_suggestions([], self._oneriler(), ["fabrika/uretim"])
        assert sonuc == []

    def test_secili_olmayan_oneri_uygulanmaz(self):
        assert apply_suggestions([], self._oneriler(), []) == []

    def test_tek_kanitli_oneri_uygulanmaz(self):
        oneriler = suggest_all([etiket("HAT_01.veri", TagKind.UNKNOWN)])
        assert apply_suggestions([], oneriler, ["HAT_01.veri"]) == []

    def test_esik_dusurulunce_uygulanir(self):
        oneriler = suggest_all([etiket("fabrika/uretim", TagKind.COUNTER)])
        sonuc = apply_suggestions([], oneriler, ["fabrika/uretim"], min_score=1)
        assert sonuc == []

    def test_var_olan_esleme_ezilmez(self):
        mevcut = [MappingEntry("Hat1.FREZE_01.UretimSayaci", "ELLE", "queue_length")]
        sonuc = apply_suggestions(mevcut, self._oneriler(), ["Hat1.FREZE_01.UretimSayaci"])
        assert sonuc[0].machine_id == "ELLE"

    def test_uygulanan_esleme_kaynagi_isaretlenir(self):
        sonuc = apply_suggestions([], self._oneriler(), ["Hat1.FREZE_01.UretimSayaci"])
        assert sonuc[0].source == "suggestion"

    def test_sonuc_adres_sirasinda(self):
        oneriler = suggest_all(
            [etiket("Z1.TORNA_02.Uretim"), etiket("A1.FREZE_01.Uretim")]
        )
        sonuc = apply_suggestions([], oneriler, ["Z1.TORNA_02.Uretim", "A1.FREZE_01.Uretim"])
        assert [item.address for item in sonuc] == [
            "A1.FREZE_01.Uretim",
            "Z1.TORNA_02.Uretim",
        ]


class TestGeriAlma:
    def test_tek_esleme_geri_alinir(self):
        eslemeler = [MappingEntry("a", "M1", "production_count")]
        assert undo(eslemeler, "a") == []

    def test_baska_esleme_korunur(self):
        eslemeler = [
            MappingEntry("a", "M1", "production_count"),
            MappingEntry("b", "M2", "production_count"),
        ]
        assert len(undo(eslemeler, "a")) == 1

    def test_olmayan_adres_degistirmez(self):
        eslemeler = [MappingEntry("a", "M1", "production_count")]
        assert len(undo(eslemeler, "yok")) == 1

    def test_onerilerin_tamami_geri_alinir(self):
        eslemeler = [
            MappingEntry("a", "M1", "production_count", source="suggestion"),
            MappingEntry("b", "M2", "production_count", source="manual"),
        ]
        assert [item.address for item in undo_suggestions(eslemeler)] == ["b"]

    def test_elle_kurulanlar_korunur(self):
        # Kullanicinin kendi emegini kaybetmesi olurdu.
        eslemeler = [MappingEntry("b", "M2", "production_count")]
        assert undo_suggestions(eslemeler) == eslemeler


class TestEslemeDenetimi:
    def test_eksik_etiket_bulunur(self):
        sonuc = review(["a", "b"], [MappingEntry("a", "M1", "production_count")])
        assert sonuc.unmapped == ["b"]

    def test_hepsi_eslendiyse_eksik_yok(self):
        sonuc = review(["a"], [MappingEntry("a", "M1", "production_count")])
        assert sonuc.unmapped == []

    def test_cakisma_bulunur(self):
        # Iki adres ayni metrige yazarsa, ekrandaki sayi rastgele degisir.
        eslemeler = [
            MappingEntry("a", "M1", "production_count"),
            MappingEntry("b", "M1", "production_count"),
        ]
        sonuc = review(["a", "b"], eslemeler)
        assert sonuc.conflicts == ["M1::production_count"]

    def test_farkli_metrikte_cakisma_yok(self):
        eslemeler = [
            MappingEntry("a", "M1", "production_count"),
            MappingEntry("b", "M1", "queue_length"),
        ]
        assert review(["a", "b"], eslemeler).conflicts == []

    def test_kapsama_hesaplanir(self):
        sonuc = review(["a", "b"], [MappingEntry("a", "M1", "production_count")])
        assert sonuc.coverage == 0.5

    def test_secim_yoksa_kapsama_none(self):
        # "%0 eslendi" demek, eslenecek bir sey olmayan kurulumu eksik
        # gosterirdi.
        assert review([], []).coverage is None

    def test_eksiksiz_esleme_hazir(self):
        assert review(["a"], [MappingEntry("a", "M1", "production_count")]).ready is True

    def test_cakismali_esleme_hazir_degil(self):
        eslemeler = [
            MappingEntry("a", "M1", "production_count"),
            MappingEntry("b", "M1", "production_count"),
        ]
        assert review(["a", "b"], eslemeler).ready is False

    def test_secim_yoksa_hazir_degil(self):
        assert review([], []).ready is False

    def test_sozluk_alanlari(self):
        payload = review(["a"], []).to_dict()
        assert set(payload) == {
            "unmapped",
            "conflicts",
            "mapped",
            "selected",
            "coverage",
            "ready",
        }


# ------------------------------------------------------- saha tanilama


class TestTanilamaSatirlari:
    def test_olculemeyen_satir_none(self):
        assert unmeasured("x", "X", "neden").value is None

    def test_olculemeyen_satir_neden_tasir(self):
        assert unmeasured("x", "X", "neden").reason == "neden"

    def test_olculemeyen_satir_olculmemis(self):
        assert unmeasured("x", "X", "neden").measured is False

    def test_her_durumun_etiketi(self):
        assert set(PROBE_STATE_LABEL) == set(ProbeState)

    def test_hizli_ping_normal(self):
        satir = latency_line("ping", "Ping", 12.0, SLOW_PING_MS, "yok")
        assert satir.state is ProbeState.OK

    def test_yavas_ping_uyari(self):
        satir = latency_line("ping", "Ping", SLOW_PING_MS, SLOW_PING_MS, "yok")
        assert satir.state is ProbeState.WARNING

    def test_olculemeyen_ping_bilinmiyor(self):
        # "0 ms" yazmak, agin kusursuz oldugunu soylemek olurdu.
        satir = latency_line("ping", "Ping", None, SLOW_PING_MS, "olculmedi")
        assert satir.state is ProbeState.UNKNOWN

    def test_yavas_protokol_uyari(self):
        satir = latency_line("opcua", "OPC UA", SLOW_PROTOCOL_MS, SLOW_PROTOCOL_MS, "yok")
        assert satir.state is ProbeState.WARNING

    def test_baglanan_protokol_normal(self):
        assert protocol_line("mqtt", "MQTT", True, None).state is ProbeState.OK

    def test_baglanamayan_protokol_basarisiz(self):
        assert protocol_line("mqtt", "MQTT", False, None).state is ProbeState.FAILED

    def test_denenmeyen_protokol_bilinmiyor(self):
        # Denenmemis bir protokolu "basarisiz" gostermek, muhendisi olmayan
        # bir arizanin pesine dusururdu.
        assert protocol_line("mqtt", "MQTT", None, None).state is ProbeState.UNKNOWN

    def test_denenmeyen_protokolde_neden_yazilir(self):
        satir = protocol_line("mqtt", "MQTT", None, None)
        assert "denenmedi" in satir.reason

    def test_protokol_metni_turkce(self):
        assert protocol_line("mqtt", "MQTT", True, None).text == "Bağlandı"


class TestSaatVeKayip:
    def test_kucuk_sapma_normal(self):
        assert clock_line(100.0).state is ProbeState.OK

    def test_buyuk_sapma_uyari(self):
        assert clock_line(CLOCK_SKEW_MS).state is ProbeState.WARNING

    def test_geriye_sapma_da_uyari(self):
        assert clock_line(-CLOCK_SKEW_MS).state is ProbeState.WARNING

    def test_sapmanin_isareti_korunur(self):
        # Cihaz ileri mi geri mi, ariza ararken fark eder.
        assert clock_line(-3_000.0).value == -3_000.0

    def test_okunamayan_saat_bilinmiyor(self):
        assert clock_line(None).state is ProbeState.UNKNOWN

    def test_kayip_orani_hesaplanir(self):
        assert loss_line(99, 1).value == 1.0

    def test_dusuk_kayip_normal(self):
        assert loss_line(1000, 1).state is ProbeState.OK

    def test_yuksek_kayip_uyari(self):
        assert loss_line(99, 1).state is ProbeState.WARNING

    def test_paket_yoksa_oran_hesaplanmaz(self):
        # "Kayip %0" demek, hic veri almamis bir baglantiyi kusursuz
        # gostermek olurdu.
        assert loss_line(0, 0).state is ProbeState.UNKNOWN

    def test_sayaclar_okunamazsa_bilinmiyor(self):
        assert loss_line(None, None).state is ProbeState.UNKNOWN

    def test_kayip_satiri_sayilari_da_yazar(self):
        assert loss_line(99, 1).text == "1/100 paket"

    def test_veri_gelmediyse_yas_bilinmiyor(self):
        assert last_data_line(None).state is ProbeState.UNKNOWN

    def test_yeni_veri_normal(self):
        assert last_data_line(1_000).state is ProbeState.OK

    def test_eski_veri_uyari(self):
        assert last_data_line(60_000).state is ProbeState.WARNING


class TestTanilamaRaporu:
    def test_yedi_satir(self):
        assert len(build(FieldInput(), NOW).lines) == 7

    def test_bos_girdide_hicbiri_olculmemis(self):
        assert build(FieldInput(), NOW).measured_count == 0

    def test_bos_girdide_durum_bilinmiyor(self):
        assert build(FieldInput(), NOW).state is ProbeState.UNKNOWN

    def test_saglikli_kurulum_normal(self):
        rapor = build(
            FieldInput(
                ping_ms=8.0,
                opcua_latency_ms=25.0,
                mqtt_connected=True,
                rest_connected=True,
                last_data_age_ms=1_000,
                clock_skew_ms=40.0,
                packets=1000,
                errors=0,
            ),
            NOW,
        )
        assert rapor.state is ProbeState.OK

    def test_basarisiz_protokol_raporu_dusurur(self):
        rapor = build(FieldInput(ping_ms=8.0, mqtt_connected=False), NOW)
        assert rapor.state is ProbeState.FAILED

    def test_uc_adresi_tasinir(self):
        rapor = build(FieldInput(endpoint="opc.tcp://10.0.0.5:4840"), NOW)
        assert rapor.to_dict()["endpoint"] == "opc.tcp://10.0.0.5:4840"

    def test_eksik_satir_gizlenmez(self):
        # Sahadaki muhendis neyin olculmedigini bilmelidir.
        rapor = build(FieldInput(ping_ms=8.0), NOW)
        assert rapor.to_dict()["line_count"] == 7

    def test_en_kotu_durum_secilir(self):
        satirlar = [
            protocol_line("a", "A", True, None),
            protocol_line("b", "B", False, None),
        ]
        assert worst_state(satirlar) is ProbeState.FAILED

    def test_bos_satirda_bilinmiyor(self):
        assert worst_state([]) is ProbeState.UNKNOWN


# ------------------------------------------------------ disa aktarma


def coz(content: str):
    return list(csv.reader(io.StringIO(content), delimiter=DELIMITER))


class TestCsvUretimi:
    def test_baslik_yazilir(self):
        assert coz(render_csv(["a", "b"], []))[0] == ["a", "b"]

    def test_bos_veride_yalnizca_baslik(self):
        # Tamamen bos bir dosya, "veri yok" ile "bozuk" arasindaki farki yok
        # ederdi.
        assert len(coz(render_csv(["a"], []))) == 1

    def test_none_bos_hucre_olur(self):
        # Sifir goren biri onu olculmus bir sifir sanardi.
        assert coz(render_csv(["a"], [[None]]))[1] == [""]

    def test_sifir_sifir_kalir(self):
        assert coz(render_csv(["a"], [[0]]))[1] == ["0"]

    def test_ayrac_noktali_virgul(self):
        assert DELIMITER == ";"

    def test_turkce_karakter_korunur(self):
        assert "Ölçüm" in render_csv(["Ölçüm"], [])


class TestTelemetriAktarimi:
    def _nokta(self, value=10.0, quality="good"):
        return TelemetryPoint(
            timestamp_ms=NOW,
            device="FREZE_01",
            tag="production_count",
            value=value,
            quality=quality,
            source="plc-1",
        )

    def test_satir_sayisi(self):
        assert export_telemetry([self._nokta(), self._nokta()]).row_count == 2

    def test_alti_sutun(self):
        satirlar = coz(export_telemetry([self._nokta()]).content)
        assert len(satirlar[0]) == 6

    def test_bozuk_kalite_korunur(self):
        # Musteri sensorun ne zaman bozuldugunu gorebilmelidir.
        cikti = export_telemetry([self._nokta(quality="bad")])
        assert "bad" in cikti.content

    def test_olculmeyen_deger_bos_hucre(self):
        cikti = export_telemetry([self._nokta(value=None)])
        assert coz(cikti.content)[1][3] == ""

    def test_kaynak_gercek_tablo(self):
        assert export_telemetry([]).source == "telemetry"

    def test_bos_aktarimda_kesilme_yok(self):
        assert export_telemetry([]).truncated is False

    def test_sinir_asiminda_kesilme_bildirilir(self):
        noktalar = [self._nokta() for _ in range(MAX_ROWS + 1)]
        assert export_telemetry(noktalar).truncated is True

    def test_sinir_asiminda_satir_kirpilir(self):
        noktalar = [self._nokta() for _ in range(MAX_ROWS + 1)]
        assert export_telemetry(noktalar).row_count == MAX_ROWS

    def test_dosya_adi_verilebilir(self):
        assert export_telemetry([], "veri.csv").file_name == "veri.csv"


class TestAlarmVeOeeAktarimi:
    def test_alarm_sutunlari(self):
        satirlar = coz(export_alarms([{"id": "a"}]).content)
        assert len(satirlar[0]) == 10

    def test_alarm_kaynagi(self):
        assert export_alarms([]).source == "alarms"

    def test_eksik_alarm_alani_bos_hucre(self):
        satirlar = coz(export_alarms([{"id": "a"}]).content)
        assert satirlar[1][1] == ""

    def test_alarm_kimligi_yazilir(self):
        satirlar = coz(export_alarms([{"id": "machine_down::T1"}]).content)
        assert satirlar[1][0] == "machine_down::T1"

    def test_oee_sutunlari(self):
        satirlar = coz(export_oee([{"at_ms": NOW}]).content)
        assert len(satirlar[0]) == 6

    def test_hesaplanmayan_carpan_bos_hucre(self):
        # Sifir yazilsaydi, musteri olmayan bir hurda sorununu arastirirdi.
        satirlar = coz(export_oee([{"at_ms": NOW, "quality": None}]).content)
        assert satirlar[1][4] == ""

    def test_oee_kaynagi(self):
        assert export_oee([]).source == "oee"

    def test_sozluk_bayt_sayisini_verir(self):
        assert export_telemetry([]).to_dict()["bytes"] > 0


class TestAktarimTurleri:
    def test_uc_tur(self):
        assert set(EXPORT_KINDS) == {"telemetry", "alarms", "oee"}

    def test_her_turun_etiketi(self):
        assert set(EXPORT_KIND_LABEL) == set(EXPORT_KINDS)

    def test_taninan_tur(self):
        assert is_supported("telemetry") is True

    def test_taninmayan_tur(self):
        # Kullanicinin alarm istedigi yerde telemetri indirmesi olurdu.
        assert is_supported("her sey") is False
