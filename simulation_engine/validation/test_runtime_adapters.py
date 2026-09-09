"""Bağlayıcı sürücülerinin saf yardımcıları ve hata çevirisi.

Bu dosyada ağ yoktur: burada sınananlar, cihaz olmadan da doğru davranması
gereken kararlardır. Gerçek cihazlarla yapılan doğrulama
`test_runtime_real_devices.py` içindedir.
"""

from __future__ import annotations

import asyncio
import socket
import urllib.error

from simulation_engine.runtime.adapters.base import (
    clamp_qos,
    clamp_timeout_ms,
    describe_network_error,
    elapsed_ms,
    failed,
    is_valid_endpoint,
    missing_library,
    split_endpoint,
    succeeded,
)
from simulation_engine.runtime.adapters.mqtt import (
    DEFAULT_PORT,
    MqttAdapter,
    broker_address,
    invalid_topics,
    is_valid_topic,
    valid_topics,
)
from simulation_engine.runtime.adapters.opcua import (
    DEFAULT_NODE_ID,
    OpcUaAdapter,
    invalid_node_ids,
    is_anonymous,
    is_valid_node_id,
    node_ids_of,
    security_note,
    security_string,
)
from simulation_engine.runtime.adapters.rest import (
    RestAdapter,
    build_headers,
    classify_status,
    preview_body,
)
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec, SecurityPolicy


def spec(kind: ConnectionKind = ConnectionKind.REST, **overrides) -> ConnectionSpec:
    base = dict(
        connection_id="c1",
        kind=kind,
        label="Hat 1",
        endpoint="http://127.0.0.1:9/veri",
    )
    base.update(overrides)
    return ConnectionSpec(**base)


class TestClampTimeout:
    def test_none_varsayilana_duser(self):
        assert clamp_timeout_ms(None) == 5_000

    def test_normal_deger_korunur(self):
        assert clamp_timeout_ms(3_000) == 3_000

    def test_cok_kucuk_deger_yukselir(self):
        # Cok kucuk zaman asimi her baglantiyi sahte bicimde basarisiz gosterir.
        assert clamp_timeout_ms(10) == 200

    def test_cok_buyuk_deger_kirpilir(self):
        assert clamp_timeout_ms(10 * 60_000) == 60_000

    def test_metin_varsayilana_duser(self):
        assert clamp_timeout_ms("abc") == 5_000  # type: ignore[arg-type]

    def test_sinir_degerler_korunur(self):
        assert clamp_timeout_ms(200) == 200
        assert clamp_timeout_ms(60_000) == 60_000


class TestClampQos:
    def test_varsayilan_bir(self):
        assert clamp_qos(None) == 1

    def test_gecerli_degerler_korunur(self):
        assert clamp_qos(0) == 0
        assert clamp_qos(2) == 2

    def test_negatif_sifira_cekilir(self):
        assert clamp_qos(-5) == 0

    def test_buyuk_deger_ikiye_cekilir(self):
        assert clamp_qos(9) == 2

    def test_metin_varsayilana_duser(self):
        assert clamp_qos("x") == 1  # type: ignore[arg-type]


class TestSplitEndpoint:
    def test_semali_adres_ayrilir(self):
        assert split_endpoint("opc.tcp://192.168.1.5:4840") == ("192.168.1.5", 4840)

    def test_semali_adreste_port_yoksa_varsayilan(self):
        assert split_endpoint("opc.tcp://cihaz", default_port=4840) == ("cihaz", 4840)

    def test_semasiz_adres_ayrilir(self):
        assert split_endpoint("broker.local:1883") == ("broker.local", 1883)

    def test_port_yoksa_varsayilan_doner(self):
        assert split_endpoint("broker.local", default_port=1883) == ("broker.local", 1883)

    def test_bozuk_port_varsayilana_duser(self):
        assert split_endpoint("broker.local:abc", default_port=1883) == (
            "broker.local",
            1883,
        )

    def test_bosluklar_kirpilir(self):
        assert split_endpoint("  broker.local:1883  ")[0] == "broker.local"


