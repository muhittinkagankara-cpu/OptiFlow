"""Lisans katmanı.

    Lisans kaydı → doğrulama → sınır denetimi → arayüz

Bu katman doğrular ve sınırları söyler; ödeme almaz. Süresi dolmuş bir lisans
izlemeyi kesmez, yalnızca yeni kayıt açmayı engeller: ticari bir sorunun bedeli
üretim körlüğü olamaz.
"""

from simulation_engine.runtime.licensing.types import (
    DAY_MS,
    DEFAULT_LIMITS,
    EXPIRY_WARNING_DAYS,
    LICENSE_STATUS_LABEL,
    LICENSE_TIER_LABEL,
    License,
    LicenseLimits,
    LicenseStatus,
    LicenseTier,
    LimitCheck,
    TRIAL_DAYS,
    UsageCounts,
    limits_for,
)
from simulation_engine.runtime.licensing.validator import (
    BLOCKED_WHEN_EXPIRED,
    RESOURCE_LABEL,
    can_add,
    check_limit,
    check_limits,
    evaluate,
    issue_license,
    key_digest,
    matches_key,
    trial_license,
)

__all__ = [
    "BLOCKED_WHEN_EXPIRED",
    "DAY_MS",
    "DEFAULT_LIMITS",
    "EXPIRY_WARNING_DAYS",
    "LICENSE_STATUS_LABEL",
    "LICENSE_TIER_LABEL",
    "License",
    "LicenseLimits",
    "LicenseStatus",
    "LicenseTier",
    "LimitCheck",
    "RESOURCE_LABEL",
    "TRIAL_DAYS",
    "UsageCounts",
    "can_add",
    "check_limit",
    "check_limits",
    "evaluate",
    "issue_license",
    "key_digest",
    "limits_for",
    "matches_key",
    "trial_license",
]
