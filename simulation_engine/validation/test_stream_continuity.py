# -*- coding: utf-8 -*-
"""Kesintisiz akis testleri: kalp atisi, bosta kalma, bayatlama, geri donus.

Bu dosyanin savundugu davranis sudur: **veri gelmemesi sessiz kalmaz**. Bir
akis susuyorsa bu bir olaya donusur; geri dondugunde de. Aksi hâlde ekranda en
son gelen deger oylece durur ve operator onu su anki deger sanir.
"""

from __future__ import annotations

import random

import pytest

from simulation_engine.runtime.stream.continuity import (
    BASE_RECONNECT_MS,
    CONTINUITY_KINDS,
    ContinuityMonitor,
    DEVICE_IDLE,
    DEVICE_RECONNECTED,
    DEVICE_STALE,
    HEARTBEAT,
    HEARTBEAT_INTERVAL_MS,
    IDLE_AFTER_MS,
    JITTER_RATIO,
    LIVENESS_LABEL,
    Liveness,
    MAX_RECONNECT_MS,
    STALE_AFTER_MS,
    data_age_ms,
    jittered_delay_ms,
    liveness_of,
    reconnect_delay_ms,
)

NOW = 1_700_000_000_000
CONNECTOR = "plc-1"


@pytest.fixture
def monitor():
    return ContinuityMonitor()


class TestVeriYasi:
    def test_hic_veri_gelmediyse_none(self):
        # Sifir donseydi, hic veri almamis bir akis "az once veri geldi" gibi
        # gorunurdu.
        assert data_age_ms(None, NOW) is None

    def test_yas_hesaplanir(self):
        assert data_age_ms(NOW - 5_000, NOW) == 5_000

    def test_gelecekteki_veri_negatif_yas_uretmez(self):
        assert data_age_ms(NOW + 1_000, NOW) == 0

    def test_ayni_anda_sifir(self):
        assert data_age_ms(NOW, NOW) == 0


class TestCanlilik:
    def test_veri_yoksa_bilinmiyor(self):
        # Yeni baslatilmis bir akisin ilk saniyesinde "bayat" demek yanlis olurdu.
        assert liveness_of(None, NOW) is Liveness.UNKNOWN

    def test_yeni_veri_canli(self):
        assert liveness_of(NOW - 1_000, NOW) is Liveness.LIVE

    def test_esikte_bosta(self):
        assert liveness_of(NOW - IDLE_AFTER_MS, NOW) is Liveness.IDLE

    def test_esigin_bir_altinda_canli(self):
        assert liveness_of(NOW - IDLE_AFTER_MS + 1, NOW) is Liveness.LIVE

    def test_bayat_esiginde_bayat(self):
        assert liveness_of(NOW - STALE_AFTER_MS, NOW) is Liveness.STALE

    def test_bayat_esiginin_altinda_bosta(self):
        assert liveness_of(NOW - STALE_AFTER_MS + 1, NOW) is Liveness.IDLE

    def test_ozel_esikler(self):
        assert liveness_of(NOW - 100, NOW, idle_after_ms=50, stale_after_ms=200) is Liveness.IDLE

    def test_her_durumun_etiketi_var(self):
        assert set(LIVENESS_LABEL) == set(Liveness)

    def test_etiketler_turkce(self):
        assert LIVENESS_LABEL[Liveness.STALE] == "Veri bayat"


