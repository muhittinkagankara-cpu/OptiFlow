"""Birleşik alarm merkezi: kurallar, depo ve değerlendirici.

Bu dosyanın koruduğu üç söz
---------------------------
1. **Aynı arıza tek alarm üretir.** Kural saniyede bir çalışır; her çağrıda
   yeni bir alarm açılsaydı bir dakikada altmış satır birikirdi.
2. **Onaylanan alarm geri açılmaz.** Neden sürdüğü için alarm her
   değerlendirmede aday listesine yeniden girer; durumu korunmasaydı
   operatörün gördüğü alarm bir saniye sonra yeniden yanardı.
3. **Ölçülmemiş veri alarm üretmez.** Kuyruğu bilinmeyen bir makine için
   "kuyruk yüksek" alarmı açmak, ölçülmemiş bir şeyi ölçülmüş saymaktır.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.alarms import (
    DEFAULT_NO_DATA_TIMEOUT_MS,
    DEFAULT_QUEUE_THRESHOLD,
    Alarm,
    AlarmEvaluator,
    AlarmRuleId,
    AlarmSeverity,
    AlarmState,
    AlarmStore,
    AlarmThresholds,
    ConnectionView,
    alarm_id,
    collect_candidates,
    evaluate_snapshot,
    machine_blocked,
    machine_down,
    no_data,
    queue_high,
    runtime_disconnected,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

NOW = 1_000_000


def machine(
    machine_id: str = "TORNA_01",
    status: str = "running",
    queue: float | None = None,
    updated_at_ms: int | None = NOW,
) -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status=status,
        queue_length=queue,
        updated_at_ms=updated_at_ms,
    )


# -- Kimlik -----------------------------------------------------------------


class TestAlarmKimligi:
    def test_kimlik_kural_ve_konudan_olusur(self):
        assert alarm_id(AlarmRuleId.QUEUE_HIGH, "TORNA_01") == "queue_high::TORNA_01"

    def test_ayni_kural_farkli_makine_farkli_kimlik(self):
        first = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        second = alarm_id(AlarmRuleId.MACHINE_DOWN, "FREZE_01")
        assert first != second

    def test_farkli_kural_ayni_makine_farkli_kimlik(self):
        first = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        second = alarm_id(AlarmRuleId.QUEUE_HIGH, "TORNA_01")
        assert first != second

    def test_kimlik_kararli(self):
        """Aynı girdi her zaman aynı kimliği verir; yoksa mükerrer alarm olur."""
        assert alarm_id(AlarmRuleId.NO_DATA, "X") == alarm_id(AlarmRuleId.NO_DATA, "X")


# -- Kurallar ---------------------------------------------------------------


class TestKuyrukKurali:
    def test_esik_ustunde_alarm_uretilir(self):
        candidate = queue_high(machine(queue=15.0))
        assert candidate is not None
        assert candidate.rule is AlarmRuleId.QUEUE_HIGH

    def test_esik_altinda_alarm_yok(self):
        assert queue_high(machine(queue=3.0)) is None

    def test_esikte_alarm_yok(self):
        """Eşiğin kendisi sınırın içindedir; eşit değer alarm üretmez."""
        assert queue_high(machine(queue=DEFAULT_QUEUE_THRESHOLD)) is None

    def test_olculmemis_kuyruk_alarm_uretmez(self):
        assert queue_high(machine(queue=None)) is None

    def test_ozel_esik_kullanilir(self):
        limits = AlarmThresholds(queue_threshold=2.0)
        assert queue_high(machine(queue=3.0), limits) is not None

    def test_mesajda_olculen_deger_gecer(self):
        candidate = queue_high(machine(queue=15.0))
        assert "15" in candidate.message

    def test_baglamda_deger_ve_esik_bulunur(self):
        candidate = queue_high(machine(queue=15.0))
        assert candidate.context["queue"] == 15.0
        assert candidate.context["threshold"] == DEFAULT_QUEUE_THRESHOLD

    def test_uyari_duzeyinde(self):
        """Kuyruk birikmesi durma değildir; kritik sayılmaz."""
        assert queue_high(machine(queue=15.0)).severity is AlarmSeverity.WARNING


class TestMakineDurduKurali:
    def test_duran_makine_alarm_uretir(self):
        candidate = machine_down(machine(status="down"))
        assert candidate is not None
        assert candidate.severity is AlarmSeverity.CRITICAL

    def test_calisan_makine_alarm_uretmez(self):
        assert machine_down(machine(status="running")) is None

    def test_bos_makine_alarm_uretmez(self):
        """Boşta duran makine arızalı değildir."""
        assert machine_down(machine(status="idle")) is None

    def test_bilinmeyen_durum_bu_kurali_tetiklemez(self):
        """Veri gelmemesi ayrı bir kuraldır; ikisi karışmamalı."""
        assert machine_down(machine(status="unknown")) is None

    def test_konu_makine_kimligi(self):
        assert machine_down(machine(status="down")).subject == "TORNA_01"


class TestMakineBlokeKurali:
    def test_bloke_makine_alarm_uretir(self):
        assert machine_blocked(machine(status="blocked")) is not None

    def test_calisan_makine_alarm_uretmez(self):
        assert machine_blocked(machine(status="running")) is None

    def test_bloke_uyari_duzeyinde(self):
        """Bloke makine çalışıyor ama akış tıkalı; durma kadar ağır değil."""
        assert machine_blocked(machine(status="blocked")).severity is AlarmSeverity.WARNING


class TestVeriYokKurali:
    def test_uzun_sessizlik_alarm_uretir(self):
        stale = machine(updated_at_ms=NOW - DEFAULT_NO_DATA_TIMEOUT_MS - 1)
        assert no_data(stale, NOW) is not None

    def test_yeni_olcum_alarm_uretmez(self):
        assert no_data(machine(updated_at_ms=NOW - 1_000), NOW) is None

    def test_tam_esikte_alarm_yok(self):
        stale = machine(updated_at_ms=NOW - DEFAULT_NO_DATA_TIMEOUT_MS)
        assert no_data(stale, NOW) is None

    def test_hic_olcum_gelmemisse_alarm_yok(self):
        """Hiç veri gelmemiş bir makine için "veri kesildi" denemez.

        Kesilmek için önce akmış olması gerekir; yeni tanımlanmış bir makine
        arızalı değildir.
        """
        assert no_data(machine(updated_at_ms=None), NOW) is None

    def test_ozel_zaman_asimi(self):
        limits = AlarmThresholds(no_data_timeout_ms=1_000)
        assert no_data(machine(updated_at_ms=NOW - 2_000), NOW, limits) is not None

    def test_baglamda_sessizlik_suresi_var(self):
        stale = machine(updated_at_ms=NOW - DEFAULT_NO_DATA_TIMEOUT_MS - 5_000)
        candidate = no_data(stale, NOW)
        assert candidate.context["age_ms"] >= DEFAULT_NO_DATA_TIMEOUT_MS


class TestBaglantiKoptuKurali:
    def test_kopan_dogrulanmis_baglanti_alarm_uretir(self):
        candidate = runtime_disconnected("c1", "PLC", "failed", True)
        assert candidate is not None
        assert candidate.severity is AlarmSeverity.CRITICAL

    def test_bagli_baglanti_alarm_uretmez(self):
        assert runtime_disconnected("c1", "PLC", "connected", True) is None

    def test_hic_dogrulanmamis_baglanti_alarm_uretmez(self):
        """Hiç kurulmamış bir bağlantı "koptu" sayılmaz.

        Kullanıcı bir bağlantı tanımlayıp henüz test etmediyse, bu bir arıza
        değil eksik yapılandırmadır; alarm üretmek gürültü olurdu.
        """
        assert runtime_disconnected("c1", "PLC", "failed", False) is None

    def test_bosta_baglanti_alarm_uretmez(self):
        assert runtime_disconnected("c1", "PLC", "idle", True) is None

    def test_konu_baglanti_kimligi(self):
        candidate = runtime_disconnected("c1", "PLC", "disconnected", True)
        assert candidate.subject == "c1"

    def test_mesajda_baglanti_etiketi_gecer(self):
        candidate = runtime_disconnected("c1", "Torna PLC", "failed", True)
        assert "Torna PLC" in candidate.message


class TestGoruntuDegerlendirmesi:
    def test_iki_sorun_iki_alarm_uretir(self):
        broken = machine(status="down", queue=20.0)
        assert len(evaluate_snapshot(broken, NOW)) == 2

    def test_saglikli_makine_alarm_uretmez(self):
        assert evaluate_snapshot(machine(status="running", queue=2.0), NOW) == []

    def test_ayni_makine_iki_kez_ayni_alarmi_uretir(self):
        """Kural saf: aynı girdi aynı çıktıyı verir (yinelemeyi depo engeller)."""
        broken = machine(status="down")
        first = evaluate_snapshot(broken, NOW)
        second = evaluate_snapshot(broken, NOW)
        assert [item.id for item in first] == [item.id for item in second]


# -- Depo -------------------------------------------------------------------


class TestAlarmDeposu:
    def test_yeni_aday_alarm_acar(self):
        store = AlarmStore()
        result = store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        assert result["opened"] == 1

    def test_ayni_aday_ikinci_kez_yeni_alarm_acmaz(self):
        """Mükerrer alarm yok: bu, sprintin en açık kabul ölçütü."""
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        store.sync(candidates, NOW)
        result = store.sync(candidates, NOW + 1_000)
        assert result["opened"] == 0
        assert result["updated"] == 1
        assert len(store.active) == 1

    def test_yuz_kez_degerlendirme_tek_alarm_birakir(self):
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        for step in range(100):
            store.sync(candidates, NOW + step * 1_000)
        assert len(store.active) == 1

    def test_neden_bitince_alarm_kapanir(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        result = store.sync([], NOW + 1_000)
        assert result["resolved"] == 1
        assert store.active == []

    def test_kapanan_alarm_gecmise_gider(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        store.sync([], NOW + 1_000)
        assert len(store.history) == 1
        assert store.history[0].state is AlarmState.RESOLVED

    def test_kapanan_alarmin_bitis_ani_yazilir(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        store.sync([], NOW + 5_000)
        assert store.history[0].resolved_at_ms == NOW + 5_000

    def test_mesaj_tazelenir(self):
        """Kuyruk 12'den 30'a çıktıysa alarm metni de güncellenmeli."""
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(queue=12.0), NOW), NOW)
        store.sync(evaluate_snapshot(machine(queue=30.0), NOW), NOW + 1_000)
        assert "30" in store.active[0].message

    def test_ilk_gorulme_ani_korunur(self):
        """Alarmın yaşı, ilk açıldığı andan sayılır."""
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        store.sync(candidates, NOW)
        store.sync(candidates, NOW + 60_000)
        assert store.active[0].raised_at_ms == NOW

    def test_iki_makine_iki_ayri_alarm(self):
        store = AlarmStore()
        candidates = [
            *evaluate_snapshot(machine("TORNA_01", status="down"), NOW),
            *evaluate_snapshot(machine("FREZE_01", status="down"), NOW),
        ]
        store.sync(candidates, NOW)
        assert len(store.active) == 2

    def test_bir_makine_duzelirse_yalnizca_onun_alarmi_kapanir(self):
        store = AlarmStore()
        store.sync(
            [
                *evaluate_snapshot(machine("TORNA_01", status="down"), NOW),
                *evaluate_snapshot(machine("FREZE_01", status="down"), NOW),
            ],
            NOW,
        )
        store.sync(evaluate_snapshot(machine("FREZE_01", status="down"), NOW), NOW + 1)
        assert [item.subject for item in store.active] == ["FREZE_01"]


class TestAlarmOnayi:
    def _acik_alarm(self) -> tuple[AlarmStore, str]:
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        store.sync(candidates, NOW)
        return store, candidates[0].id

    def test_acik_alarm_onaylanir(self):
        store, ident = self._acik_alarm()
        alarm = store.acknowledge(ident, "Ayşe", NOW + 1_000)
        assert alarm is not None
        assert alarm.state is AlarmState.ACKNOWLEDGED

    def test_onaylayan_kisi_yazilir(self):
        store, ident = self._acik_alarm()
        assert store.acknowledge(ident, "Ayşe", NOW + 1_000).acknowledged_by == "Ayşe"

    def test_onay_ani_yazilir(self):
        store, ident = self._acik_alarm()
        assert store.acknowledge(ident, "Ayşe", NOW + 7).acknowledged_at_ms == NOW + 7

    def test_onaylanan_alarm_yeniden_acilmaz(self):
        """Sprintin ikinci açık kabul ölçütü: ACK asla OPEN'a dönmez."""
        store, ident = self._acik_alarm()
        store.acknowledge(ident, "Ayşe", NOW + 1_000)
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        for step in range(50):
            store.sync(candidates, NOW + 2_000 + step)
        assert store.active[0].state is AlarmState.ACKNOWLEDGED

    def test_ikinci_onay_reddedilir(self):
        store, ident = self._acik_alarm()
        store.acknowledge(ident, "Ayşe", NOW + 1_000)
        assert store.acknowledge(ident, "Mehmet", NOW + 2_000) is None

    def test_bilinmeyen_alarm_onaylanamaz(self):
        store, _ = self._acik_alarm()
        assert store.acknowledge("yok::yok", "Ayşe", NOW) is None

    def test_kapanmis_alarm_onaylanamaz(self):
        store, ident = self._acik_alarm()
        store.sync([], NOW + 1_000)
        assert store.acknowledge(ident, "Ayşe", NOW + 2_000) is None

    def test_onaylanan_alarm_neden_bitince_kapanir(self):
        store, ident = self._acik_alarm()
        store.acknowledge(ident, "Ayşe", NOW + 1_000)
        store.sync([], NOW + 2_000)
        assert store.active == []
        assert store.history[0].state is AlarmState.RESOLVED

    def test_onaylanan_alarm_onaylayani_gecmiste_de_korur(self):
        store, ident = self._acik_alarm()
        store.acknowledge(ident, "Ayşe", NOW + 1_000)
        store.sync([], NOW + 2_000)
        assert store.history[0].acknowledged_by == "Ayşe"


