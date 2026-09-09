"""Yoklama zamanlayıcısı.

Zamanlayıcı saf: saat okumaz, beklemez, yalnızca "ne zaman" sorusunu
yanıtlar. Bu dosyanın koruduğu üç davranış:

1. **Aralık sınırlıdır.** 250 ms'nin altı çoğu MES'te kötüye kullanım sayılır,
   60 saniyenin üstü ise "canlı" sayılamaz.
2. **Başarısızlıkta aralık büyür.** Sabit kalsaydı, gece kapanan bir sunucu
   sabaha kadar yüz binlerce başarısız istek üretirdi.
3. **İlk yoklama hemen yapılır.** Bir aralık beklemek, ekranı ilk açan
   kullanıcıyı boş ekranla bırakırdı.
"""

from __future__ import annotations

import math

import pytest

from simulation_engine.runtime.stream.scheduler import (
    DEFAULT_POLL_INTERVAL_MS,
    MAX_BACKOFF_MS,
    MAX_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    STREAM_HEALTH_LABEL,
    PollScheduler,
    ScheduleEntry,
    StreamHealth,
    backoff_interval_ms,
    clamp_interval_ms,
    poll_rate_hz,
)

NOW = 1_000_000


class TestAralikSinirlari:
    def test_varsayilan_bir_saniye(self):
        assert DEFAULT_POLL_INTERVAL_MS == 1_000

    def test_en_kisa_ceyrek_saniye(self):
        assert MIN_POLL_INTERVAL_MS == 250

    def test_en_uzun_bir_dakika(self):
        assert MAX_POLL_INTERVAL_MS == 60_000

    def test_araliktaki_deger_korunur(self):
        assert clamp_interval_ms(2_000) == 2_000

    def test_cok_kisa_aralik_tabana_cekilir(self):
        assert clamp_interval_ms(10) == MIN_POLL_INTERVAL_MS

    def test_cok_uzun_aralik_tavana_cekilir(self):
        assert clamp_interval_ms(600_000) == MAX_POLL_INTERVAL_MS

    def test_tam_sinirlar_korunur(self):
        assert clamp_interval_ms(MIN_POLL_INTERVAL_MS) == MIN_POLL_INTERVAL_MS
        assert clamp_interval_ms(MAX_POLL_INTERVAL_MS) == MAX_POLL_INTERVAL_MS

    def test_none_varsayilana_duser(self):
        assert clamp_interval_ms(None) == DEFAULT_POLL_INTERVAL_MS

    def test_sifir_tabana_cekilir(self):
        """Sıfır aralık sonsuz döngü demek olurdu."""
        assert clamp_interval_ms(0) == MIN_POLL_INTERVAL_MS

    def test_negatif_tabana_cekilir(self):
        assert clamp_interval_ms(-500) == MIN_POLL_INTERVAL_MS

    def test_nan_varsayilana_duser(self):
        assert clamp_interval_ms(float("nan")) == DEFAULT_POLL_INTERVAL_MS

    def test_metin_varsayilana_duser(self):
        assert clamp_interval_ms("1000") == DEFAULT_POLL_INTERVAL_MS

    def test_ondalik_tam_sayiya_dondurulur(self):
        assert isinstance(clamp_interval_ms(1500.7), int)


class TestGeriCekilme:
    def test_hatasizken_taban_aralik(self):
        assert backoff_interval_ms(1_000, 0) == 1_000

    def test_ilk_hatada_da_buyur(self):
        """Bir kez başarısız olan uç, aynı hızda yeniden denenmemelidir."""
        assert backoff_interval_ms(1_000, 1) == 2_000

    def test_ikinci_hatada_dort_kat(self):
        assert backoff_interval_ms(1_000, 2) == 4_000

    def test_ucuncu_hatada_sekiz_kat(self):
        assert backoff_interval_ms(1_000, 3) == 8_000

    def test_tavan_asilmaz(self):
        assert backoff_interval_ms(1_000, 20) == MAX_BACKOFF_MS

    def test_negatif_hata_sayisi_taban_verir(self):
        assert backoff_interval_ms(1_000, -1) == 1_000

    def test_taban_da_sinirlanir(self):
        assert backoff_interval_ms(10, 0) == MIN_POLL_INTERVAL_MS

    def test_buyume_monoton(self):
        values = [backoff_interval_ms(500, step) for step in range(6)]
        assert values == sorted(values)


class TestYoklamaSikligi:
    def test_bir_saniyede_bir_hz(self):
        assert poll_rate_hz(1_000) == 1.0

    def test_yarim_saniyede_iki_hz(self):
        assert poll_rate_hz(500) == 2.0

    def test_ceyrek_saniyede_dort_hz(self):
        assert poll_rate_hz(250) == 4.0

    def test_olculmemis_aralik_none(self):
        assert poll_rate_hz(None) is None

    def test_sifir_aralik_none(self):
        """Sıfır dönmek, saniyede bir yoklanan akışı "hiç yoklanmıyor" göstermek olurdu."""
        assert poll_rate_hz(0) is None

    def test_negatif_aralik_none(self):
        assert poll_rate_hz(-10) is None


