"""Lisans modeli.

Neden gerekli
-------------
İlk ücretli müşteriye kurulan bir sistemin "kaç kullanıcı, kaç makine, ne
zamana kadar" sorularına yanıtı olmalıdır. Bu yanıt kodda sabit olsaydı, her
müşteri için ayrı bir sürüm gerekirdi; sözleşmede kalsaydı, sistem sınırı hiç
bilmezdi.

Ne yapar, ne yapmaz
-------------------
Bu katman **doğrular ve sınırları söyler**. Ödeme almaz, fatura kesmez, kart
saklamaz. Gerçek bir ödeme sağlayıcısı bağlanmadığı sürece "ödendi" diyen
hiçbir alan yoktur.

Süre dolması neden erişimi kesmez
---------------------------------
Süresi dolmuş bir lisans sistemi **kilitlemez**, uyarı üretir ve yeni kayıt
açmayı engeller. Üretim hattını izleyen bir ekranın lisans yüzünden kararması,
fabrikada gerçek bir arızayı görünmez kılardı. Ticari sorunun bedeli üretim
körlüğü olamaz.

Sınırlar neden `None` olabilir
------------------------------
`Enterprise` planında makine sınırı yoktur ve bu `None` ile yazılır. Çok büyük
bir sayı (999999) yazılsaydı, arayüz "999999 makineden 12'si kullanılıyor" gibi
anlamsız bir doluluk gösterirdi.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

#: Deneme lisansının süresi (gün).
TRIAL_DAYS = 14

#: Bir günün milisaniyesi.
DAY_MS = 86_400_000

#: Bitişe bu kadar kala uyarı verilir (gün).
#:
#: Yedi gün, bir müşterinin satın alma sürecini başlatması için gereken en kısa
#: süredir; daha geç uyarmak, hattı lisanssız bırakma riski demektir.
EXPIRY_WARNING_DAYS = 7


class LicenseTier(str, Enum):
    """Lisans planları."""

    TRIAL = "trial"
    STARTER = "starter"
    GROWTH = "growth"
    ENTERPRISE = "enterprise"


LICENSE_TIER_LABEL: Dict[LicenseTier, str] = {
    LicenseTier.TRIAL: "Deneme",
    LicenseTier.STARTER: "Başlangıç",
    LicenseTier.GROWTH: "Büyüme",
    LicenseTier.ENTERPRISE: "Kurumsal",
}


class LicenseStatus(str, Enum):
    """Lisansın o andaki durumu."""

    #: Geçerli ve süresi var.
    ACTIVE = "active"
    #: Geçerli ama bitişi yaklaştı.
    EXPIRING = "expiring"
    #: Süresi doldu; sistem çalışır ama yeni kayıt açılmaz.
    EXPIRED = "expired"
    #: Elle iptal edildi.
    REVOKED = "revoked"
    #: Henüz başlamadı (ileri tarihli).
    PENDING = "pending"
    #: Lisans yok; hiç kurulmamış.
    MISSING = "missing"


LICENSE_STATUS_LABEL: Dict[LicenseStatus, str] = {
    LicenseStatus.ACTIVE: "Etkin",
    LicenseStatus.EXPIRING: "Bitiyor",
    LicenseStatus.EXPIRED: "Süresi doldu",
    LicenseStatus.REVOKED: "İptal edildi",
    LicenseStatus.PENDING: "Başlamadı",
    LicenseStatus.MISSING: "Lisans yok",
}


@dataclass(frozen=True)
class LicenseLimits:
    """Bir planın sınırları.

    `None` **sınırsız** demektir, sıfır değil. Sıfır "hiç kullanamaz" anlamına
    gelirdi ve kurumsal planı en kısıtlı plan yapardı.
    """

    users: Optional[int]
    machines: Optional[int]
    factories: Optional[int]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "users": self.users,
            "machines": self.machines,
            "factories": self.factories,
        }


#: Plan başına varsayılan sınırlar.
#:
#: Sayılar bir ürün kararıdır: `Starter` tek fabrikalı küçük bir atölyedir,
#: `Growth` çok hatlı bir tesistir, `Enterprise` sınırsızdır. Deneme planı
#: `Starter` ile aynı sınırlara sahiptir — müşteri deneme sırasında gerçek
#: kurulumunu kurabilmelidir, yoksa deneme hiçbir şey göstermez.
DEFAULT_LIMITS: Dict[LicenseTier, LicenseLimits] = {
    LicenseTier.TRIAL: LicenseLimits(users=5, machines=25, factories=1),
    LicenseTier.STARTER: LicenseLimits(users=5, machines=25, factories=1),
    LicenseTier.GROWTH: LicenseLimits(users=25, machines=150, factories=5),
    LicenseTier.ENTERPRISE: LicenseLimits(users=None, machines=None, factories=None),
}


def limits_for(tier: LicenseTier) -> LicenseLimits:
    """Planın sınırları."""
    return DEFAULT_LIMITS[tier]


@dataclass
class License:
    """Bir kiracının lisansı."""

    org_id: str
    tier: LicenseTier
    #: Geçerliliğin başladığı an (epoch ms).
    starts_at_ms: int
    #: Geçerliliğin bittiği an (epoch ms).
    expires_at_ms: int
    #: Müşteri adı; sözleşmede yazan ad, kiracı kimliği değil.
    customer: str = ""
    limits: LicenseLimits = field(
        default_factory=lambda: DEFAULT_LIMITS[LicenseTier.TRIAL]
    )
    #: Elle iptal edildiyse anı; edilmediyse `None`.
    revoked_at_ms: Optional[int] = None
    #: İptal nedeni.
    revoked_reason: Optional[str] = None
    issued_at_ms: int = 0
    #: Lisansı veren; bilinmiyorsa "sistem".
    issued_by: str = "sistem"
    #: Lisans anahtarının özeti; anahtarın kendisi saklanmaz.
    key_digest: str = ""

    def status(self, now_ms: int) -> LicenseStatus:
        """Bu andaki durum.

        Sıra bir karardır: iptal her şeyin önündedir, sonra başlangıç, sonra
        bitiş. İptal edilmiş ama süresi dolmamış bir lisans "etkin"
        görünseydi, iptalin bir anlamı kalmazdı.
        """
        if self.revoked_at_ms is not None:
            return LicenseStatus.REVOKED
        if now_ms < self.starts_at_ms:
            return LicenseStatus.PENDING
        if now_ms >= self.expires_at_ms:
            return LicenseStatus.EXPIRED
        if self.expires_at_ms - now_ms <= EXPIRY_WARNING_DAYS * DAY_MS:
            return LicenseStatus.EXPIRING
        return LicenseStatus.ACTIVE

    def remaining_ms(self, now_ms: int) -> Optional[int]:
        """Bitişe kalan süre; süresi dolduysa ya da iptalse `None`.

        Negatif bir süre döndürmek, "eksi üç gün kaldı" gibi okunmaz bir
        değer üretirdi; süre bittiyse kalan süre **yoktur**.
        """
        if self.revoked_at_ms is not None:
            return None
        if now_ms >= self.expires_at_ms:
            return None
        return self.expires_at_ms - now_ms

    def remaining_days(self, now_ms: int) -> Optional[int]:
        """Kalan gün; hesaplanamıyorsa `None`."""
        remaining = self.remaining_ms(now_ms)
        return None if remaining is None else remaining // DAY_MS

    @property
    def is_trial(self) -> bool:
        return self.tier is LicenseTier.TRIAL

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, Any]:
        status = None if now_ms is None else self.status(now_ms)
        return {
            "org_id": self.org_id,
            "tier": self.tier.value,
            "tier_label": LICENSE_TIER_LABEL[self.tier],
            "customer": self.customer,
            "starts_at_ms": self.starts_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "limits": self.limits.to_dict(),
            "revoked_at_ms": self.revoked_at_ms,
            "revoked_reason": self.revoked_reason,
            "issued_at_ms": self.issued_at_ms,
            "issued_by": self.issued_by,
            "key_digest": self.key_digest,
            "status": None if status is None else status.value,
            "status_label": None if status is None else LICENSE_STATUS_LABEL[status],
            # Ölçülemeyen süre `null` döner; sıfır "bugün bitiyor" demek olurdu.
            "remaining_ms": None if now_ms is None else self.remaining_ms(now_ms),
            "remaining_days": None if now_ms is None else self.remaining_days(now_ms),
            "is_trial": self.is_trial,
        }


@dataclass(frozen=True)
class UsageCounts:
    """Kiracının o andaki kullanımı.

    Sayılamayan bir kaynak `None` taşır: kullanıcı sayısı okunamıyorsa
    "0 kullanıcı" demek, sınırın hiç dolmadığı izlenimi verirdi.
    """

    users: Optional[int] = None
    machines: Optional[int] = None
    factories: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "users": self.users,
            "machines": self.machines,
            "factories": self.factories,
        }


@dataclass(frozen=True)
class LimitCheck:
    """Tek bir sınırın durumu."""

    resource: str
    label: str
    #: Kullanılan miktar; sayılamadıysa `None`.
    used: Optional[int]
    #: Sınır; sınırsızsa `None`.
    limit: Optional[int]
    #: Sınır aşıldı mı? Ölçülemiyorsa `None` — "aşılmadı" demek değildir.
    exceeded: Optional[bool]
    #: Doluluk oranı; hesaplanamıyorsa `None`.
    ratio: Optional[float]
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "resource": self.resource,
            "label": self.label,
            "used": self.used,
            "limit": self.limit,
            "exceeded": self.exceeded,
            "ratio": self.ratio,
            "reason": self.reason,
        }
