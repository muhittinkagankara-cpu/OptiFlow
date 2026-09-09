"""Denetim günlüğü.

Bu dosyanın koruduğu üç söz:

1. **Kayıtlar değiştirilemez.** Güncelleme ve silme işlevi yoktur; sonradan
   düzeltilebilen bir denetim günlüğü kanıt değeri taşımaz.
2. **Hassas alanlar yazılmaz.** Denetim kayıtları destek ekibiyle paylaşılır;
   parola içeren bir kayıt, sızıntının en kolay yoludur.
3. **Kayıt hatası işlemi durdurmaz.** Dolu bir disk yüzünden operatör alarmı
   onaylayamaz hâle gelmemelidir.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from simulation_engine.runtime.audit import (
    ACTION_LABEL,
    MAX_MEMORY_ENTRIES,
    REDACTED_VALUE,
    SYSTEM_ACTOR,
    AuditAction,
    AuditOutcome,
    AuditRecorder,
    make_entry,
    redact,
)
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
)

ORG = "denetim-org"
NOW = 1_700_000


class TestGizleme:
    def test_parola_gizlenir(self):
        assert redact({"password": "gizli"})["password"] == REDACTED_VALUE

    def test_turkce_parola_gizlenir(self):
        assert redact({"parola": "gizli"})["parola"] == REDACTED_VALUE

    def test_token_gizlenir(self):
        assert redact({"access_token": "abc"})["access_token"] == REDACTED_VALUE

    def test_api_anahtari_gizlenir(self):
        assert redact({"api_key": "abc"})["api_key"] == REDACTED_VALUE

    def test_buyuk_harf_de_gizlenir(self):
        assert redact({"PASSWORD": "x"})["PASSWORD"] == REDACTED_VALUE

    def test_tire_ile_yazilan_da_gizlenir(self):
        assert redact({"api-key": "x"})["api-key"] == REDACTED_VALUE

    def test_ic_ice_sozluk_de_gizlenir(self):
        cleaned = redact({"spec": {"token": "x", "label": "Torna"}})
        assert cleaned["spec"]["token"] == REDACTED_VALUE
        assert cleaned["spec"]["label"] == "Torna"

    def test_zararsiz_alan_korunur(self):
        assert redact({"machine": "TORNA_01"})["machine"] == "TORNA_01"

    def test_bos_girdi_bos_doner(self):
        assert redact(None) == {}


class TestKayitOlusturma:
    def test_aktor_bilinmiyorsa_sistem_yazilir(self):
        """Boş bırakmak, kaydın eksik mi otomatik mi olduğunu gizlerdi."""
        entry = make_entry(ORG, AuditAction.RUNTIME_RECOVERY, "runtime", NOW)
        assert entry.actor == SYSTEM_ACTOR

    def test_bos_aktor_sistem_olur(self):
        entry = make_entry(ORG, AuditAction.RUNTIME_RECOVERY, "runtime", NOW, actor="   ")
        assert entry.actor == SYSTEM_ACTOR

    def test_aktor_korunur(self):
        entry = make_entry(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a", NOW, actor="Ayşe")
        assert entry.actor == "Ayşe"

    def test_kaynak_bos_ise_bilinmiyor(self):
        entry = make_entry(ORG, AuditAction.ALARM_ACKNOWLEDGE, "", NOW)
        assert entry.resource == "bilinmiyor"

    def test_negatif_zaman_sifira_cekilir(self):
        entry = make_entry(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a", -5)
        assert entry.at_ms == 0

    def test_hassas_alan_kayit_aninda_gizlenir(self):
        entry = make_entry(
            ORG, AuditAction.CONNECTOR_CONNECT, "c1", NOW, details={"password": "x"}
        )
        assert entry.details["password"] == REDACTED_VALUE

    def test_kayit_degistirilemez(self):
        """`frozen=True`: bellekteki bir kayıt sonradan düzeltilemez."""
        entry = make_entry(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a", NOW)
        with pytest.raises(Exception):
            entry.actor = "baskasi"  # type: ignore[misc]

    def test_her_eylemin_etiketi_var(self):
        for action in AuditAction:
            assert ACTION_LABEL[action]

    def test_sozluk_butun_alanlari_tasir(self):
        payload = make_entry(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a", NOW).to_dict()
        assert set(payload) == {
            "sequence",
            "org_id",
            "action",
            "action_label",
            "resource",
            "actor",
            "outcome",
            "outcome_label",
            "at_ms",
            "details",
        }


class TestKaydedici:
    def _recorder(self, **kwargs) -> AuditRecorder:
        return AuditRecorder(clock=lambda: NOW, **kwargs)

    def test_kayit_eklenir(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        assert recorder.count(ORG) == 1

    def test_sira_numarasi_artar(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        entry = recorder.record(ORG, AuditAction.CONNECTOR_DISCONNECT, "c1")
        assert entry.sequence == 2

    def test_kiracilar_ayri_numaralanir(self):
        recorder = self._recorder()
        recorder.record("a", AuditAction.CONNECTOR_CONNECT, "c1")
        entry = recorder.record("b", AuditAction.CONNECTOR_CONNECT, "c1")
        assert entry.sequence == 1

    def test_kayitlar_yeniden_eskiye_okunur(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "ilk")
        recorder.record(ORG, AuditAction.CONNECTOR_DISCONNECT, "son")
        assert recorder.entries(ORG)[0].resource == "son"

    def test_eyleme_gore_suzulur(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        rows = recorder.entries(ORG, action=AuditAction.ALARM_ACKNOWLEDGE)
        assert len(rows) == 1

    def test_sinir_uygulanir(self):
        recorder = self._recorder()
        for index in range(10):
            recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, f"c{index}")
        assert len(recorder.entries(ORG, limit=3)) == 3

    def test_bellek_tamponu_sinirlidir(self):
        recorder = self._recorder()
        for index in range(MAX_MEMORY_ENTRIES + 50):
            recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, f"c{index}")
        assert recorder.count(ORG) == MAX_MEMORY_ENTRIES

    def test_son_kayit_okunur(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        assert recorder.last(ORG).resource == "c1"

    def test_bos_kiracida_son_kayit_none(self):
        assert self._recorder().last(ORG) is None

    def test_basarisiz_islem_de_kaydedilir(self):
        """"Kim denedi ve başaramadı?" sorusu da yanıtlanabilmeli."""
        recorder = self._recorder()
        recorder.record(
            ORG, AuditAction.CONNECTOR_CONNECT, "c1", outcome=AuditOutcome.FAILURE
        )
        assert recorder.summary(ORG)["failures"] == 1

    def test_ozet_eyleme_gore_sayar(self):
        recorder = self._recorder()
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c2")
        assert recorder.summary(ORG)["by_action"]["connector_connect"] == 2

    def test_depo_yoksa_kalici_degil(self):
        assert self._recorder().summary(ORG)["persistent"] is False

    def test_temizleme_yalnizca_bellegi_bosaltir(self):
        repository = InMemoryRuntimeRepository()
        recorder = self._recorder(repository=repository)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        recorder.clear(ORG)
        assert recorder.count(ORG) == 0
        assert repository.audit_count(ORG) == 1


class TestYazmaHatasi:
    class BozukDepo:
        is_persistent = True

        def append_audit(self, org_id, entry):
            raise RuntimeError("disk dolu")

        def list_audit(self, org_id, limit=100):
            raise RuntimeError("disk dolu")

    def test_yazma_hatasi_islemi_durdurmaz(self):
        """Denetime yazamamak, alarmın onaylanmasını engellememelidir."""
        recorder = AuditRecorder(repository=self.BozukDepo(), clock=lambda: NOW)
        entry = recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        assert entry.sequence == 1

    def test_yazma_hatasi_sayilir(self):
        recorder = AuditRecorder(repository=self.BozukDepo(), clock=lambda: NOW)
        recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        assert recorder.write_errors == 1

    def test_hata_nedeni_saklanir(self):
        recorder = AuditRecorder(repository=self.BozukDepo(), clock=lambda: NOW)
        recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        assert recorder.last_error == "disk dolu"

    def test_okuma_hatasinda_bellege_dusulur(self):
        recorder = AuditRecorder(repository=self.BozukDepo(), clock=lambda: NOW)
        recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1")
        assert len(recorder.entries(ORG)) == 1


@pytest.fixture(params=["memory", "sqlite"])
def repository(request):
    if request.param == "memory":
        return InMemoryRuntimeRepository()
    path = os.path.join(tempfile.mkdtemp(), "audit.db")
    return DatabaseRuntimeRepository(f"sqlite:///{path}")


class TestKalicilik:
    def test_kayit_diske_yazilir(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")
        assert repository.audit_count(ORG) == 1

    def test_yeni_kaydedici_gecmisi_gorur(self, repository):
        """Sunucu yeniden başladığında geçmiş kaybolmamalı."""
        first = AuditRecorder(repository=repository, clock=lambda: NOW)
        first.record(ORG, AuditAction.CONNECTOR_CONNECT, "c1")

        second = AuditRecorder(repository=repository, clock=lambda: NOW)
        assert len(second.entries(ORG)) == 1

    def test_kiraci_yalitimi_surer(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record("a", AuditAction.CONNECTOR_CONNECT, "c1")
        recorder.record("b", AuditAction.CONNECTOR_CONNECT, "c1")
        assert repository.audit_count("a") == 1

    def test_hassas_alan_diske_de_yazilmaz(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(
            ORG, AuditAction.CONNECTOR_CONNECT, "c1", details={"password": "x"}
        )
        stored = repository.list_audit(ORG)[0]
        assert stored.details["password"] == REDACTED_VALUE

    def test_aktor_diske_yazilir(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1", actor="Ayşe")
        assert repository.list_audit(ORG)[0].actor == "Ayşe"

    def test_sonuc_diske_yazilir(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(
            ORG, AuditAction.CONNECTOR_CONNECT, "c1", outcome=AuditOutcome.FAILURE
        )
        assert repository.list_audit(ORG)[0].outcome is AuditOutcome.FAILURE

    def test_yeniden_eskiye_okunur(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "ilk")
        recorder.record(ORG, AuditAction.CONNECTOR_DISCONNECT, "son")
        assert repository.list_audit(ORG)[0].resource == "son"

    def test_silme_islevi_yok(self, repository):
        """Değiştirilemezlik: depoda silme ya da güncelleme yöntemi yoktur."""
        assert not hasattr(repository, "delete_audit")
        assert not hasattr(repository, "update_audit")
