/**
 * Tanılama yanıtlarının çözümlenmesi.
 *
 * Sunucu bir ölçütü ölçememişse `value` `null` gelir ve `reason` doludur.
 * Ayrıştırıcı bu ayrımı **korur**: eksik bir değeri sıfıra çevirmek, ölçüm
 * yapılmış izlenimi verirdi.
 */

import { numberOr, numberOrNull, record, stringOr, stringOrNull } from "../monitoring/parse";
import {
  DIAGNOSTIC_LEVEL_LABEL,
  DIAGNOSTIC_LEVEL_ORDER,
  EMPTY_DIAGNOSTICS,
  LIVENESS_LABEL,
  type CleanupStats,
  type DiagnosticLevel,
  type DiagnosticMetric,
  type DiagnosticsReport,
  type Liveness,
  type StreamLiveness,
} from "./types";

const LIVENESS_VALUES: Liveness[] = ["live", "idle", "stale", "unknown"];

/**
 * Tanınmayan seviye "ölçülmedi" olur.
 *
 * "Normal"e düşseydi, sunucunun anlamadığımız bir uyarısı sağlıklı görünürdü;
 * "kritik"e düşseydi, sürüm farkı yüzünden yanlış alarm verirdi.
 */
export function parseLevel(value: unknown): DiagnosticLevel {
  return DIAGNOSTIC_LEVEL_ORDER.includes(value as DiagnosticLevel)
    ? (value as DiagnosticLevel)
    : "unknown";
}

export function parseLiveness(value: unknown): Liveness {
  return LIVENESS_VALUES.includes(value as Liveness) ? (value as Liveness) : "unknown";
}

export function parseMetric(value: unknown): DiagnosticMetric {
  const row = record(value);
  const level = parseLevel(row.level);
  const measured = numberOrNull(row.value);
  return {
    id: stringOr(row.id, "bilinmiyor"),
    label: stringOr(row.label, "Ölçüt"),
    value: measured,
    unit: stringOrNull(row.unit),
    level,
    // Ölçülmemiş bir ölçüt nedensiz kalmamalı: arayüz "—" işaretinin yanında
    // niçin ölçülemediğini yazar.
    reason:
      stringOrNull(row.reason) ??
      (measured === null ? "Sunucu bu ölçütü bildirmedi" : null),
    measured: measured !== null,
  };
}

export function parseMetrics(value: unknown): DiagnosticMetric[] {
  return Array.isArray(value) ? value.map(parseMetric) : [];
}

export function parseStream(value: unknown): StreamLiveness {
  const row = record(value);
  const liveness = parseLiveness(row.liveness);
  return {
    connectorId: stringOr(row.connector_id, "bilinmiyor"),
    lastDataMs: numberOrNull(row.last_data_ms),
    ageMs: numberOrNull(row.age_ms),
    liveness,
    livenessLabel: stringOr(row.liveness_label, LIVENESS_LABEL[liveness]),
    reconnects: numberOr(row.reconnects, 0),
    attempt: numberOr(row.attempt, 0),
    outageStartedMs: numberOrNull(row.outage_started_ms),
  };
}

export function parseStreams(value: unknown): StreamLiveness[] {
  return Array.isArray(value) ? value.map(parseStream) : [];
}

export function parseCleanup(value: unknown): CleanupStats {
  const row = record(value);
  const policy = record(row.policy);
  return {
    runs: numberOr(row.runs, 0),
    totalDeleted: numberOr(row.total_deleted, 0),
    errors: numberOr(row.errors, 0),
    lastError: stringOrNull(row.last_error),
    lastRunMs: numberOrNull(row.last_run_ms),
    retentionDays: numberOr(policy.retention_days, 0),
  };
}

/** `/api/runtime/diagnostics` yanıtı. */
export function parseDiagnostics(value: unknown): DiagnosticsReport {
  const row = record(value);
  if (Object.keys(row).length === 0) return EMPTY_DIAGNOSTICS;
  const metrics = parseMetrics(row.metrics);
  const level = parseLevel(row.level);
  return {
    atMs: numberOr(row.at_ms, 0),
    level,
    levelLabel: stringOr(row.level_label, DIAGNOSTIC_LEVEL_LABEL[level]),
    metrics,
    streams: parseStreams(row.streams),
    measuredCount: numberOr(row.measured_count, metrics.filter((m) => m.measured).length),
    metricCount: numberOr(row.metric_count, metrics.length),
    cleanup: parseCleanup(row.cleanup),
    telemetryRows: numberOr(row.telemetry_rows, 0),
    oldestTelemetryMs: numberOrNull(row.oldest_telemetry_ms),
    persistenceMode: stringOr(row.persistence_mode, "bilinmiyor"),
  };
}

/** `/api/runtime/continuity` yanıtı. */
export function parseContinuity(value: unknown): StreamLiveness[] {
  return parseStreams(record(value).streams);
}
