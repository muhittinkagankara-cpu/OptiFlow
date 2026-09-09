"""Duruş takibi ve kalıcılığı.

Neden ayrı bir katman
---------------------
Görüntü (snapshot) yalnızca **son** durumu tutar. Vardiya boyunca üç kez duran
bir makine görüntüde "şu an çalışıyor" görünür ve toplam duruş kaybolur.
Kullanılabilirlik doğrudan duruş süresinden hesaplandığı için, bu bilgi
kaybolursa OEE de hesaplanamaz.

Bu dosyanın koruduğu üç davranış
--------------------------------
1. Aynı durumun tekrar bildirilmesi yeni duruş açmaz (cihazlar durumu saniyede
   bir yayınlar).
2. `UNKNOWN` duruşu **bitirmez**: haber alamamak, makinenin çalışmaya
   başladığı anlamına gelmez.
3. Hiç duruş kaydı yoksa toplam `None` döner; sıfır dönmek "hiç durmadı"
   demek olurdu ve izlenmemiş bir hat için bu bir yalandır.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from simulation_engine.runtime.persistence.downtime import (
    UNKNOWN_REASON,
    DowntimeEvent,
    DowntimeTracker,
)
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
    downtime_key,
)

DK = 60_000


# -- Tek duruş kaydı --------------------------------------------------------


class TestDurusKaydi:
    def test_bitmemis_durus_acik(self):
        assert DowntimeEvent("M1", 1_000).is_open is True

    def test_biten_durus_acik_degil(self):
        assert DowntimeEvent("M1", 1_000, end_ms=2_000).is_open is False

    def test_sure_bitisten_hesaplanir(self):
        assert DowntimeEvent("M1", 1_000, end_ms=61_000).duration_ms() == DK

    def test_acik_durusun_suresi_o_ana_kadar(self):
        assert DowntimeEvent("M1", 1_000).duration_ms(61_000) == DK

    def test_acik_durusun_suresi_an_verilmezse_none(self):
        """Devam eden bir duruşun süresi, hangi ana kadar sorulduğuna bağlıdır."""
        assert DowntimeEvent("M1", 1_000).duration_ms() is None

    def test_negatif_sure_olmaz(self):
        """Saat geri gitse bile duruş süresi negatif görünmemeli."""
        assert DowntimeEvent("M1", 5_000, end_ms=1_000).duration_ms() == 0

    def test_neden_varsayilani_bildirilmedi(self):
        assert DowntimeEvent("M1", 1_000).reason == UNKNOWN_REASON

    def test_sozlukte_acik_bayragi_var(self):
        assert DowntimeEvent("M1", 1_000).to_dict()["open"] is True

    def test_sozlukte_sure_verilen_ana_gore(self):
        assert DowntimeEvent("M1", 1_000).to_dict(61_000)["duration_ms"] == DK


# -- Takip ------------------------------------------------------------------


class TestDurusTakibi:
    def test_duran_makine_durus_acar(self):
        tracker = DowntimeTracker()
        event = tracker.observe("M1", "down", 1_000)
        assert event is not None
        assert tracker.open_count() == 1

    def test_calisan_makine_durus_acmaz(self):
        tracker = DowntimeTracker()
        assert tracker.observe("M1", "running", 1_000) is None

    def test_yeniden_calisinca_durus_kapanir(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        event = tracker.observe("M1", "running", 61_000)
        assert event.end_ms == 61_000
        assert tracker.open_count() == 0

    def test_ayni_durum_ikinci_kez_yeni_durus_acmaz(self):
        """Cihaz durumu saniyede bir yayınlar; her yayın duruş olsaydı yüz kat şişerdi."""
        tracker = DowntimeTracker()
        for step in range(60):
            tracker.observe("M1", "down", 1_000 + step * 1_000)
        assert tracker.open_count() == 1

    def test_bilinmeyen_durum_durusu_bitirmez(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "unknown", 30_000)
        assert tracker.open_count() == 1

    def test_bloke_durum_durusu_bitirmez(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "blocked", 30_000)
        assert tracker.open_count() == 1

    def test_iki_makine_ayri_takip_edilir(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M2", "down", 2_000)
        assert tracker.open_count() == 2

    def test_bir_makine_kalkarsa_otekinin_durusu_surer(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M2", "down", 1_000)
        tracker.observe("M1", "running", 61_000)
        assert tracker.open_count() == 1

    def test_ikinci_durus_yeni_kayit_acar(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "running", 61_000)
        tracker.observe("M1", "down", 120_000)
        assert len(tracker.all_events()) == 2

    def test_neden_ve_kaynak_kaydedilir(self):
        tracker = DowntimeTracker()
        event = tracker.observe("M1", "down", 1_000, reason="Kalıp değişimi", source="plc-1")
        assert event.reason == "Kalıp değişimi"
        assert event.source == "plc-1"

    def test_bitis_baslangictan_once_olamaz(self):
        """Sırasız bir ölçüm gelse bile duruş negatif süreli kaydedilmez."""
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 60_000)
        event = tracker.observe("M1", "running", 1_000)
        assert event.end_ms == 60_000


class TestToplamlar:
    def test_kapanmis_durus_toplanir(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "running", 61_000)
        assert tracker.total_ms() == DK

    def test_acik_durus_o_ana_kadar_sayilir(self):
        """Devam eden bir arıza raporun dışında bırakılamaz."""
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        assert tracker.total_ms(61_000) == DK

    def test_hic_durus_yoksa_none(self):
        assert DowntimeTracker().total_ms(NOW := 1_000) is None

    def test_makine_bazinda_toplam(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "running", 61_000)
        tracker.observe("M2", "down", 1_000)
        tracker.observe("M2", "running", 121_000)
        assert tracker.total_for("M1") == DK
        assert tracker.total_for("M2") == 2 * DK

    def test_bilinmeyen_makinenin_toplami_none(self):
        assert DowntimeTracker().total_for("YOK") is None

    def test_iki_durus_toplanir(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 0)
        tracker.observe("M1", "running", DK)
        tracker.observe("M1", "down", 2 * DK)
        tracker.observe("M1", "running", 3 * DK)
        assert tracker.total_ms() == 2 * DK


class TestSiralamaVeYukleme:
    def test_olaylar_baslangica_gore_sirali(self):
        tracker = DowntimeTracker()
        tracker.observe("M2", "down", 5_000)
        tracker.observe("M1", "down", 1_000)
        assert [item.start_ms for item in tracker.all_events()] == [1_000, 5_000]

    def test_acik_ve_kapali_olaylar_birlikte_donulur(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.observe("M1", "running", 61_000)
        tracker.observe("M2", "down", 70_000)
        assert len(tracker.all_events()) == 2

    def test_diskten_yukleme_acik_durusu_acik_birakir(self):
        tracker = DowntimeTracker()
        loaded = tracker.load([DowntimeEvent("M1", 1_000)])
        assert loaded == 1
        assert tracker.open_count() == 1

    def test_diskten_yukleme_kapali_durusu_gecmise_koyar(self):
        tracker = DowntimeTracker()
        tracker.load([DowntimeEvent("M1", 1_000, end_ms=61_000)])
        assert tracker.open_count() == 0
        assert tracker.total_ms() == DK

    def test_yuklenen_acik_durus_yeniden_calisinca_kapanir(self):
        """Kurtarmadan sonra süren arıza, makine kalkınca doğru kapanmalı."""
        tracker = DowntimeTracker()
        tracker.load([DowntimeEvent("M1", 1_000)])
        tracker.observe("M1", "running", 61_000)
        assert tracker.open_count() == 0
        assert tracker.total_ms() == DK

    def test_temizleme_her_seyi_siler(self):
        tracker = DowntimeTracker()
        tracker.observe("M1", "down", 1_000)
        tracker.clear()
        assert tracker.total_ms(61_000) is None


# -- Kalıcılık --------------------------------------------------------------


class TestDurusAnahtari:
    def test_anahtar_kiraci_makine_ve_baslangictan_olusur(self):
        key = downtime_key("org-1", DowntimeEvent("M1", 1_000))
        assert key == "org-1::M1::1000"

    def test_iki_kiraci_ayni_makinede_catismaz(self):
        first = downtime_key("org-1", DowntimeEvent("M1", 1_000))
        second = downtime_key("org-2", DowntimeEvent("M1", 1_000))
        assert first != second

    def test_ayni_durusun_anahtari_degismez(self):
        """Anahtar değişseydi kapanan duruş ikinci bir satır açardı."""
        event = DowntimeEvent("M1", 1_000)
        before = downtime_key("org-1", event)
        event.end_ms = 61_000
        assert downtime_key("org-1", event) == before


@pytest.fixture(params=["memory", "sqlite"])
def repository(request):
    """Aynı sözleşme iki depoda da geçerli olmalı."""
    if request.param == "memory":
        return InMemoryRuntimeRepository()
    path = os.path.join(tempfile.mkdtemp(), "downtime.db")
    return DatabaseRuntimeRepository(f"sqlite:///{path}")


class TestDurusDeposu:
    def test_durus_yazilir_ve_okunur(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000, end_ms=61_000))
        events = repository.list_downtime("org-1")
        assert len(events) == 1
        assert events[0].duration_ms() == DK

    def test_ayni_durus_iki_satir_uretmez(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000, end_ms=61_000))
        assert len(repository.list_downtime("org-1")) == 1

    def test_kapanis_ayni_kayda_yazilir(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000, end_ms=61_000))
        assert repository.list_downtime("org-1")[0].end_ms == 61_000

    def test_acik_durusun_bitisi_bos(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        assert repository.list_downtime("org-1")[0].end_ms is None

    def test_kiracilar_birbirinin_durusunu_gormez(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        repository.save_downtime("org-2", DowntimeEvent("M1", 2_000))
        assert len(repository.list_downtime("org-1")) == 1

    def test_baslangica_gore_sirali_doner(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 5_000))
        repository.save_downtime("org-1", DowntimeEvent("M2", 1_000))
        assert [item.start_ms for item in repository.list_downtime("org-1")] == [
            1_000,
            5_000,
        ]

    def test_belirli_andan_sonrasi_suzulur(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        repository.save_downtime("org-1", DowntimeEvent("M2", 90_000))
        assert len(repository.list_downtime("org-1", since_ms=50_000)) == 1

    def test_neden_ve_kaynak_korunur(self, repository):
        repository.save_downtime(
            "org-1", DowntimeEvent("M1", 1_000, reason="Kalıp", source="plc-1")
        )
        stored = repository.list_downtime("org-1")[0]
        assert stored.reason == "Kalıp"
        assert stored.source == "plc-1"

    def test_temizleme_yalnizca_o_kiraciyi_siler(self, repository):
        repository.save_downtime("org-1", DowntimeEvent("M1", 1_000))
        repository.save_downtime("org-2", DowntimeEvent("M1", 1_000))
        repository.clear_downtime("org-1")
        assert repository.list_downtime("org-1") == []
        assert len(repository.list_downtime("org-2")) == 1

    def test_bos_depoda_liste_bos(self, repository):
        assert repository.list_downtime("org-1") == []


class TestKayitliKiracilar:
    def test_baglantisi_olan_kiracilar_listelenir(self, repository):
        from simulation_engine.runtime.persistence.repository import StoredConnection

        repository.save_connection(
            "org-1",
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        assert repository.known_orgs() == ["org-1"]

    def test_bos_depoda_kiraci_yok(self, repository):
        assert repository.known_orgs() == []
