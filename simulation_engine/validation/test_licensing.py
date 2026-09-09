# -*- coding: utf-8 -*-
"""Lisans dogrulamasinin testleri.

Bu dosyanin savundugu iki kural:

1. **Suresi dolmus lisans izlemeyi kesmez.** Engellenen sey buyumedir: yeni
   kullanici, yeni makine, yeni fabrika. Uretim hattini izleyen bir ekranin
   ticari bir nedenle kararmasi, gercek bir arizayi gorunmez kilardi.
2. **Olculemeyen sinir "asilmadi" sayilmaz.** Kullanim sayilamadiginda yanit
   `None`'dir; `False` donseydi, sayac bozuldugunda sinirsiz kayit acilirdi.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.licensing import (
    BLOCKED_WHEN_EXPIRED,
    DAY_MS,
    DEFAULT_LIMITS,
    EXPIRY_WARNING_DAYS,
    LICENSE_STATUS_LABEL,
    LICENSE_TIER_LABEL,
    License,
    LicenseLimits,
    LicenseStatus,
    LicenseTier,
    TRIAL_DAYS,
    UsageCounts,
    can_add,
    check_limit,
    check_limits,
    evaluate,
    issue_license,
    key_digest,
    limits_for,
    matches_key,
    trial_license,
)

NOW = 1_700_000_000_000
ORG = "org-lisans"


def lisans(**kwargs) -> License:
    base = dict(
        org_id=ORG,
        tier=LicenseTier.GROWTH,
        starts_at_ms=NOW - DAY_MS,
        expires_at_ms=NOW + 30 * DAY_MS,
        customer="Pilot Fabrika A.Ş.",
        limits=limits_for(LicenseTier.GROWTH),
        issued_at_ms=NOW - DAY_MS,
    )
    base.update(kwargs)
    return License(**base)


class TestPlanlar:
    def test_dort_plan(self):
        assert len(list(LicenseTier)) == 4

    def test_her_planin_etiketi(self):
        assert set(LICENSE_TIER_LABEL) == set(LicenseTier)

    def test_etiketler_turkce(self):
        assert LICENSE_TIER_LABEL[LicenseTier.ENTERPRISE] == "Kurumsal"

    def test_her_planin_siniri_var(self):
        assert set(DEFAULT_LIMITS) == set(LicenseTier)

    def test_kurumsal_sinirsiz(self):
        # `None` sinirsiz demektir; 999999 yazilsaydi arayuz anlamsiz bir
        # doluluk gosterirdi.
        limits = limits_for(LicenseTier.ENTERPRISE)
        assert (limits.users, limits.machines, limits.factories) == (None, None, None)

    def test_deneme_starter_ile_ayni(self):
        # Musteri deneme sirasinda gercek kurulumunu kurabilmelidir.
        assert limits_for(LicenseTier.TRIAL) == limits_for(LicenseTier.STARTER)

    def test_buyume_starter_dan_genis(self):
        assert limits_for(LicenseTier.GROWTH).machines > limits_for(
            LicenseTier.STARTER
        ).machines


class TestDurum:
    def test_etkin_lisans(self):
        assert lisans().status(NOW) is LicenseStatus.ACTIVE

    def test_bitisi_yaklasan_lisans(self):
        yakin = lisans(expires_at_ms=NOW + EXPIRY_WARNING_DAYS * DAY_MS)
        assert yakin.status(NOW) is LicenseStatus.EXPIRING

    def test_esigin_bir_ustunde_etkin(self):
        yakin = lisans(expires_at_ms=NOW + EXPIRY_WARNING_DAYS * DAY_MS + 1)
        assert yakin.status(NOW) is LicenseStatus.ACTIVE

    def test_suresi_dolmus(self):
        assert lisans(expires_at_ms=NOW).status(NOW) is LicenseStatus.EXPIRED

    def test_baslamamis(self):
        assert lisans(starts_at_ms=NOW + 1).status(NOW) is LicenseStatus.PENDING

    def test_iptal_her_seyin_onunde(self):
        # Iptal edilmis ama suresi dolmamis bir lisans "etkin" gorunseydi,
        # iptalin bir anlami kalmazdi.
        iptal = lisans(revoked_at_ms=NOW - 1)
        assert iptal.status(NOW) is LicenseStatus.REVOKED

    def test_iptal_suresi_dolmusun_de_onunde(self):
        iptal = lisans(expires_at_ms=NOW - 1, revoked_at_ms=NOW - 2)
        assert iptal.status(NOW) is LicenseStatus.REVOKED

    def test_her_durumun_etiketi(self):
        assert set(LICENSE_STATUS_LABEL) == set(LicenseStatus)


class TestKalanSure:
    def test_kalan_sure_hesaplanir(self):
        assert lisans(expires_at_ms=NOW + 5 * DAY_MS).remaining_ms(NOW) == 5 * DAY_MS

    def test_kalan_gun(self):
        assert lisans(expires_at_ms=NOW + 5 * DAY_MS).remaining_days(NOW) == 5

    def test_suresi_dolmusta_kalan_none(self):
        # "Eksi uc gun kaldi" okunmaz bir degerdir; sure bittiyse kalan yoktur.
        assert lisans(expires_at_ms=NOW - 1).remaining_ms(NOW) is None

    def test_iptalde_kalan_none(self):
        assert lisans(revoked_at_ms=NOW).remaining_ms(NOW) is None

    def test_kalan_gun_none(self):
        assert lisans(expires_at_ms=NOW - 1).remaining_days(NOW) is None


class TestUretim:
    def test_deneme_on_dort_gun(self):
        deneme = trial_license(ORG, NOW)
        assert deneme.expires_at_ms - deneme.starts_at_ms == TRIAL_DAYS * DAY_MS

    def test_deneme_deneme_plani(self):
        assert trial_license(ORG, NOW).is_trial is True

    def test_deneme_hemen_baslar(self):
        assert trial_license(ORG, NOW).status(NOW) is LicenseStatus.ACTIVE

    def test_uretilen_lisans_suresi(self):
        uretilen = issue_license(ORG, LicenseTier.STARTER, NOW, days=90)
        assert uretilen.expires_at_ms == NOW + 90 * DAY_MS

    def test_sifir_gun_bir_gune_cekilir(self):
        # Uretildigi anda dolmus bir lisansi kimse isteyerek yapmaz.
        uretilen = issue_license(ORG, LicenseTier.STARTER, NOW, days=0)
        assert uretilen.expires_at_ms == NOW + DAY_MS

    def test_negatif_gun_bir_gune_cekilir(self):
        uretilen = issue_license(ORG, LicenseTier.STARTER, NOW, days=-5)
        assert uretilen.expires_at_ms == NOW + DAY_MS

    def test_plan_sinirlari_uygulanir(self):
        uretilen = issue_license(ORG, LicenseTier.GROWTH, NOW, days=30)
        assert uretilen.limits == limits_for(LicenseTier.GROWTH)

    def test_musteri_adi_tasinir(self):
        uretilen = issue_license(
            ORG, LicenseTier.STARTER, NOW, days=30, customer="Pilot A.Ş."
        )
        assert uretilen.customer == "Pilot A.Ş."


class TestAnahtar:
    def test_ozet_uretilir(self):
        assert len(key_digest("gizli-anahtar")) == 32

    def test_ayni_anahtar_ayni_ozet(self):
        assert key_digest("a") == key_digest("a")

    def test_farkli_anahtar_farkli_ozet(self):
        assert key_digest("a") != key_digest("b")

    def test_anahtar_lisansta_saklanmaz(self):
        uretilen = issue_license(
            ORG, LicenseTier.STARTER, NOW, days=30, license_key="gizli"
        )
        assert "gizli" not in str(uretilen.to_dict(NOW))

    def test_dogru_anahtar_eslesir(self):
        uretilen = issue_license(
            ORG, LicenseTier.STARTER, NOW, days=30, license_key="gizli"
        )
        assert matches_key(uretilen, "gizli") is True

    def test_yanlis_anahtar_eslesmez(self):
        uretilen = issue_license(
            ORG, LicenseTier.STARTER, NOW, days=30, license_key="gizli"
        )
        assert matches_key(uretilen, "baska") is False

    def test_anahtarsiz_lisans_hicbir_anahtarla_eslesmez(self):
        # Anahtarsiz bir lisansi herhangi bir metinle dogrulamak,
        # dogrulamanin kendisini anlamsiz kilardi.
        assert matches_key(lisans(), "her sey") is False


class TestSinirDenetimi:
    def test_sinirsiz_planda_asilmaz(self):
        sonuc = check_limit("machines", 500, None)
        assert sonuc.exceeded is False

    def test_sinirsiz_planda_oran_none(self):
        assert check_limit("machines", 500, None).ratio is None

    def test_olculemeyen_kullanim_none(self):
        # `False` donseydi, sayac bozuldugunda sinirsiz kayit acilirdi.
        assert check_limit("users", None, 10).exceeded is None

    def test_olculemeyen_kullanimda_neden_yazilir(self):
        assert "sayılamadı" in check_limit("users", None, 10).reason

    def test_sinir_altinda(self):
        assert check_limit("users", 3, 10).exceeded is False

    def test_sinirda_asilmamis(self):
        assert check_limit("users", 10, 10).exceeded is False

    def test_sinir_ustunde(self):
        assert check_limit("users", 11, 10).exceeded is True

    def test_asimda_neden_yazilir(self):
        assert "sınır aşıldı" in check_limit("users", 11, 10).reason

    def test_doluluk_orani(self):
        assert check_limit("users", 5, 10).ratio == 0.5

    def test_etiket_turkce(self):
        assert check_limit("machines", 1, 10).label == "Makine"

    def test_uc_sinir_denetlenir(self):
        sonuc = check_limits(lisans(), UsageCounts(users=1, machines=2, factories=1))
        assert [item.resource for item in sonuc] == ["users", "machines", "factories"]


class TestYeniKayit:
    def test_lisanssiz_kurulumda_acilamaz(self):
        sonuc = can_add(None, UsageCounts(users=1), "users", NOW)
        assert sonuc["allowed"] is False

    def test_lisanssiz_kurulumda_neden_yazilir(self):
        sonuc = can_add(None, UsageCounts(users=1), "users", NOW)
        assert "Lisans yok" in sonuc["reason"]

    def test_etkin_lisansta_acilir(self):
        sonuc = can_add(lisans(), UsageCounts(users=1), "users", NOW)
        assert sonuc["allowed"] is True

    def test_suresi_dolmusta_acilamaz(self):
        sonuc = can_add(
            lisans(expires_at_ms=NOW - 1), UsageCounts(users=1), "users", NOW
        )
        assert sonuc["allowed"] is False

    def test_iptalde_acilamaz(self):
        sonuc = can_add(lisans(revoked_at_ms=NOW), UsageCounts(users=1), "users", NOW)
        assert sonuc["allowed"] is False

    def test_baslamamista_acilamaz(self):
        sonuc = can_add(
            lisans(starts_at_ms=NOW + 1), UsageCounts(users=1), "users", NOW
        )
        assert sonuc["allowed"] is False

    def test_sinir_dolduysa_acilamaz(self):
        # 5/5 kullaniciya altincisi eklenemez.
        sonuc = can_add(lisans(), UsageCounts(users=25), "users", NOW)
        assert sonuc["allowed"] is False

    def test_sinir_dolduysa_neden_yazilir(self):
        sonuc = can_add(lisans(), UsageCounts(users=25), "users", NOW)
        assert "dolu" in sonuc["reason"]

    def test_olculemeyen_kullanimda_karar_yok(self):
        sonuc = can_add(lisans(), UsageCounts(users=None), "users", NOW)
        assert sonuc["allowed"] is None

    def test_sinirsiz_planda_acilir(self):
        kurumsal = lisans(
            tier=LicenseTier.ENTERPRISE, limits=limits_for(LicenseTier.ENTERPRISE)
        )
        sonuc = can_add(kurumsal, UsageCounts(machines=10_000), "machines", NOW)
        assert sonuc["allowed"] is True

    def test_bitisi_yaklasan_lisansta_acilir(self):
        # Uyari engel degildir; musterinin yenilemek icin zamani olmalidir.
        yakin = lisans(expires_at_ms=NOW + DAY_MS)
        sonuc = can_add(yakin, UsageCounts(users=1), "users", NOW)
        assert sonuc["allowed"] is True


class TestDegerlendirme:
    def test_lisanssiz_gorunum(self):
        sonuc = evaluate(None, UsageCounts(), NOW)
        assert sonuc["status"] == "missing"

    def test_lisanssiz_gorunum_saglikli_degil(self):
        assert evaluate(None, UsageCounts(), NOW)["healthy"] is False

    def test_etkin_lisans_saglikli(self):
        sonuc = evaluate(lisans(), UsageCounts(users=1, machines=2, factories=1), NOW)
        assert sonuc["healthy"] is True

    def test_etkin_lisansta_engel_yok(self):
        sonuc = evaluate(lisans(), UsageCounts(users=1, machines=2, factories=1), NOW)
        assert sonuc["blocked"] == []

    def test_suresi_dolmusta_buyume_engellenir(self):
        sonuc = evaluate(
            lisans(expires_at_ms=NOW - 1), UsageCounts(users=1), NOW
        )
        assert set(sonuc["blocked"]) == set(BLOCKED_WHEN_EXPIRED)

    def test_engellenenler_izlemeyi_icermez(self):
        # Uretim korlugu ticari bir sorunun bedeli olamaz.
        assert "read" not in BLOCKED_WHEN_EXPIRED
        assert "monitor" not in BLOCKED_WHEN_EXPIRED

    def test_suresi_dolmusta_neden_yazilir(self):
        sonuc = evaluate(lisans(expires_at_ms=NOW - 1), UsageCounts(), NOW)
        assert "izleme sürer" in sonuc["reason"]

    def test_iptalde_neden_lisanstan_okunur(self):
        iptal = lisans(revoked_at_ms=NOW, revoked_reason="Ödeme alınmadı")
        assert evaluate(iptal, UsageCounts(), NOW)["reason"] == "Ödeme alınmadı"

    def test_sinir_asiminda_saglikli_degil(self):
        sonuc = evaluate(lisans(), UsageCounts(users=100), NOW)
        assert sonuc["healthy"] is False

    def test_kullanim_gorunume_tasinir(self):
        sonuc = evaluate(lisans(), UsageCounts(users=3), NOW)
        assert sonuc["usage"]["users"] == 3

    def test_uc_sinir_gorunumde(self):
        sonuc = evaluate(lisans(), UsageCounts(users=1), NOW)
        assert len(sonuc["limits"]) == 3


class TestSozluk:
    def test_an_verilmezse_durum_none(self):
        assert lisans().to_dict()["status"] is None

    def test_an_verilmezse_kalan_none(self):
        assert lisans().to_dict()["remaining_ms"] is None

    def test_an_verilirse_durum_yazilir(self):
        assert lisans().to_dict(NOW)["status"] == "active"

    def test_sinirlar_sozlukte(self):
        assert lisans().to_dict(NOW)["limits"]["machines"] == 150

    def test_deneme_bayragi(self):
        assert trial_license(ORG, NOW).to_dict(NOW)["is_trial"] is True

    def test_kullanim_sozlugu_none_korur(self):
        assert UsageCounts().to_dict() == {
            "users": None,
            "machines": None,
            "factories": None,
        }
