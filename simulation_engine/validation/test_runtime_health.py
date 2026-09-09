"""Sağlık ölçümü ve yeniden deneme aralıkları."""

from __future__ import annotations

from simulation_engine.runtime.health import (
    LATENCY_WINDOW,
    HealthMonitor,
    retry_delay_ms,
    should_retry,
)


class TestLatency:
    def test_olcum_yoksa_ortalama_none(self):
        # Olculmemis bir gecikme sifir degildir.
        assert HealthMonitor().avg_latency_ms() is None

    def test_olcum_yoksa_medyan_none(self):
        assert HealthMonitor().median_latency_ms() is None

    def test_olcum_yoksa_en_kotu_none(self):
        assert HealthMonitor().max_latency_ms() is None

    def test_tek_olcum_ortalamadir(self):
        monitor = HealthMonitor()
        monitor.record_latency(12.0)
        assert monitor.avg_latency_ms() == 12.0

    def test_ortalama_hesaplanir(self):
        monitor = HealthMonitor()
        for value in (10.0, 20.0, 30.0):
            monitor.record_latency(value)
        assert monitor.avg_latency_ms() == 20.0

    def test_en_kotu_olcum_doner(self):
        monitor = HealthMonitor()
        for value in (5.0, 900.0, 7.0):
            monitor.record_latency(value)
        assert monitor.max_latency_ms() == 900.0

    def test_medyan_uc_degerden_etkilenmez(self):
        # Ortalama 304 cikar; medyan tipik davranisi anlatir.
        monitor = HealthMonitor()
        for value in (5.0, 7.0, 900.0):
            monitor.record_latency(value)
        assert monitor.median_latency_ms() == 7.0
        assert monitor.avg_latency_ms() > 300.0

    def test_cift_sayida_olcumde_medyan_ortalamadir(self):
        monitor = HealthMonitor()
        for value in (10.0, 20.0):
            monitor.record_latency(value)
        assert monitor.median_latency_ms() == 15.0

    def test_none_olcum_kaydedilmez(self):
        # Olculemeyen bir denemeyi sifir saymak ortalamayi iyimser yapardi.
        monitor = HealthMonitor()
        monitor.record_latency(None)
        assert monitor.avg_latency_ms() is None
        assert monitor.snapshot()["samples"] == 0

    def test_pencere_asilinca_eski_olcum_duser(self):
        monitor = HealthMonitor()
        for index in range(LATENCY_WINDOW + 30):
            monitor.record_latency(float(index))
        assert len(monitor.latencies) == LATENCY_WINDOW

    def test_pencere_asilinca_en_yeni_olcumler_kalir(self):
        monitor = HealthMonitor()
        for index in range(LATENCY_WINDOW + 5):
            monitor.record_latency(float(index))
        assert monitor.latencies[-1] == float(LATENCY_WINDOW + 4)

    def test_sifir_gecikme_kaydedilir(self):
        monitor = HealthMonitor()
        monitor.record_latency(0.0)
        assert monitor.avg_latency_ms() == 0.0


class TestCounters:
    def test_paket_sayaci_artar(self):
        monitor = HealthMonitor()
        monitor.record_packet(1_000)
        monitor.record_packet(2_000)
        assert monitor.packets == 2

    def test_son_paket_ani_kaydedilir(self):
        monitor = HealthMonitor()
        monitor.record_packet(1_700)
        assert monitor.last_packet_at_ms == 1_700

    def test_hic_paket_yoksa_son_paket_ani_none(self):
        assert HealthMonitor().last_packet_at_ms is None

    def test_hata_sayaci_artar(self):
        monitor = HealthMonitor()
        monitor.record_error("kapali")
        assert monitor.errors == 1

    def test_son_hata_saklanir(self):
        monitor = HealthMonitor()
        monitor.record_error("ilk")
        monitor.record_error("ikinci")
        assert monitor.last_error == "ikinci"

    def test_hic_hata_yoksa_son_hata_none(self):
        assert HealthMonitor().last_error is None

    def test_yeniden_baglanma_sayaci_artar(self):
        monitor = HealthMonitor()
        monitor.record_reconnect()
        monitor.record_reconnect()
        assert monitor.reconnects == 2