class TestIsValidEndpoint:
    def test_http_kabul_edilir(self):
        assert is_valid_endpoint("http://x/y", ("http", "https")) is True

    def test_https_kabul_edilir(self):
        assert is_valid_endpoint("https://x/y", ("http", "https")) is True

    def test_opc_tcp_kabul_edilir(self):
        assert is_valid_endpoint("opc.tcp://x:4840", ("opc.tcp",)) is True

    def test_yanlis_sema_reddedilir(self):
        assert is_valid_endpoint("ftp://x", ("http", "https")) is False

    def test_semasiz_adres_reddedilir(self):
        assert is_valid_endpoint("192.168.1.5", ("http", "https")) is False

    def test_buyuk_harf_kabul_edilir(self):
        assert is_valid_endpoint("HTTP://x", ("http",)) is True


class TestDescribeNetworkError:
    def test_zaman_asimi_ne_yapilacagini_soyler(self):
        message = describe_network_error(TimeoutError())
        assert "zaman aşımı" in message
        assert "kontrol edin" in message

    def test_reddedilen_baglantida_port_onerilir(self):
        message = describe_network_error(ConnectionRefusedError())
        assert "reddetti" in message
        assert "Port" in message

    def test_cozulemeyen_adres_bildirilir(self):
        assert "adres çözülemedi" in describe_network_error(socket.gaierror())

    def test_yetki_hatasi_kimlik_bilgilerini_isaret_eder(self):
        message = describe_network_error(PermissionError())
        assert "kimlik doğrulama" in message.lower()

    def test_bilinmeyen_hata_metniyle_doner(self):
        assert "beklenmedik" in describe_network_error(RuntimeError("beklenmedik"))

    def test_bos_hata_sinif_adiyla_doner(self):
        assert "RuntimeError" in describe_network_error(RuntimeError())

    def test_her_mesaj_kurulamadi_ile_baslar(self):
        # Sozlesme: dogrulanmamis hicbir baglanti "baglandi" demez.
        for error in (TimeoutError(), ConnectionRefusedError(), RuntimeError("x")):
            assert describe_network_error(error).startswith("Bağlantı kurulamadı")


class TestMissingLibrary:
    def test_dogrulanmadi_der(self):
        # Kutuphane yoksa "baglanamadi" degil "denenmedi" denir.
        assert missing_library("asyncua", "asyncua").startswith("Doğrulanmadı")

    def test_kurulum_komutu_verir(self):
        assert "pip install asyncua" in missing_library("asyncua", "asyncua")

    def test_deneme_yapilmadigini_soyler(self):
        assert "hiçbir bağlantı denemesi yapılmadı" in missing_library("aiomqtt", "aiomqtt")


class TestElapsed:
    def test_sure_milisaniyeye_cevrilir(self):
        assert elapsed_ms(1.0, 1.5) == 500.0

    def test_negatif_fark_sifira_cekilir(self):
        # Saat geri gitse bile eksi gecikme rapora giremez.
        assert elapsed_ms(2.0, 1.0) == 0.0


class TestResultHelpers:
    def test_basarisiz_sonucta_kanit_yok(self):
        assert failed("olmadi").evidence is None

    def test_basarisiz_sonucta_gecikme_verilebilir(self):
        assert failed("olmadi", 12.0).latency_ms == 12.0

    def test_basarili_sonuc_kanit_tasir(self):
        result = succeeded("ok", "42 okundu", 5.0)
        assert result.ok is True
        assert result.evidence == "42 okundu"

    def test_basarili_sonucta_bayt_sayisi_opsiyonel(self):
        assert succeeded("ok", "kanit", 5.0).bytes_received is None


