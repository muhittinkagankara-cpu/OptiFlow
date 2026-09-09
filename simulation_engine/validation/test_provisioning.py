# -*- coding: utf-8 -*-
"""Cihaz devreye alma testleri: isimlendirme, kesif, onbellek, sihirbaz.

Bu dosyanin savundugu kural: **kesif uydurmaz**. Uctan yanit alinamadiysa
etiket listesi bos doner ve nedeni yazilir. Ornek etiket uretilseydi, kullanici
olmayan bir dugumu esler ve hata ancak uretimde ortaya cikardi.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from simulation_engine.runtime.provisioning import (
    CACHE_TTL_MS,
    CredentialTest,
    DeviceFingerprint,
    DiscoveredTag,
    DiscoveryCache,
    DiscoveryResult,
    MAX_DISCOVERED_TAGS,
    MAX_JSON_DEPTH,
    PROVISIONING_ORDER,
    PROVISIONING_STEP_LABEL,
    ProvisioningStep,
    RestDiscovery,
    TAG_KIND_LABEL,
    TagKind,
    WizardState,
    address_parts,
    classify,
    classify_value,
    connection_label,
    decode_payload,
    describe,
    discovery_failed,
    discovery_for,
    fingerprint_of,
    flatten_json,
    humanize,
    machine_hint,
    not_discovered,
    strip_prefix,
    suggest_metric,
    tag_name,
    tags_from_json,
)
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

NOW = 1_700_000_000_000
ENDPOINT = "http://127.0.0.1:9/veri"


def spec(**kwargs) -> ConnectionSpec:
    base = dict(
        connection_id="c1",
        kind=ConnectionKind.REST,
        label="Test",
        endpoint=ENDPOINT,
        timeout_ms=1_000,
    )
    base.update(kwargs)
    return ConnectionSpec(**base)


def run(coro):
    return asyncio.run(coro)


def result(ok: bool = True, tags=None, endpoint: str = ENDPOINT) -> DiscoveryResult:
    return DiscoveryResult(
        ok=ok,
        kind=ConnectionKind.REST,
        endpoint=endpoint,
        tags=list(tags or []),
        detail="test",
        at_ms=NOW,
    )


# --------------------------------------------------------- isimlendirme


class TestAdres:
    def test_opcua_on_eki_atilir(self):
        assert strip_prefix("ns=2;s=Hat1.Freze") == "Hat1.Freze"

    def test_sayisal_opcua_on_eki_atilir(self):
        assert strip_prefix("ns=3;i=1005") == "1005"

    def test_on_eksiz_adres_korunur(self):
        assert strip_prefix("fabrika/hat1") == "fabrika/hat1"

    def test_nokta_ayirici(self):
        assert address_parts("Hat1.Freze01.Sayac") == ["Hat1", "Freze01", "Sayac"]

    def test_egik_cizgi_ayirici(self):
        assert address_parts("fabrika/hat1/sayac") == ["fabrika", "hat1", "sayac"]

    def test_bos_parcalar_atilir(self):
        assert address_parts("a//b") == ["a", "b"]

    def test_bos_adres_bos_liste(self):
        assert address_parts("") == []


class TestOkunurAd:
    def test_deve_yazimi_ayrilir(self):
        assert humanize("UretimSayaci") == "Uretim Sayaci"

    def test_alt_cizgi_ayrilir(self):
        assert humanize("uretim_sayaci") == "Uretim Sayaci"

    def test_tire_ayrilir(self):
        assert humanize("uretim-sayaci") == "Uretim Sayaci"

    def test_bos_parca_bos_doner(self):
        assert humanize("") == ""

    def test_ad_son_parcadan_turetilir(self):
        assert tag_name("ns=2;s=Hat1.Freze01.UretimSayaci") == "Uretim Sayaci"

    def test_turetilemezse_adresin_kendisi(self):
        # Bos bir ad, kullanicinin hangi dugumu sectigini gormesini engellerdi.
        assert tag_name("") == ""

    def test_ayirici_olmayan_adres(self):
        assert tag_name("Sayac") == "Sayac"


class TestMakineIpucu:
    def test_makine_kimligi_bulunur(self):
        assert machine_hint("Hat1.FREZE_01.Sayac") == "FREZE_01"

    def test_kucuk_harf_buyutulur(self):
        assert machine_hint("hat1.freze01.sayac") == "FREZE01"

    def test_bulunamazsa_none(self):
        # Rastgele bir makineye atanmasi, baska bir hattin uretimini bozardi.
        assert machine_hint("fabrika/uretim/toplam") is None

    def test_son_parca_makine_sayilmaz(self):
        assert machine_hint("Hat1.FREZE_01") == "HAT1"

    def test_bos_adres_none(self):
        assert machine_hint("") is None


class TestSiniflandirma:
    def test_mantiksal_deger(self):
        assert classify_value(True) is TagKind.BOOLEAN

    def test_sayisal_deger(self):
        assert classify_value(3.5) is TagKind.GAUGE

    def test_metin_deger(self):
        assert classify_value("calisiyor") is TagKind.TEXT

    def test_okunamayan_deger_bilinmiyor(self):
        # Sayi varsayilirsa, metin alani sayisal eksene konur.
        assert classify_value(None) is TagKind.UNKNOWN

    def test_sayac_adi_sayac_yapar(self):
        assert classify("Hat1.UretimSayaci", 42) is TagKind.COUNTER

    def test_hurda_da_sayactir(self):
        assert classify("Hat1.HurdaAdedi", 3) is TagKind.COUNTER

    def test_sicaklik_olcumdur(self):
        assert classify("Hat1.Sicaklik", 68.4) is TagKind.GAUGE

    def test_metin_adi_sayac_yapmaz(self):
        assert classify("Hat1.UretimDurumu", "OK") is TagKind.TEXT

    def test_her_turun_etiketi_var(self):
        assert set(TAG_KIND_LABEL) == set(TagKind)


class TestMetrikOnerisi:
    def test_turkce_uretim(self):
        assert suggest_metric("hat1/uretim") == "production_count"

    def test_ingilizce_production(self):
        assert suggest_metric("line1/production") == "production_count"

    def test_hurda(self):
        assert suggest_metric("hat1/hurda") == "scrap_count"

    def test_kuyruk(self):
        assert suggest_metric("hat1/kuyruk") == "queue_length"

    def test_cevrim_suresi(self):
        assert suggest_metric("hat1/cevrim") == "cycle_time_seconds"

    def test_durus(self):
        assert suggest_metric("hat1/durus") == "downtime_minutes"

    def test_anlasilmayan_none(self):
        # Sessizce uygulanan bir esleme, yanlis makineye yazilmis uretimdir.
        assert suggest_metric("hat1/xyz123") is None

    def test_opcua_on_eki_engel_degil(self):
        assert suggest_metric("ns=2;s=Hat1.Uretim") == "production_count"


class TestBaglantiAdi:
    def test_opcua_ucu(self):
        assert connection_label("opc.tcp://192.168.1.10:4840", "opcua") == "OPCUA 192.168.1.10"

    def test_rest_ucu(self):
        assert connection_label("http://10.0.0.5:8080/api", "rest") == "REST 10.0.0.5"

    def test_bos_uc_yalnizca_tur(self):
        assert connection_label("", "mqtt") == "MQTT"


class TestEtiketTanimi:
    def test_etiket_kurulur(self):
        tag = describe("Hat1.Uretim", 42)
        assert (tag.name, tag.kind) == ("Uretim", TagKind.COUNTER)

    def test_deger_tasinir(self):
        assert describe("Hat1.Sicaklik", 68.4).value == 68.4

    def test_okunamayan_deger_none(self):
        assert describe("Hat1.Sicaklik").value is None

    def test_veri_tipi_yazilir(self):
        assert describe("Hat1.Sicaklik", 68.4).data_type == "float"

    def test_degersizde_veri_tipi_none(self):
        assert describe("Hat1.Sicaklik").data_type is None

    def test_sozluk_alanlari(self):
        payload = describe("Hat1.Uretim", 5).to_dict()
        assert set(payload) == {
            "address",
            "name",
            "kind",
            "kind_label",
            "value",
            "unit",
            "data_type",
        }

    def test_etiket_degistirilemez(self):
        with pytest.raises(Exception):
            describe("a", 1).value = 2


# --------------------------------------------------------------- kesif


class TestJsonDuzlestirme:
    def test_duz_sozluk(self):
        assert flatten_json({"uretim": 5}) == [("uretim", 5)]

    def test_ic_ice_sozluk(self):
        assert flatten_json({"hat1": {"uretim": 5}}) == [("hat1.uretim", 5)]

    def test_dizi_indeksle_adreslenir(self):
        # Indekssiz bir yol iki makineyi ayni adrese yazardi.
        rows = flatten_json({"makineler": [{"uretim": 1}, {"uretim": 2}]})
        assert [row[0] for row in rows] == ["makineler.0.uretim", "makineler.1.uretim"]

    def test_derinlik_siniri(self):
        deep = {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}
        assert flatten_json(deep) == []

    def test_null_alan_da_listelenir(self):
        # Uçta var olan ama o an degeri olmayan bir alan da eslenebilir olmali.
        assert flatten_json({"uretim": None}) == [("uretim", None)]

    def test_kok_skaler_atlanir(self):
        assert flatten_json(5) == []

    def test_etiketler_uretilir(self):
        tags = tags_from_json({"hat1": {"uretim": 5}})
        assert tags[0].address == "hat1.uretim"

    def test_etiket_siniri(self):
        payload = {str(index): index for index in range(MAX_DISCOVERED_TAGS + 50)}
        assert len(tags_from_json(payload)) == MAX_DISCOVERED_TAGS


class TestKesifSonucu:
    def test_basarisiz_kesifte_etiket_yok(self):
        assert discovery_failed(ConnectionKind.REST, ENDPOINT, "hata").tags == []

    def test_basarisiz_kesif_nedeni_yazar(self):
        assert discovery_failed(ConnectionKind.REST, ENDPOINT, "hata").detail == "hata"

    def test_denenmemis_kesifte_gecikme_none(self):
        # Deneme yapilmadiysa gecikme de yoktur; sifir olcum yapilmis izlenimi verirdi.
        assert not_discovered(ConnectionKind.REST, ENDPOINT, "kapali").latency_ms is None

    def test_denenmemis_kesifte_an_none(self):
        assert not_discovered(ConnectionKind.REST, ENDPOINT, "kapali").at_ms is None

    def test_etiket_sayisi(self):
        assert result(tags=[describe("a", 1), describe("b", 2)]).tag_count == 2

    def test_sozluk_alanlari(self):
        payload = result().to_dict()
        assert "unreadable" in payload and "evidence" in payload

    def test_protokole_gore_surucu(self):
        assert discovery_for(ConnectionKind.REST).kind is ConnectionKind.REST

    def test_opcua_surucusu(self):
        assert discovery_for(ConnectionKind.OPCUA).kind is ConnectionKind.OPCUA

    def test_mqtt_surucusu(self):
        assert discovery_for(ConnectionKind.MQTT).kind is ConnectionKind.MQTT


class TestRestKesfi:
    def _discovery(self, status=200, body=b'{"hat1":{"uretim":5}}'):
        def fetch(url, headers, timeout_s):
            return status, body

        return RestDiscovery(fetch=fetch)

    def test_gecersiz_adres_reddedilir(self):
        found = run(self._discovery().discover(spec(endpoint="ftp://x")))
        assert found.ok is False

    def test_gecersiz_adreste_etiket_yok(self):
        found = run(self._discovery().discover(spec(endpoint="ftp://x")))
        assert found.tags == []

    def test_basarili_kesif(self):
        assert run(self._discovery().discover(spec())).ok is True

    def test_alanlar_bulunur(self):
        found = run(self._discovery().discover(spec()))
        assert found.tags[0].address == "hat1.uretim"

    def test_gercek_deger_okunur(self):
        found = run(self._discovery().discover(spec()))
        assert found.tags[0].value == 5

    def test_kanit_yazilir(self):
        found = run(self._discovery().discover(spec()))
        assert "bayt" in found.evidence

    def test_hata_kodu_kesfi_dusurur(self):
        found = run(self._discovery(status=500).discover(spec()))
        assert found.ok is False

    def test_hata_kodunda_etiket_yok(self):
        found = run(self._discovery(status=500).discover(spec()))
        assert found.tags == []

    def test_json_olmayan_govde_reddedilir(self):
        found = run(self._discovery(body=b"<html/>").discover(spec()))
        assert "JSON" in found.detail

    def test_ag_hatasi_yakalanir(self):
        def fetch(url, headers, timeout_s):
            raise OSError("baglanti yok")

        found = run(RestDiscovery(fetch=fetch).discover(spec()))
        assert found.ok is False

    def test_ag_hatasinda_gecikme_olculur(self):
        def fetch(url, headers, timeout_s):
            raise OSError("baglanti yok")

        found = run(RestDiscovery(fetch=fetch).discover(spec()))
        assert found.latency_ms is not None

    def test_bos_json_bos_liste(self):
        found = run(self._discovery(body=b"{}").discover(spec()))
        assert found.tags == []


class TestMqttGovdesi:
    def test_bos_govde_none(self):
        assert decode_payload(b"") is None

    def test_sayi_cozulur(self):
        assert decode_payload(b"42") == 42

    def test_ondalik_cozulur(self):
        assert decode_payload(b"3.5") == 3.5

    def test_metin_sayiya_zorlanmaz(self):
        # "OK" sifira cevrilseydi, durum bilgisi sayisal olcum gibi gorunurdu.
        assert decode_payload(b"OK") == "OK"

    def test_json_nesnesi_metin_kalir(self):
        assert decode_payload(b'{"a":1}') == '{"a":1}'

    def test_cozulemeyen_bayt_none(self):
        assert decode_payload(b"\xff\xfe") is None

    def test_bosluk_temizlenir(self):
        assert decode_payload(b"  7  ") == 7


# ------------------------------------------------------------ parmak izi


class TestParmakIzi:
    def test_ayni_adresler_ayni_iz(self):
        first = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a", "b"])
        second = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a", "b"])
        assert first.digest == second.digest

    def test_sira_onemsiz(self):
        # Ayni cihazin dugumleri farkli sirada donunce iz degismemeli.
        first = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a", "b"])
        second = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["b", "a"])
        assert first.digest == second.digest

    def test_tekrarli_adres_sayilmaz(self):
        assert fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a", "a"]).tag_count == 1

    def test_farkli_adresler_farkli_iz(self):
        first = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a"])
        second = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["b"])
        assert first.digest != second.digest

    def test_farkli_uc_farkli_iz(self):
        first = fingerprint_of("http://a", ConnectionKind.REST, ["x"])
        second = fingerprint_of("http://b", ConnectionKind.REST, ["x"])
        assert first.digest != second.digest

    def test_farkli_protokol_farkli_iz(self):
        first = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["x"])
        second = fingerprint_of(ENDPOINT, ConnectionKind.MQTT, ["x"])
        assert first.digest != second.digest

    def test_ayni_iz_eslesir(self):
        first = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a"])
        assert first.matches(fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a"])) is True

    def test_bilinmeyen_iz_eslesmez(self):
        # Bilinmeyen bir cihazi "ayni" saymak, degisimi sessizce gecirmek olurdu.
        assert fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a"]).matches(None) is False

    def test_sozluk(self):
        payload = fingerprint_of(ENDPOINT, ConnectionKind.REST, ["a"]).to_dict()
        assert payload["tag_count"] == 1


# ------------------------------------------------------------- onbellek


class TestOnbellek:
    @pytest.fixture
    def cache(self):
        return DiscoveryCache()

    def test_saklanan_kayit_okunur(self, cache):
        cache.store(result(tags=[describe("a", 1)]), NOW)
        assert cache.get(ENDPOINT, NOW) is not None

    def test_basarisiz_kesif_saklanmaz(self, cache):
        # Gecici bir ag hatasi on dakika "cihazda etiket yok" diye okunurdu.
        with pytest.raises(ValueError):
            cache.store(result(ok=False), NOW)

    def test_eskimis_kayit_donmez(self, cache):
        cache.store(result(), NOW)
        assert cache.get(ENDPOINT, NOW + CACHE_TTL_MS) is None

    def test_taze_kayit_doner(self, cache):
        cache.store(result(), NOW)
        assert cache.get(ENDPOINT, NOW + CACHE_TTL_MS - 1) is not None

    def test_bilinmeyen_uc_none(self, cache):
        assert cache.get("http://yok", NOW) is None

    def test_parmak_izi_saklanir(self, cache):
        cache.store(result(tags=[describe("a", 1)]), NOW)
        assert cache.fingerprint(ENDPOINT) is not None

    def test_parmak_izi_sure_dolsa_da_doner(self, cache):
        # Cihaz degisimini anlamak icin eski iz gerekir.
        cache.store(result(tags=[describe("a", 1)]), NOW)
        assert cache.fingerprint(ENDPOINT) is not None

    def test_ilk_kurulumda_degisim_none(self, cache):
        # "Ayni cihaz" ile "daha once gorulmemis" ayni sey degildir.
        assert cache.changed(result(tags=[describe("a", 1)])) is None

    def test_ayni_cihaz_degismedi(self, cache):
        cache.store(result(tags=[describe("a", 1)]), NOW)
        assert cache.changed(result(tags=[describe("a", 1)])) is False

    def test_farkli_cihaz_degisti(self, cache):
        cache.store(result(tags=[describe("a", 1)]), NOW)
        assert cache.changed(result(tags=[describe("b", 1)])) is True

    def test_gecersiz_kilma(self, cache):
        cache.store(result(), NOW)
        assert cache.invalidate(ENDPOINT) is True

    def test_olmayani_gecersiz_kilma(self, cache):
        assert cache.invalidate("http://yok") is False

    def test_kapasite_asilinca_en_eski_atilir(self):
        cache = DiscoveryCache(capacity=2)
        for index in range(3):
            cache.store(result(endpoint=f"http://h{index}"), NOW + index)
        assert cache.stats(NOW)["entries"] == 2

    def test_temizleme(self, cache):
        cache.store(result(), NOW)
        cache.clear()
        assert cache.stats(NOW)["entries"] == 0

    def test_yasin_hesabi(self, cache):
        entry = cache.store(result(), NOW)
        assert entry.age_ms(NOW + 5_000) == 5_000


# -------------------------------------------------------------- sihirbaz


class TestSihirbaz:
    @pytest.fixture
    def state(self):
        return WizardState()

    def test_alti_adim(self):
        assert len(PROVISIONING_ORDER) == 6

    def test_her_adimin_etiketi(self):
        assert set(PROVISIONING_STEP_LABEL) == set(ProvisioningStep)

    def test_ilk_adim_uc_adresi(self, state):
        assert state.step is ProvisioningStep.ENDPOINT

    def test_ilk_adima_girilebilir(self, state):
        assert state.can_enter(ProvisioningStep.ENDPOINT) is True

    def test_kesif_uc_adresinden_once_girilemez(self, state):
        # Atlamaya izin verilseydi, kullanici bos bir listeyle karsilasirdi.
        assert state.can_enter(ProvisioningStep.DISCOVERY) is False

    def test_adim_tamamlanir(self, state):
        assert state.complete(ProvisioningStep.ENDPOINT) is True

    def test_tamamlanan_adim_sonrakine_gecirir(self, state):
        state.complete(ProvisioningStep.ENDPOINT)
        assert state.step is ProvisioningStep.DISCOVERY

    def test_sirasiz_adim_tamamlanamaz(self, state):
        assert state.complete(ProvisioningStep.MAPPING) is False

    def test_son_adimda_kalinir(self, state):
        for step in PROVISIONING_ORDER:
            state.complete(step)
        assert state.step is ProvisioningStep.SAVE

    def test_test_edilmeden_kaydedilemez(self, state):
        # Kaydedilmis ama hic denenmemis bir baglanti calisiyormus gibi durur.
        assert state.can_save is False

    def test_basarisiz_testten_sonra_kaydedilemez(self, state):
        for step in PROVISIONING_ORDER[:5]:
            state.complete(step)
        state.test_ok = False
        assert state.can_save is False

    def test_basarili_testten_sonra_kaydedilir(self, state):
        for step in PROVISIONING_ORDER[:5]:
            state.complete(step)
        state.test_ok = True
        assert state.can_save is True

    def test_test_yapilmadan_sonuc_none(self, state):
        assert state.test_ok is None

    def test_sozluk_alanlari(self, state):
        payload = state.to_dict()
        assert set(payload) == {
            "step",
            "completed",
            "selected",
            "mapping",
            "test_ok",
            "test_detail",
            "can_save",
        }


class TestKimlikDenemesi:
    def test_basarili_deneme(self):
        test = CredentialTest(ok=True, detail="oturum açıldı", username="opc")
        assert test.ok is True

    def test_parola_sonuçta_tasinmaz(self):
        payload = CredentialTest(ok=True, detail="x", username="opc").to_dict()
        assert "password" not in payload

    def test_anonim_denemede_kullanici_none(self):
        assert CredentialTest(ok=True, detail="x").username is None

    def test_olculmeyen_gecikme_none(self):
        assert CredentialTest(ok=False, detail="x").latency_ms is None

    def test_kimlik_gerekliligi_bilinmiyorsa_none(self):
        assert CredentialTest(ok=False, detail="x").requires_auth is None
