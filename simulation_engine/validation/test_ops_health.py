"""Sağlık, hazırlık, ortam denetimi ve süreç ölçümleri.

Korunan ayrım
-------------
**Sağlık** "süreç ayakta mı?" sorusudur ve hiçbir bağımlılığı yoklamaz:
veritabanı bir dakikalığına yavaşladığında bütün kapsayıcıların sırayla
yeniden başlaması, kesintiyi dakikalara çıkarırdı.

**Hazırlık** "bu sürece istek gönderilebilir mi?" sorusudur; veritabanını ve
yapılandırmayı gerçekten yoklar.

Ölçüm dürüstlüğü
----------------
`psutil` yoksa bellek ve işlemci `None` döner. Sıfır dönmek, hiç bellek
kullanmayan bir sunucu göstermek olurdu.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from simulation_engine.runtime.ops.environment import (
    ENVIRONMENT_ENV,
    RECOMMENDED,
    REQUIRED_IN_PRODUCTION,
    Severity,
    check_environment,
    environment_name,
    is_production,
    missing_keys,
)
from simulation_engine.runtime.ops.health import (
    HealthService,
    check_configuration,
    check_database,
)
from simulation_engine.runtime.ops.metrics import (
    MAX_SAMPLES,
    CpuSampler,
    ProcessMetrics,
    RequestCounter,
    memory_mb,
)
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
)

NOW = 3_000_000

PRODUCTION_ENV = {
    ENVIRONMENT_ENV: "production",
    "SUPABASE_JWKS_URL": "https://x.supabase.co/jwks.json",
    "FRONTEND_ORIGINS": "https://optiflow.example.com",
    "DATABASE_URL": "postgresql+psycopg2://u:p@db/optiflow",
}


class TestOrtamAdi:
    def test_tanimsizsa_gelistirme(self):
        """Ortamsız açılan bir sunucu üretim kurallarıyla reddedilmemeli."""
        assert environment_name({}) == "development"

    def test_buyuk_harf_kucultulur(self):
        assert environment_name({ENVIRONMENT_ENV: "PRODUCTION"}) == "production"

    def test_bosluk_kirpilir(self):
        assert environment_name({ENVIRONMENT_ENV: "  prod  "}) == "prod"

    @pytest.mark.parametrize("name", ["production", "prod", "uretim"])
    def test_uretim_adlari_taninir(self, name):
        assert is_production({ENVIRONMENT_ENV: name}) is True

    def test_gelistirme_uretim_degil(self):
        assert is_production({ENVIRONMENT_ENV: "development"}) is False


class TestOrtamDenetimi:
    def test_tam_uretim_ortami_gecer(self):
        assert check_environment(PRODUCTION_ENV).ok is True

    def test_eksik_jwks_uretimde_hata(self):
        env = {**PRODUCTION_ENV}
        del env["SUPABASE_JWKS_URL"]
        report = check_environment(env)
        assert report.ok is False
        assert "SUPABASE_JWKS_URL" in missing_keys(report)

    def test_eksik_jwks_gelistirmede_uyari(self):
        report = check_environment({ENVIRONMENT_ENV: "development"})
        assert report.ok is True
        assert any(item.key == "SUPABASE_JWKS_URL" for item in report.warnings)

    def test_eksik_cors_uretimde_hata(self):
        env = {**PRODUCTION_ENV}
        del env["FRONTEND_ORIGINS"]
        assert check_environment(env).ok is False

    def test_joker_cors_uretimde_hata(self):
        """Joker CORS, herhangi bir sitenin API'yi çağırmasına izin verirdi."""
        env = {**PRODUCTION_ENV, "FRONTEND_ORIGINS": "*"}
        assert check_environment(env).ok is False

    def test_joker_cors_gelistirmede_uyari(self):
        env = {ENVIRONMENT_ENV: "development", "FRONTEND_ORIGINS": "*"}
        report = check_environment(env)
        assert report.ok is True
        assert report.warnings

    def test_veritabani_yoksa_uyari(self):
        """Eksikliği yeteneği kısıtlar ama sunucuyu durdurmaz."""
        env = {**PRODUCTION_ENV}
        del env["DATABASE_URL"]
        report = check_environment(env)
        assert report.ok is True
        assert any(item.key == "DATABASE_URL" for item in report.warnings)

    def test_bos_deger_tanimsiz_sayilir(self):
        env = {**PRODUCTION_ENV, "SUPABASE_JWKS_URL": "   "}
        assert check_environment(env).ok is False

    def test_bulgu_cozum_onerisi_tasir(self):
        env = {**PRODUCTION_ENV}
        del env["SUPABASE_JWKS_URL"]
        assert check_environment(env).errors[0].remedy

    def test_sozluk_alanlari(self):
        payload = check_environment(PRODUCTION_ENV).to_dict()
        assert set(payload) == {
            "environment",
            "production",
            "ok",
            "errors",
            "warnings",
        }

    def test_zorunlu_ve_onerilen_listeler_ayri(self):
        assert set(REQUIRED_IN_PRODUCTION) & set(RECOMMENDED) == set()

    def test_bulgu_duzeyi_etiketli(self):
        env = {**PRODUCTION_ENV}
        del env["SUPABASE_JWKS_URL"]
        finding = check_environment(env).errors[0]
        assert finding.severity is Severity.ERROR
        assert finding.to_dict()["severity_label"] == "Hata"


