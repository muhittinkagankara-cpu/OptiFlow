# -*- coding: utf-8 -*-
"""Kurulum tokeni, makine etiketleri ve kurulum kontrol listesi testleri.

Uc kural savunulur:

1. **Token tek kullanimliktir ve metni saklanmaz.** Veritabani yedegini ele
   geciren biri, orada yazan degerle kurulum yapamaz.
2. **Etiket uydurulmaz.** Cevrilemeyen bir metinden etiket uretilseydi, sahada
   yanlis makineye yapistirilan bir kagit olurdu.
3. **Kontrol listesi elle isaretlenmez.** Olculemeyen bir adim "bekliyor"
   sayilmaz; ikisi farkli iki kisiyi ilgilendirir.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.commissioning import (
    DEFAULT_TTL_HOURS,
    HOUR_MS,
    ChecklistStep,
    DeploymentInput,
    MAX_TTL_HOURS,
    MachineLabel,
    QR_SCHEME,
    STEP_STATE_LABEL,
    StepState,
    TOKEN_STATUS_LABEL,
    TokenStatus,
    build_checklist,
    build_report,
    clamp_ttl_hours,
    describe,
    duplicate_labels,
    generate_token,
    is_valid_label,
    issue,
    normalize_label,
    note_step,
    parse_qr,
    qr_payload,
    redeem,
    revoke,
    suggest_label,
    token_digest,
    unlabeled_machines,
)

NOW = 1_700_000_000_000
ORG = "org-kurulum"


def token_kaydi(**kwargs):
    uretilen = issue(ORG, NOW, sequence=1, created_by="saha", site="Hat 1")
    for key, value in kwargs.items():
        setattr(uretilen.record, key, value)
    return uretilen


# ------------------------------------------------------------------ token


class TestTokenUretimi:
    def test_token_uretilir(self):
        assert len(generate_token()) > 20

    def test_iki_token_farkli(self):
        assert generate_token() != generate_token()

    def test_ozet_uretilir(self):
        assert len(token_digest("abc")) == 64

    def test_ayni_token_ayni_ozet(self):
        assert token_digest("abc") == token_digest("abc")

    def test_token_metni_kayitta_yok(self):
        # Yedegi ele geciren biri orada yazan degerle kurulum yapamamalidir.
        uretilen = token_kaydi()
        assert uretilen.token not in str(uretilen.record.to_dict(NOW))

    def test_sozlukte_yalnizca_ozet_on_eki(self):
        uretilen = token_kaydi()
        assert len(uretilen.record.to_dict(NOW)["digest_prefix"]) == 8

    def test_uretim_sonucunda_token_bir_kez_doner(self):
        uretilen = token_kaydi()
        assert uretilen.to_dict(NOW)["token"] == uretilen.token

    def test_uretim_sonucu_uyari_tasir(self):
        assert "bir kez" in token_kaydi().to_dict(NOW)["note"]

    def test_ureten_kisi_saklanir(self):
        assert token_kaydi().record.created_by == "saha"

    def test_tesis_saklanir(self):
        assert token_kaydi().record.site == "Hat 1"


class TestTokenOmru:
    def test_varsayilan_omur(self):
        assert clamp_ttl_hours(None) == DEFAULT_TTL_HOURS

    def test_sifir_omur_varsayilana_duser(self):
        # Uretildigi anda dolmus bir token kimseye yaramaz.
        assert clamp_ttl_hours(0) == DEFAULT_TTL_HOURS

    def test_negatif_omur_varsayilana_duser(self):
        assert clamp_ttl_hours(-4) == DEFAULT_TTL_HOURS

    def test_gecersiz_omur_varsayilana_duser(self):
        assert clamp_ttl_hours("iki gun") == DEFAULT_TTL_HOURS

    def test_ust_sinir(self):
        assert clamp_ttl_hours(10_000) == MAX_TTL_HOURS

    def test_gecerli_omur_korunur(self):
        assert clamp_ttl_hours(12) == 12

    def test_bitis_ani_hesaplanir(self):
        uretilen = issue(ORG, NOW, sequence=1, ttl_hours=6)
        assert uretilen.record.expires_at_ms == NOW + 6 * HOUR_MS


class TestTokenDurumu:
    def test_yeni_token_kullanilabilir(self):
        assert token_kaydi().record.status(NOW) is TokenStatus.ACTIVE

    def test_suresi_dolan_token(self):
        uretilen = token_kaydi()
        an = uretilen.record.expires_at_ms
        assert uretilen.record.status(an) is TokenStatus.EXPIRED

    def test_kullanilan_token(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        assert uretilen.record.status(NOW) is TokenStatus.USED

    def test_iptal_her_seyin_onunde(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        uretilen.record.revoked_at_ms = NOW
        assert uretilen.record.status(NOW) is TokenStatus.REVOKED

    def test_kullanim_sureden_once_gelir(self):
        # Kullanilmis bir tokenin suresi de dolmus olabilir; onemli olan
        # kullanildigidir.
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        an = uretilen.record.expires_at_ms + 1
        assert uretilen.record.status(an) is TokenStatus.USED

    def test_kullanilabilir_token_kalan_sure(self):
        uretilen = issue(ORG, NOW, sequence=1, ttl_hours=6)
        assert uretilen.record.remaining_ms(NOW) == 6 * HOUR_MS

    def test_kullanilmis_tokenin_kalan_suresi_none(self):
        # Sayi gostermek onu hâlâ kullanilabilir sanmaya yol acardi.
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        assert uretilen.record.remaining_ms(NOW) is None

    def test_her_durumun_etiketi(self):
        assert set(TOKEN_STATUS_LABEL) == set(TokenStatus)


class TestTokenKullanimi:
    def test_dogru_token_kabul_edilir(self):
        uretilen = token_kaydi()
        assert redeem(uretilen.record, uretilen.token, NOW, "saha")["ok"] is True

    def test_yanlis_token_reddedilir(self):
        uretilen = token_kaydi()
        assert redeem(uretilen.record, "yanlis", NOW, "saha")["ok"] is False

    def test_yanlis_tokenin_nedeni_yazilir(self):
        uretilen = token_kaydi()
        sonuc = redeem(uretilen.record, "yanlis", NOW, "saha")
        assert sonuc["reason"] == "Token eşleşmedi."

    def test_suresi_dolan_tokenin_nedeni_farkli(self):
        # "Gecersiz token" demek, iki farkli hatayi ayirt edilemez kilardi.
        uretilen = token_kaydi()
        an = uretilen.record.expires_at_ms
        sonuc = redeem(uretilen.record, uretilen.token, an, "saha")
        assert "süresi doldu" in sonuc["reason"]

    def test_ikinci_kullanim_reddedilir(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        assert redeem(uretilen.record, uretilen.token, NOW + 1, "saha")["ok"] is False

    def test_kullanan_kisi_saklanir(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "ayse")
        assert uretilen.record.used_by == "ayse"

    def test_kullanilan_adres_saklanir(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "ayse", used_from="10.0.0.7")
        assert uretilen.record.used_from == "10.0.0.7"

    def test_kullanim_gunluge_yazilir(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "ayse")
        assert uretilen.record.usage_log[0]["action"] == "redeem"

    def test_bilinmeyen_adres_none_kalir(self):
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "ayse")
        assert uretilen.record.used_from is None


class TestTokenIptali:
    def test_etkin_token_iptal_edilir(self):
        uretilen = token_kaydi()
        assert revoke(uretilen.record, NOW, "yanlış kişi", "yonetici") is True

    def test_kullanilmis_token_iptal_edilmez(self):
        # Kapatilmis bir kapiyi ikinci kez kapatmak kayitlari karistirirdi.
        uretilen = token_kaydi()
        redeem(uretilen.record, uretilen.token, NOW, "saha")
        assert revoke(uretilen.record, NOW + 1, "gerek yok", "yonetici") is False

    def test_iptal_nedeni_saklanir(self):
        uretilen = token_kaydi()
        revoke(uretilen.record, NOW, "yanlış kişi", "yonetici")
        assert uretilen.record.revoked_reason == "yanlış kişi"

    def test_iptal_gunluge_yazilir(self):
        uretilen = token_kaydi()
        revoke(uretilen.record, NOW, "yanlış kişi", "yonetici")
        assert uretilen.record.usage_log[-1]["action"] == "revoke"

    def test_iptalden_sonra_kullanilamaz(self):
        uretilen = token_kaydi()
        revoke(uretilen.record, NOW, "yanlış kişi", "yonetici")
        assert redeem(uretilen.record, uretilen.token, NOW + 1, "saha")["ok"] is False

    def test_adim_gunluge_eklenir(self):
        uretilen = token_kaydi()
        note_step(uretilen.record, NOW, "kesif", "saha")
        assert uretilen.record.usage_log[-1]["step"] == "kesif"

    def test_gunluk_yalnizca_buyur(self):
        uretilen = token_kaydi()
        note_step(uretilen.record, NOW, "kesif", "saha")
        note_step(uretilen.record, NOW + 1, "esleme", "saha")
        assert len(uretilen.record.usage_log) == 2


# ---------------------------------------------------------------- etiket


class TestEtiketBicimi:
    def test_gecerli_etiket(self):
        assert is_valid_label("FREZE-02") is True

    def test_kucuk_harf_gecersiz(self):
        assert is_valid_label("freze-02") is False

    def test_tiresiz_gecersiz(self):
        assert is_valid_label("FREZE02") is False

    def test_cok_uzun_harf_obegi_gecersiz(self):
        assert is_valid_label("COKUZUNAD-01") is False

    def test_bosluk_gecersiz(self):
        assert is_valid_label("FREZE 02") is False


class TestEtiketNormalizasyonu:
    def test_bosluklu_ad_cevrilir(self):
        assert normalize_label("freze 2") == "FREZE-02"

    def test_alt_cizgili_ad_cevrilir(self):
        assert normalize_label("torn_1") == "TORN-01"

    def test_numara_iki_basamaga_tamamlanir(self):
        # `FREZE-2` ile `FREZE-02` ayni makine olmalidir.
        assert normalize_label("FREZE-2") == normalize_label("FREZE-02")

    def test_uc_basamak_korunur(self):
        assert normalize_label("PRES-123") == "PRES-123"

    def test_turkce_harf_asciye_cevrilir(self):
        # Etiketler telsizle okunur ve farkli klavyelerde aranir.
        assert normalize_label("ölçüm 3") == "OLCUM-03"

    def test_cevrilemeyen_metin_none(self):
        # Uydurulmus bir etiket, sahada yanlis makineye yapistirilan kagittir.
        assert normalize_label("hat bir") is None

    def test_bos_metin_none(self):
        assert normalize_label("") is None

    def test_yalnizca_sayi_none(self):
        assert normalize_label("42") is None


class TestEtiketOnerisi:
    def test_dogrudan_cevrilebilen_kimlik(self):
        assert suggest_label("FREZE_02") == "FREZE-02"

    def test_karmasik_kimlikten_turetilir(self):
        assert suggest_label("freze_hat1_2") == "FREZE-02"

    def test_son_sayi_kullanilir(self):
        assert suggest_label("torna_hat3_07") == "TORNA-07"

    def test_sayisiz_kimlik_none(self):
        assert suggest_label("freze") is None

    def test_harfsiz_kimlik_none(self):
        assert suggest_label("123") is None


class TestQr:
    def test_qr_kimlik_tasir(self):
        assert qr_payload(ORG, "FREZE-02") == f"{QR_SCHEME}/{ORG}/FREZE-02"

    def test_qr_cozulur(self):
        cozulen = parse_qr(qr_payload(ORG, "FREZE-02"))
        assert cozulen == {"org_id": ORG, "label": "FREZE-02"}

    def test_taninmayan_qr_none(self):
        # Yanlis cozulen bir QR, teknisyeni baska bir makinenin ekranina
        # gotururdu.
        assert parse_qr("https://baska/qr") is None

    def test_eksik_parcali_qr_none(self):
        assert parse_qr(f"{QR_SCHEME}/{ORG}") is None

    def test_gecersiz_etiketli_qr_none(self):
        assert parse_qr(f"{QR_SCHEME}/{ORG}/freze02") is None

    def test_etiket_qr_uretir(self):
        etiket = MachineLabel(org_id=ORG, machine_id="freze_1", label="FREZE-01")
        assert etiket.qr.endswith("FREZE-01")

    def test_basilmamis_etiketin_ani_none(self):
        etiket = MachineLabel(org_id=ORG, machine_id="freze_1", label="FREZE-01")
        assert etiket.to_dict()["printed_at_ms"] is None


class TestEtiketDenetimi:
    def _etiket(self, machine_id: str, label: str) -> MachineLabel:
        return MachineLabel(org_id=ORG, machine_id=machine_id, label=label)

    def test_cakisma_bulunur(self):
        # Iki makineye ayni etiket yapistirilirsa, ariza kaydi hangi makineye
        # ait oldugu bilinemeden kapatilir.
        etiketler = [self._etiket("a", "FREZE-01"), self._etiket("b", "FREZE-01")]
        assert duplicate_labels(etiketler) == ["FREZE-01"]

    def test_cakisma_yoksa_bos(self):
        etiketler = [self._etiket("a", "FREZE-01"), self._etiket("b", "FREZE-02")]
        assert duplicate_labels(etiketler) == []

    def test_etiketsiz_makineler_bulunur(self):
        etiketler = [self._etiket("a", "FREZE-01")]
        assert unlabeled_machines(["a", "b"], etiketler) == ["b"]

    def test_hepsi_etiketliyse_bos(self):
        etiketler = [self._etiket("a", "FREZE-01")]
        assert unlabeled_machines(["a"], etiketler) == []


# ------------------------------------------------------- kontrol listesi


def tam_kurulum(**kwargs) -> DeploymentInput:
    base = dict(
        server_up=True,
        database_ready=True,
        license_active=True,
        discovered_tags=12,
        mapped_tags=12,
        unmapped_tags=0,
        telemetry_rows=1200,
        alarms_raised=3,
        oee=0.72,
        backup_verified=True,
        signature_recorded=True,
    )
    base.update(kwargs)
    return DeploymentInput(**base)


class TestKontrolListesi:
    def test_on_adim(self):
        assert len(build_checklist(tam_kurulum())) == 10

    def test_her_durumun_etiketi(self):
        assert set(STEP_STATE_LABEL) == set(StepState)

    def test_tam_kurulum_hazir(self):
        assert build_report(tam_kurulum()).ready is True

    def test_bos_girdide_hicbir_sey_hazir_degil(self):
        rapor = build_report(DeploymentInput())
        assert rapor.ready is False

    def test_bos_girdide_adimlar_olculemedi(self):
        rapor = build_report(DeploymentInput())
        # OEE hesaplanamamasi "bekliyor"dur, "olculemedi" degil: eksik olan
        # olcum degil, kullanicinin girmesi gereken bir bilgidir.
        assert (rapor.unknown, rapor.pending) == (9, 1)

    def test_olculemeyen_adim_hazir_saymaz(self):
        # Bilinmeyen bir adimi gecmis saymak, listenin tamamini guvenilmez
        # kilardi.
        rapor = build_report(tam_kurulum(server_up=None))
        assert rapor.ready is False

    def test_her_adimin_nedeni_var(self):
        adimlar = build_checklist(DeploymentInput())
        assert all(adim.reason for adim in adimlar)

    def test_bekleyen_adimda_yapilacak_is_yazilir(self):
        adimlar = build_checklist(tam_kurulum(backup_verified=False))
        yedek = next(adim for adim in adimlar if adim.id == "backup")
        assert yedek.action is not None

    def test_tamam_adiminda_yapilacak_is_yok(self):
        adimlar = build_checklist(tam_kurulum())
        assert all(adim.action is None for adim in adimlar)

    def test_bellek_modu_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(database_ready=False))
        veritabani = next(adim for adim in adimlar if adim.id == "database")
        assert veritabani.state is StepState.PENDING

    def test_bellek_modunda_kayip_uyarilir(self):
        adimlar = build_checklist(tam_kurulum(database_ready=False))
        veritabani = next(adim for adim in adimlar if adim.id == "database")
        assert "kaybolur" in veritabani.reason

    def test_eksik_esleme_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(unmapped_tags=3))
        esleme = next(adim for adim in adimlar if adim.id == "mapping")
        assert esleme.state is StepState.PENDING

    def test_eksik_eslemede_sayi_yazilir(self):
        adimlar = build_checklist(tam_kurulum(unmapped_tags=3))
        esleme = next(adim for adim in adimlar if adim.id == "mapping")
        assert "3 etiket" in esleme.reason

    def test_hic_esleme_yoksa_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(mapped_tags=0, unmapped_tags=0))
        esleme = next(adim for adim in adimlar if adim.id == "mapping")
        assert esleme.state is StepState.PENDING

    def test_veri_gelmediyse_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(telemetry_rows=0))
        veri = next(adim for adim in adimlar if adim.id == "first_data")
        assert veri.state is StepState.PENDING

    def test_alarm_tetiklenmediyse_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(alarms_raised=0))
        alarm = next(adim for adim in adimlar if adim.id == "alarm_test")
        assert alarm.state is StepState.PENDING

    def test_alarm_tetiklenmediginde_dogrulanmadi_denir(self):
        adimlar = build_checklist(tam_kurulum(alarms_raised=0))
        alarm = next(adim for adim in adimlar if adim.id == "alarm_test")
        assert "doğrulanmadı" in alarm.reason

    def test_oee_hesaplanmadiysa_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(oee=None))
        oee = next(adim for adim in adimlar if adim.id == "oee")
        assert oee.state is StepState.PENDING

    def test_oee_yuzde_yazilir(self):
        adimlar = build_checklist(tam_kurulum(oee=0.72))
        oee = next(adim for adim in adimlar if adim.id == "oee")
        assert "%72" in oee.reason

    def test_imza_son_adim(self):
        assert build_checklist(tam_kurulum())[-1].id == "signature"

    def test_imzasiz_kurulum_hazir_degil(self):
        assert build_report(tam_kurulum(signature_recorded=False)).ready is False

    def test_kesif_bulunamadiysa_bekliyor(self):
        adimlar = build_checklist(tam_kurulum(discovered_tags=0))
        kesif = next(adim for adim in adimlar if adim.id == "discovery")
        assert kesif.state is StepState.PENDING


class TestKontrolOzeti:
    def test_tam_kurulum_ozeti(self):
        assert "tamamlandı" in describe(build_report(tam_kurulum()))

    def test_eksik_kurulum_sayilari_yazar(self):
        ozet = describe(build_report(tam_kurulum(backup_verified=False)))
        assert "9/10 adım tamam" in ozet

    def test_olculemeyen_adim_ozette(self):
        ozet = describe(build_report(tam_kurulum(server_up=None)))
        assert "ölçülemedi" in ozet

    def test_bos_liste_ozeti(self):
        from simulation_engine.runtime.commissioning.checklist import DeploymentReport

        assert describe(DeploymentReport()) == "Kontrol listesi okunamadı."

    def test_oran_hesaplanir(self):
        assert build_report(tam_kurulum()).ratio == 1.0

    def test_bos_listede_oran_none(self):
        from simulation_engine.runtime.commissioning.checklist import DeploymentReport

        assert DeploymentReport().ratio is None

    def test_sozluk_alanlari(self):
        payload = build_report(tam_kurulum()).to_dict()
        assert set(payload) == {
            "steps",
            "done",
            "pending",
            "unknown",
            "total",
            "ready",
            "ratio",
        }


class TestOlculemeyenAdimYonlendirmesi:
    """Olculemeyen adim, olcumun **nerede** uretildigini soyler.

    Tarayicida goruldu: kesif ve esleme adimlari "Sunucuya erisimi dogrulayin"
    diyordu — oysa sunucuya erisiliyordu ve eksik olan, o ekranin vermedigi
    bir olcumdu. Yanlis yonlendiren bir mesaj, kullaniciyi olmayan bir sorunun
    pesine dusururdu.
    """

    def _adim(self, adim_id: str, **kwargs):
        adimlar = build_checklist(DeploymentInput(**kwargs))
        return next(adim for adim in adimlar if adim.id == adim_id)

    def test_kesif_sihirbaza_yonlendirir(self):
        assert "sihirbaz" in self._adim("discovery").action

    def test_esleme_sihirbaza_yonlendirir(self):
        assert "sihirbaz" in self._adim("mapping").action

    def test_yedek_operasyon_ekranina_yonlendirir(self):
        assert "Operasyon" in self._adim("backup").action

    def test_imza_kabul_raporuna_yonlendirir(self):
        assert "kabul raporu" in self._adim("signature").action

    def test_sunucu_olcumu_sunucuya_yonlendirir(self):
        # Telemetri sayaci gercekten sunucudan okunur; erisim sorunu olabilir.
        assert "Sunucuya" in self._adim("first_data").action

    def test_olculemeyen_adim_verilmedigini_soyler(self):
        # "Okunamadi" demek, bir ariza ima ederdi.
        assert "verilmedi" in self._adim("discovery").reason

    def test_bekleyen_adim_farkli_yonlendirir(self):
        # Bekleyen yedek adiminda is yapilacak; olculemeyen adimda olcum
        # verilecek. Ikisi ayni cumle olamaz.
        bekleyen = self._adim("backup", backup_verified=False)
        olculemeyen = self._adim("backup")
        assert bekleyen.action != olculemeyen.action
