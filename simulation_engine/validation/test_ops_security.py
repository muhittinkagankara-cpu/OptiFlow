"""Güvenlik sertleştirmesi: hız sınırı, başlıklar, gövde boyutu.

Bu dosyanın koruduğu kararlar:

* **Kova dolu başlar.** İlk isteği reddetmek, kotayı kullanmadan
  cezalandırmak olurdu.
* **Yazma kotası daha dardır.** Okuma bir sorgu çalıştırır; yazma diske yazar,
  olay üretir ve cihazla konuşabilir.
* **Token saklanmaz.** Sayaç anahtarı token'ın özetidir; token'ın kendisi
  hiçbir yerde tutulmaz.
* **HSTS yalnızca üretimde.** Geliştirmede eklenirse tarayıcı `localhost`'u
  da HTTPS'e zorlar ve yerel kurulum çalışmaz.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.ops.security import (
    DEFAULT_BURST,
    DEFAULT_RATE_PER_MINUTE,
    HSTS_HEADER,
    MAX_REQUEST_BYTES,
    SECURITY_HEADERS,
    WRITE_RATE_PER_MINUTE,
    RateLimiter,
    TokenBucket,
    client_key,
    exceeds_size_limit,
    is_write_method,
    security_headers,
)

NOW = 1_000_000


class TestJetonKovasi:
    def test_kova_dolu_baslar(self):
        """İlk isteği reddetmek, kotayı kullanmadan cezalandırmak olurdu."""
        bucket = TokenBucket(capacity=5, refill_per_second=1)
        assert bucket.allow(NOW) is True

    def test_kapasite_kadar_izin_verilir(self):
        bucket = TokenBucket(capacity=3, refill_per_second=1)
        assert [bucket.allow(NOW) for _ in range(3)] == [True, True, True]

    def test_kapasite_bitince_reddedilir(self):
        bucket = TokenBucket(capacity=2, refill_per_second=1)
        bucket.allow(NOW)
        bucket.allow(NOW)
        assert bucket.allow(NOW) is False

    def test_zamanla_dolar(self):
        bucket = TokenBucket(capacity=2, refill_per_second=1)
        bucket.allow(NOW)
        bucket.allow(NOW)
        assert bucket.allow(NOW + 1_000) is True

    def test_kapasitenin_ustune_dolmaz(self):
        bucket = TokenBucket(capacity=2, refill_per_second=10)
        bucket.allow(NOW)
        # Uzun bir sessizlikten sonra bile kova kapasitesi kadar dolar.
        for _ in range(2):
            assert bucket.allow(NOW + 60_000) is True
        assert bucket.allow(NOW + 60_000) is False

    def test_sifir_kapasite_bire_cekilir(self):
        assert TokenBucket(capacity=0, refill_per_second=1).capacity == 1

    def test_negatif_kapasite_bire_cekilir(self):
        assert TokenBucket(capacity=-5, refill_per_second=1).capacity == 1

    def test_bekleme_suresi_en_az_bir_saniye(self):
        """Sıfır dönmek, sınırı anlamsız kılardı."""
        bucket = TokenBucket(capacity=1, refill_per_second=0.5)
        bucket.allow(NOW)
        assert bucket.retry_after_seconds(NOW) >= 1

    def test_jeton_varken_bekleme_sifir(self):
        bucket = TokenBucket(capacity=2, refill_per_second=1)
        assert bucket.retry_after_seconds(NOW) == 0


class TestHizSinirlayici:
    def test_varsayilan_sinirlar(self):
        limiter = RateLimiter()
        assert limiter.rate_per_minute == DEFAULT_RATE_PER_MINUTE
        assert limiter.burst == DEFAULT_BURST

    def test_yazma_kotasi_daha_dar(self):
        assert WRITE_RATE_PER_MINUTE < DEFAULT_RATE_PER_MINUTE

    def test_sinir_asilinca_reddedilir(self):
        limiter = RateLimiter(rate_per_minute=60, burst=2)
        assert limiter.check("u1", NOW)[0] is True
        assert limiter.check("u1", NOW)[0] is True
        assert limiter.check("u1", NOW)[0] is False

    def test_reddedilen_bekleme_suresi_verir(self):
        limiter = RateLimiter(rate_per_minute=60, burst=1)
        limiter.check("u1", NOW)
        allowed, retry = limiter.check("u1", NOW)
        assert allowed is False
        assert retry >= 1

    def test_kullanicilar_ayri_sayilir(self):
        """Bir kullanıcının kotası ötekini engellememelidir."""
        limiter = RateLimiter(rate_per_minute=60, burst=1)
        limiter.check("u1", NOW)
        assert limiter.check("u2", NOW)[0] is True

    def test_reddedilenler_sayilir(self):
        limiter = RateLimiter(rate_per_minute=60, burst=1)
        limiter.check("u1", NOW)
        limiter.check("u1", NOW)
        assert limiter.stats()["rejected"] == 1

    def test_izin_verilenler_sayilir(self):
        limiter = RateLimiter(rate_per_minute=60, burst=2)
        limiter.check("u1", NOW)
        assert limiter.stats()["allowed"] == 1

    def test_izlenen_istemci_sayisi(self):
        limiter = RateLimiter()
        limiter.check("u1", NOW)
        limiter.check("u2", NOW)
        assert limiter.stats()["tracked_clients"] == 2

    def test_sifirlama_sayaclari_temizler(self):
        limiter = RateLimiter(rate_per_minute=60, burst=1)
        limiter.check("u1", NOW)
        limiter.check("u1", NOW)
        limiter.reset()
        assert limiter.stats()["rejected"] == 0
        assert limiter.check("u1", NOW)[0] is True

    def test_zamanla_yeniden_izin_verilir(self):
        limiter = RateLimiter(rate_per_minute=60, burst=1)
        limiter.check("u1", NOW)
        assert limiter.check("u1", NOW + 2_000)[0] is True


class TestIstemciAnahtari:
    def test_kimlikli_istek_token_ozetiyle_sayilir(self):
        key = client_key("Bearer abc", "10.0.0.1")
        assert key.startswith("user:")

    def test_token_anahtarda_gorunmez(self):
        """Token'ın kendisi hiçbir yerde saklanmaz."""
        assert "abc" not in client_key("Bearer abc", None)

    def test_ayni_token_ayni_anahtar(self):
        assert client_key("Bearer abc", None) == client_key("Bearer abc", None)

    def test_farkli_token_farkli_anahtar(self):
        assert client_key("Bearer abc", None) != client_key("Bearer xyz", None)

    def test_kimliksiz_istek_ipye_duser(self):
        assert client_key(None, "10.0.0.1") == "ip:10.0.0.1"

    def test_ikisi_de_yoksa_ortak_kova(self):
        """Anahtarsız istekler sınırsız olmamalıdır."""
        assert client_key(None, None) == "anonim"

    def test_kimlik_ipden_onceliklidir(self):
        assert client_key("Bearer abc", "10.0.0.1").startswith("user:")