class TestVeritabaniYoklamasi:
    def test_depo_yoksa_hazir_degil(self):
        assert check_database(None).ok is False

    def test_bellek_deposu_ariza_degil(self):
        """Bellek deposu kalıcı değildir ama bir arıza da değildir."""
        check = check_database(InMemoryRuntimeRepository())
        assert check.ok is True
        assert "kaybolur" in check.detail

    def test_gercek_veritabani_yoklanir(self):
        path = os.path.join(tempfile.mkdtemp(), "health.db")
        repository = DatabaseRuntimeRepository(f"sqlite:///{path}")
        check = check_database(repository)
        assert check.ok is True
        assert check.latency_ms is not None

    def test_okunamayan_veritabani_hazir_degil(self):
        class Bozuk:
            is_persistent = True

            def known_orgs(self):
                raise RuntimeError("baglanti yok")

        check = check_database(Bozuk())
        assert check.ok is False
        assert "baglanti yok" in check.detail

    def test_yapilandirma_yoklamasi_gecer(self):
        assert check_configuration(check_environment(PRODUCTION_ENV)).ok is True

    def test_eksik_yapilandirma_yoklamasi_duser(self):
        env = {**PRODUCTION_ENV}
        del env["SUPABASE_JWKS_URL"]
        check = check_configuration(check_environment(env))
        assert check.ok is False
        assert "SUPABASE_JWKS_URL" in check.detail


class TestSaglikServisi:
    def _service(self, **kwargs) -> HealthService:
        defaults = {
            "version": "1.0.0",
            "metrics": ProcessMetrics(started_at_ms=NOW - 5_000, clock=lambda: NOW),
            "repository": InMemoryRuntimeRepository(),
            "env": PRODUCTION_ENV,
        }
        defaults.update(kwargs)
        return HealthService(**defaults)

    def test_saglik_her_zaman_ok(self):
        assert self._service().health()["status"] == "ok"

    def test_saglik_surumu_bildirir(self):
        assert self._service().health()["version"] == "1.0.0"

    def test_saglik_calisma_suresini_bildirir(self):
        assert self._service().health()["uptime_ms"] == 5_000

    def test_saglik_bagimlilik_yoklamaz(self):
        """Veritabanı bozukken bile canlılık ok döner."""

        class Bozuk:
            is_persistent = True

            def known_orgs(self):
                raise RuntimeError("kapali")

        assert self._service(repository=Bozuk()).health()["status"] == "ok"

    def test_hazirlik_tam_ortamda_gecer(self):
        assert self._service().readiness()["ready"] is True

    def test_hazirlik_eksik_ayarda_duser(self):
        env = {**PRODUCTION_ENV}
        del env["SUPABASE_JWKS_URL"]
        assert self._service(env=env).readiness()["ready"] is False

    def test_hazirlik_bozuk_veritabaninda_duser(self):
        class Bozuk:
            is_persistent = True

            def known_orgs(self):
                raise RuntimeError("kapali")

        assert self._service(repository=Bozuk()).readiness()["ready"] is False

    def test_hazirlik_yoklamalari_listeler(self):
        names = {item["name"] for item in self._service().readiness()["checks"]}
        assert names == {"configuration", "database"}

    def test_hazirlik_uyarilari_tasir(self):
        env = {**PRODUCTION_ENV}
        del env["DATABASE_URL"]
        payload = self._service(env=env).readiness()
        assert payload["ready"] is True
        assert payload["warnings"]

    def test_kapanista_hazirlik_duser(self):
        """Kapanan süreç yeni istek almamalı ama hemen ölmemeli."""
        service = self._service()
        service.begin_shutdown()
        assert service.readiness()["ready"] is False

    def test_kapanista_saglik_hala_ok(self):
        service = self._service()
        service.begin_shutdown()
        assert service.health()["status"] == "ok"


