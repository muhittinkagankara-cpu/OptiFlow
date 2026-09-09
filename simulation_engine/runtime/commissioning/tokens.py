"""Kurulum tokenı: saha mühendisinin tek kullanımlık anahtarı.

Sorun
-----
Sahaya giden mühendisin kuruluma başlayabilmesi için bir yetkiye ihtiyacı var.
Ona müşterinin yönetici parolasını vermek, kurulum bittikten sonra da geçerli
kalan bir erişim bırakırdı. Kalıcı bir API anahtarı vermek de aynı şey: bir kez
sızdığında süresiz kullanılır.

Token bunun yerine **tek kullanımlıktır ve süresi vardır**. Kurulum
tamamlandığında kendiliğinden kapanır.

Token neden saklanmaz
---------------------
Yalnızca SHA-256 özeti yazılır. Veritabanı yedeğini ele geçiren biri, orada
yazan değerle kurulum yapamaz. Token yalnızca üretildiği anda, bir kez
gösterilir — ikinci kez gösterilemez, çünkü sistemde yoktur.

Neden kullanım kaydı
--------------------
"Bu kurulumu kim yaptı, ne zaman, hangi cihazdan?" sorusu bir arıza
soruşturmasında ilk sorulan sorudur. Token kullanıldığında kim kullandı ve
hangi adresten kullandı yazılır; silinmez.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

#: Tokenın varsayılan ömrü (saat).
#:
#: Kırk sekiz saat, bir saha ziyaretini ve olası bir ertesi gün dönüşünü
#: kapsar. Daha uzun bir ömür, unutulan bir tokenın haftalarca açık kalması
#: demektir.
DEFAULT_TTL_HOURS = 48

#: Kabul edilen en uzun ömür (saat).
MAX_TTL_HOURS = 24 * 14

#: Token metninin bayt uzunluğu.
#:
#: Otuz iki bayt, tahmin edilmesi pratikte imkânsız bir alan verir; daha kısası
#: kaba kuvvetle denenebilir hâle gelirdi.
TOKEN_BYTES = 32

HOUR_MS = 3_600_000


class TokenStatus(str, Enum):
    """Tokenın durumu."""

    #: Kullanılabilir.
    ACTIVE = "active"
    #: Kurulumda kullanıldı; bir daha kullanılamaz.
    USED = "used"
    #: Süresi doldu.
    EXPIRED = "expired"
    #: Elle iptal edildi.
    REVOKED = "revoked"


TOKEN_STATUS_LABEL: Dict[TokenStatus, str] = {
    TokenStatus.ACTIVE: "Kullanılabilir",
    TokenStatus.USED: "Kullanıldı",
    TokenStatus.EXPIRED: "Süresi doldu",
    TokenStatus.REVOKED: "İptal edildi",
}


def generate_token() -> str:
    """Yeni bir token metni üretir.

    `secrets` kullanılır, `random` değil: `random` öngörülebilir bir üreteçtir
    ve tohumu bilinen bir sistemde üretilen tokenlar hesaplanabilir.
    """
    return secrets.token_urlsafe(TOKEN_BYTES)


def token_digest(token: str) -> str:
    """Tokenın özeti; saklanan tek şey budur."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def clamp_ttl_hours(hours: Optional[int]) -> int:
    """Ömrü kabul edilen aralığa çeker.

    Sıfır ya da negatif bir ömür varsayılana düşer: üretildiği anda dolmuş bir
    token kimseye yaramaz.
    """
    if hours is None:
        return DEFAULT_TTL_HOURS
    try:
        value = int(hours)
    except (TypeError, ValueError):
        return DEFAULT_TTL_HOURS
    if value <= 0:
        return DEFAULT_TTL_HOURS
    return min(MAX_TTL_HOURS, value)


