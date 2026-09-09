/**
 * Sunucu yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcılar savunmacıdır: eksik ya da tanınmayan bir alan geldiğinde
 * çökmez, o alanı `null` yapar. Eski bir sunucuya bağlanan yeni bir arayüz,
 * tanımadığı bir gövdeyle karşılaştığında boş bir ekran değil "ölçülmedi"
 * göstermelidir.
 *
 * Sayılarda `0` korunur, `NaN` ve sonsuz düşürülür: "ölçüldü ve sıfır" ile
 * "ölçülmedi" farklı bilgilerdir ve ikisini karıştıran bir dönüşüm, hiç
 * ölçülmemiş duruşu "0 dakika" diye gösterirdi.
 */

import {
  ALARM_ORIGIN_LABEL,
  ALARM_RULE_LABEL,
  ALARM_SEVERITY_LABEL,
  ALARM_STATE_LABEL,
  EMPTY_ALARM_COUNTS,
  type AlarmCounts,
  type AlarmOrigin,
  type HealthScoreConnection,
  type HealthScoreView,
  type MonitoringKpi,
  type OeeView,
  type ProductionStatus,
  type TimelineEntry,
  type TimelineEntryType,
  type UnifiedAlarm,
  type UnifiedAlarmRule,
  type UnifiedAlarmSeverity,
  type UnifiedAlarmState,
} from "./types";

const STATES: UnifiedAlarmState[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "SILENCED",
  "ESCALATED",
  "RESOLVED",
];
const SEVERITIES: UnifiedAlarmSeverity[] = ["critical", "warning", "info"];
const RULES: UnifiedAlarmRule[] = [
  "queue_high",
  "machine_down",
  "machine_blocked",
  "no_data",
  "runtime_disconnected",
  "simulation",
];

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Sayı ya da `null`; `0` korunur, `NaN` ve sonsuz ölçülmemiş sayılır. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sayı ya da verilen yedek; sayaçlar için (ölçülmüş sıfır anlamlıdır). */
export function numberOr(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value);
  return parsed === null ? fallback : parsed;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

/** Metin → metin sözlüğü; nedenler bu biçimde gelir. */
export function reasonMap(value: unknown): Record<string, string> {
  const source = record(value);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string" && item.length > 0) {
      result[key] = item;
    }
  }
  return result;
}

/**
 * Tanınmayan durum `OPEN` sayılır.
 *
 * "Kapandı" varsayılsaydı, sunucunun yeni bir durum adı eklediği gün bütün
 * açık alarmlar sessizce kaybolurdu; bir alarmı fazladan göstermek, eksik
 * göstermekten çok daha ucuzdur.
 */
export function parseAlarmState(value: unknown): UnifiedAlarmState {
  return STATES.includes(value as UnifiedAlarmState)
    ? (value as UnifiedAlarmState)
    : "OPEN";
}

/** Tanınmayan ağırlık "uyarı" olur; kritik uydurulmaz, bilgi de sayılmaz. */
export function parseSeverity(value: unknown): UnifiedAlarmSeverity {
  return SEVERITIES.includes(value as UnifiedAlarmSeverity)
    ? (value as UnifiedAlarmSeverity)
    : "warning";
}

export function parseRule(value: unknown): UnifiedAlarmRule {
  return RULES.includes(value as UnifiedAlarmRule)
    ? (value as UnifiedAlarmRule)
    : "simulation";
}

/** Sunucudan gelen tek bir alarm. */
export function parseAlarm(
  value: unknown,
  origin: AlarmOrigin = "runtime",
): UnifiedAlarm {
  const row = record(value);
  const rule = parseRule(row.rule);
  const severity = parseSeverity(row.severity);
  const state = parseAlarmState(row.state);
  const subject = stringOr(row.subject, "bilinmiyor");

  return {
    id: stringOr(row.id, `${rule}::${subject}`),
    rule,
    ruleLabel: stringOr(row.rule_label, ALARM_RULE_LABEL[rule]),
    subject,
    severity,
    severityLabel: stringOr(row.severity_label, ALARM_SEVERITY_LABEL[severity]),
    state,
    stateLabel: stringOr(row.state_label, ALARM_STATE_LABEL[state]),
    origin,
    originLabel: ALARM_ORIGIN_LABEL[origin],
    message: stringOr(row.message, "Alarm ayrıntısı bildirilmedi."),
    raisedAtMs: numberOr(row.raised_at_ms, 0),
    updatedAtMs: numberOr(row.updated_at_ms, numberOr(row.raised_at_ms, 0)),
    acknowledgedBy: stringOrNull(row.acknowledged_by),
    acknowledgedAtMs: numberOrNull(row.acknowledged_at_ms),
    resolvedAtMs: numberOrNull(row.resolved_at_ms),
    durationMs: numberOrNull(row.duration_ms),
    unattendedMs: numberOrNull(row.unattended_ms),
    silencedBy: stringOrNull(row.silenced_by),
    silencedUntilMs: numberOrNull(row.silenced_until_ms),
    silenceReason: stringOrNull(row.silence_reason),
    escalatedAtMs: numberOrNull(row.escalated_at_ms),
    escalationLevel: numberOr(row.escalation_level, 0),
    repeatCount: numberOr(row.repeat_count, 0),
    context: record(row.context),
  };
}

