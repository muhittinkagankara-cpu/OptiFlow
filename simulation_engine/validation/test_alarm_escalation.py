# -*- coding: utf-8 -*-
"""Alarm yukseltme, susturma, bakim modu ve vardiya devri testleri.

Bu dosyanin savundugu iki ayrim var:

* **Susturma kapatma degildir.** Bakimdaki bir makinenin durus alarmi
  kapatilsaydi, bakim bittiginde gercek bir ariza da kapanmis gorunurdu.
* **Yukseltme, ilgilenilmesini engellemez.** Yukseltilmis bir alarm hâlâ
  gorulebilir; tersine, gorulmesini ister.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.alarms import (
    Alarm,
    AlarmCandidate,
    AlarmRuleId,
    AlarmSeverity,
    AlarmState,
    AlarmStore,
    DEFAULT_SILENCE_MS,
    ESCALATION_CHAIN,
    ESCALATION_KIND_LABEL,
    EscalationEngine,
    EscalationKind,
    EscalationPolicy,
    MAX_ESCALATION_LEVEL,
    MAX_SILENCE_MS,
    MaintenanceRegistry,
    MaintenanceWindow,
    chain_target,
    clamp_silence_ms,
)

NOW = 1_700_000_000_000
CRITICAL_DELAY = 120_000
WARNING_DELAY = 900_000
CRITICAL_REPEAT = 300_000


def candidate(
    subject: str = "FREZE_01",
    rule: AlarmRuleId = AlarmRuleId.MACHINE_DOWN,
    severity: AlarmSeverity = AlarmSeverity.CRITICAL,
) -> AlarmCandidate:
    return AlarmCandidate(
        rule=rule,
        subject=subject,
        severity=severity,
        message=f"{subject} durdu",
        context={"kaynak": "test"},
    )


@pytest.fixture
def store():
    store = AlarmStore()
    store.sync([candidate()], NOW)
    return store


@pytest.fixture
def alarm(store):
    return store.active[0]


@pytest.fixture
def engine():
    return EscalationEngine()


# ------------------------------------------------------------- durumlar


class TestDurumlar:
    def test_bes_durum_var(self):
        assert len(list(AlarmState)) == 5

    def test_susturulmus_alarm_etkin(self, store, alarm):
        # Nedeni suruyor; yalnizca bildirimi kesilmis.
        store.silence(alarm.id, "operator", NOW)
        assert alarm.is_active is True

    def test_yukseltilmis_alarm_etkin(self, store, alarm):
        store.escalate(alarm.id, 1, NOW)
        assert alarm.is_active is True

    def test_kapanmis_alarm_etkin_degil(self, store, alarm):
        store.resolve(alarm.id, NOW)
        assert alarm.is_active is False

    def test_acik_alarm_ilgi_bekler(self, alarm):
        assert alarm.needs_attention is True

    def test_yukseltilmis_alarm_ilgi_bekler(self, store, alarm):
        store.escalate(alarm.id, 1, NOW)
        assert alarm.needs_attention is True

    def test_gorulmus_alarm_ilgi_beklemez(self, store, alarm):
        store.acknowledge(alarm.id, "operator", NOW)
        assert alarm.needs_attention is False

    def test_susturulmus_alarm_ilgi_beklemez(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert alarm.needs_attention is False

    def test_susturulmus_bayragi(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert alarm.is_silenced is True


class TestSahipsizlikSuresi:
    def test_acik_alarmin_sahipsizlik_suresi(self, alarm):
        assert alarm.unattended_ms(NOW + 5_000) == 5_000

    def test_gorulmus_alarmin_sahipsizligi_none(self, store, alarm):
        # Sifir donseydi, ilgilenilmis bir alarm "az once acildi" gibi gorunurdu.
        store.acknowledge(alarm.id, "operator", NOW)
        assert alarm.unattended_ms(NOW + 5_000) is None

    def test_susturulmus_alarmin_sahipsizligi_none(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert alarm.unattended_ms(NOW + 5_000) is None

    def test_yukseltilmis_alarm_hâlâ_sahipsiz(self, store, alarm):
        store.escalate(alarm.id, 1, NOW)
        assert alarm.unattended_ms(NOW + 5_000) == 5_000

    def test_baslangici_bilinmeyen_alarm_none(self):
        bare = Alarm(
            id="x",
            rule=AlarmRuleId.NO_DATA,
            subject="X",
            severity=AlarmSeverity.INFO,
            message="",
        )
        assert bare.unattended_ms(NOW) is None


# ------------------------------------------------------------- susturma


class TestSusturmaSuresi:
    def test_varsayilan_sure(self):
        assert clamp_silence_ms(None) == DEFAULT_SILENCE_MS

    def test_sifir_varsayilana_duser(self):
        # Sonsuz susturma yoktur.
        assert clamp_silence_ms(0) == DEFAULT_SILENCE_MS

    def test_negatif_varsayilana_duser(self):
        assert clamp_silence_ms(-1) == DEFAULT_SILENCE_MS

    def test_gecersiz_deger_varsayilana_duser(self):
        assert clamp_silence_ms("bir saat") == DEFAULT_SILENCE_MS

    def test_ust_sinir(self):
        assert clamp_silence_ms(99 * 3_600_000) == MAX_SILENCE_MS

    def test_ust_sinir_bir_vardiya(self):
        assert MAX_SILENCE_MS == 8 * 3_600_000

    def test_gecerli_sure_korunur(self):
        assert clamp_silence_ms(60_000) == 60_000


class TestSusturma:
    def test_susturma_durumu_degistirir(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert alarm.state is AlarmState.SILENCED

    def test_susturan_kisi_saklanir(self, store, alarm):
        store.silence(alarm.id, "ayse", NOW)
        assert alarm.silenced_by == "ayse"

    def test_bitis_ani_hesaplanir(self, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        assert alarm.silenced_until_ms == NOW + 60_000

    def test_neden_saklanir(self, store, alarm):
        store.silence(alarm.id, "operator", NOW, reason="Planlı bakım")
        assert alarm.silence_reason == "Planlı bakım"

    def test_olmayan_alarm_susturulmaz(self, store):
        assert store.silence("yok", "operator", NOW) is None

    def test_kapanmis_alarm_susturulmaz(self, store, alarm):
        store.resolve(alarm.id, NOW)
        assert store.silence(alarm.id, "operator", NOW) is None

    def test_susturma_suresi_dolmadi(self, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        assert alarm.silence_expired(NOW + 30_000) is False

    def test_susturma_suresi_doldu(self, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        assert alarm.silence_expired(NOW + 60_000) is True

    def test_susturulmamis_alarmin_suresi_dolmaz(self, alarm):
        assert alarm.silence_expired(NOW + 10**9) is False

    def test_geri_alma_acik_duruma_dondurur(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        store.unsilence(alarm.id, NOW + 1_000)
        assert alarm.state is AlarmState.OPEN

    def test_geri_alma_susturma_izlerini_siler(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        store.unsilence(alarm.id, NOW + 1_000)
        assert (alarm.silenced_by, alarm.silenced_until_ms) == (None, None)

    def test_susturulmamis_alarm_geri_alinmaz(self, store, alarm):
        assert store.unsilence(alarm.id, NOW) is None

    def test_susturulmus_alarm_gorulmez(self, store, alarm):
        # Once geri alinmalidir: susturma sirasinda ilgilenildigine dair kanit yok.
        store.silence(alarm.id, "operator", NOW)
        assert store.acknowledge(alarm.id, "operator", NOW) is None

    def test_susturulmus_alarm_esitlemede_kapanmaz(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        store.sync([candidate()], NOW + 1_000)
        assert alarm.state is AlarmState.SILENCED

    def test_nedeni_biten_susturulmus_alarm_kapanir(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        store.sync([], NOW + 1_000)
        assert alarm.state is AlarmState.RESOLVED

    def test_sayacta_susturulmus_gorunur(self, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert store.counts()["silenced"] == 1


# --------------------------------------------------------------- bakim


class TestBakimPenceresi:
    def _window(self, **kwargs):
        base = dict(subject="FREZE_01", start_ms=NOW, end_ms=NOW + 3_600_000)
        base.update(kwargs)
        return MaintenanceWindow(**base)

    def test_baslangic_dahil(self):
        assert self._window().covers(NOW) is True

    def test_bitis_haric(self):
        assert self._window().covers(NOW + 3_600_000) is False

    def test_oncesi_disarida(self):
        assert self._window().covers(NOW - 1) is False

    def test_kalan_sure(self):
        assert self._window().remaining_ms(NOW + 600_000) == 3_000_000

    def test_pencere_disinda_kalan_none(self):
        assert self._window().remaining_ms(NOW - 1) is None

    def test_sozlukte_etkinlik(self):
        assert self._window().to_dict(NOW)["active"] is True

    def test_an_verilmezse_etkinlik_none(self):
        # Olculmemis bir deger sifir ya da false degil, None doner.
        assert self._window().to_dict()["active"] is None


class TestBakimKaydi:
    @pytest.fixture
    def registry(self):
        registry = MaintenanceRegistry()
        registry.open(
            MaintenanceWindow(
                subject="FREZE_01",
                start_ms=NOW,
                end_ms=NOW + 3_600_000,
                reason="Planlı bakım",
                opened_by="bakim-ekibi",
            )
        )
        return registry

    def test_etkin_pencere_bulunur(self, registry):
        assert registry.active("FREZE_01", NOW) is not None

    def test_pencere_disinda_none(self, registry):
        assert registry.active("FREZE_01", NOW + 3_600_001) is None

    def test_baska_makine_none(self, registry):
        assert registry.active("TORNA_02", NOW) is None

    def test_kapatma(self, registry):
        assert registry.close("FREZE_01") is True

    def test_olmayani_kapatma(self, registry):
        assert registry.close("yok") is False

    def test_ayni_makine_penceresi_degistirilir(self, registry):
        registry.open(MaintenanceWindow(subject="FREZE_01", start_ms=NOW, end_ms=NOW + 10))
        assert len(registry.windows()) == 1

    def test_bakim_alarmi_susturur(self, store, alarm, registry):
        store.apply_maintenance(registry, NOW)
        assert alarm.state is AlarmState.SILENCED

    def test_bakim_alarmi_kapatmaz(self, store, alarm, registry):
        # Kapatilsaydi, bakim bittiginde gercek bir ariza da kapanmis gorunurdu.
        store.apply_maintenance(registry, NOW)
        assert alarm.is_active is True

    def test_susturma_bakim_bitisine_kadar(self, store, alarm, registry):
        store.apply_maintenance(registry, NOW)
        assert alarm.silenced_until_ms == NOW + 3_600_000

    def test_susturma_nedeni_bakim(self, store, alarm, registry):
        store.apply_maintenance(registry, NOW)
        assert alarm.silence_reason == "Planlı bakım"

    def test_susturan_bakim_ekibi(self, store, alarm, registry):
        store.apply_maintenance(registry, NOW)
        assert alarm.silenced_by == "bakim-ekibi"

    def test_bakim_disi_makine_etkilenmez(self, store, registry):
        store.sync([candidate(), candidate("TORNA_02")], NOW)
        store.apply_maintenance(registry, NOW)
        torna = [item for item in store.active if item.subject == "TORNA_02"][0]
        assert torna.state is AlarmState.OPEN

    def test_zaten_susturulmus_alarm_yeniden_susturulmaz(self, store, alarm, registry):
        # Yeniden susturulsaydi, sure her turda bastan baslar ve alarm hic
        # geri donmezdi.
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        store.apply_maintenance(registry, NOW)
        assert alarm.silenced_until_ms == NOW + 60_000


# ----------------------------------------------------------- yukseltme


class TestZincir:
    def test_uc_kademe(self):
        assert len(ESCALATION_CHAIN) == MAX_ESCALATION_LEVEL

    def test_birinci_kademe_operator(self):
        assert chain_target(1) == "Operatör"

    def test_ucuncu_kademe_uretim_muduru(self):
        assert chain_target(3) == "Üretim müdürü"

    def test_tanimsiz_kademe_none(self):
        # Varsayilana dusseydi, ucuncu kademedeki alarm birinci gibi gorunurdu.
        assert chain_target(9) is None

    def test_sifirinci_kademe_none(self):
        assert chain_target(0) is None


class TestYukseltmePolitikasi:
    def test_kritik_iki_dakika(self):
        assert EscalationPolicy().escalation_delay(AlarmSeverity.CRITICAL) == CRITICAL_DELAY

    def test_uyari_on_bes_dakika(self):
        assert EscalationPolicy().escalation_delay(AlarmSeverity.WARNING) == WARNING_DELAY

    def test_bilgi_yukselmez(self):
        assert EscalationPolicy().escalation_delay(AlarmSeverity.INFO) is None

    def test_bilgi_yinelenmez(self):
        assert EscalationPolicy().repeat_delay(AlarmSeverity.INFO) is None

    def test_sozluk(self):
        payload = EscalationPolicy().to_dict()
        assert payload["escalate_after_ms"]["critical"] == CRITICAL_DELAY


class TestYukseltmeMotoru:
    def test_yeni_alarm_yukselmez(self, engine, store):
        assert engine.evaluate(store.active, NOW + 1_000) == []

    def test_sure_dolunca_yukselir(self, engine, store):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        assert actions[0].kind is EscalationKind.ESCALATE

    def test_birinci_kademeye_yukselir(self, engine, store):
        assert engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0].level == 1

    def test_kademenin_sorumlusu_yazilir(self, engine, store):
        assert engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0].target == "Operatör"

    def test_gorulmus_alarm_yukselmez(self, engine, store, alarm):
        store.acknowledge(alarm.id, "operator", NOW)
        assert engine.evaluate(store.active, NOW + CRITICAL_DELAY * 5) == []

    def test_susturulmus_alarm_yukselmez(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=CRITICAL_DELAY * 10)
        assert engine.evaluate(store.active, NOW + CRITICAL_DELAY * 5) == []

    def test_bilgi_alarmi_yukselmez(self, engine, store):
        store.clear()
        store.sync([candidate(severity=AlarmSeverity.INFO)], NOW)
        assert engine.evaluate(store.active, NOW + 10**9) == []

    def test_ikinci_kademe_daha_uzun_bekler(self, engine, store, alarm):
        store.escalate(alarm.id, 1, NOW + CRITICAL_DELAY)
        assert engine.evaluate(store.active, NOW + CRITICAL_DELAY + 1) == []

    def test_ikinci_kademeye_yukselir(self, engine, store, alarm):
        store.escalate(alarm.id, 1, NOW + CRITICAL_DELAY)
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY * 2)
        assert actions[0].level == 2

    def test_en_ust_kademede_durur(self, engine, store, alarm):
        store.escalate(alarm.id, MAX_ESCALATION_LEVEL, NOW)
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY * 100)
        assert [a for a in actions if a.kind is EscalationKind.ESCALATE] == []

    def test_yukseltme_mesaji_sureyi_yazar(self, engine, store):
        assert "2 dk" in engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0].message

    def test_yukseltme_sahipsizlik_suresini_tasir(self, engine, store):
        action = engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0]
        assert action.data["unattended_ms"] == CRITICAL_DELAY

    def test_kapanmis_alarm_degerlendirilmez(self, engine, store, alarm):
        store.resolve(alarm.id, NOW)
        assert engine.evaluate(store.history, NOW + 10**9) == []


class TestYineleme:
    def test_aralik_dolmadan_yineleme_yok(self, engine, store):
        assert engine.evaluate(store.active, NOW + 1_000) == []

    def test_yukseltme_yinelemenin_onunde(self, engine, store):
        # Ikisi de zamani gelmisse yukseltme kazanir: daha aciltir.
        actions = engine.evaluate(store.active, NOW + CRITICAL_REPEAT)
        assert actions[0].kind is EscalationKind.ESCALATE

    def test_en_ust_kademede_yineleme_calisir(self, engine, store, alarm):
        store.escalate(alarm.id, MAX_ESCALATION_LEVEL, NOW)
        actions = engine.evaluate(store.active, NOW + CRITICAL_REPEAT)
        assert actions[0].kind is EscalationKind.REPEAT

    def test_yineleme_sayaci_artar(self, engine, store, alarm):
        store.escalate(alarm.id, MAX_ESCALATION_LEVEL, NOW)
        actions = engine.evaluate(store.active, NOW + CRITICAL_REPEAT)
        assert actions[0].data["repeat_count"] == 1

    def test_bildirim_kaydi_sayaci_artirir(self, store, alarm):
        store.note_notified(alarm.id, NOW + 1_000)
        assert alarm.repeat_count == 1

    def test_bildirim_kaydi_ani_saklar(self, store, alarm):
        store.note_notified(alarm.id, NOW + 1_000)
        assert alarm.last_notified_ms == NOW + 1_000

    def test_yeni_alarmin_bildirim_ani_isaretlidir(self, alarm):
        assert alarm.last_notified_ms == NOW

    def test_olmayan_alarmin_bildirimi_kaydedilmez(self, store):
        assert store.note_notified("yok", NOW) is None


class TestSusturmaBitisi:
    def test_sure_dolunca_geri_donus_eylemi(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        actions = engine.evaluate(store.active, NOW + 60_000)
        assert actions[0].kind is EscalationKind.UNSILENCE

    def test_sure_dolmadan_eylem_yok(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        assert engine.evaluate(store.active, NOW + 30_000) == []

    def test_geri_donus_nedeni_tasir(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000, reason="Bakım")
        action = engine.evaluate(store.active, NOW + 60_000)[0]
        assert action.data["silence_reason"] == "Bakım"


class TestEylemUygulama:
    def test_yukseltme_uygulanir(self, engine, store, alarm):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        store.apply_actions(actions, NOW + CRITICAL_DELAY)
        assert alarm.state is AlarmState.ESCALATED

    def test_yukseltme_sayilir(self, engine, store):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        assert store.apply_actions(actions, NOW + CRITICAL_DELAY)["escalated"] == 1

    def test_yukseltme_kademesi_yazilir(self, engine, store, alarm):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        store.apply_actions(actions, NOW + CRITICAL_DELAY)
        assert alarm.escalation_level == 1

    def test_yukseltme_ani_yazilir(self, engine, store, alarm):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        store.apply_actions(actions, NOW + CRITICAL_DELAY)
        assert alarm.escalated_at_ms == NOW + CRITICAL_DELAY

    def test_susturma_bitisi_uygulanir(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW, duration_ms=60_000)
        actions = engine.evaluate(store.active, NOW + 60_000)
        store.apply_actions(actions, NOW + 60_000)
        assert alarm.state is AlarmState.OPEN

    def test_olmayan_alarmin_eylemi_atlanir(self, engine, store):
        actions = engine.evaluate(store.active, NOW + CRITICAL_DELAY)
        store.clear()
        assert store.apply_actions(actions, NOW)["skipped"] == 1

    def test_yukseltilmis_alarm_gorulebilir(self, engine, store, alarm):
        # Yukseltme ilgilenilmesini engellemez, tersine ister.
        store.escalate(alarm.id, 1, NOW)
        assert store.acknowledge(alarm.id, "amir", NOW + 1) is not None

    def test_gorulen_yukseltilmis_alarm_gorulmus_olur(self, store, alarm):
        store.escalate(alarm.id, 1, NOW)
        store.acknowledge(alarm.id, "amir", NOW + 1)
        assert alarm.state is AlarmState.ACKNOWLEDGED

    def test_gorulmus_alarm_yukseltilemez(self, store, alarm):
        store.acknowledge(alarm.id, "operator", NOW)
        assert store.escalate(alarm.id, 1, NOW + 1) is None


class TestVardiyaDevri:
    def test_acik_alarm_devredilir(self, engine, store):
        actions = engine.handover(store.active, NOW, "Gece")
        assert actions[0].kind is EscalationKind.SHIFT_HANDOVER

    def test_gorulmus_alarm_da_devredilir(self, engine, store, alarm):
        # Mudahale eden kisi vardiyayi bitiriyorsa, devralanin da bilmesi gerekir.
        store.acknowledge(alarm.id, "operator", NOW)
        assert len(engine.handover(store.active, NOW, "Gece")) == 1

    def test_susturulmus_alarm_da_devredilir(self, engine, store, alarm):
        store.silence(alarm.id, "operator", NOW)
        assert len(engine.handover(store.active, NOW, "Gece")) == 1

    def test_kapanmis_alarm_devredilmez(self, engine, store, alarm):
        store.resolve(alarm.id, NOW)
        assert engine.handover(store.history, NOW, "Gece") == []

    def test_devir_vardiyayi_adlandirir(self, engine, store):
        assert engine.handover(store.active, NOW, "Gece")[0].target == "Gece"

    def test_devir_mesaji(self, engine, store):
        assert "Gece" in engine.handover(store.active, NOW, "Gece")[0].message

    def test_devir_durumu_tasir(self, engine, store, alarm):
        store.acknowledge(alarm.id, "operator", NOW)
        action = engine.handover(store.active, NOW, "Gece")[0]
        assert action.data["state"] == "ACKNOWLEDGED"

    def test_devir_alarm_suresini_tasir(self, engine, store):
        action = engine.handover(store.active, NOW + 5_000, "Gece")[0]
        assert action.data["duration_ms"] == 5_000

    def test_devir_durum_degistirmez(self, engine, store, alarm):
        actions = engine.handover(store.active, NOW, "Gece")
        store.apply_actions(actions, NOW)
        assert alarm.state is AlarmState.OPEN


class TestEylemSozlugu:
    def test_dort_eylem_turu(self):
        assert set(ESCALATION_KIND_LABEL) == set(EscalationKind)

    def test_etiketler_turkce(self):
        assert ESCALATION_KIND_LABEL[EscalationKind.ESCALATE] == "Yükseltildi"

    def test_sozluk_alanlari(self, engine, store):
        payload = engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0].to_dict()
        assert set(payload) == {
            "kind",
            "kind_label",
            "alarm_id",
            "at_ms",
            "message",
            "level",
            "target",
            "data",
        }

    def test_eylem_degistirilemez(self, engine, store):
        action = engine.evaluate(store.active, NOW + CRITICAL_DELAY)[0]
        with pytest.raises(Exception):
            action.level = 9

    def test_alarm_sozlugu_yukseltme_alanlarini_tasir(self, store, alarm):
        store.escalate(alarm.id, 2, NOW)
        assert alarm.to_dict(NOW)["escalation_level"] == 2

    def test_alarm_sozlugu_susturma_alanlarini_tasir(self, store, alarm):
        store.silence(alarm.id, "ayse", NOW)
        assert alarm.to_dict(NOW)["silenced_by"] == "ayse"

    def test_an_verilmezse_sahipsizlik_none(self, alarm):
        assert alarm.to_dict()["unattended_ms"] is None