@dataclass
class InstallToken:
    """Tek kullanımlık kurulum tokenı."""

    id: str
    org_id: str
    #: Tokenın SHA-256 özeti; metnin kendisi saklanmaz.
    digest: str
    created_at_ms: int
    expires_at_ms: int
    #: Tokenı üreten kişi.
    created_by: str = "sistem"
    #: Kurulumun yapılacağı tesis; bilinmiyorsa boş.
    site: str = ""
    #: Kullanıldığı an; kullanılmadıysa `None`.
    used_at_ms: Optional[int] = None
    #: Kullanan kişi; kullanılmadıysa `None`.
    used_by: Optional[str] = None
    #: Kullanıldığı adres; bilinmiyorsa `None`.
    used_from: Optional[str] = None
    revoked_at_ms: Optional[int] = None
    revoked_reason: Optional[str] = None
    #: Kurulum sırasında yapılan işlemler; sırayla eklenir, silinmez.
    usage_log: List[Dict[str, Any]] = field(default_factory=list)

    def status(self, now_ms: int) -> TokenStatus:
        """Bu andaki durum.

        Sıra bir karardır: iptal her şeyin önündedir, sonra kullanım, en son
        süre. Kullanılmış bir tokenın süresi de dolmuş olabilir ama önemli
        olan **kullanıldığıdır**: ikinci kez kullanılamaz.
        """
        if self.revoked_at_ms is not None:
            return TokenStatus.REVOKED
        if self.used_at_ms is not None:
            return TokenStatus.USED
        if now_ms >= self.expires_at_ms:
            return TokenStatus.EXPIRED
        return TokenStatus.ACTIVE

    def is_usable(self, now_ms: int) -> bool:
        return self.status(now_ms) is TokenStatus.ACTIVE

    def remaining_ms(self, now_ms: int) -> Optional[int]:
        """Kalan süre; kullanılabilir değilse `None`.

        Kullanılmış bir tokenın "kalan süresi" yoktur; sayı göstermek onu
        hâlâ kullanılabilir sanmaya yol açardı.
        """
        if not self.is_usable(now_ms):
            return None
        return self.expires_at_ms - now_ms

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, Any]:
        status = None if now_ms is None else self.status(now_ms)
        return {
            "id": self.id,
            "org_id": self.org_id,
            # Özet bile tam gösterilmez: kısa ön ek, iki tokenı ayırt etmeye
            # yeter ve kaba kuvvet için bir şey vermez.
            "digest_prefix": self.digest[:8],
            "created_at_ms": self.created_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "created_by": self.created_by,
            "site": self.site,
            "used_at_ms": self.used_at_ms,
            "used_by": self.used_by,
            "used_from": self.used_from,
            "revoked_at_ms": self.revoked_at_ms,
            "revoked_reason": self.revoked_reason,
            "usage_log": list(self.usage_log),
            "status": None if status is None else status.value,
            "status_label": None if status is None else TOKEN_STATUS_LABEL[status],
            "remaining_ms": None if now_ms is None else self.remaining_ms(now_ms),
            "usable": None if now_ms is None else self.is_usable(now_ms),
        }


@dataclass(frozen=True)
class IssuedToken:
    """Üretim sonucunun tamamı.

    Token metni **yalnızca burada** bulunur ve tek bir kez döner. Depoya
    yazılmaz; ikinci kez sorulduğunda yoktur.
    """

    token: str
    record: InstallToken

    def to_dict(self, now_ms: int) -> Dict[str, Any]:
        payload = self.record.to_dict(now_ms)
        payload["token"] = self.token
        payload["note"] = (
            "Bu token yalnızca bir kez gösterilir; kapatıldıktan sonra "
            "yeniden görüntülenemez."
        )
        return payload


def issue(
    org_id: str,
    now_ms: int,
    sequence: int,
    created_by: str = "sistem",
    site: str = "",
    ttl_hours: Optional[int] = None,
) -> IssuedToken:
    """Yeni bir kurulum tokenı üretir."""
    token = generate_token()
    hours = clamp_ttl_hours(ttl_hours)
    record = InstallToken(
        id=f"kurulum-{sequence}",
        org_id=org_id,
        digest=token_digest(token),
        created_at_ms=now_ms,
        expires_at_ms=now_ms + hours * HOUR_MS,
        created_by=created_by,
        site=site,
    )
    return IssuedToken(token=token, record=record)


def redeem(
    record: InstallToken,
    token: str,
    now_ms: int,
    used_by: str,
    used_from: Optional[str] = None,
) -> Dict[str, Any]:
    """Tokenı kullanır; sonucu ve nedenini döndürür.

    Başarısızlıkta **neden** yazılır: "geçersiz token" demek, süresi dolmuş
    bir tokenla yanlış yazılmış bir tokenı ayırt edilemez kılardı ve sahadaki
    mühendis nerede hata yaptığını anlayamazdı.
    """
    status = record.status(now_ms)
    if status is not TokenStatus.ACTIVE:
        return {
            "ok": False,
            "reason": f"Token {TOKEN_STATUS_LABEL[status].lower()}.",
            "status": status.value,
        }
    if record.digest != token_digest(token):
        return {
            "ok": False,
            "reason": "Token eşleşmedi.",
            "status": status.value,
        }

    record.used_at_ms = now_ms
    record.used_by = used_by
    record.used_from = used_from
    record.usage_log.append(
        {
            "at_ms": now_ms,
            "action": "redeem",
            "actor": used_by,
            "from": used_from,
        }
    )
    return {"ok": True, "reason": None, "status": TokenStatus.USED.value}


def revoke(record: InstallToken, now_ms: int, reason: str, actor: str) -> bool:
    """Tokenı iptal eder; zaten kapalıysa `False`.

    Kullanılmış bir token iptal edilmez: kapatılmış bir kapıyı ikinci kez
    kapatmak, kullanım kaydını iptal kaydıyla karıştırırdı.
    """
    if record.status(now_ms) is not TokenStatus.ACTIVE:
        return False
    record.revoked_at_ms = now_ms
    record.revoked_reason = reason
    record.usage_log.append(
        {"at_ms": now_ms, "action": "revoke", "actor": actor, "reason": reason}
    )
    return True


def note_step(record: InstallToken, now_ms: int, step: str, actor: str) -> None:
    """Kurulum sırasında yapılan bir adımı kaydeder.

    Kayıt yalnızca **eklenir**: sonradan düzeltilebilen bir kurulum günlüğü,
    bir arıza soruşturmasında kanıt değeri taşımaz.
    """
    record.usage_log.append(
        {"at_ms": now_ms, "action": "step", "step": step, "actor": actor}
    )