class TestElleKapatma:
    def test_alarm_elle_kapatilabilir(self):
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        store.sync(candidates, NOW)
        assert store.resolve(candidates[0].id, NOW + 1_000) is not None
        assert store.active == []

    def test_bilinmeyen_alarm_kapatilamaz(self):
        assert AlarmStore().resolve("yok::yok", NOW) is None

    def test_elle_kapatilan_alarm_neden_surerse_yeniden_acilir(self):
        """Neden sürüyorsa alarm geri gelir; sorunu gizlemek tehlikeli olurdu."""
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down"), NOW)
        store.sync(candidates, NOW)
        store.resolve(candidates[0].id, NOW + 1_000)
        result = store.sync(candidates, NOW + 2_000)
        assert result["opened"] == 1


class TestSayaclarVeGecmis:
    def test_sayaclar_durumlara_gore_ayrisir(self):
        store = AlarmStore()
        candidates = evaluate_snapshot(machine(status="down", queue=20.0), NOW)
        store.sync(candidates, NOW)
        store.acknowledge(candidates[0].id, "Ayşe", NOW)
        counts = store.counts()
        assert counts["active"] == 2
        assert counts["acknowledged"] == 1
        assert counts["open"] == 1

    def test_kritik_sayaci_yalnizca_kritikleri_sayar(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down", queue=20.0), NOW), NOW)
        assert store.counts()["critical"] == 1

    def test_toplam_acilan_sayaci_artar(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        store.sync([], NOW + 1)
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW + 2)
        assert store.counts()["raised_total"] == 2

    def test_gecmis_sinirlanir(self):
        """Sınırsız geçmiş, günlerce çalışan bir süreçte belleği doldururdu."""
        store = AlarmStore(max_history=3)
        for step in range(10):
            store.sync(evaluate_snapshot(machine(f"M{step}", status="down"), NOW), NOW)
            store.sync([], NOW + 1)
        assert len(store.history) == 3

    def test_temizleme_her_seyi_sifirlar(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        store.clear()
        assert store.active == []
        assert store.counts()["raised_total"] == 0


class TestAlarmSozlugu:
    def test_sozlukte_durum_etiketi_var(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        assert store.to_dict(NOW)["active"][0]["state_label"] == "Açık"

    def test_sure_verilen_ana_gore_hesaplanir(self):
        store = AlarmStore()
        store.sync(evaluate_snapshot(machine(status="down"), NOW), NOW)
        assert store.to_dict(NOW + 60_000)["active"][0]["duration_ms"] == 60_000

    def test_sozluk_sayaclari_icerir(self):
        assert "counts" in AlarmStore().to_dict(NOW)

    def test_alarm_etkin_mi(self):
        alarm = Alarm(
            id="x",
            rule=AlarmRuleId.MACHINE_DOWN,
            subject="M1",
            severity=AlarmSeverity.CRITICAL,
            message="",
            state=AlarmState.OPEN,
            raised_at_ms=NOW,
            updated_at_ms=NOW,
        )
        assert alarm.is_active is True
        alarm.state = AlarmState.RESOLVED
        assert alarm.is_active is False


# -- Değerlendirici ---------------------------------------------------------


class TestDegerlendirici:
    def test_makine_ve_baglanti_alarmlari_birlikte_toplanir(self):
        candidates = collect_candidates(
            [machine(status="down")],
            [ConnectionView("c1", "PLC", "failed", True)],
            NOW,
        )
        rules = {item.rule for item in candidates}
        assert AlarmRuleId.MACHINE_DOWN in rules
        assert AlarmRuleId.RUNTIME_DISCONNECTED in rules

    def test_bos_girdi_aday_uretmez(self):
        assert collect_candidates([], [], NOW) == []

    def test_degerlendirici_depoyu_gunceller(self):
        evaluator = AlarmEvaluator()
        result = evaluator.evaluate([machine(status="down")], [], NOW)
        assert result["opened"] == 1
        assert evaluator.active_count == 1

    def test_degerlendirici_tekrar_calisinca_yeni_alarm_acmaz(self):
        evaluator = AlarmEvaluator()
        evaluator.evaluate([machine(status="down")], [], NOW)
        result = evaluator.evaluate([machine(status="down")], [], NOW + 1_000)
        assert result["opened"] == 0

    def test_acik_sayaci_onaydan_sonra_duser(self):
        evaluator = AlarmEvaluator()
        evaluator.evaluate([machine(status="down")], [], NOW)
        ident = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        evaluator.acknowledge(ident, "Ayşe", NOW)
        assert evaluator.open_count == 0
        assert evaluator.active_count == 1

    def test_ozel_esik_degerlendiriciye_gecer(self):
        evaluator = AlarmEvaluator(thresholds=AlarmThresholds(queue_threshold=1.0))
        evaluator.evaluate([machine(queue=2.0)], [], NOW)
        assert evaluator.active_count == 1

    def test_degerlendirici_gorunumu_sozluk_dondurur(self):
        evaluator = AlarmEvaluator()
        evaluator.evaluate([machine(status="down")], [], NOW)
        state = evaluator.snapshot(NOW)
        assert set(state) == {"active", "history", "counts"}


class TestAlarmSiddetSiralamasi:
    @pytest.mark.parametrize(
        "status,expected",
        [
            ("down", AlarmSeverity.CRITICAL),
            ("blocked", AlarmSeverity.WARNING),
        ],
    )
    def test_durum_siddeti_belirler(self, status, expected):
        candidates = evaluate_snapshot(machine(status=status), NOW)
        assert candidates[0].severity is expected