class TestYazmaYontemi:
    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_yazma_yontemleri(self, method):
        assert is_write_method(method) is True

    @pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
    def test_okuma_yontemleri(self, method):
        assert is_write_method(method) is False

    def test_kucuk_harf_de_taninir(self):
        assert is_write_method("post") is True


class TestGovdeBoyutu:
    def test_sinirin_altinda_gecer(self):
        assert exceeds_size_limit("1000") is False

    def test_sinirin_ustunde_reddedilir(self):
        assert exceeds_size_limit(str(MAX_REQUEST_BYTES + 1)) is True

    def test_tam_sinirda_gecer(self):
        assert exceeds_size_limit(str(MAX_REQUEST_BYTES)) is False

    def test_baslik_yoksa_gecer(self):
        """Uzunluk bildirmeyen bir istek burada reddedilemez."""
        assert exceeds_size_limit(None) is False

    def test_bozuk_baslik_gecer(self):
        assert exceeds_size_limit("cok-buyuk") is False

    def test_ozel_sinir_uygulanir(self):
        assert exceeds_size_limit("500", limit=100) is True


class TestGuvenlikBasliklari:
    def test_icerik_turu_tahmini_kapali(self):
        assert security_headers(False)["X-Content-Type-Options"] == "nosniff"

    def test_cerceveleme_kapali(self):
        assert security_headers(False)["X-Frame-Options"] == "DENY"

    def test_yonlendiren_gizlenir(self):
        assert security_headers(False)["Referrer-Policy"] == "no-referrer"

    def test_izin_politikasi_dar(self):
        policy = security_headers(False)["Permissions-Policy"]
        assert "camera=()" in policy

    def test_icerik_politikasi_en_dar(self):
        assert "default-src 'none'" in security_headers(False)["Content-Security-Policy"]

    def test_hsts_gelistirmede_eklenmez(self):
        """Eklenirse tarayıcı localhost'u da HTTPS'e zorlar."""
        assert HSTS_HEADER[0] not in security_headers(False)

    def test_hsts_uretimde_eklenir(self):
        assert HSTS_HEADER[0] in security_headers(True)

    def test_temel_basliklar_her_ortamda_var(self):
        for key in SECURITY_HEADERS:
            assert key in security_headers(False)
            assert key in security_headers(True)
