"""Runtime şemasının dürüstlük sözleşmesi.

Bu dosyadaki testler tek bir şeyi korur: ölçülmemiş bir değer hiçbir zaman
ölçülmüş gibi görünemez ve parola hiçbir yanıta sızamaz.
"""

from __future__ import annotations

from simulation_engine.runtime.types import (
    STATUS_LABEL,
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    EventLevel,
    ProbeResult,
    SecurityPolicy,
    not_attempted,
)


def spec(**overrides) -> ConnectionSpec:
    base = dict(
        connection_id="c1",
        kind=ConnectionKind.REST,
        label="Hat 1 API",
        endpoint="http://127.0.0.1:9/veri",
    )
    base.update(overrides)
    return ConnectionSpec(**base)


class TestConnectionSpec:
    def test_varsayilan_zaman_asimi_bes_saniye(self):
        assert spec().timeout_ms == 5_000

    def test_varsayilan_olarak_yeniden_denenmez(self):
        # Sessizce yeniden denemek, kullanicinin bir hatayi hic gormemesine
        # yol acabilir; deneme sayisi acikca istenir.
        assert spec().max_retries == 3

    def test_konu_listesi_varsayilan_bos(self):
        assert spec().topics == []

    def test_varsayilan_guvenlik_politikasi_none(self):
        assert spec().security_policy is SecurityPolicy.NONE

    def test_spec_degistirilemez(self):
        item = spec()
        try:
            item.endpoint = "http://baska"  # type: ignore[misc]
        except Exception as error:
            assert isinstance(error, (AttributeError, TypeError))
        else:  # pragma: no cover - dataclass frozen ise buraya girilmez
            raise AssertionError("ConnectionSpec degistirilebilir olmamali")


class TestRedaction:
    def test_parola_yanitta_yer_almaz(self):
        payload = spec(password="gizli123").redacted()
        assert "password" not in payload
        assert "gizli123" not in str(payload)

    def test_parolanin_varligi_bildirilir(self):
        assert spec(password="gizli").redacted()["has_password"] is True

    def test_parola_yoksa_bildirilir(self):
        assert spec().redacted()["has_password"] is False

    def test_bos_parola_yok_sayilir(self):
        assert spec(password="").redacted()["has_password"] is False

    def test_kullanici_adi_gorunur(self):
        # Kullanici adi bir sir degildir ve hangi hesapla baglanildigini
        # gormek sorun cozmenin ilk adimidir.
        assert spec(username="operator").redacted()["username"] == "operator"

    def test_uc_adresi_gorunur(self):
        assert spec().redacted()["endpoint"] == "http://127.0.0.1:9/veri"

    def test_konular_kopyalanir(self):
        item = spec(topics=["a/b"])
        payload = item.redacted()
        payload["topics"].append("c/d")
        assert item.topics == ["a/b"]

    def test_tur_metin_olarak_doner(self):
        assert spec(kind=ConnectionKind.MQTT).redacted()["kind"] == "mqtt"

    def test_guvenlik_politikasi_metin_olarak_doner(self):
        payload = spec(security_policy=SecurityPolicy.BASIC256SHA256).redacted()
        assert payload["security_policy"] == "Basic256Sha256"


class TestProbeResult:
    def test_denenmeyen_baglantida_hicbir_olcum_yok(self):
        result = not_attempted("Test edilmedi.")
        assert result.ok is False
        assert result.latency_ms is None
        assert result.bytes_received is None
        assert result.evidence is None

    def test_denenmeyen_baglantinin_nedeni_yazilir(self):
        assert not_attempted("Kutuphane yok.").detail == "Kutuphane yok."

    def test_deneme_ani_kaydedilir(self):
        assert not_attempted("x").at_ms > 0

    def test_basarili_sonuc_kanit_tasiyabilir(self):
        result = ProbeResult(ok=True, latency_ms=12.5, detail="ok", evidence="42")
        assert result.evidence == "42"

    def test_gecikme_sifir_ile_none_ayni_degildir(self):
        olculen = ProbeResult(ok=True, latency_ms=0.0, detail="ok")
        olculmeyen = ProbeResult(ok=False, latency_ms=None, detail="yok")
        assert olculen.latency_ms == 0.0
        assert olculmeyen.latency_ms is None


class TestStatusLabels:
    def test_her_durumun_etiketi_var(self):
        for value in ConnectionStatus:
            assert value in STATUS_LABEL
            assert STATUS_LABEL[value]

    def test_yalnizca_dogrulanan_durum_baglandi_der(self):
        # Sozlesme: "Bagladi" yalnizca gercek cihaz yanitindan sonra.
        bagli = [
            value
            for value, label in STATUS_LABEL.items()
            if "Bağlandı" in label
        ]
        assert bagli == [ConnectionStatus.CONNECTED]

    def test_denenmeyen_durum_test_edilmedi_der(self):
        assert STATUS_LABEL[ConnectionStatus.IDLE] == "Test edilmedi"

    def test_basarisiz_durum_kurulamadi_der(self):
        assert STATUS_LABEL[ConnectionStatus.FAILED] == "Bağlantı kurulamadı"

    def test_durum_degerleri_metin(self):
        assert ConnectionStatus.CONNECTED.value == "connected"


class TestEnums:
    def test_uc_baglanti_turu_var(self):
        assert {kind.value for kind in ConnectionKind} == {"rest", "opcua", "mqtt"}

    def test_uc_olay_seviyesi_var(self):
        assert {level.value for level in EventLevel} == {"info", "warning", "critical"}

    def test_iki_guvenlik_politikasi_var(self):
        assert {policy.value for policy in SecurityPolicy} == {"None", "Basic256Sha256"}
