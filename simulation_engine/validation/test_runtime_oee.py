"""OEE motoru: kullanılabilirlik, performans, kalite ve bileşimi.

Bu dosyanın koruduğu asıl kural
-------------------------------
Bir çarpan hesaplanamıyorsa OEE de hesaplanamaz. Eksik çarpanı 1 saymak,
kalitesi hiç ölçülmemiş bir hattı %92 OEE ile mükemmel göstermek olurdu; 0
saymak ise çalışan bir hattı durmuş göstermek. Doğru yanıt üçüncüsüdür:
`None` ve "hangi çarpan eksik" yazan bir neden.

İkinci kural: sonuç her zaman 0-1 arasındadır. Aralık dışına çıkan bir OEE,
hesaplama hatasının en görünür işaretidir ve kabul listesi bunu arar.
"""

from __future__ import annotations

import math

import pytest

from simulation_engine.runtime.oee import (
    OeeInput,
    availability,
    availability_from_minutes,
    availability_reason,
    clamp_ratio,
    compute_oee,
    expected_output,
    is_clamped,
    is_valid_oee,
    line_oee,
    performance,
    performance_reason,
    performance_was_clamped,
    quality,
    quality_from_production,
    quality_reason,
    run_time_ms,
    total_parts,
)

SAAT_MS = 3_600_000


# -- Oran kırpma ------------------------------------------------------------


class TestOranKirpma:
    def test_araliktaki_deger_degismez(self):
        assert clamp_ratio(0.5) == 0.5

    def test_birden_buyuk_deger_bire_iner(self):
        """Bir hattın kullanılabilirliği %100'ü aşamaz."""
        assert clamp_ratio(1.4) == 1.0

    def test_negatif_deger_sifira_cikar(self):
        assert clamp_ratio(-0.2) == 0.0

    def test_none_none_kalir(self):
        assert clamp_ratio(None) is None

    def test_nan_none_olur(self):
        """`NaN` ekranda görünürse kullanıcının bütün sayılara güveni biter."""
        assert clamp_ratio(float("nan")) is None

    def test_sonsuz_none_olur(self):
        assert clamp_ratio(float("inf")) is None

    def test_kirpma_isaretlenir(self):
        assert is_clamped(1.4) is True

    def test_kirpilmayan_deger_isaretlenmez(self):
        assert is_clamped(0.9) is False

    def test_none_kirpilmis_sayilmaz(self):
        assert is_clamped(None) is False


# -- Kullanılabilirlik ------------------------------------------------------


class TestKullanilabilirlik:
    def test_durus_yoksa_tam(self):
        assert availability(SAAT_MS, 0) == 1.0

    def test_yari_durus_yarim(self):
        assert availability(SAAT_MS, SAAT_MS / 2) == 0.5

    def test_tam_durus_sifir(self):
        assert availability(SAAT_MS, SAAT_MS) == 0.0

    def test_planlanan_sure_yoksa_hesaplanamaz(self):
        assert availability(None, 1_000) is None

    def test_durus_olculmemisse_hesaplanamaz(self):
        """Duruşu bilinmeyen bir hattı "hiç durmadı" saymak yanlış olurdu."""
        assert availability(SAAT_MS, None) is None

    def test_sifir_planlanan_sure_hesaplanamaz(self):
        assert availability(0, 0) is None

    def test_negatif_planlanan_sure_hesaplanamaz(self):
        assert availability(-1, 0) is None

    def test_planlanandan_uzun_durus_sifira_kirpilir(self):
        """Kırpma olmasaydı negatif kullanılabilirlik görünürdü."""
        assert availability(SAAT_MS, SAAT_MS * 2) == 0.0

    def test_calisma_suresi_hesaplanir(self):
        assert run_time_ms(SAAT_MS, SAAT_MS / 4) == SAAT_MS * 0.75

    def test_calisma_suresi_negatif_olmaz(self):
        assert run_time_ms(SAAT_MS, SAAT_MS * 3) == 0.0

    def test_calisma_suresi_eksik_veride_none(self):
        assert run_time_ms(None, 0) is None

    def test_dakikadan_hesaplama_ayni_sonucu_verir(self):
        assert availability_from_minutes(60, 30) == 0.5

    def test_dakikadan_hesaplama_eksik_veride_none(self):
        assert availability_from_minutes(None, 30) is None

    def test_neden_planlanan_sure_yoksa_yazilir(self):
        assert availability_reason(None, 0) is not None

    def test_neden_olculebilirse_yok(self):
        assert availability_reason(SAAT_MS, 0) is None


