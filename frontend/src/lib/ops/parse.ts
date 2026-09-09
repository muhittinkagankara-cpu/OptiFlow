/**
 * Operasyon yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcılar savunmacıdır: eksik alan `null` olur, çökme olmaz. Sayılarda
 * `0` korunur — "ölçüldü ve sıfır" ile "ölçülmedi" farklı bilgilerdir ve
 * ikisini karıştıran bir dönüşüm, hiç ölçülmemiş bir hata oranını "%0" diye
 * gösterirdi.
 */

import type {
  AuditEntry,
  AuditSummary,
  BackupSummary,
  DependencyCheck,
  EnvironmentFinding,
  EnvironmentReport,
  HealthStatus,
  ProcessMetrics,
  ReadinessStatus,
  RestoreSummary,
} from "./types";

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Sayı ya da `null`; `0` korunur, `NaN` ölçülmemiş sayılır. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function countMap(value: unknown): Record<string, number> {
  const source = record(value);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(source)) {
    const parsed = numberOrNull(item);
    if (parsed !== null) result[key] = parsed;
  }
  return result;
}

export function parseHealth(value: unknown): HealthStatus {
  const row = record(value);
  return {
    status: stringOr(row.status, "bilinmiyor"),
    version: stringOr(row.version, "bilinmiyor"),
    uptimeMs: numberOr(row.uptime_ms, 0),
  };
}

export function parseCheck(value: unknown): DependencyCheck {
  const row = record(value);
  return {
    name: stringOr(row.name, "bilinmiyor"),
    ok: row.ok === true,
    detail: stringOr(row.detail, "Ayrıntı bildirilmedi."),
    latencyMs: numberOrNull(row.latency_ms),
  };
}

export function parseFinding(value: unknown): EnvironmentFinding {
  const row = record(value);
  const severity = row.severity === "error" ? "error" : "warning";
  return {
    key: stringOr(row.key, "bilinmiyor"),
    severity,
    severityLabel: stringOr(row.severity_label, severity === "error" ? "Hata" : "Uyarı"),
    message: stringOr(row.message, "Ayrıntı bildirilmedi."),
    remedy: stringOr(row.remedy, ""),
  };
}

export function parseEnvironment(value: unknown): EnvironmentReport {
  const row = record(value);
  return {
    environment: stringOr(row.environment, "bilinmiyor"),
    production: row.production === true,
    ok: row.ok === true,
    errors: Array.isArray(row.errors) ? row.errors.map(parseFinding) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(parseFinding) : [],
  };
}

export function parseReadiness(value: unknown): ReadinessStatus {
  const row = record(value);
  return {
    ready: row.ready === true,
    version: stringOr(row.version, "bilinmiyor"),
    uptimeMs: numberOr(row.uptime_ms, 0),
    environment: stringOr(row.environment, "bilinmiyor"),
    checks: Array.isArray(row.checks) ? row.checks.map(parseCheck) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(parseFinding) : [],
  };
}

export function parseProcessMetrics(value: unknown): ProcessMetrics {
  const row = record(value);
  return {
    uptimeMs: numberOr(row.uptime_ms, 0),
    uptimeSeconds: numberOr(row.uptime_seconds, 0),
    memoryMb: numberOrNull(row.memory_mb),
    cpuPercent: numberOrNull(row.cpu_percent),
    requests: numberOr(row.requests, 0),
    errors: numberOr(row.errors, 0),
    errorRate: numberOrNull(row.error_rate),
    recentErrorRate: numberOrNull(row.recent_error_rate),
    measurementAvailable: row.measurement_available === true,
  };
}

export function parseAuditEntry(value: unknown): AuditEntry {
  const row = record(value);
  const outcome = row.outcome === "failure" ? "failure" : "success";
  return {
    sequence: numberOr(row.sequence, 0),
    orgId: stringOr(row.org_id, ""),
    action: stringOr(row.action, "bilinmiyor"),
    actionLabel: stringOr(row.action_label, "Bilinmeyen işlem"),
    resource: stringOr(row.resource, "bilinmiyor"),
    actor: stringOr(row.actor, "sistem"),
    outcome,
    outcomeLabel: stringOr(
      row.outcome_label,
      outcome === "failure" ? "Başarısız" : "Başarılı",
    ),
    atMs: numberOr(row.at_ms, 0),
    details: record(row.details),
  };
}

export function parseAuditSummary(value: unknown): AuditSummary {
  const row = record(value);
  return {
    total: numberOr(row.total, 0),
    failures: numberOr(row.failures, 0),
    byAction: countMap(row.by_action),
    persistent: row.persistent === true,
    writeErrors: numberOr(row.write_errors, 0),
    lastError: stringOrNull(row.last_error),
  };
}

export function parseAuditPage(value: unknown): {
  entries: AuditEntry[];
  count: number;
  summary: AuditSummary;
} {
  const row = record(value);
  return {
    entries: Array.isArray(row.entries) ? row.entries.map(parseAuditEntry) : [],
    count: numberOr(row.count, 0),
    summary: parseAuditSummary(row.summary),
  };
}

export function parseBackupSummary(value: unknown): BackupSummary {
  const row = record(value);
  return {
    orgId: stringOr(row.org_id, ""),
    atMs: numberOr(row.at_ms, 0),
    checksum: stringOr(row.checksum, ""),
    counts: countMap(row.counts),
    totalRows: numberOr(row.total_rows, 0),
    formatVersion: numberOr(row.format_version, 0),
  };
}

export function parseRestoreSummary(value: unknown): RestoreSummary {
  const row = record(value);
  return {
    orgId: stringOr(row.org_id, ""),
    ok: row.ok === true,
    error: stringOrNull(row.error),
    restored: countMap(row.restored),
    removed: countMap(row.removed),
    totalRestored: numberOr(row.total_restored, 0),
  };
}