export function parseAlarms(
  value: unknown,
  origin: AlarmOrigin = "runtime",
): UnifiedAlarm[] {
  return Array.isArray(value) ? value.map((item) => parseAlarm(item, origin)) : [];
}

export function parseCounts(value: unknown): AlarmCounts {
  const row = record(value);
  return {
    active: numberOr(row.active, 0),
    open: numberOr(row.open, 0),
    acknowledged: numberOr(row.acknowledged, 0),
    silenced: numberOr(row.silenced, 0),
    escalated: numberOr(row.escalated, 0),
    critical: numberOr(row.critical, 0),
    history: numberOr(row.history, 0),
    raisedTotal: numberOr(row.raised_total, 0),
    resolvedTotal: numberOr(row.resolved_total, 0),
  };
}

/** `/api/runtime/alarms` yanıtı. */
export function parseAlarmCenter(value: unknown): {
  active: UnifiedAlarm[];
  history: UnifiedAlarm[];
  counts: AlarmCounts;
} {
  const row = record(value);
  return {
    active: parseAlarms(row.active),
    history: parseAlarms(row.history),
    counts: Object.keys(record(row.counts)).length
      ? parseCounts(row.counts)
      : EMPTY_ALARM_COUNTS,
  };
}

export function parseOee(value: unknown): OeeView {
  const row = record(value);
  const percent = record(row.percent);
  return {
    availability: numberOrNull(row.availability),
    performance: numberOrNull(row.performance),
    quality: numberOrNull(row.quality),
    oee: numberOrNull(row.oee),
    percent: {
      availability: numberOrNull(percent.availability),
      performance: numberOrNull(percent.performance),
      quality: numberOrNull(percent.quality),
      oee: numberOrNull(percent.oee),
    },
    reasons: reasonMap(row.reasons),
    complete: row.complete === true,
  };
}

export function parseMonitoringKpi(value: unknown): MonitoringKpi {
  const row = record(value);
  return {
    production: numberOrNull(row.production),
    scrap: numberOrNull(row.scrap),
    queue: numberOrNull(row.queue),
    throughput: numberOrNull(row.throughput),
    availability: numberOrNull(row.availability),
    downtimeMinutes: numberOrNull(row.downtime_minutes),
    activeMachines: numberOr(row.active_machines, 0),
    blockedMachines: numberOr(row.blocked_machines, 0),
    downMachines: numberOr(row.down_machines, 0),
    unknownMachines: numberOr(row.unknown_machines, 0),
    totalMachines: numberOr(row.total_machines, 0),
    measuredMachines: numberOr(row.measured_machines, 0),
    alarmCount: numberOr(row.alarm_count, 0),
    openAlarmCount: numberOr(row.open_alarm_count, 0),
    reasons: reasonMap(row.reasons),
  };
}

export function parseProductionStatus(value: unknown): ProductionStatus {
  const row = record(value);
  return {
    oee: numberOrNull(row.oee),
    oeePercent: numberOrNull(row.oee_percent),
    oeeReasons: reasonMap(row.oee_reasons),
    activeAlarms: numberOr(row.active_alarms, 0),
    openAlarms: numberOr(row.open_alarms, 0),
    runningMachines: numberOr(row.running_machines, 0),
    blockedMachines: numberOr(row.blocked_machines, 0),
    downMachines: numberOr(row.down_machines, 0),
    totalMachines: numberOr(row.total_machines, 0),
    downtimeMinutes: numberOrNull(row.downtime_minutes),
    openDowntime: numberOr(row.open_downtime, 0),
    reasons: reasonMap(row.reasons),
  };
}

function parseEntryType(value: unknown): TimelineEntryType {
  return value === "alarm" ? "alarm" : "downtime";
}

export function parseTimelineEntry(value: unknown): TimelineEntry {
  const row = record(value);
  const type = parseEntryType(row.type);
  return {
    type,
    atMs: numberOr(row.at_ms, 0),
    endMs: numberOrNull(row.end_ms),
    machineId: stringOrNull(row.machine_id),
    durationMs: numberOrNull(row.duration_ms),
    reason: stringOr(row.reason, "Bildirilmedi"),
    severity: type === "alarm" ? parseSeverity(row.severity) : null,
    state: type === "alarm" ? parseAlarmState(row.state) : null,
    open: row.open === true,
  };
}

export function parseTimeline(value: unknown): TimelineEntry[] {
  const row = record(value);
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return entries.map(parseTimelineEntry);
}

function parseHealthConnection(value: unknown): HealthScoreConnection {
  const row = record(value);
  const components = record(row.components);
  const parsed: Record<string, number | null> = {};
  for (const [key, item] of Object.entries(components)) {
    parsed[key] = numberOrNull(item);
  }
  return {
    connectionId: stringOr(row.connection_id, "bilinmiyor"),
    score: numberOrNull(row.score),
    label: stringOr(row.label, "Ölçülmedi"),
    components: parsed,
    missing: Array.isArray(row.missing)
      ? row.missing.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function parseHealthScore(value: unknown): HealthScoreView {
  const row = record(value);
  return {
    score: numberOrNull(row.score),
    label: stringOr(row.label, "Ölçülmedi"),
    connections: Array.isArray(row.connections)
      ? row.connections.map(parseHealthConnection)
      : [],
    measured: numberOr(row.measured, 0),
    total: numberOr(row.total, 0),
  };
}