class TestRestClassify:
    def test_iki_yuz_dogrulanir(self):
        ok, detail = classify_status(200)
        assert ok is True
        assert "200" in detail

    def test_uc_yuz_dogrulanir(self):
        # Yonlendirme de bir yanittir: uc ayakta ve konusuyor.
        assert classify_status(301)[0] is True

    def test_dort_yuz_bir_yetki_der(self):
        ok, detail = classify_status(401)
        assert ok is False
        assert "yetki" in detail

    def test_dort_yuz_uc_yetki_der(self):
        assert "yetki" in classify_status(403)[1]

    def test_dort_yuz_dort_yolu_isaret_eder(self):
        assert "Yol (path)" in classify_status(404)[1]

    def test_dort_yuz_istek_reddedildi_der(self):
        assert "istek reddedildi" in classify_status(422)[1]

    def test_bes_yuz_sunucu_hatasi_der(self):
        ok, detail = classify_status(500)
        assert ok is False
        assert "sunucu hatası" in detail

    def test_basarisiz_kodlar_kurulamadi_ile_baslar(self):
        for code in (401, 404, 500, 503):
            assert classify_status(code)[1].startswith("Bağlantı kurulamadı")


class TestRestHeaders:
    def test_accept_basligi_her_zaman_var(self):
        assert "Accept" in build_headers(spec())

    def test_kimlik_yoksa_authorization_yok(self):
        # Bos bir Authorization basligi bazi uclarda 400 uretir.
        assert "Authorization" not in build_headers(spec())

    def test_kullanici_adi_varsa_temel_kimlik_eklenir(self):
        headers = build_headers(spec(username="op", password="123"))
        assert headers["Authorization"].startswith("Basic ")

    def test_parolasiz_kullanici_adi_da_calisir(self):
        headers = build_headers(spec(username="op"))
        assert headers["Authorization"].startswith("Basic ")


class TestPreviewBody:
    def test_bos_govde_none(self):
        assert preview_body(b"") is None

    def test_metin_govde_kirpilir(self):
        assert preview_body(b"merhaba", limit=4) == "merh"

    def test_bosluklar_sadelestirilir(self):
        assert preview_body(b"a\n\n  b") == "a b"

    def test_ikili_govde_none(self):
        assert preview_body(b"\xff\xfe\x00") is None


class TestRestAdapterProbe:
    def test_yanlis_sema_denenmeden_reddedilir(self):
        adapter = RestAdapter(fetch=lambda *args: (_ for _ in ()).throw(AssertionError()))
        result = asyncio.run(adapter.probe(spec(endpoint="ftp://x")))
        assert result.ok is False
        assert "http://" in result.detail

    def test_basarili_yanit_dogrulanir(self):
        adapter = RestAdapter(fetch=lambda url, headers, timeout: (200, b'{"ok":1}'))
        result = asyncio.run(adapter.probe(spec()))
        assert result.ok is True
        assert result.bytes_received == 8

    def test_basarili_yanit_gecikme_olcer(self):
        adapter = RestAdapter(fetch=lambda url, headers, timeout: (200, b"x"))
        assert asyncio.run(adapter.probe(spec())).latency_ms is not None

    def test_basarili_yanitta_kanit_yazilir(self):
        adapter = RestAdapter(fetch=lambda url, headers, timeout: (200, b"xy"))
        assert "2 bayt" in asyncio.run(adapter.probe(spec())).evidence

    def test_dort_yuz_dort_basarisiz(self):
        adapter = RestAdapter(fetch=lambda url, headers, timeout: (404, b""))
        assert asyncio.run(adapter.probe(spec())).ok is False

    def test_http_hatasi_yanit_sayilir(self):
        def firlat(url, headers, timeout):
            raise urllib.error.HTTPError(url, 503, "yok", {}, None)

        result = asyncio.run(RestAdapter(fetch=firlat).probe(spec()))
        assert result.ok is False
        assert "503" in result.detail

    def test_ag_hatasi_cevrilir(self):
        def firlat(url, headers, timeout):
            raise urllib.error.URLError(ConnectionRefusedError())

        result = asyncio.run(RestAdapter(fetch=firlat).probe(spec()))
        assert "reddetti" in result.detail

    def test_beklenmedik_hata_da_cevrilir(self):
        def firlat(url, headers, timeout):
            raise RuntimeError("kapali kapi")

        result = asyncio.run(RestAdapter(fetch=firlat).probe(spec()))
        assert result.ok is False
        assert "kapali kapi" in result.detail

    def test_zaman_asimi_saniyeye_cevrilir(self):
        gorulen = {}

        def yakala(url, headers, timeout):
            gorulen["timeout"] = timeout
            return (200, b"")

        asyncio.run(RestAdapter(fetch=yakala).probe(spec(timeout_ms=2_500)))
        assert gorulen["timeout"] == 2.5


