"""Lisans doğrulaması ve sınır denetimi.

Doğrulama neden erişimi kesmez
------------------------------
Süresi dolmuş bir lisans **okumayı** engellemez: üretim hattını izleyen bir
ekranın ticari bir nedenle kararması, fabrikada gerçek bir arızayı görünmez
kılardı. Engellenen şey **büyümedir** — yeni kullanıcı, yeni makine, yeni
fabrika eklenemez.

Ölçülemeyen sınır neden geçirilmez
----------------------------------
Kullanım sayısı okunamadığında sınır "aşılmadı" sayılmaz, `None` döner ve
karar veren tarafa "ölçülemedi" denir. `False` dönseydi, sayaç bozulduğunda
sınırsız kayıt açılabilirdi.

Anahtar neden saklanmaz
-----------------------
Lisans anahtarının kendisi değil, SHA-256 özeti saklanır. Veritabanı yedeğini
ele geçiren birinin başka bir kuruluma aynı anahtarı yazabilmesi, lisansın
hiçbir anlamı kalmaması demektir.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

from simulation_engine.runtime.licensing.types import (
    DAY_MS,
    LICENSE_STATUS_LABEL,
    LicenseStatus,
    LicenseTier,
    License,
    LimitCheck,
    TRIAL_DAYS,
    UsageCounts,
    limits_for,
)

#: Sınırların insan okunur adları.
RESOURCE_LABEL: Dict[str, str] = {
    "users": "Kullanıcı",
    "machines": "Makine",
    "factories": "Fabrika",
}

#: Süresi dolmuş lisansta engellenen işlemler.
#:
#: Okuma ve izleme listede **yoktur**: lisans sorunu üretim körlüğüne yol
#: açmamalıdır.
BLOCKED_WHEN_EXPIRED = ("add_user", "add_machine", "add_factory")


def key_digest(license_key: str) -> str:
    """Lisans anahtarının özeti.

    Anahtarın kendisi hiçbir yere yazılmaz. Kısaltma (32 karakter) yeterlidir:
    amaç gizliliği kırmak değil, iki anahtarın aynı olup olmadığını
    söyleyebilmektir.
    """
    return hashlib.sha256(license_key.encode("utf-8")).hexdigest()[:32]


def matches_key(license_row: License, license_key: str) -> bool:
    """Verilen anahtar bu lisansa mı ait?

    Özeti boş bir lisans hiçbir anahtarla eşleşmez: anahtarsız kurulmuş bir
    lisansı herhangi bir metinle doğrulamak, doğrulamanın kendisini anlamsız
    kılardı.
    """
    if not license_row.key_digest:
        return False
    return license_row.key_digest == key_digest(license_key)


def trial_license(
    org_id: str, now_ms: int, customer: str = "", issued_by: str = "sistem"
) -> License:
    """On dört günlük deneme lisansı.

    Deneme, `Starter` ile aynı sınırlara sahiptir: müşteri deneme sırasında
    gerçek kurulumunu kurabilmelidir, yoksa deneme hiçbir şey göstermez.
    """
    return License(
        org_id=org_id,
        tier=LicenseTier.TRIAL,
        starts_at_ms=now_ms,
        expires_at_ms=now_ms + TRIAL_DAYS * DAY_MS,
        customer=customer,
        limits=limits_for(LicenseTier.TRIAL),
        issued_at_ms=now_ms,
        issued_by=issued_by,
    )


def issue_license(
    org_id: str,
    tier: LicenseTier,
    now_ms: int,
    days: int,
    customer: str = "",
    issued_by: str = "sistem",
    license_key: Optional[str] = None,
) -> License:
    """Belirtilen planda lisans üretir.

    Süre en az bir gündür: sıfır günlük bir lisans, üretildiği anda dolmuş
    olurdu ve kimse bunu isteyerek yapmaz.
    """
    span = max(1, int(days))
    return License(
        org_id=org_id,
        tier=tier,
        starts_at_ms=now_ms,
        expires_at_ms=now_ms + span * DAY_MS,
        customer=customer,
        limits=limits_for(tier),
        issued_at_ms=now_ms,
        issued_by=issued_by,
        key_digest="" if license_key is None else key_digest(license_key),
    )


def check_limit(
    resource: str, used: Optional[int], limit: Optional[int]
) -> LimitCheck:
    """Tek bir sınırın durumu.

    Üç ayrı sonuç vardır ve üçü de farklıdır: sınırsız, ölçülemedi, aşıldı.
    İkisini birleştirmek, bozuk bir sayacı sınırsız bir plana çevirirdi.
    """
    label = RESOURCE_LABEL.get(resource, resource)
    if limit is None:
        return LimitCheck(
            resource=resource,
            label=label,
            used=used,
            limit=None,
            exceeded=False,
            ratio=None,
            reason="Bu planda sınır yok",
        )
    if used is None:
        return LimitCheck(
            resource=resource,
            label=label,
            used=None,
            limit=limit,
            exceeded=None,
            ratio=None,
            reason="Kullanım sayılamadı; sınırın aşılıp aşılmadığı bilinmiyor",
        )
    return LimitCheck(
        resource=resource,
        label=label,
        used=used,
        limit=limit,
        exceeded=used > limit,
        ratio=round(used / limit, 4) if limit > 0 else None,
        reason=None if used <= limit else f"{used}/{limit} — sınır aşıldı",
    )


def check_limits(license_row: License, usage: UsageCounts) -> List[LimitCheck]:
    """Üç sınırın tamamı."""
    return [
        check_limit("users", usage.users, license_row.limits.users),
        check_limit("machines", usage.machines, license_row.limits.machines),
        check_limit("factories", usage.factories, license_row.limits.factories),
    ]


def can_add(
    license_row: Optional[License],
    usage: UsageCounts,
    resource: str,
    now_ms: int,
) -> Dict[str, Any]:
    """Yeni bir kayıt açılabilir mi?

    Yanıt üç değerlidir: `True` (açılabilir), `False` (açılamaz) ve `None`
    (ölçülemedi). Üçüncüsü `False` sayılsaydı, sayaç bozulduğunda kurulum
    tamamen dururdu; `True` sayılsaydı sınır hiç uygulanmazdı. Karar
    çağırana bırakılır ve nedeni yazılır.
    """
    if license_row is None:
        return {
            "allowed": False,
            "reason": "Lisans yok; bu kuruluma lisans tanımlanmamış.",
            "status": LicenseStatus.MISSING.value,
        }

    status = license_row.status(now_ms)
    if status in (LicenseStatus.EXPIRED, LicenseStatus.REVOKED, LicenseStatus.PENDING):
        return {
            "allowed": False,
            "reason": f"Lisans {LICENSE_STATUS_LABEL[status].lower()}; yeni kayıt açılamaz.",
            "status": status.value,
        }

    limit = getattr(license_row.limits, resource, None)
    used = getattr(usage, resource, None)
    check = check_limit(resource, used, limit)

    if check.exceeded is None:
        return {
            "allowed": None,
            "reason": check.reason,
            "status": status.value,
        }
    if check.exceeded:
        return {
            "allowed": False,
            "reason": check.reason,
            "status": status.value,
        }
    # Sınırın **tam üstünde** olmak da engeldir: 5/5 kullanıcıya altıncı
    # eklenemez.
    if limit is not None and used is not None and used >= limit:
        return {
            "allowed": False,
            "reason": f"{used}/{limit} — sınır dolu",
            "status": status.value,
        }
    return {"allowed": True, "reason": None, "status": status.value}


def evaluate(
    license_row: Optional[License], usage: UsageCounts, now_ms: int
) -> Dict[str, Any]:
    """Arayüzün okuduğu tam lisans görünümü."""
    if license_row is None:
        return {
            "license": None,
            "status": LicenseStatus.MISSING.value,
            "status_label": LICENSE_STATUS_LABEL[LicenseStatus.MISSING],
            "limits": [],
            "usage": usage.to_dict(),
            "blocked": list(BLOCKED_WHEN_EXPIRED),
            "healthy": False,
            "reason": "Bu kuruluma lisans tanımlanmamış.",
        }

    status = license_row.status(now_ms)
    checks = check_limits(license_row, usage)
    exceeded = [item for item in checks if item.exceeded is True]
    healthy = status in (LicenseStatus.ACTIVE, LicenseStatus.EXPIRING) and not exceeded

    reason = None
    if status is LicenseStatus.EXPIRED:
        reason = "Lisans süresi doldu; izleme sürer ama yeni kayıt açılamaz."
    elif status is LicenseStatus.REVOKED:
        reason = license_row.revoked_reason or "Lisans iptal edildi."
    elif status is LicenseStatus.PENDING:
        reason = "Lisans henüz başlamadı."
    elif exceeded:
        reason = "; ".join(item.reason or "" for item in exceeded)

    return {
        "license": license_row.to_dict(now_ms),
        "status": status.value,
        "status_label": LICENSE_STATUS_LABEL[status],
        "limits": [item.to_dict() for item in checks],
        "usage": usage.to_dict(),
        "blocked": [] if healthy else list(BLOCKED_WHEN_EXPIRED),
        "healthy": healthy,
        "reason": reason,
    }
