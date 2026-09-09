"""Runtime sağlık skoru (0-100).

Tek bir sayı "köprü iyi durumda mı?" sorusunu yanıtlar. Bu dosyanın koruduğu
kural, skorun **uydurulmamasıdır**: hiçbir ölçü yoksa skor `None` döner. Sıfır
dönmek hiç izlenmemiş bir köprüyü "tamamen bozuk" diye raporlamak, yüz dönmek
ise "kusursuz" diye raporlamak olurdu; ikisi de yanlıştır.

Kısmi ölçümde skor, yalnızca ölçülebilen bileşenlerin ağırlıkları yeniden
normalize edilerek hesaplanır ve eksikler yazılır.
"""

from __future__ import annotations

import math

import pytest

from simulation_engine.runtime.health_score import (
    LATENCY_CEILING_MS,
    RECONNECT_CEILING,
    WEIGHTS,
    HealthInput,
    compute_health_score,
    error_score,
    is_valid_score,
    latency_score,
    reconnect_score,
    uptime_score,
)

SAAT_MS = 3_600_000


# -- Bileşenler -------------------------------------------------------------


class TestCalismaSuresiPuani:
    def test_pencerenin_tamaminda_acik_tam_puan(self):
        assert uptime_score(SAAT_MS, SAAT_MS) == 1.0

    def test_yarisinda_acik_yarim_puan(self):
        assert uptime_score(SAAT_MS / 2, SAAT_MS) == 0.5

    def test_hic_acik_degilse_sifir(self):
        assert uptime_score(0, SAAT_MS) == 0.0

    def test_olculmemis_sure_none(self):
        assert uptime_score(None, SAAT_MS) is None

    def test_pencere_yoksa_none(self):
        assert uptime_score(SAAT_MS, None) is None

    def test_sifir_pencere_none(self):
        assert uptime_score(SAAT_MS, 0) is None

    def test_penceredan_uzun_sure_bire_kirpilir(self):
        assert uptime_score(SAAT_MS * 2, SAAT_MS) == 1.0


class TestHataPuani:
    def test_hicbir_hata_yoksa_tam_puan(self):
        assert error_score(100, 0) == 1.0

    def test_yarisi_hataysa_yarim_puan(self):
        assert error_score(50, 50) == 0.5

    def test_hepsi_hataysa_sifir(self):
        assert error_score(0, 10) == 0.0

    def test_hic_deneme_yoksa_none(self):
        """Hiç paket denenmediyse hata oranı yoktur; sıfır demek yanıltıcı olurdu."""
        assert error_score(0, 0) is None

    def test_olculmemis_paket_none(self):
        assert error_score(None, 0) is None

    def test_olculmemis_hata_none(self):
        assert error_score(100, None) is None


