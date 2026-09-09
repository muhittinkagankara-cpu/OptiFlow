"""Birleşik alarm merkezi.

    Snapshot + Bağlantı durumu → Kurallar → Değerlendirici → AlarmStore
                                                                  │
                                          Live Factory · Alarm Merkezi · Pano

Tek alarm kaynağı: üç ekran da aynı depodan okur. Durum geçişleri (`OPEN` →
`ACKNOWLEDGED` → `RESOLVED`) yalnızca depoda uygulanır.
"""

from simulation_engine.runtime.alarms.evaluator import (
    AlarmEvaluator,
    ConnectionView,
    collect_candidates,
)
from simulation_engine.runtime.alarms.escalation import (
    DEFAULT_SILENCE_MS,
    ESCALATE_AFTER_MS,
    ESCALATION_CHAIN,
    ESCALATION_KIND_LABEL,
    EscalationAction,
    EscalationEngine,
    EscalationKind,
    EscalationPolicy,
    MAX_ESCALATION_LEVEL,
    MAX_SILENCE_MS,
    MaintenanceRegistry,
    MaintenanceWindow,
    REPEAT_INTERVAL_MS,
    chain_target,
    clamp_silence_ms,
)
from simulation_engine.runtime.alarms.repository import MAX_HISTORY, AlarmStore
from simulation_engine.runtime.alarms.rules import (
    DEFAULT_NO_DATA_TIMEOUT_MS,
    DEFAULT_QUEUE_THRESHOLD,
    AlarmThresholds,
    evaluate_snapshot,
    machine_blocked,
    machine_down,
    no_data,
    queue_high,
    runtime_disconnected,
)
from simulation_engine.runtime.alarms.types import (
    ALARM_RULE_LABEL,
    ALARM_SEVERITY_LABEL,
    ALARM_STATE_LABEL,
    Alarm,
    AlarmCandidate,
    AlarmRuleId,
    AlarmSeverity,
    AlarmState,
    alarm_id,
)

__all__ = [
    "ALARM_RULE_LABEL",
    "ALARM_SEVERITY_LABEL",
    "ALARM_STATE_LABEL",
    "Alarm",
    "AlarmCandidate",
    "AlarmEvaluator",
    "AlarmRuleId",
    "AlarmSeverity",
    "AlarmState",
    "AlarmStore",
    "AlarmThresholds",
    "ConnectionView",
    "DEFAULT_NO_DATA_TIMEOUT_MS",
    "DEFAULT_SILENCE_MS",
    "ESCALATE_AFTER_MS",
    "ESCALATION_CHAIN",
    "ESCALATION_KIND_LABEL",
    "EscalationAction",
    "EscalationEngine",
    "EscalationKind",
    "EscalationPolicy",
    "MAX_ESCALATION_LEVEL",
    "MAX_SILENCE_MS",
    "MaintenanceRegistry",
    "MaintenanceWindow",
    "REPEAT_INTERVAL_MS",
    "chain_target",
    "clamp_silence_ms",
    "DEFAULT_QUEUE_THRESHOLD",
    "MAX_HISTORY",
    "alarm_id",
    "collect_candidates",
    "evaluate_snapshot",
    "machine_blocked",
    "machine_down",
    "no_data",
    "queue_high",
    "runtime_disconnected",
]