class TestPlanKaydi:
    def test_aralik_kurulumda_sinirlanir(self):
        entry = ScheduleEntry("c1", base_interval_ms=10, next_due_ms=NOW)
        assert entry.base_interval_ms == MIN_POLL_INTERVAL_MS

    def test_gecerli_aralik_baslangicta_tabana_esit(self):
        entry = ScheduleEntry("c1", base_interval_ms=2_000, next_due_ms=NOW)
        assert entry.current_interval_ms == 2_000

    def test_sozluk_sikligi_icerir(self):
        entry = ScheduleEntry("c1", base_interval_ms=1_000, next_due_ms=NOW)
        assert entry.to_dict()["poll_rate_hz"] == 1.0

    def test_sozluk_kimligi_tasir(self):
        entry = ScheduleEntry("c1", base_interval_ms=1_000, next_due_ms=NOW)
        assert entry.to_dict()["connector_id"] == "c1"


class TestZamanlayici:
    def test_yeni_baglanti_hemen_yoklanir(self):
        """İlk yoklama beklemez; kullanıcı boş ekranla karşılaşmamalı."""
        scheduler = PollScheduler()
        entry = scheduler.add("c1", 5_000, NOW)
        assert entry.next_due_ms == NOW
        assert scheduler.due(NOW) == [entry]

    def test_ikinci_kayit_araligi_gunceller(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        entry = scheduler.add("c1", 3_000, NOW)
        assert entry.base_interval_ms == 3_000
        assert len(scheduler.entries) == 1

    def test_vadesi_gelmeyen_baglanti_listede_yok(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_success("c1", NOW)
        assert scheduler.due(NOW) == []

    def test_vade_dolunca_listeye_girer(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_success("c1", NOW)
        assert len(scheduler.due(NOW + 1_000)) == 1

    def test_en_gecikmis_once_gelir(self):
        """Yük altında hepsi yoklanamayabilir; en uzun bekleyen önce gelmeli."""
        scheduler = PollScheduler()
        scheduler.add("yeni", 1_000, NOW)
        scheduler.add("eski", 1_000, NOW - 5_000)
        assert scheduler.due(NOW)[0].connector_id == "eski"

    def test_basari_geri_cekilmeyi_sifirlar(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_failure("c1", NOW)
        scheduler.note_failure("c1", NOW)
        entry = scheduler.note_success("c1", NOW)
        assert entry.consecutive_failures == 0
        assert entry.current_interval_ms == 1_000

    def test_hata_araligi_buyutur(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        entry = scheduler.note_failure("c1", NOW)
        assert entry.current_interval_ms == 2_000

    def test_art_arda_hata_birikir(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_failure("c1", NOW)
        entry = scheduler.note_failure("c1", NOW)
        assert entry.consecutive_failures == 2
        assert entry.current_interval_ms == 4_000

    def test_yoklama_sayaci_artar(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_success("c1", NOW)
        scheduler.note_failure("c1", NOW)
        assert scheduler.entries["c1"].polls == 2

    def test_bilinmeyen_baglantida_none(self):
        scheduler = PollScheduler()
        assert scheduler.note_success("yok", NOW) is None
        assert scheduler.note_failure("yok", NOW) is None

    def test_silme_calisir(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        assert scheduler.remove("c1") is True
        assert scheduler.remove("c1") is False

    def test_bos_planda_uyanma_none(self):
        assert PollScheduler().next_wake_ms(NOW) is None

    def test_uyanma_suresi_hesaplanir(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.note_success("c1", NOW)
        assert scheduler.next_wake_ms(NOW) == 1_000

    def test_gecmis_vade_sifir_bekleme(self):
        """Geçmişte kalmış bir plan "hemen" demektir, negatif bekleme değil."""
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW - 5_000)
        assert scheduler.next_wake_ms(NOW) == 0

    def test_en_yakin_vade_secilir(self):
        scheduler = PollScheduler()
        scheduler.add("uzak", 10_000, NOW)
        scheduler.note_success("uzak", NOW)
        scheduler.add("yakin", 1_000, NOW)
        scheduler.note_success("yakin", NOW)
        assert scheduler.next_wake_ms(NOW) == 1_000

    def test_durumlar_listelenir(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.add("c2", 2_000, NOW)
        assert len(scheduler.states()) == 2

    def test_temizleme_plani_bosaltir(self):
        scheduler = PollScheduler()
        scheduler.add("c1", 1_000, NOW)
        scheduler.clear()
        assert scheduler.entries == {}


class TestAkisSagligi:
    @pytest.mark.parametrize(
        "health,label",
        [
            (StreamHealth.RUNNING, "Çalışıyor"),
            (StreamHealth.IDLE, "Veri bekleniyor"),
            (StreamHealth.BACKPRESSURE, "Kuyruk dolu"),
            (StreamHealth.FAILING, "Hata alıyor"),
            (StreamHealth.STOPPED, "Durduruldu"),
        ],
    )
    def test_her_durumun_etiketi_var(self, health, label):
        assert STREAM_HEALTH_LABEL[health] == label

    def test_bes_durum_tanimli(self):
        assert len(StreamHealth) == 5
