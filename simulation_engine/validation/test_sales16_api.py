# -*- coding: utf-8 -*-
"""SALES-16 uclarinin HTTP davranisi.

Lisans, kurulum tokeni, makine etiketleri, saha tanilama, kontrol listesi,
disa aktarma ve pilot calisma alani.

Savunulan kurallar:

* **Token metni yalnizca uretim yanitinda doner.** Listeleme ucunda hicbir
  tokenin metni yoktur.
* **Suresi dolmus lisans izlemeyi kesmez.** Engellenen sey yeni kayittir.
* **Taninmayan disa aktarma turu varsayilana dusmez.** Kullanicinin alarm
  istedigi yerde telemetri indirmesi olurdu.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import get_runtime_manager
from simulation_engine.runtime.licensing import DAY_MS, LicenseTier
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

ORG_A = "sales16-a"
ORG_B = "sales16-b"


@pytest.fixture
def manager():
    instance = RuntimeManager(adapters={})
    instance.active_org_id = ORG_A
    app.dependency_overrides[get_runtime_manager] = lambda: instance

    previous_org = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: ORG_A

    yield instance

    app.dependency_overrides.pop(get_runtime_manager, None)
    if previous_org is None:
        app.dependency_overrides.pop(get_current_org, None)
    else:
        app.dependency_overrides[get_current_org] = previous_org


@pytest.fixture
def client(manager):
    with TestClient(app) as test_client:
        yield test_client


@contextmanager
def as_org(org_id: str):
    previous = app.dependency_overrides.get(get_current_org)
    app.dependency_overrides[get_current_org] = lambda: org_id
    try:
        yield
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_org, None)
        else:
            app.dependency_overrides[get_current_org] = previous


def makine(machine_id: str = "TORNA_01") -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status="running",
        updated_at_ms=int(time.time() * 1000),
    )


# ----------------------------------------------------------------- lisans


class TestLisansUcu:
    def test_lisanssiz_kurulum(self, client):
        assert client.get("/api/runtime/license").json()["status"] == "missing"

    def test_lisanssiz_kurulum_saglikli_degil(self, client):
        assert client.get("/api/runtime/license").json()["healthy"] is False

    def test_lisanssiz_kurulumda_neden_yazilir(self, client):
        assert client.get("/api/runtime/license").json()["reason"]

    def test_deneme_acilir(self, client):
        sonuc = client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        assert sonuc.json()["created"] is True

    def test_deneme_on_dort_gun(self, client):
        sonuc = client.post("/api/runtime/license/trial", json={"customer": "Pilot"}).json()
        lisans = sonuc["license"]
        assert lisans["expires_at_ms"] - lisans["starts_at_ms"] == 14 * DAY_MS

    def test_ikinci_deneme_acilmaz(self, client):
        # Ucretli bir lisansi denemeye dusurmek, satin alinan sinirlari geri
        # almak olurdu.
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        sonuc = client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        assert sonuc.json()["created"] is False

    def test_ikinci_denemede_neden_yazilir(self, client):
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        sonuc = client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        assert "zaten" in sonuc.json()["reason"]

    def test_lisans_uretilir(self, client):
        sonuc = client.post(
            "/api/runtime/license",
            json={"tier": "growth", "days": 365, "customer": "Pilot A.Ş."},
        )
        assert sonuc.json()["tier"] == "growth"

    def test_uretilen_lisansin_sinirlari(self, client):
        sonuc = client.post(
            "/api/runtime/license", json={"tier": "growth", "days": 365}
        ).json()
        assert sonuc["limits"]["machines"] == 150

    def test_kurumsal_sinirsiz(self, client):
        sonuc = client.post(
            "/api/runtime/license", json={"tier": "enterprise", "days": 365}
        ).json()
        assert sonuc["limits"]["machines"] is None

    def test_anahtar_yanitta_donmez(self, client):
        sonuc = client.post(
            "/api/runtime/license",
            json={"tier": "starter", "days": 30, "license_key": "gizli-anahtar"},
        ).json()
        assert "gizli-anahtar" not in str(sonuc)

    def test_sifir_gun_reddedilir(self, client):
        sonuc = client.post("/api/runtime/license", json={"tier": "starter", "days": 0})
        assert sonuc.status_code == 422

    def test_taninmayan_plan_reddedilir(self, client):
        sonuc = client.post("/api/runtime/license", json={"tier": "sinirsiz", "days": 30})
        assert sonuc.status_code == 422

    def test_lisans_iptal_edilir(self, client):
        client.post("/api/runtime/license", json={"tier": "starter", "days": 30})
        sonuc = client.post(
            "/api/runtime/license/revoke", json={"reason": "Ödeme alınmadı"}
        )
        assert sonuc.json()["status"] == "revoked"

    def test_lisanssiz_kurulumda_iptal_404(self, client):
        sonuc = client.post("/api/runtime/license/revoke", json={"reason": "x"})
        assert sonuc.status_code == 404

    def test_iptalden_sonra_saglikli_degil(self, client):
        client.post("/api/runtime/license", json={"tier": "starter", "days": 30})
        client.post("/api/runtime/license/revoke", json={"reason": "Ödeme alınmadı"})
        assert client.get("/api/runtime/license").json()["healthy"] is False

    def test_kullanici_sayisi_olculmez(self, client):
        # Kimlik deposu ayri bir bilesendir; sayi uydurulmaz.
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        assert client.get("/api/runtime/license").json()["usage"]["users"] is None

    def test_makine_sayisi_olculur(self, client, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = makine()
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        assert client.get("/api/runtime/license").json()["usage"]["machines"] == 1

    def test_baska_kiracinin_lisansi_gorunmez(self, client):
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        with as_org(ORG_B):
            assert client.get("/api/runtime/license").json()["status"] == "missing"


# ---------------------------------------------------------- kurulum tokeni


class TestKurulumTokeni:
    def test_bos_sistemde_token_yok(self, client):
        assert client.get("/api/runtime/install-tokens").json()["count"] == 0

    def test_token_uretilir(self, client):
        sonuc = client.post("/api/runtime/install-tokens", json={"site": "Hat 1"})
        assert sonuc.json()["status"] == "active"

    def test_uretim_yanitinda_token_metni_var(self, client):
        sonuc = client.post("/api/runtime/install-tokens", json={"site": "Hat 1"}).json()
        assert len(sonuc["token"]) > 20

    def test_uretim_yaniti_uyari_tasir(self, client):
        sonuc = client.post("/api/runtime/install-tokens", json={"site": "Hat 1"}).json()
        assert "bir kez" in sonuc["note"]

    def test_listelemede_token_metni_yok(self, client):
        # Token metni yalnizca uretildigi anda gorulur.
        uretilen = client.post("/api/runtime/install-tokens", json={"site": "Hat 1"}).json()
        liste = client.get("/api/runtime/install-tokens").json()
        assert uretilen["token"] not in str(liste)

    def test_listelemede_yalnizca_ozet_on_eki(self, client):
        client.post("/api/runtime/install-tokens", json={"site": "Hat 1"})
        liste = client.get("/api/runtime/install-tokens").json()
        assert len(liste["tokens"][0]["digest_prefix"]) == 8

    def test_tesis_saklanir(self, client):
        sonuc = client.post("/api/runtime/install-tokens", json={"site": "Hat 1"}).json()
        assert sonuc["site"] == "Hat 1"

    def test_omur_uygulanir(self, client):
        sonuc = client.post(
            "/api/runtime/install-tokens", json={"site": "Hat 1", "ttl_hours": 6}
        ).json()
        assert sonuc["expires_at_ms"] - sonuc["created_at_ms"] == 6 * 3_600_000

    def test_sifir_omur_reddedilir(self, client):
        sonuc = client.post("/api/runtime/install-tokens", json={"ttl_hours": 0})
        assert sonuc.status_code == 422

    def test_token_kullanilir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        sonuc = client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "saha"},
        )
        assert sonuc.json()["ok"] is True

    def test_kullanim_sonrasi_kapanir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "saha"},
        )
        liste = client.get("/api/runtime/install-tokens").json()
        assert liste["tokens"][0]["status"] == "used"

    def test_ikinci_kullanim_reddedilir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "saha"},
        )
        sonuc = client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "saha"},
        )
        assert sonuc.json()["ok"] is False

    def test_yanlis_token_reddedilir(self, client):
        sonuc = client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": "yanlis-token-metni", "actor": "saha"},
        )
        assert sonuc.json()["ok"] is False

    def test_basarisiz_kullanim_da_200_doner(self, client):
        # "Sunucu isteği işleyemedi" ile "token gecersiz" ayri seylerdir.
        sonuc = client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": "yanlis-token-metni", "actor": "saha"},
        )
        assert sonuc.status_code == 200

    def test_kullanan_kisi_kaydedilir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "ayse"},
        )
        liste = client.get("/api/runtime/install-tokens").json()
        assert liste["tokens"][0]["used_by"] == "ayse"

    def test_kullanim_gunluge_yazilir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "ayse"},
        )
        liste = client.get("/api/runtime/install-tokens").json()
        assert liste["tokens"][0]["usage_log"][0]["action"] == "redeem"

    def test_token_iptal_edilir(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        sonuc = client.post(
            "/api/runtime/install-tokens/revoke",
            json={"token_id": uretilen["id"], "reason": "yanlış kişi"},
        )
        assert sonuc.json()["revoked"] is True

    def test_kullanilmis_token_iptal_edilmez(self, client):
        uretilen = client.post("/api/runtime/install-tokens", json={}).json()
        client.post(
            "/api/runtime/install-tokens/redeem",
            json={"token": uretilen["token"], "actor": "saha"},
        )
        sonuc = client.post(
            "/api/runtime/install-tokens/revoke",
            json={"token_id": uretilen["id"], "reason": "gerek yok"},
        )
        assert sonuc.json()["revoked"] is False

    def test_olmayan_token_iptali_404(self, client):
        sonuc = client.post(
            "/api/runtime/install-tokens/revoke",
            json={"token_id": "yok", "reason": "x"},
        )
        assert sonuc.status_code == 404

    def test_baska_kiracinin_tokeni_gorunmez(self, client):
        client.post("/api/runtime/install-tokens", json={})
        with as_org(ORG_B):
            assert client.get("/api/runtime/install-tokens").json()["count"] == 0


# -------------------------------------------------------- makine etiketleri


class TestMakineEtiketleri:
    def test_bos_sistemde_etiket_yok(self, client):
        assert client.get("/api/runtime/machine-labels").json()["labels"] == []

    def test_etiket_kaydedilir(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        )
        assert sonuc.json()["label"] == "FREZE-01"

    def test_qr_uretilir(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        ).json()
        assert sonuc["qr"].endswith("FREZE-01")

    def test_qr_adres_tasimaz(self, client):
        # Sunucu adresi degistiginde etiketlerin yeniden basilmasi gerekmemeli.
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        ).json()
        assert "http" not in sonuc["qr"]

    def test_bicimsiz_etiket_normallesir(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_2", "label": "freze 2"},
        )
        assert sonuc.json()["label"] == "FREZE-02"

    def test_cevrilemeyen_etiket_400(self, client):
        # Uydurulmus bir etiket, sahada yanlis makineye yapistirilan kagittir.
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_2", "label": "hat bir"},
        )
        assert sonuc.status_code == 400

    def test_cevrilemeyen_etikette_beklenen_bicim_yazilir(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_2", "label": "hat bir"},
        )
        assert "FREZE-02" in sonuc.json()["detail"]

    def test_basilmamis_etiketin_ani_null(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        ).json()
        assert sonuc["printed_at_ms"] is None

    def test_basim_isaretlenir(self, client):
        client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        )
        sonuc = client.post(
            "/api/runtime/machine-labels/printed", json={"labels": ["FREZE-01"]}
        )
        assert sonuc.json()["marked"] == 1

    def test_olmayan_etiket_isaretlenmez(self, client):
        sonuc = client.post(
            "/api/runtime/machine-labels/printed", json={"labels": ["YOK-01"]}
        )
        assert sonuc.json()["marked"] == 0

    def test_cakisan_etiket_bildirilir(self, client):
        client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_1", "label": "FREZE-01"},
        )
        client.post(
            "/api/runtime/machine-labels",
            json={"machine_id": "freze_2", "label": "FREZE-01"},
        )
        assert client.get("/api/runtime/machine-labels").json()["duplicates"] == [
            "FREZE-01"
        ]

    def test_etiketsiz_makine_bildirilir(self, client, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = makine()
        assert client.get("/api/runtime/machine-labels").json()["unlabeled"] == [
            "TORNA_01"
        ]

    def test_etiketsiz_makineye_oneri(self, client, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = makine()
        oneriler = client.get("/api/runtime/machine-labels").json()["suggestions"]
        assert oneriler["TORNA_01"] == "TORNA-01"


# ------------------------------------------------------------ saha tanilama


class TestSahaTanilama:
    def test_yedi_satir(self, client):
        assert client.get("/api/runtime/field-diagnostics").json()["line_count"] == 7

    def test_bos_kurulumda_hicbiri_olculmemis(self, client):
        assert client.get("/api/runtime/field-diagnostics").json()["measured_count"] == 0

    def test_bos_kurulumda_durum_bilinmiyor(self, client):
        assert client.get("/api/runtime/field-diagnostics").json()["state"] == "unknown"

    def test_olculmeyen_satir_null(self, client):
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        assert all(satir["value"] is None for satir in satirlar)

    def test_olculmeyen_satir_neden_tasir(self, client):
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        assert all(satir["reason"] for satir in satirlar if not satir["measured"])

    def test_saat_sapmasi_olculmez(self, client):
        # OPC UA sunucu saati her sunucuda yok; uydurmak yerine `null`.
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        saat = next(satir for satir in satirlar if satir["id"] == "clock")
        assert saat["value"] is None


# --------------------------------------------------------- kontrol listesi


class TestKontrolListesiUcu:
    def test_on_adim(self, client):
        assert client.post("/api/runtime/deployment-checklist", json={}).json()["total"] == 10

    def test_bos_kurulum_hazir_degil(self, client):
        assert client.post("/api/runtime/deployment-checklist", json={}).json()["ready"] is False

    def test_sunucu_adimi_tamam(self, client):
        # Bu yanit sunucudan geliyorsa sunucu ayakta demektir.
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        sunucu = next(adim for adim in sonuc["steps"] if adim["id"] == "server")
        assert sunucu["state"] == "done"

    def test_bellek_modunda_veritabani_bekliyor(self, client):
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        veritabani = next(adim for adim in sonuc["steps"] if adim["id"] == "database")
        assert veritabani["state"] == "pending"

    def test_lisanssiz_kurulumda_lisans_bekliyor(self, client):
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        lisans = next(adim for adim in sonuc["steps"] if adim["id"] == "license")
        assert lisans["state"] == "pending"

    def test_lisans_acilinca_adim_tamam(self, client):
        client.post("/api/runtime/license/trial", json={"customer": "Pilot"})
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        lisans = next(adim for adim in sonuc["steps"] if adim["id"] == "license")
        assert lisans["state"] == "done"

    def test_verilmeyen_olcum_olculemedi(self, client):
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        imza = next(adim for adim in sonuc["steps"] if adim["id"] == "signature")
        assert imza["state"] == "unknown"

    def test_verilen_olcum_uygulanir(self, client):
        sonuc = client.post(
            "/api/runtime/deployment-checklist",
            json={"signature_recorded": True},
        ).json()
        imza = next(adim for adim in sonuc["steps"] if adim["id"] == "signature")
        assert imza["state"] == "done"

    def test_eksik_esleme_bekliyor(self, client):
        sonuc = client.post(
            "/api/runtime/deployment-checklist",
            json={"mapped_tags": 5, "unmapped_tags": 2},
        ).json()
        esleme = next(adim for adim in sonuc["steps"] if adim["id"] == "mapping")
        assert esleme["state"] == "pending"

    def test_ozet_cumlesi(self, client):
        assert client.post("/api/runtime/deployment-checklist", json={}).json()["summary"]

    def test_her_adimin_nedeni_var(self, client):
        sonuc = client.post("/api/runtime/deployment-checklist", json={}).json()
        assert all(adim["reason"] for adim in sonuc["steps"])


# ----------------------------------------------------------- disa aktarma


class TestDisaAktarma:
    def test_telemetri_aktarilir(self, client):
        assert client.get("/api/runtime/export/telemetry").status_code == 200

    def test_bos_aktarimda_baslik_var(self, client):
        sonuc = client.get("/api/runtime/export/telemetry").json()
        assert "zaman_ms" in sonuc["content"]

    def test_bos_aktarimda_satir_yok(self, client):
        assert client.get("/api/runtime/export/telemetry").json()["row_count"] == 0

    def test_alarm_aktarilir(self, client):
        assert client.get("/api/runtime/export/alarms").json()["source"] == "alarms"

    def test_oee_aktarilir(self, client):
        assert client.get("/api/runtime/export/oee").json()["source"] == "oee"

    def test_taninmayan_tur_400(self, client):
        # Varsayilana dusmek, kullanicinin alarm istedigi yerde telemetri
        # indirmesi olurdu.
        assert client.get("/api/runtime/export/her-sey").status_code == 400

    def test_taninmayan_turde_gecerliler_yazilir(self, client):
        sonuc = client.get("/api/runtime/export/her-sey")
        assert "telemetry" in sonuc.json()["detail"]

    def test_bayt_sayisi_bildirilir(self, client):
        assert client.get("/api/runtime/export/telemetry").json()["bytes"] > 0


# ------------------------------------------------------- pilot calisma alani


class TestPilotCalismaAlani:
    def test_okunur(self, client):
        assert client.get("/api/runtime/pilot-workspace").status_code == 200

    def test_kaynak_runtime(self, client):
        # Bu uc yalnizca gercek kayitlari okur; benzetim karismaz.
        assert client.get("/api/runtime/pilot-workspace").json()["origin"] == "runtime"

    def test_bos_kurulumda_baglanti_yok(self, client):
        assert client.get("/api/runtime/pilot-workspace").json()["connections"] == []

    def test_lisans_gorunumu_icerir(self, client):
        assert "status" in client.get("/api/runtime/pilot-workspace").json()["license"]

    def test_alarm_merkezi_icerir(self, client):
        assert "counts" in client.get("/api/runtime/pilot-workspace").json()["alarms"]

    def test_kalicilik_modu_bildirilir(self, client):
        sonuc = client.get("/api/runtime/pilot-workspace").json()
        assert sonuc["persistence_mode"] in {"memory", "database"}

    def test_makine_listesi_gercek_goruntuden(self, client, manager):
        manager.devices.snapshots_by_machine["TORNA_01"] = makine()
        sonuc = client.get("/api/runtime/pilot-workspace").json()
        assert len(sonuc["machines"]) == 1

    def test_etiket_denetimi_icerir(self, client):
        assert "unlabeled" in client.get("/api/runtime/pilot-workspace").json()["labels"]

    def test_an_bildirilir(self, client):
        assert client.get("/api/runtime/pilot-workspace").json()["at_ms"] > 0


class TestSahaTanilamaGercekBaglantiyla:
    """Kayitli baglantilarla saha tanilamasi.

    Bos bir yoneticiyle yapilan testler bu yolu hic yurutmuyordu: `health`
    uzerindeki `avg_latency_ms` bir **yontemdir**, alan degil, ve cagrilmadan
    kullanildiginda karsilastirma iki yontem nesnesi arasinda yapiliyordu.
    Tarayicida gercek baglantilarla 500 donerek goruldu.
    """

    def _connected(self, manager, kind: str = "opcua", latency: float = 12.5):
        from simulation_engine.runtime.types import (
            ConnectionKind,
            ConnectionSpec,
            ProbeResult,
        )

        spec = ConnectionSpec(
            connection_id=f"{kind}-1",
            kind=ConnectionKind(kind),
            label=kind,
            endpoint=f"{kind}://10.0.0.5",
        )
        manager.register(ORG_A, spec)
        state = manager.state_of(ORG_A, spec.connection_id)
        state.apply_probe(
            ProbeResult(ok=True, latency_ms=latency, detail="ok", evidence="okundu")
        )
        return state

    def test_baglanti_varken_uc_calisir(self, client, manager):
        self._connected(manager)
        assert client.get("/api/runtime/field-diagnostics").status_code == 200

    def test_gecikme_olculur(self, client, manager):
        self._connected(manager, latency=12.5)
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        ping = next(satir for satir in satirlar if satir["id"] == "ping")
        assert ping["value"] == 12.5

    def test_opcua_gecikmesi_olculur(self, client, manager):
        self._connected(manager, kind="opcua", latency=25.0)
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        opcua = next(satir for satir in satirlar if satir["id"] == "opcua")
        assert opcua["value"] == 25.0

    def test_denenmemis_protokol_bilinmiyor_kalir(self, client, manager):
        # Denenmemis bir protokolu "basarisiz" gostermek, muhendisi olmayan bir
        # arizanin pesine dusururdu.
        self._connected(manager, kind="opcua")
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        mqtt = next(satir for satir in satirlar if satir["id"] == "mqtt")
        assert mqtt["state"] == "unknown"

    def test_baglanan_protokol_normal(self, client, manager):
        self._connected(manager, kind="mqtt")
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        mqtt = next(satir for satir in satirlar if satir["id"] == "mqtt")
        assert mqtt["state"] == "ok"

    def test_paket_sayaci_okunur(self, client, manager):
        self._connected(manager)
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        kayip = next(satir for satir in satirlar if satir["id"] == "loss")
        assert kayip["measured"] is True

    def test_uc_adresi_bildirilir(self, client, manager):
        self._connected(manager)
        assert client.get("/api/runtime/field-diagnostics").json()["endpoint"] != ""

    def test_en_dusuk_gecikme_ping_sayilir(self, client, manager):
        # Ping ayri bir olcum degildir: baglantilarin en dusuk gecikmesi agin
        # gecikmesine en yakin degerdir.
        self._connected(manager, kind="opcua", latency=40.0)
        self._connected(manager, kind="rest", latency=8.0)
        satirlar = client.get("/api/runtime/field-diagnostics").json()["lines"]
        ping = next(satir for satir in satirlar if satir["id"] == "ping")
        assert ping["value"] == 8.0

    def test_pilot_calisma_alani_baglantiyi_gosterir(self, client, manager):
        self._connected(manager)
        sonuc = client.get("/api/runtime/pilot-workspace").json()
        assert len(sonuc["connections"]) == 1