class TestYenidenBaglanmaPuani:
    def test_hic_kopma_yoksa_tam_puan(self):
        assert reconnect_score(0) == 1.0

    def test_tavanda_sifir(self):
        assert reconnect_score(RECONNECT_CEILING) == 0.0

    def test_tavanin_ustunde_de_sifir(self):
        assert reconnect_score(RECONNECT_CEILING * 3) == 0.0

    def test_yari_tavanda_yarim(self):
        assert reconnect_score(RECONNECT_CEILING // 2) == 0.5

    def test_olculmemis_none(self):
        assert reconnect_score(None) is None


class TestGecikmePuani:
    def test_sifir_gecikme_tam_puan(self):
        assert latency_score(0) == 1.0

    def test_tavanda_sifir(self):
        assert latency_score(LATENCY_CEILING_MS) == 0.0

    def test_tavanin_ustunde_sifir(self):
        assert latency_score(LATENCY_CEILING_MS * 2) == 0.0

    def test_yari_tavanda_yarim(self):
        assert latency_score(LATENCY_CEILING_MS / 2) == 0.5

    def test_olculmemis_none(self):
        assert latency_score(None) is None

    def test_negatif_gecikme_none(self):
        """Negatif gecikme bir ölçüm değil, bir hesap hatasıdır."""
        assert latency_score(-5) is None


# -- Bileşim ----------------------------------------------------------------


def tam_girdi(**overrides) -> HealthInput:
    data = {
        "uptime_ms": SAAT_MS,
        "window_ms": SAAT_MS,
        "packets": 1_000,
        "errors": 0,
        "reconnects": 0,
        "avg_latency_ms": 50.0,
    }
    data.update(overrides)
    return HealthInput(**data)


class TestSaglikSkoru:
    def test_agirliklarin_toplami_bir(self):
        assert sum(WEIGHTS.values()) == pytest.approx(1.0)

    def test_kusursuz_kosullarda_yuz(self):
        assert compute_health_score(tam_girdi(avg_latency_ms=0)).score == 100.0

    def test_skor_sifir_yuz_araliginda(self):
        assert 0.0 <= compute_health_score(tam_girdi()).score <= 100.0

    def test_hicbir_olcum_yoksa_none(self):
        assert compute_health_score(HealthInput()).score is None

    def test_olcumsuz_skor_olculmedi_etiketi(self):
        assert compute_health_score(HealthInput()).label == "Ölçülmedi"

    def test_olcumsuz_skorda_dort_bilesen_de_eksik(self):
        assert len(compute_health_score(HealthInput()).missing) == 4

    def test_eksik_bilesen_sifir_sayilmaz(self):
        """Eksik bileşeni sıfır saymak, ölçülmemiş bir şeyi kötü puanlamaktır."""
        yalnizca_gecikme = compute_health_score(
            HealthInput(avg_latency_ms=0)
        )
        assert yalnizca_gecikme.score == 100.0

    def test_eksik_bilesenler_listelenir(self):
        result = compute_health_score(HealthInput(avg_latency_ms=0))
        assert set(result.missing) == {"uptime", "errors", "reconnects"}

    def test_hatalar_skoru_dusurur(self):
        temiz = compute_health_score(tam_girdi()).score
        hatali = compute_health_score(tam_girdi(errors=500)).score
        assert hatali < temiz

    def test_kopmalar_skoru_dusurur(self):
        temiz = compute_health_score(tam_girdi()).score
        kopuk = compute_health_score(tam_girdi(reconnects=5)).score
        assert kopuk < temiz

    def test_gecikme_skoru_dusurur(self):
        hizli = compute_health_score(tam_girdi(avg_latency_ms=10)).score
        yavas = compute_health_score(tam_girdi(avg_latency_ms=900)).score
        assert yavas < hizli

    def test_calisma_suresi_en_agir_bilesen(self):
        """Veri akmıyorsa geri kalanı önemsizdir; ağırlık bunu yansıtmalı."""
        assert WEIGHTS["uptime"] == max(WEIGHTS.values())

    def test_iyi_etiketi(self):
        assert compute_health_score(tam_girdi(avg_latency_ms=0)).label == "İyi"

    def test_kotu_etiketi(self):
        kotu = compute_health_score(
            tam_girdi(uptime_ms=0, errors=1_000, packets=0, reconnects=RECONNECT_CEILING,
                      avg_latency_ms=LATENCY_CEILING_MS)
        )
        assert kotu.label == "Kötü"

    def test_sozluk_bilesenleri_icerir(self):
        payload = compute_health_score(tam_girdi()).to_dict()
        assert set(payload) == {"score", "label", "components", "missing"}

    def test_bilesen_degerleri_sozlukte_gorunur(self):
        payload = compute_health_score(tam_girdi()).to_dict()
        assert payload["components"]["uptime"] == 1.0


class TestGecerlilikDenetimi:
    def test_none_gecerli(self):
        assert is_valid_score(None) is True

    def test_aralik_ici_gecerli(self):
        assert is_valid_score(72.5) is True

    def test_sinirlar_gecerli(self):
        assert is_valid_score(0.0) is True
        assert is_valid_score(100.0) is True

    def test_yuzun_ustu_gecersiz(self):
        assert is_valid_score(101) is False

    def test_negatif_gecersiz(self):
        assert is_valid_score(-1) is False

    def test_nan_gecersiz(self):
        assert is_valid_score(float("nan")) is False

    def test_sonsuz_gecersiz(self):
        assert is_valid_score(math.inf) is False