# -- Performans -------------------------------------------------------------


class TestPerformans:
    def test_beklenen_cikti_hesaplanir(self):
        assert expected_output(SAAT_MS, 60) == 60

    def test_beklenen_cikti_eksik_veride_none(self):
        assert expected_output(None, 60) is None

    def test_sifir_cevrim_suresi_gecersiz(self):
        """Sıfıra bölme yerine "ölçülmedi" döner."""
        assert expected_output(SAAT_MS, 0) is None

    def test_negatif_cevrim_suresi_gecersiz(self):
        assert expected_output(SAAT_MS, -5) is None

    def test_beklenen_kadar_uretim_tam_performans(self):
        assert performance(60, SAAT_MS, 60) == 1.0

    def test_yarisi_kadar_uretim_yarim_performans(self):
        assert performance(30, SAAT_MS, 60) == 0.5

    def test_uretim_olculmemisse_hesaplanamaz(self):
        assert performance(None, SAAT_MS, 60) is None

    def test_calisma_suresi_yoksa_hesaplanamaz(self):
        assert performance(30, None, 60) is None

    def test_ideal_cevrim_yoksa_hesaplanamaz(self):
        """İdeal çevrimi uydurmak, performansı uydurmak olurdu."""
        assert performance(30, SAAT_MS, None) is None

    def test_sifir_calisma_suresinde_hesaplanamaz(self):
        assert performance(30, 0, 60) is None

    def test_beklenenden_fazla_uretim_bire_kirpilir(self):
        assert performance(120, SAAT_MS, 60) == 1.0

    def test_kirpma_isaretlenir(self):
        """Sürekli kırpılan performans, ideal çevrimin yanlış olduğunu söyler."""
        assert performance_was_clamped(120, SAAT_MS, 60) is True

    def test_normal_deger_kirpilmis_sayilmaz(self):
        assert performance_was_clamped(30, SAAT_MS, 60) is False

    def test_neden_eksik_veride_yazilir(self):
        assert performance_reason(None, SAAT_MS, 60) is not None

    def test_neden_olculebilirse_yok(self):
        assert performance_reason(30, SAAT_MS, 60) is None


# -- Kalite -----------------------------------------------------------------


class TestKalite:
    def test_toplam_parca_hesaplanir(self):
        assert total_parts(90, 10) == 100

    def test_toplam_parca_eksik_veride_none(self):
        assert total_parts(None, 10) is None

    def test_fire_yoksa_tam_kalite(self):
        assert quality(100, 0) == 1.0

    def test_onda_bir_fire(self):
        assert quality(90, 10) == 0.9

    def test_hicbiri_saglam_degilse_sifir(self):
        assert quality(0, 50) == 0.0

    def test_uretim_olculmemisse_hesaplanamaz(self):
        assert quality(None, 10) is None

    def test_fire_olculmemisse_hesaplanamaz(self):
        """Fire ölçülmediyse kalite %100 sayılamaz; ölçüm yokluğu iyi haber değildir."""
        assert quality(100, None) is None

    def test_hic_parca_yoksa_hesaplanamaz(self):
        assert quality(0, 0) is None

    def test_uretimden_kalite_ayni_sonucu_verir(self):
        assert quality_from_production(100, 10) == pytest.approx(0.9)

    def test_neden_eksik_veride_yazilir(self):
        assert quality_reason(None, 10) is not None

    def test_neden_olculebilirse_yok(self):
        assert quality_reason(90, 10) is None


# -- Bileşim ----------------------------------------------------------------


def tam_girdi(**overrides) -> OeeInput:
    data = {
        "planned_time_ms": SAAT_MS,
        "downtime_ms": SAAT_MS / 10,
        "good_parts": 90,
        "scrap_parts": 10,
        "ideal_cycle_seconds": 30,
    }
    data.update(overrides)
    return OeeInput(**data)