class TestYenidenBaglanmaGecikmesi:
    def test_sifirinci_deneme_beklemez(self):
        assert reconnect_delay_ms(0) == 0

    def test_ilk_deneme_taban_gecikme(self):
        assert reconnect_delay_ms(1) == BASE_RECONNECT_MS

    def test_gecikme_ikiye_katlanir(self):
        assert reconnect_delay_ms(3) == BASE_RECONNECT_MS * 4

    def test_ust_sinir_asilmaz(self):
        assert reconnect_delay_ms(50) == MAX_RECONNECT_MS

    def test_sarsinti_gecikmeyi_uzatir(self):
        assert reconnect_delay_ms(1, jitter=1.0) > reconnect_delay_ms(1, jitter=0.0)

    def test_sarsinti_orani_asilmaz(self):
        en_cok = BASE_RECONNECT_MS * (1 + JITTER_RATIO)
        assert reconnect_delay_ms(1, jitter=1.0) <= en_cok

    def test_sarsinti_ust_siniri_asamaz(self):
        # Sarsinti, sinira dayanmis bir gecikmeyi sinirin ustune cikaramaz.
        assert reconnect_delay_ms(50, jitter=1.0) == MAX_RECONNECT_MS

    def test_sarsinti_negatif_kabul_etmez(self):
        assert reconnect_delay_ms(1, jitter=-5.0) == BASE_RECONNECT_MS

    def test_sarsinti_birden_buyuk_kirpilir(self):
        assert reconnect_delay_ms(1, jitter=9.0) == reconnect_delay_ms(1, jitter=1.0)

    def test_rastgele_sarsinti_aralikta(self):
        rng = random.Random(7)
        delay = jittered_delay_ms(2, rng)
        assert BASE_RECONNECT_MS * 2 <= delay <= BASE_RECONNECT_MS * 2 * (1 + JITTER_RATIO)

    def test_ayni_tohum_ayni_gecikme(self):
        assert jittered_delay_ms(3, random.Random(1)) == jittered_delay_ms(3, random.Random(1))

    def test_farkli_tohum_gecikmeleri_dagitir(self):
        # Yirmi cihaz ayni anda koparsa hepsi ayni milisaniyede vurmamalidir.
        delays = {jittered_delay_ms(4, random.Random(seed)) for seed in range(20)}
        assert len(delays) > 1


class TestIzleme:
    def test_izlemeye_alma(self, monitor):
        monitor.track(CONNECTOR)
        assert monitor.state(CONNECTOR) is not None

    def test_izlemeye_alma_tekrarlanabilir(self, monitor):
        first = monitor.track(CONNECTOR)
        assert monitor.track(CONNECTOR) is first

    def test_izlenmeyen_baglanti_none(self, monitor):
        assert monitor.state("yok") is None

    def test_unutma(self, monitor):
        monitor.track(CONNECTOR)
        assert monitor.forget(CONNECTOR) is True

    def test_olmayani_unutma_false(self, monitor):
        assert monitor.forget("yok") is False

    def test_temizleme(self, monitor):
        monitor.track(CONNECTOR)
        monitor.clear()
        assert monitor.states(NOW) == []

    def test_yeni_baglantinin_yasi_none(self, monitor):
        monitor.track(CONNECTOR)
        assert monitor.states(NOW)[0]["age_ms"] is None

    def test_yeni_baglanti_bilinmiyor(self, monitor):
        monitor.track(CONNECTOR)
        assert monitor.states(NOW)[0]["liveness"] == "unknown"


