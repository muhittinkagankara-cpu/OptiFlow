"""Bağlantı kaydı ve kiracı yalıtımı.

En kritik testler kiracı yalıtımıyla ilgilidir: bir organizasyonun kaydı,
kimliği bilinse bile başka bir organizasyon adına okunamaz.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.registry import (
    ConnectionExists,
    ConnectionNotFound,
    ConnectionRegistry,
    ConnectionState,
)
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    ProbeResult,
)

ORG_A = "org-a"
ORG_B = "org-b"


def spec(connection_id: str = "c1", label: str = "Hat 1", **overrides) -> ConnectionSpec:
    base = dict(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label=label,
        endpoint="http://127.0.0.1:9/veri",
    )
    base.update(overrides)
    return ConnectionSpec(**base)


class TestAdd:
    def test_kayit_eklenir(self):
        registry = ConnectionRegistry()
        state = registry.add(ORG_A, spec())
        assert state.connection_id == "c1"

    def test_yeni_kayit_denenmemis_baslar(self):
        # Kaydedilmis olmak baglanmis olmak degildir.
        registry = ConnectionRegistry()
        assert registry.add(ORG_A, spec()).status is ConnectionStatus.IDLE

    def test_yeni_kayit_dogrulanmamis_baslar(self):
        registry = ConnectionRegistry()
        assert registry.add(ORG_A, spec()).ever_verified is False

    def test_yeni_kaydin_denemesi_yok(self):
        registry = ConnectionRegistry()
        assert registry.add(ORG_A, spec()).last_probe is None

    def test_ayni_kimlik_iki_kez_eklenemez(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        with pytest.raises(ConnectionExists):
            registry.add(ORG_A, spec())

    def test_farkli_organizasyon_ayni_kimligi_kullanabilir(self):
        # Kimlik kullaniciya aittir; iki firmanin "hat1" demesi dogaldir.
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        registry.add(ORG_B, spec())
        assert registry.count() == 2


class TestUpsert:
    def test_yoksa_ekler(self):
        registry = ConnectionRegistry()
        registry.upsert(ORG_A, spec())
        assert registry.count(ORG_A) == 1

    def test_varsa_gunceller(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        registry.upsert(ORG_A, spec(label="Yeni ad"))
        assert registry.get(ORG_A, "c1").spec.label == "Yeni ad"

    def test_guncelleme_cogaltmaz(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        registry.upsert(ORG_A, spec(label="Yeni"))
        assert registry.count(ORG_A) == 1

    def test_guncelleme_olcumleri_korur(self):
        # Zaman asimi degistiginde gecmis gecikme olcumleri silinmemeli.
        registry = ConnectionRegistry()
        state = registry.add(ORG_A, spec())
        state.health.record_latency(12.0)
        registry.upsert(ORG_A, spec(timeout_ms=9_000))
        assert registry.get(ORG_A, "c1").health.avg_latency_ms() == 12.0

    def test_guncelleme_dogrulama_gecmisini_korur(self):
        registry = ConnectionRegistry()
        state = registry.add(ORG_A, spec())
        state.ever_verified = True
        registry.upsert(ORG_A, spec(label="x"))
        assert registry.get(ORG_A, "c1").ever_verified is True


class TestTenantIsolation:
    def test_baska_organizasyonun_kaydi_okunamaz(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        with pytest.raises(ConnectionNotFound):
            registry.get(ORG_B, "c1")

    def test_baska_organizasyonun_kaydi_bulunamaz(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        assert registry.find(ORG_B, "c1") is None

    def test_baska_organizasyonun_kaydi_silinemez(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        with pytest.raises(ConnectionNotFound):
            registry.remove(ORG_B, "c1")

    def test_liste_yalnizca_kendi_kayitlarini_verir(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec("c1"))
        registry.add(ORG_B, spec("c2"))
        assert [state.connection_id for state in registry.list(ORG_A)] == ["c1"]

    def test_sayim_organizasyona_gore(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec("c1"))
        registry.add(ORG_A, spec("c2"))
        registry.add(ORG_B, spec("c3"))
        assert registry.count(ORG_A) == 2
        assert registry.count(ORG_B) == 1

    def test_ayni_kimlikli_kayitlar_karismaz(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec(label="A firmasi"))
        registry.add(ORG_B, spec(label="B firmasi"))
        assert registry.get(ORG_A, "c1").spec.label == "A firmasi"
        assert registry.get(ORG_B, "c1").spec.label == "B firmasi"


class TestGetRemoveList:
    def test_olmayan_kayit_hata_verir(self):
        with pytest.raises(ConnectionNotFound):
            ConnectionRegistry().get(ORG_A, "yok")

    def test_hata_mesaji_kimligi_yazar(self):
        with pytest.raises(ConnectionNotFound) as error:
            ConnectionRegistry().get(ORG_A, "hat-7")
        assert "hat-7" in str(error.value)

    def test_find_olmayan_kayitta_none(self):
        assert ConnectionRegistry().find(ORG_A, "yok") is None

    def test_kayit_silinir(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec())
        registry.remove(ORG_A, "c1")
        assert registry.count(ORG_A) == 0

    def test_silinen_kayit_geri_doner(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec(label="Silinen"))
        assert registry.remove(ORG_A, "c1").spec.label == "Silinen"

    def test_liste_ada_gore_siralanir(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec("c1", label="Zeytin"))
        registry.add(ORG_A, spec("c2", label="Ada"))
        assert [state.spec.label for state in registry.list(ORG_A)] == ["Ada", "Zeytin"]

    def test_temizleme_hepsini_siler(self):
        registry = ConnectionRegistry()
        registry.add(ORG_A, spec("c1"))
        registry.add(ORG_B, spec("c2"))
        registry.clear()
        assert registry.count() == 0


class TestApplyProbe:
    def _state(self) -> ConnectionState:
        return ConnectionState(spec=spec(), org_id=ORG_A)

    def test_basarili_deneme_baglandi_yazar(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok", evidence="42"))
        assert state.status is ConnectionStatus.CONNECTED

    def test_basarili_deneme_dogrulanmis_isaretler(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok"))
        assert state.ever_verified is True

    def test_basarili_deneme_gecikmeyi_kaydeder(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok"))
        assert state.health.avg_latency_ms() == 5.0

    def test_basarili_deneme_paket_sayar(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok"))
        assert state.health.packets == 1

    def test_basarili_deneme_calisma_suresini_baslatir(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok", at_ms=1_000))
        assert state.health.connected_at_ms == 1_000

    def test_ikinci_basari_calisma_suresini_sifirlamaz(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok", at_ms=1_000))
        state.apply_probe(ProbeResult(ok=True, latency_ms=6.0, detail="ok", at_ms=9_000))
        assert state.health.connected_at_ms == 1_000

    def test_basarisiz_deneme_kurulamadi_yazar(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=False, latency_ms=None, detail="kapali"))
        assert state.status is ConnectionStatus.FAILED

    def test_basarisiz_deneme_hata_sayar(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=False, latency_ms=None, detail="kapali"))
        assert state.health.errors == 1
        assert state.health.last_error == "kapali"

    def test_basarisiz_deneme_dogrulama_iddiasi_uretmez(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=False, latency_ms=None, detail="kapali"))
        assert state.ever_verified is False

    def test_bir_kez_dogrulanan_kayit_isareti_korur(self):
        # Cihaz sonradan kapansa da "bir zamanlar dogrulandi" bilgisi kalir.
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok"))
        state.apply_probe(ProbeResult(ok=False, latency_ms=None, detail="koptu"))
        assert state.ever_verified is True
        assert state.status is ConnectionStatus.FAILED

    def test_basarisiz_deneme_calisma_suresini_durdurur(self):
        state = self._state()
        state.apply_probe(ProbeResult(ok=True, latency_ms=5.0, detail="ok", at_ms=1_000))
        state.apply_probe(ProbeResult(ok=False, latency_ms=None, detail="koptu"))
        assert state.health.uptime_ms(now_ms=9_000) is None


class TestToDict:
    def test_parola_sozlukte_yok(self):
        state = ConnectionState(spec=spec(password="gizli"), org_id=ORG_A)
        assert "gizli" not in str(state.to_dict())

    def test_durum_metin_olarak_doner(self):
        state = ConnectionState(spec=spec(), org_id=ORG_A)
        assert state.to_dict()["status"] == "idle"

    def test_denenmemis_kayitta_last_probe_none(self):
        state = ConnectionState(spec=spec(), org_id=ORG_A)
        assert state.to_dict()["last_probe"] is None

    def test_deneme_sonrasi_kanit_gorunur(self):
        state = ConnectionState(spec=spec(), org_id=ORG_A)
        state.apply_probe(
            ProbeResult(ok=True, latency_ms=3.0, detail="ok", evidence="ns=2;i=2 = 42")
        )
        assert state.to_dict()["last_probe"]["evidence"] == "ns=2;i=2 = 42"

    def test_saglik_ozeti_eklenir(self):
        state = ConnectionState(spec=spec(), org_id=ORG_A)
        assert state.to_dict()["health"]["avg_latency_ms"] is None