class TestOeeBilesimi:
    def test_tam_veride_uc_carpan_da_hesaplanir(self):
        result = compute_oee(tam_girdi())
        assert result.availability is not None
        assert result.performance is not None
        assert result.quality is not None

    def test_oee_carpanlarin_carpimi(self):
        result = compute_oee(tam_girdi())
        beklenen = result.availability * result.performance * result.quality
        assert result.oee == pytest.approx(beklenen)

    def test_oee_sifir_bir_araliginda(self):
        assert 0.0 <= compute_oee(tam_girdi()).oee <= 1.0

    def test_tam_veride_neden_yazilmaz(self):
        assert compute_oee(tam_girdi()).reasons == {}

    def test_tam_veride_eksiksiz_isaretlenir(self):
        assert compute_oee(tam_girdi()).is_complete is True

    @pytest.mark.parametrize(
        "eksik",
        ["planned_time_ms", "downtime_ms", "good_parts", "scrap_parts", "ideal_cycle_seconds"],
    )
    def test_tek_eksik_alan_oeeyi_hesaplanamaz_yapar(self, eksik):
        assert compute_oee(tam_girdi(**{eksik: None})).oee is None

    def test_eksik_carpan_nedende_adiyla_gecer(self):
        result = compute_oee(tam_girdi(scrap_parts=None))
        assert "kalite" in result.reasons["oee"]

    def test_bos_girdide_uc_neden_de_yazilir(self):
        result = compute_oee(OeeInput())
        assert set(result.reasons) >= {"availability", "performance", "quality"}

    def test_eksik_carpan_bir_sayilmaz(self):
        """En tehlikeli varsayım: eksik çarpanı "sorun yok" saymak."""
        result = compute_oee(tam_girdi(scrap_parts=None))
        assert result.quality is None
        assert result.oee is None

    def test_eksik_carpan_sifir_da_sayilmaz(self):
        result = compute_oee(tam_girdi(good_parts=None))
        assert result.oee is None
        assert result.performance is None

    def test_yuzde_donusumu_yuz_katidir(self):
        result = compute_oee(tam_girdi())
        assert result.as_percent()["oee"] == pytest.approx(result.oee * 100)

    def test_yuzde_donusumu_none_korur(self):
        result = compute_oee(OeeInput())
        assert result.as_percent()["oee"] is None

    def test_sozluk_yuzde_ve_nedenleri_icerir(self):
        payload = compute_oee(tam_girdi()).to_dict()
        assert set(payload) == {
            "availability",
            "performance",
            "quality",
            "oee",
            "percent",
            "reasons",
            "complete",
        }

    def test_sifir_durus_gecerli_olcumdur(self):
        """Ölçülmüş sıfır duruş, ölçülmemiş duruştan farklıdır."""
        result = compute_oee(tam_girdi(downtime_ms=0))
        assert result.availability == 1.0


class TestHatOeesi:
    def test_hesaplanabilen_makinelerin_ortalamasi(self):
        results = [compute_oee(tam_girdi()), compute_oee(tam_girdi(good_parts=45))]
        values = [item.oee for item in results]
        assert line_oee(results) == pytest.approx(sum(values) / 2)

    def test_eksik_makine_ortalamaya_girmez(self):
        """Eksik makineyi sıfır saymak hattı olduğundan kötü gösterirdi."""
        tam = compute_oee(tam_girdi())
        eksik = compute_oee(OeeInput())
        assert line_oee([tam, eksik]) == pytest.approx(tam.oee)

    def test_hicbiri_hesaplanamiyorsa_hat_da_hesaplanamaz(self):
        assert line_oee([compute_oee(OeeInput())]) is None

    def test_bos_liste_none_doner(self):
        assert line_oee([]) is None


class TestGecerlilikDenetimi:
    def test_none_gecerli(self):
        assert is_valid_oee(None) is True

    def test_arasindaki_deger_gecerli(self):
        assert is_valid_oee(0.84) is True

    def test_sinirlar_gecerli(self):
        assert is_valid_oee(0.0) is True
        assert is_valid_oee(1.0) is True

    def test_bir_ustu_gecersiz(self):
        assert is_valid_oee(1.2) is False

    def test_negatif_gecersiz(self):
        assert is_valid_oee(-0.1) is False

    def test_nan_gecersiz(self):
        assert is_valid_oee(float("nan")) is False

    def test_sonsuz_gecersiz(self):
        assert is_valid_oee(math.inf) is False

    def test_metin_gecersiz(self):
        assert is_valid_oee("0.5") is False
