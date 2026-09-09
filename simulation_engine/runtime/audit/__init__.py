"""Denetim günlüğü.

Kritik her işlem — bağlantı kurma/kapatma, alarm onayı, rol değişikliği,
davet, kurtarma, yedekleme — beş soruyla kaydedilir: ne zaman, kim, hangi
kiracı, neye, ne yaptı. Kayıtlar yalnızca eklenir; güncelleme ve silme işlevi
bilinçli olarak yoktur.
"""

from simulation_engine.runtime.audit.recorder import (
    MAX_MEMORY_ENTRIES,
    AuditRecorder,
)
from simulation_engine.runtime.audit.types import (
    ACTION_LABEL,
    OUTCOME_LABEL,
    REDACTED_KEYS,
    REDACTED_VALUE,
    SYSTEM_ACTOR,
    AuditAction,
    AuditEntry,
    AuditOutcome,
    make_entry,
    redact,
)

__all__ = [
    "ACTION_LABEL",
    "AuditAction",
    "AuditEntry",
    "AuditOutcome",
    "AuditRecorder",
    "MAX_MEMORY_ENTRIES",
    "OUTCOME_LABEL",
    "REDACTED_KEYS",
    "REDACTED_VALUE",
    "SYSTEM_ACTOR",
    "make_entry",
    "redact",
]
