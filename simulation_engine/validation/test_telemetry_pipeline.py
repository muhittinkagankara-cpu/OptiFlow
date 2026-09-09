# -*- coding: utf-8 -*-
"""Telemetri yazicisi, saklama isi ve trend hesabinin testleri.

En kritik davranis: **olculmeyen deger sifir donmez**. Bos bir kovanin
ortalamasi `None`'dir, hic yazma yapilmamis bir yazicinin hizi `None`'dir ve
bos bir seride ozet alanlari `None`'dir. Bunlarin herhangi biri sifir donseydi,
kapali bir cihaz "uretim sifira dustu" gibi, hic olculmemis bir sistem de
"saniyede sifir yaziyor" gibi okunurdu.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.persistence.repository import InMemoryRuntimeRepository
from simulation_engine.runtime.telemetry import (
    CLEANUP_INTERVAL_MS,
    CleanupJob,
    DEFAULT_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    RetentionPolicy,
    TREND_WINDOWS,
    TelemetryPoint,
    TelemetryWriter,
    bucket_index,
    build_series,
    clamp_retention_days,
    cutoff_ms,
    empty_buckets,
    excluded_count,
    load_series,
    series_summary,
    window_of,
    writes_per_second,
)
from simulation_engine.runtime.telemetry.retention import DAY_MS
from simulation_engine.runtime.telemetry.writer import THROUGHPUT_WINDOW_MS

ORG = "org-telemetri"
NOW = 1_700_000_000_000


def point(offset_ms: int = 0, value: float = 10.0, quality: str = "good"):
    return TelemetryPoint(
        timestamp_ms=NOW + offset_ms,
        device="FREZE_01",
        tag="production_count",
        value=value,
        quality=quality,
        source="plc-1",
    )


class KirikDepo:
    """Her yazmada hata veren depo.

    Gercek bir arizayi taklit eder: disk dolmasi ya da veritabaninin dusmesi.
    Boyle bir durumda akisin surmesi gerekir; telemetri kayit amaclidir, canli
    ekran gorunti tablosundan beslenir.
    """

    def write_telemetry(self, org_id, points):
        raise RuntimeError("veritabani yaniti yok")

    def delete_telemetry_before(self, org_id, cutoff_ms, limit=1000):
        raise RuntimeError("silme basarisiz")

    def oldest_telemetry_ms(self, org_id):
        raise RuntimeError("okuma basarisiz")


@pytest.fixture
def repository():
    return InMemoryRuntimeRepository()


@pytest.fixture
def writer(repository):
    return TelemetryWriter(repository, ORG, capacity=3, flush_interval_ms=5_000)


# ----------------------------------------------------------------- yazici


class TestYaziciTampon:
    def test_kapasiteye_ulasmadan_yazmaz(self, writer):
        assert writer.submit(point(), NOW) == 0

    def test_kapasitede_yazar(self, writer):
        writer.submit(point(0), NOW)
        writer.submit(point(1), NOW)
        assert writer.submit(point(2), NOW) == 3

    def test_yazma_sonrasi_tampon_bosalir(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        assert writer.pending == 0

    def test_bekleyen_sayisi(self, writer):
        writer.submit(point(), NOW)
        assert writer.pending == 1

    def test_toplu_gonderim(self, writer):
        assert writer.submit_many([point(index) for index in range(3)], NOW) == 3

    def test_kuyruk_sayaci_artar(self, writer):
        writer.submit(point(), NOW)
        assert writer.stats.queued == 1

    def test_bos_tampon_yazmaz(self, writer):
        assert writer.flush(NOW) == 0

    def test_bos_tamponda_yazma_sayaci_artmaz(self, writer):
        writer.flush(NOW)
        assert writer.stats.flushes == 0


class TestYaziciSureSiniri:
    def test_bos_tamponda_sure_dolmaz(self, writer):
        # Bos bir yazma islemi acmak veritabanina bos yere gidip gelmektir.
        assert writer.due(NOW + 1_000_000) is False

    def test_ilk_veride_sure_dolmus_sayilir(self, writer):
        writer.submit(point(), NOW)
        assert writer.due(NOW) is True

    def test_aralik_dolmadan_beklenir(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        writer.submit(point(10), NOW + 1_000)
        assert writer.due(NOW + 2_000) is False

    def test_aralik_dolunca_yazilir(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        writer.submit(point(10), NOW + 1_000)
        assert writer.due(NOW + 7_000) is True

    def test_sure_dolunca_elle_yazma_calisir(self, writer):
        writer.submit(point(), NOW)
        assert writer.flush(NOW + 6_000) == 1


class TestYaziciSayaclari:
    def test_yazilan_sayisi(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        assert writer.stats.written == 3

    def test_tekrar_gonderim_mukerrer_sayilir(self, writer, repository):
        repository.write_telemetry(ORG, [point(0)])
        writer.submit_many([point(0), point(1), point(2)], NOW)
        assert writer.stats.duplicates == 1

    def test_hic_hata_yoksa_son_hata_none(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        assert writer.stats.last_error is None

    def test_hic_yazma_yoksa_son_yazma_none(self, writer):
        # Sifir donseydi, hic yazmamis bir yazici 1970'te yazmis gibi gorunurdu.
        assert writer.stats.last_flush_ms is None

    def test_yazma_sonrasi_son_yazma_ani(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        assert writer.stats.last_flush_ms == NOW

    def test_sozluk_bekleyeni_tasir(self, writer):
        writer.submit(point(), NOW)
        assert writer.diagnostics(NOW)["pending"] == 1


class TestYaziciHatasi:
    def test_depo_hatasi_disari_sizmaz(self):
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        assert broken.submit(point(), NOW) == 0

    def test_hata_sayaci_artar(self):
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        broken.submit(point(), NOW)
        assert broken.stats.errors == 1

    def test_son_hata_saklanir(self):
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        broken.submit(point(), NOW)
        assert "veritabani" in broken.stats.last_error

    def test_hatali_yazma_tamponu_bosaltir(self):
        # Tamponda tutulsalardi, surekli basarisiz bir veritabani karsisinda
        # tampon sinirsiz buyur ve surec bellegi tukenirdi.
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        broken.submit(point(), NOW)
        assert broken.pending == 0

    def test_hatali_yazma_son_yazma_anini_guncellemez(self):
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        broken.submit(point(), NOW)
        assert broken.stats.last_flush_ms is None

    def test_hatali_yazmada_hiz_olculmez(self):
        broken = TelemetryWriter(KirikDepo(), ORG, capacity=1)
        broken.submit(point(), NOW)
        assert broken.writes_per_second(NOW) is None


class TestYazmaHizi:
    def test_ornek_yoksa_none(self):
        assert writes_per_second([], NOW) is None

    def test_pencere_disi_ornekler_sayilmaz(self):
        eski = [(NOW - THROUGHPUT_WINDOW_MS - 1, 100)]
        assert writes_per_second(eski, NOW) is None

    def test_hiz_hesaplanir(self):
        samples = [(NOW - 2_000, 10), (NOW, 10)]
        assert writes_per_second(samples, NOW) == 10.0

    def test_tek_ornekte_hiz_pozitif(self):
        assert writes_per_second([(NOW - 1_000, 5)], NOW) == 5.0

    def test_yazicidan_okunan_hiz(self, writer):
        writer.submit_many([point(index) for index in range(3)], NOW)
        assert writer.writes_per_second(NOW + 1_000) is not None

    def test_hic_yazmayan_yazicinin_hizi_none(self, writer):
        assert writer.diagnostics(NOW)["writes_per_second"] is None


# ------------------------------------------------------------- saklama


class TestSaklamaSuresi:
    def test_varsayilan(self):
        assert clamp_retention_days(None) == DEFAULT_RETENTION_DAYS

    def test_gecersiz_deger_varsayilana_duser(self):
        assert clamp_retention_days("otuz") == DEFAULT_RETENTION_DAYS

    def test_sifir_alt_sinira_cekilir(self):
        # Sifir kabul edilseydi, temizlik butun tabloyu silerdi.
        assert clamp_retention_days(0) == MIN_RETENTION_DAYS

    def test_negatif_alt_sinira_cekilir(self):
        assert clamp_retention_days(-5) == MIN_RETENTION_DAYS

    def test_asiri_deger_ust_sinira_cekilir(self):
        assert clamp_retention_days(99_999) == MAX_RETENTION_DAYS

    def test_gecerli_deger_korunur(self):
        assert clamp_retention_days(7) == 7

    def test_kesim_ani_geriye_bakar(self):
        assert cutoff_ms(NOW, 1) == NOW - DAY_MS

    def test_kesim_ani_sinirlanir(self):
        assert cutoff_ms(NOW, 0) == NOW - MIN_RETENTION_DAYS * DAY_MS


class TestSaklamaPolitikasi:
    def test_varsayilan_politika(self):
        assert RetentionPolicy().retention_days == DEFAULT_RETENTION_DAYS

    def test_politika_sureyi_sinirlar(self):
        assert RetentionPolicy(retention_days=0).retention_days == MIN_RETENTION_DAYS

    def test_tur_boyu_en_az_bir(self):
        assert RetentionPolicy(batch_size=0).batch_size == 1

    def test_aralik_en_az_bir(self):
        assert RetentionPolicy(interval_ms=0).interval_ms == 1

    def test_varsayilan_aralik(self):
        assert RetentionPolicy().interval_ms == CLEANUP_INTERVAL_MS

    def test_sozluk(self):
        assert RetentionPolicy(retention_days=5).to_dict()["retention_days"] == 5


class TestTemizlemeIsi:
    def test_ilk_calistirmada_zamani_gelmis(self, repository):
        assert CleanupJob(repository).due(NOW) is True

    def test_hic_calismadiysa_son_tur_none(self, repository):
        assert CleanupJob(repository).last_run_ms is None

    def test_aralik_dolmadan_zamani_gelmez(self, repository):
        job = CleanupJob(repository)
        job.run(ORG, NOW)
        assert job.due(NOW + 1_000) is False

    def test_aralik_dolunca_zamani_gelir(self, repository):
        job = CleanupJob(repository)
        job.run(ORG, NOW)
        assert job.due(NOW + CLEANUP_INTERVAL_MS) is True

    def test_eski_olcum_silinir(self, repository):
        repository.write_telemetry(ORG, [point(-2 * DAY_MS)])
        job = CleanupJob(repository, RetentionPolicy(retention_days=1))
        assert job.run(ORG, NOW).deleted == 1

    def test_yeni_olcum_korunur(self, repository):
        repository.write_telemetry(ORG, [point(-1_000)])
        job = CleanupJob(repository, RetentionPolicy(retention_days=1))
        assert job.run(ORG, NOW).deleted == 0

    def test_tur_siniri_bildirilir(self, repository):
        eski = [point(-2 * DAY_MS + index) for index in range(5)]
        repository.write_telemetry(ORG, eski)
        job = CleanupJob(repository, RetentionPolicy(retention_days=1, batch_size=2))
        assert job.run(ORG, NOW).truncated is True

    def test_tur_siniri_asilmadiysa_bildirilmez(self, repository):
        repository.write_telemetry(ORG, [point(-2 * DAY_MS)])
        job = CleanupJob(repository, RetentionPolicy(retention_days=1, batch_size=10))
        assert job.run(ORG, NOW).truncated is False

    def test_kalan_en_eski_bildirilir(self, repository):
        repository.write_telemetry(ORG, [point(-2 * DAY_MS), point(-1_000)])
        job = CleanupJob(repository, RetentionPolicy(retention_days=1))
        assert job.run(ORG, NOW).oldest_remaining_ms == NOW - 1_000

    def test_bos_tabloda_kalan_en_eski_none(self, repository):
        job = CleanupJob(repository)
        assert job.run(ORG, NOW).oldest_remaining_ms is None

    def test_toplam_silinen_birikir(self, repository):
        repository.write_telemetry(ORG, [point(-2 * DAY_MS), point(-3 * DAY_MS)])
        job = CleanupJob(repository, RetentionPolicy(retention_days=1, batch_size=1))
        job.run(ORG, NOW)
        job.run(ORG, NOW + 1)
        assert job.stats()["total_deleted"] == 2

    def test_silme_hatasi_disari_sizmaz(self):
        job = CleanupJob(KirikDepo())
        assert job.run(ORG, NOW).deleted == 0

    def test_silme_hatasi_sayilir(self):
        job = CleanupJob(KirikDepo())
        job.run(ORG, NOW)
        assert job.stats()["errors"] == 1

    def test_son_hata_saklanir(self):
        job = CleanupJob(KirikDepo())
        job.run(ORG, NOW)
        assert "silme" in job.stats()["last_error"]

    def test_tur_sayaci_artar(self, repository):
        job = CleanupJob(repository)
        job.run(ORG, NOW)
        assert job.stats()["runs"] == 1


# --------------------------------------------------------------- trendler


class TestPencereler:
    def test_uc_pencere_var(self):
        assert set(TREND_WINDOWS) == {"1h", "24h", "7d"}

    def test_bir_saat_altmis_kova(self):
        assert TREND_WINDOWS["1h"].buckets == 60

    def test_bir_saatlik_kova_bir_dakika(self):
        assert TREND_WINDOWS["1h"].bucket_ms == 60_000

    def test_gunluk_kova_bir_saat(self):
        assert TREND_WINDOWS["24h"].bucket_ms == 3_600_000

    def test_haftalik_kova_uc_saat(self):
        assert TREND_WINDOWS["7d"].bucket_ms == 3 * 3_600_000

    def test_taninmayan_pencere_none(self):
        # Varsayilana dusseydi, kullanici yanlis bir donem okurdu.
        assert window_of("30d") is None

    def test_taninan_pencere(self):
        assert window_of("24h").label == "Son 24 saat"


class TestKovalar:
    def test_kova_sayisi(self):
        assert len(empty_buckets(NOW, TREND_WINDOWS["24h"])) == 24

    def test_ilk_kova_baslangicta(self):
        assert empty_buckets(NOW, TREND_WINDOWS["1h"])[0].start_ms == NOW

    def test_kovalar_bitisik(self):
        buckets = empty_buckets(NOW, TREND_WINDOWS["1h"])
        assert buckets[0].end_ms == buckets[1].start_ms

    def test_bos_kovanin_ortalamasi_none(self):
        # Sifir yazilsaydi, cihazin kapali oldugu saatler "uretim sifira dustu"
        # gibi gorunurdu.
        assert empty_buckets(NOW, TREND_WINDOWS["1h"])[0].average is None

    def test_bos_kovanin_sayimi_sifir(self):
        assert empty_buckets(NOW, TREND_WINDOWS["1h"])[0].count == 0

    def test_kova_indeksi(self):
        assert bucket_index(NOW + 90_000, NOW, 60_000) == 1

    def test_sifir_boyutlu_kova_indeksi(self):
        assert bucket_index(NOW, NOW, 0) == 0


class TestSeriKurulumu:
    def _series(self, points, window="1h"):
        return build_series(
            "FREZE_01", "production_count", TREND_WINDOWS[window], points, NOW
        )

    def test_veri_yoksa_seri_bos(self):
        assert self._series([]).has_data is False

    def test_veri_yoksa_kovalar_yine_de_var(self):
        assert len(self._series([]).buckets) == 60

    def test_olcum_kovaya_duser(self):
        series = self._series([point(-30_000)])
        assert series.total_points == 1

    def test_pencere_oncesi_olcum_atilir(self):
        assert self._series([point(-7_200_000)]).total_points == 0

    def test_gelecekteki_olcum_atilir(self):
        assert self._series([point(60_000)]).total_points == 0

    def test_bozuk_kaliteli_olcum_hesaba_girmez(self):
        assert self._series([point(-30_000, quality="bad")]).total_points == 0

    def test_degersiz_olcum_hesaba_girmez(self):
        assert self._series([point(-30_000, value=None)]).total_points == 0

    def test_ortalama_hesaplanir(self):
        series = self._series([point(-30_000, 10.0), point(-31_000, 20.0)])
        filled = [item for item in series.buckets if item.count > 0]
        assert filled[0].average == 15.0

    def test_en_dusuk_ve_en_yuksek(self):
        series = self._series([point(-30_000, 10.0), point(-31_000, 20.0)])
        filled = [item for item in series.buckets if item.count > 0]
        assert (filled[0].minimum, filled[0].maximum) == (10.0, 20.0)

    def test_son_deger_saklanir(self):
        series = self._series([point(-31_000, 5.0), point(-30_000, 9.0)])
        filled = [item for item in series.buckets if item.count > 0]
        assert filled[0].last == 9.0

    def test_farkli_kovalar_ayrilir(self):
        series = self._series([point(-30_000), point(-3_000_000)])
        filled = [item for item in series.buckets if item.count > 0]
        assert len(filled) == 2

    def test_pencere_kimligi_tasinir(self):
        assert self._series([], "7d").window == "7d"


class TestSeriOzeti:
    def _summary(self, points, window="1h"):
        series = build_series(
            "FREZE_01", "production_count", TREND_WINDOWS[window], points, NOW
        )
        return series_summary(series)

    def test_bos_seride_ortalama_none(self):
        assert self._summary([])["average"] is None

    def test_bos_seride_neden_yazilir(self):
        assert self._summary([])["reason"] == "Bu aralıkta kayıtlı ölçüm yok"

    def test_bos_seride_kapsama_none(self):
        assert self._summary([])["coverage"] is None

    def test_dolu_seride_neden_yok(self):
        assert self._summary([point(-30_000)])["reason"] is None

    def test_agirlikli_ortalama(self):
        points = [point(-30_000, 10.0), point(-31_000, 20.0), point(-3_000_000, 60.0)]
        assert self._summary(points)["average"] == 30.0

    def test_en_dusuk(self):
        points = [point(-30_000, 10.0), point(-3_000_000, 60.0)]
        assert self._summary(points)["min"] == 10.0

    def test_en_yuksek(self):
        points = [point(-30_000, 10.0), point(-3_000_000, 60.0)]
        assert self._summary(points)["max"] == 60.0

    def test_dolu_kova_sayisi(self):
        points = [point(-30_000), point(-3_000_000)]
        assert self._summary(points)["filled_buckets"] == 2

    def test_kapsama_orani(self):
        # Altmis kovanin ikisinde veri var: kesintili akis burada gorulur.
        points = [point(-30_000), point(-3_000_000)]
        assert self._summary(points)["coverage"] == round(2 / 60, 4)

    def test_disarida_kalan_sayilir(self):
        points = [point(-30_000, quality="bad"), point(-31_000, value=None)]
        assert excluded_count(points) == 2

    def test_temiz_veride_disarida_kalan_yok(self):
        assert excluded_count([point(-30_000)]) == 0


class TestSeriYukleme:
    def test_taninmayan_pencere_none(self, repository):
        assert load_series(repository, ORG, "FREZE_01", "production_count", "30d", NOW) is None

    def test_bos_depoda_seri_bos(self, repository):
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["has_data"] is False

    def test_veri_okunur(self, repository):
        repository.write_telemetry(ORG, [point(-30_000)])
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["total_points"] == 1

    def test_kaynak_telemetri_olarak_isaretlenir(self, repository):
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["origin"] == "telemetry"

    def test_pencere_etiketi(self, repository):
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "24h", NOW)
        assert payload["label"] == "Son 24 saat"

    def test_baska_cihazin_verisi_karismaz(self, repository):
        repository.write_telemetry(
            ORG,
            [
                TelemetryPoint(
                    timestamp_ms=NOW - 30_000,
                    device="TORNA_02",
                    tag="production_count",
                    value=5.0,
                )
            ],
        )
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["total_points"] == 0

    def test_disarida_kalan_bildirilir(self, repository):
        repository.write_telemetry(ORG, [point(-30_000, quality="bad")])
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["excluded"] == 1

    def test_aralik_bildirilir(self, repository):
        payload = load_series(repository, ORG, "FREZE_01", "production_count", "1h", NOW)
        assert payload["end_ms"] - payload["start_ms"] == 3_600_000