class TestIstekSayaci:
    def test_basarili_istek_sayilir(self):
        counter = RequestCounter()
        counter.note(ok=True)
        assert counter.total == 1
        assert counter.errors == 0

    def test_hatali_istek_sayilir(self):
        counter = RequestCounter()
        counter.note(ok=False)
        assert counter.errors == 1

    def test_hic_istek_yokken_oran_none(self):
        """Sıfır dönmek, hiç istek almamış sunucuyu "hatasız" göstermek olurdu."""
        assert RequestCounter().error_rate() is None

    def test_hata_orani_hesaplanir(self):
        counter = RequestCounter()
        counter.note(ok=True)
        counter.note(ok=False)
        assert counter.error_rate() == 0.5

    def test_son_pencere_orani(self):
        counter = RequestCounter()
        counter.note(ok=False)
        assert counter.recent_error_rate() == 1.0

    def test_pencere_sinirlidir(self):
        counter = RequestCounter()
        for _ in range(MAX_SAMPLES + 100):
            counter.note(ok=True)
        assert len(counter._recent) == MAX_SAMPLES

    def test_sifirlama_calisir(self):
        counter = RequestCounter()
        counter.note(ok=False)
        counter.reset()
        assert counter.error_rate() is None


class TestSurecOlcumleri:
    def test_calisma_suresi_hesaplanir(self):
        metrics = ProcessMetrics(started_at_ms=NOW - 10_000, clock=lambda: NOW)
        assert metrics.uptime_ms() == 10_000

    def test_calisma_suresi_negatif_olmaz(self):
        metrics = ProcessMetrics(started_at_ms=NOW + 5_000, clock=lambda: NOW)
        assert metrics.uptime_ms() == 0

    def test_ilk_islemci_olcumu_none(self):
        """`cpu_percent` ilk çağrıda 0.0 döner; bu ölçüm değildir."""
        assert CpuSampler().percent() is None

    def test_bellek_olcumu_sayi_ya_da_none(self):
        value = memory_mb()
        assert value is None or value > 0

    def test_sozluk_alanlari(self):
        metrics = ProcessMetrics(started_at_ms=NOW, clock=lambda: NOW)
        payload = metrics.snapshot()
        assert set(payload) == {
            "uptime_ms",
            "uptime_seconds",
            "memory_mb",
            "cpu_percent",
            "requests",
            "errors",
            "error_rate",
            "recent_error_rate",
            "measurement_available",
        }

    def test_olcum_yoksa_hata_orani_none(self):
        metrics = ProcessMetrics(started_at_ms=NOW, clock=lambda: NOW)
        assert metrics.snapshot()["error_rate"] is None

    def test_istekler_olcume_yansir(self):
        metrics = ProcessMetrics(started_at_ms=NOW, clock=lambda: NOW)
        metrics.requests.note(ok=True)
        metrics.requests.note(ok=False)
        assert metrics.snapshot()["requests"] == 2
        assert metrics.snapshot()["error_rate"] == 0.5