class TestErrorRate:
    def test_hic_deneme_yoksa_none(self):
        assert HealthMonitor().error_rate() is None

    def test_yalnizca_paket_varsa_sifir(self):
        monitor = HealthMonitor()
        monitor.record_packet()
        assert monitor.error_rate() == 0.0

    def test_yalnizca_hata_varsa_bir(self):
        monitor = HealthMonitor()
        monitor.record_error("x")
        assert monitor.error_rate() == 1.0

    def test_karisik_durumda_oran(self):
        monitor = HealthMonitor()
        monitor.record_packet()
        monitor.record_packet()
        monitor.record_packet()
        monitor.record_error("x")
        assert monitor.error_rate() == 0.25


class TestUptime:
    def test_bagli_degilse_none(self):
        assert HealthMonitor().uptime_ms(now_ms=5_000) is None

    def test_bagliyken_gecen_sure(self):
        monitor = HealthMonitor()
        monitor.mark_connected(1_000)
        assert monitor.uptime_ms(now_ms=4_000) == 3_000

    def test_saat_geri_giderse_negatif_olmaz(self):
        monitor = HealthMonitor()
        monitor.mark_connected(9_000)
        assert monitor.uptime_ms(now_ms=1_000) == 0

    def test_kapaninca_sure_durur(self):
        monitor = HealthMonitor()
        monitor.mark_connected(1_000)
        monitor.mark_disconnected()
        assert monitor.uptime_ms(now_ms=9_000) is None


class TestSnapshot:
    def test_bos_izlemede_olculer_none(self):
        snapshot = HealthMonitor().snapshot(now_ms=1_000)
        assert snapshot["avg_latency_ms"] is None
        assert snapshot["median_latency_ms"] is None
        assert snapshot["max_latency_ms"] is None
        assert snapshot["uptime_ms"] is None
        assert snapshot["error_rate"] is None

    def test_bos_izlemede_sayaclar_sifir(self):
        # Sayaclar olculur (hic olay olmadi = 0); gecikme olculmez (= None).
        snapshot = HealthMonitor().snapshot()
        assert snapshot["packets"] == 0
        assert snapshot["errors"] == 0
        assert snapshot["reconnects"] == 0

    def test_ornek_sayisi_bildirilir(self):
        monitor = HealthMonitor()
        monitor.record_latency(3.0)
        monitor.record_latency(5.0)
        assert monitor.snapshot()["samples"] == 2

    def test_snapshot_tum_alanlari_tasir(self):
        beklenen = {
            "avg_latency_ms",
            "median_latency_ms",
            "max_latency_ms",
            "samples",
            "reconnects",
            "packets",
            "errors",
            "error_rate",
            "uptime_ms",
            "last_packet_at_ms",
            "last_error",
        }
        assert set(HealthMonitor().snapshot().keys()) == beklenen


class TestRetryDelay:
    def test_ilk_deneme_beklemez(self):
        assert retry_delay_ms(0) == 0

    def test_ikinci_deneme_taban_kadar_bekler(self):
        assert retry_delay_ms(1, base_ms=500) == 500

    def test_gecikme_iki_kat_artar(self):
        assert retry_delay_ms(2, base_ms=500) == 1_000
        assert retry_delay_ms(3, base_ms=500) == 2_000

    def test_tavan_asilmaz(self):
        # Sabit araliklı deneme kapali bir cihazi saniyede onlarca kez yoklardi.
        assert retry_delay_ms(20, base_ms=500, cap_ms=30_000) == 30_000

    def test_negatif_deneme_beklemez(self):
        assert retry_delay_ms(-3) == 0

    def test_taban_disaridan_verilebilir(self):
        assert retry_delay_ms(1, base_ms=100) == 100

    def test_ayni_girdi_ayni_gecikme(self):
        # Rastgele sapma yok: testler belirsizlesmesin.
        assert retry_delay_ms(3) == retry_delay_ms(3)


class TestShouldRetry:
    def test_sifir_denemede_yeniden_denenmez(self):
        assert should_retry(0, 0) is False

    def test_sinira_gelmeden_denenir(self):
        assert should_retry(0, 3) is True
        assert should_retry(2, 3) is True

    def test_sinirda_durur(self):
        assert should_retry(3, 3) is False

    def test_siniri_asinca_durur(self):
        assert should_retry(9, 3) is False