class TestOpcUaHelpers:
    def test_sayisal_dugum_gecerli(self):
        assert is_valid_node_id("i=2258") is True

    def test_ad_alanli_dugum_gecerli(self):
        assert is_valid_node_id("ns=2;i=5") is True

    def test_metin_dugum_gecerli(self):
        assert is_valid_node_id("ns=2;s=Hat.Sayac") is True

    def test_guid_dugum_gecerli(self):
        assert is_valid_node_id("g=1234") is True

    def test_bos_dugum_gecersiz(self):
        assert is_valid_node_id("  ") is False

    def test_tipsiz_dugum_gecersiz(self):
        assert is_valid_node_id("2258") is False

    def test_bos_govdeli_dugum_gecersiz(self):
        assert is_valid_node_id("i=") is False

    def test_sayisal_olmayan_ad_alani_gecersiz(self):
        assert is_valid_node_id("ns=x;i=5") is False

    def test_fazla_noktali_virgul_gecersiz(self):
        assert is_valid_node_id("ns=2;i=5;x=1") is False

    def test_dugum_verilmezse_sunucu_saati_okunur(self):
        # Her OPC UA sunucusunda bulunmasi zorunlu standart dugum.
        assert node_ids_of(spec(kind=ConnectionKind.OPCUA)) == [DEFAULT_NODE_ID]

    def test_gecerli_dugumler_kullanilir(self):
        item = spec(kind=ConnectionKind.OPCUA, topics=["ns=2;i=5", "bozuk"])
        assert node_ids_of(item) == ["ns=2;i=5"]

    def test_hepsi_bozuksa_varsayilana_dusulur(self):
        item = spec(kind=ConnectionKind.OPCUA, topics=["bozuk", "yine bozuk"])
        assert node_ids_of(item) == [DEFAULT_NODE_ID]

    def test_bozuk_dugumler_bildirilir(self):
        item = spec(kind=ConnectionKind.OPCUA, topics=["ns=2;i=5", "bozuk"])
        assert invalid_node_ids(item) == ["bozuk"]

    def test_none_politikasinda_guvenlik_dizgesi_yok(self):
        assert security_string(spec(kind=ConnectionKind.OPCUA)) is None

    def test_sifreli_politikada_dizge_uretilir(self):
        item = spec(
            kind=ConnectionKind.OPCUA, security_policy=SecurityPolicy.BASIC256SHA256
        )
        assert security_string(item) == "Basic256Sha256,SignAndEncrypt"

    def test_parolali_none_politikasi_uyarir(self):
        item = spec(kind=ConnectionKind.OPCUA, password="123")
        assert "şifrelenmeden" in security_note(item)

    def test_anonim_none_politikasi_sifrelenmedigini_yazar(self):
        assert "şifrelenmez" in security_note(spec(kind=ConnectionKind.OPCUA))

    def test_sifreli_politika_sertifika_ister(self):
        item = spec(
            kind=ConnectionKind.OPCUA, security_policy=SecurityPolicy.BASIC256SHA256
        )
        assert "sertifika" in security_note(item)

    def test_kullanici_adi_yoksa_anonim(self):
        assert is_anonymous(spec(kind=ConnectionKind.OPCUA)) is True

    def test_kullanici_adi_varsa_anonim_degil(self):
        assert is_anonymous(spec(kind=ConnectionKind.OPCUA, username="op")) is False