class TestVeriGelisi:
    def test_ilk_veride_olay_yok(self, monitor):
        assert monitor.note_data(CONNECTOR, NOW) is None

    def test_veri_sonrasi_canli(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.state(CONNECTOR).reported is Liveness.LIVE

    def test_veri_yasi_guncellenir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.states(NOW + 1_000)[0]["age_ms"] == 1_000

    def test_bostayken_gelen_veri_geri_donus_olayi(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + IDLE_AFTER_MS)
        event = monitor.note_data(CONNECTOR, NOW + IDLE_AFTER_MS + 1_000)
        assert event.kind == DEVICE_RECONNECTED

    def test_geri_donuste_kesinti_suresi_yazilir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + IDLE_AFTER_MS)
        event = monitor.note_data(CONNECTOR, NOW + IDLE_AFTER_MS + 5_000)
        assert event.data["outage_ms"] == IDLE_AFTER_MS + 5_000

    def test_geri_donus_sayaci_artar(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + STALE_AFTER_MS)
        monitor.note_data(CONNECTOR, NOW + STALE_AFTER_MS + 1)
        assert monitor.state(CONNECTOR).reconnects == 1

    def test_canliyken_gelen_veri_geri_donus_saymaz(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.note_data(CONNECTOR, NOW + 100) is None

    def test_geri_donus_deneme_sayacini_sifirlar(self, monitor):
        monitor.note_failure(CONNECTOR, NOW)
        monitor.note_data(CONNECTOR, NOW + 100)
        assert monitor.state(CONNECTOR).attempt == 0

    def test_geri_donus_kesinti_baslangicini_temizler(self, monitor):
        monitor.note_failure(CONNECTOR, NOW)
        monitor.note_data(CONNECTOR, NOW + 100)
        assert monitor.state(CONNECTOR).outage_started_ms is None


class TestBasarisizlik:
    def test_ilk_basarisizlik_birinci_deneme(self, monitor):
        assert monitor.note_failure(CONNECTOR, NOW) == 1

    def test_denemeler_birikir(self, monitor):
        monitor.note_failure(CONNECTOR, NOW)
        assert monitor.note_failure(CONNECTOR, NOW + 1_000) == 2

    def test_kesinti_baslangici_ilk_basarisizlikta(self, monitor):
        monitor.note_failure(CONNECTOR, NOW)
        monitor.note_failure(CONNECTOR, NOW + 10_000)
        assert monitor.state(CONNECTOR).outage_started_ms == NOW

    def test_gecikme_deneme_sayisiyla_buyur(self, monitor):
        rng = random.Random(3)
        monitor.note_failure(CONNECTOR, NOW)
        first = monitor.next_delay_ms(CONNECTOR, random.Random(3))
        monitor.note_failure(CONNECTOR, NOW + 1)
        assert monitor.next_delay_ms(CONNECTOR, random.Random(3)) > first

    def test_hic_denenmemis_baglanti_taban_gecikme(self, monitor):
        assert monitor.next_delay_ms(CONNECTOR, random.Random(0)) >= BASE_RECONNECT_MS


class TestDegerlendirme:
    def test_veri_gelmemisse_olay_uretilmez(self, monitor):
        # Hic veri gelmemis olmak bir degisiklik degil, baslangic hâlidir.
        monitor.track(CONNECTOR)
        assert monitor.evaluate(NOW + STALE_AFTER_MS * 5) == []

    def test_bosta_kalma_olayi(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        events = monitor.evaluate(NOW + IDLE_AFTER_MS)
        assert events[0].kind == DEVICE_IDLE

    def test_bosta_kalma_uyari_seviyesinde(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.evaluate(NOW + IDLE_AFTER_MS)[0].level == "warning"

    def test_bayatlama_olayi(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        events = monitor.evaluate(NOW + STALE_AFTER_MS)
        assert events[0].kind == DEVICE_STALE

    def test_bayatlama_kritik_seviyede(self, monitor):
        # Bayat veri kritiktir: ekrandaki deger artik guvenilmez.
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.evaluate(NOW + STALE_AFTER_MS)[0].level == "critical"

    def test_seviyeler_runtime_sozlugunde(self, monitor):
        # Ayri bir sozluk kullanilsaydi, olay kalicilik katmaninda taninmaz ve
        # sessizce kaybolurdu; 30 dakikalik gercek kosum bunu ortaya cikardi.
        from simulation_engine.runtime.types import EventLevel

        monitor.note_data(CONNECTOR, NOW)
        uretilen = monitor.evaluate(NOW + STALE_AFTER_MS) + monitor.heartbeats(NOW)
        assert all(EventLevel(event.level) for event in uretilen)

    def test_ayni_durum_tekrar_olay_uretmez(self, monitor):
        # Bir dakika susan bir cihaz yuzlerce ozdes olay uretmemelidir.
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + IDLE_AFTER_MS)
        assert monitor.evaluate(NOW + IDLE_AFTER_MS + 1_000) == []

    def test_bostadan_bayata_gecis_olay_uretir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + IDLE_AFTER_MS)
        assert monitor.evaluate(NOW + STALE_AFTER_MS)[0].kind == DEVICE_STALE

    def test_canli_akis_olay_uretmez(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.evaluate(NOW + 1_000) == []

    def test_olayda_yas_tasinir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.evaluate(NOW + IDLE_AFTER_MS)[0].age_ms == IDLE_AFTER_MS

    def test_olay_mesaji_baglantiyi_adlandirir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert CONNECTOR in monitor.evaluate(NOW + IDLE_AFTER_MS)[0].message

    def test_bosta_mesaji_sureyi_yazar(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert "15 sn" in monitor.evaluate(NOW + IDLE_AFTER_MS)[0].message

    def test_bayat_mesaji_dakika_yazar(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert "1 dk" in monitor.evaluate(NOW + STALE_AFTER_MS)[0].message

    def test_coklu_baglanti_ayri_degerlendirilir(self, monitor):
        monitor.note_data("a", NOW)
        monitor.note_data("b", NOW + IDLE_AFTER_MS)
        events = monitor.evaluate(NOW + IDLE_AFTER_MS)
        assert [event.connector_id for event in events] == ["a"]

    def test_kesinti_baslangici_son_veriden_isaretlenir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        monitor.evaluate(NOW + IDLE_AFTER_MS)
        assert monitor.state(CONNECTOR).outage_started_ms == NOW


class TestKalpAtisi:
    def test_ilk_turda_atis_uretilir(self, monitor):
        monitor.track(CONNECTOR)
        assert monitor.heartbeats(NOW)[0].kind == HEARTBEAT

    def test_aralik_dolmadan_atis_yok(self, monitor):
        monitor.track(CONNECTOR)
        monitor.heartbeats(NOW)
        assert monitor.heartbeats(NOW + 1_000) == []

    def test_aralik_dolunca_atis_var(self, monitor):
        monitor.track(CONNECTOR)
        monitor.heartbeats(NOW)
        assert len(monitor.heartbeats(NOW + HEARTBEAT_INTERVAL_MS)) == 1

    def test_atista_veri_yasi_tasinir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.heartbeats(NOW + 3_000)[0].age_ms == 3_000

    def test_veri_gelmemisse_atista_yas_none(self, monitor):
        # Sistemin baktigini soyler ama veri geldigini soylemez.
        monitor.track(CONNECTOR)
        assert monitor.heartbeats(NOW)[0].age_ms is None

    def test_atis_canlilik_durumunu_tasir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        assert monitor.heartbeats(NOW)[0].data["liveness"] == "live"

    def test_her_baglanti_icin_atis(self, monitor):
        monitor.track("a")
        monitor.track("b")
        assert len(monitor.heartbeats(NOW)) == 2

    def test_izlenmeyen_baglanti_atis_uretmez(self, monitor):
        assert monitor.heartbeats(NOW) == []


class TestOlaySozlugu:
    def test_dort_olay_turu(self):
        assert set(CONTINUITY_KINDS) == {
            HEARTBEAT,
            DEVICE_IDLE,
            DEVICE_RECONNECTED,
            DEVICE_STALE,
        }

    def test_sozluk_alanlari(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        payload = monitor.evaluate(NOW + IDLE_AFTER_MS)[0].to_dict()
        assert set(payload) == {
            "kind",
            "connector_id",
            "at_ms",
            "message",
            "age_ms",
            "level",
            "data",
        }

    def test_sozluk_kopyalanir(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        event = monitor.evaluate(NOW + IDLE_AFTER_MS)[0]
        event.to_dict()["data"]["idle_after_ms"] = 0
        assert event.data["idle_after_ms"] == IDLE_AFTER_MS

    def test_olay_degistirilemez(self, monitor):
        monitor.note_data(CONNECTOR, NOW)
        event = monitor.evaluate(NOW + IDLE_AFTER_MS)[0]
        with pytest.raises(Exception):
            event.kind = "baska"
