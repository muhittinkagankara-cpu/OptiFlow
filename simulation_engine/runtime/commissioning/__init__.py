"""Devreye alma katmanı: kurulum tokenı, makine etiketleri, kontrol listesi.

Üçünün ortak yanı, kurulumu **kanıta bağlamasıdır**: token kimin ne zaman
kurduğunu, etiket sahadaki makinenin yazılımdaki karşılığını, kontrol listesi
kurulumun gerçekten bitip bitmediğini söyler. Hiçbiri kullanıcının
işaretlemesiyle tamamlanmaz.
"""

from simulation_engine.runtime.commissioning.checklist import (
    ChecklistStep,
    DeploymentInput,
    DeploymentReport,
    STEP_STATE_LABEL,
    StepState,
    build_checklist,
    build_report,
    describe,
)
from simulation_engine.runtime.commissioning.labels import (
    LABEL_PATTERN,
    MachineLabel,
    QR_SCHEME,
    duplicate_labels,
    is_valid_label,
    normalize_label,
    parse_qr,
    qr_payload,
    suggest_label,
    unlabeled_machines,
)
from simulation_engine.runtime.commissioning.tokens import (
    DEFAULT_TTL_HOURS,
    HOUR_MS,
    InstallToken,
    IssuedToken,
    MAX_TTL_HOURS,
    TOKEN_STATUS_LABEL,
    TokenStatus,
    clamp_ttl_hours,
    generate_token,
    issue,
    note_step,
    redeem,
    revoke,
    token_digest,
)

__all__ = [
    "ChecklistStep",
    "DEFAULT_TTL_HOURS",
    "DeploymentInput",
    "DeploymentReport",
    "HOUR_MS",
    "InstallToken",
    "IssuedToken",
    "LABEL_PATTERN",
    "MAX_TTL_HOURS",
    "MachineLabel",
    "QR_SCHEME",
    "STEP_STATE_LABEL",
    "StepState",
    "TOKEN_STATUS_LABEL",
    "TokenStatus",
    "build_checklist",
    "build_report",
    "clamp_ttl_hours",
    "describe",
    "duplicate_labels",
    "generate_token",
    "is_valid_label",
    "issue",
    "normalize_label",
    "note_step",
    "parse_qr",
    "qr_payload",
    "redeem",
    "revoke",
    "suggest_label",
    "token_digest",
    "unlabeled_machines",
]