class TestOpcUaAdapterGuards:
    def test_yanlis_sema_reddedilir(self):
        result = asyncio.run(
            OpcUaAdapter().probe(spec(kind=ConnectionKind.OPCUA, endpoint="http://x"))
        )
        assert result.ok is False
        assert "opc.tcp://" in result.detail

    def test_sertifikasiz_sifreli_politika_denenmez(self):
        item = spec(
            kind=ConnectionKind.OPCUA,
            endpoint="opc.tcp://127.0.0.1:4840",
            security_policy=SecurityPolicy.BASIC256SHA256,
        )
        result = asyncio.run(OpcUaAdapter().probe(item))
        assert result.ok is False
        assert result.detail.startswith("Doğrulanmadı")

    def test_kutuphane_yoksa_dogrulanmadi_denir(self):
        adapter = OpcUaAdapter()
        adapter._client_factory = None  # noqa: SLF001 — test icin acik
        # Ice aktarma basarisiz olmus gibi davranmak icin sahte cozucu.
        adapter._resolve_factory = lambda: (None, missing_library("asyncua", "asyncua"))  # type: ignore[method-assign]
        item = spec(kind=ConnectionKind.OPCUA, endpoint="opc.tcp://127.0.0.1:4840")
        result = asyncio.run(adapter.probe(item))
        assert result.detail.startswith("Doğrulanmadı")


class TestMqttHelpers:
    def test_duz_konu_gecerli(self):
        assert is_valid_topic("fabrika/hat1/sayac") is True

    def test_tek_seviye_joker_gecerli(self):
        assert is_valid_topic("fabrika/+/sayac") is True

    def test_son_seviyede_coklu_joker_gecerli(self):
        assert is_valid_topic("fabrika/#") is True

    def test_ortada_coklu_joker_gecersiz(self):
        # `#` yalnizca son seviyede olabilir; broker sessizce reddeder.
        assert is_valid_topic("fabrika/#/sayac") is False

    def test_seviyeye_yapisik_joker_gecersiz(self):
        assert is_valid_topic("fabrika/hat#") is False
        assert is_valid_topic("fabrika/hat+") is False

    def test_bos_konu_gecersiz(self):
        assert is_valid_topic("   ") is False

    def test_null_karakterli_konu_gecersiz(self):
        assert is_valid_topic("a\x00b") is False

    def test_gecerli_konular_suzulur(self):
        item = spec(kind=ConnectionKind.MQTT, topics=["a/b", "a/#/c"])
        assert valid_topics(item) == ["a/b"]

    def test_gecersiz_konular_bildirilir(self):
        item = spec(kind=ConnectionKind.MQTT, topics=["a/b", "a/#/c"])
        assert invalid_topics(item) == ["a/#/c"]

    def test_varsayilan_port_bin_sekiz_yuz_seksen_uc(self):
        assert DEFAULT_PORT == 1883

    def test_adres_ve_port_ayrilir(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local:1884")
        assert broker_address(item) == ("broker.local", 1884)

    def test_acik_port_adresteki_portu_yener(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local:1884", port=9000)
        assert broker_address(item) == ("broker.local", 9000)

    def test_port_yoksa_varsayilan(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local")
        assert broker_address(item) == ("broker.local", 1883)


class TestMqttAdapterGuards:
    def test_bos_adres_reddedilir(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="", topics=["a/b"])
        result = asyncio.run(MqttAdapter().probe(item))
        assert result.ok is False
        assert "adresi boş" in result.detail

    def test_konu_yoksa_denenmez(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local", topics=[])
        result = asyncio.run(MqttAdapter().probe(item))
        assert result.ok is False
        assert "konu" in result.detail

    def test_hepsi_gecersiz_konuysa_denenmez(self):
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local", topics=["a/#/b"])
        assert asyncio.run(MqttAdapter().probe(item)).ok is False

    def test_kutuphane_yoksa_dogrulanmadi_denir(self):
        adapter = MqttAdapter()
        adapter._resolve_factory = lambda: (None, missing_library("aiomqtt", "aiomqtt"))  # type: ignore[method-assign]
        item = spec(kind=ConnectionKind.MQTT, endpoint="broker.local", topics=["a/b"])
        assert asyncio.run(adapter.probe(item)).detail.startswith("Doğrulanmadı")
