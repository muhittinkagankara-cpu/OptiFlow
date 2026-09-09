/**
 * Devreye alma yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcı, sunucunun üç değerli alanlarını **üç değerli tutar**: `null`
 * "ölçülemedi" demektir ve `false`'a çevrilmez. Çevrilseydi, okunamayan bir
 * adım "yapılmadı" diye raporlanırdı.
 */

import { numberOr, numberOrNull, record, stringOr, stringOrNull } from "../monitoring/parse";
import {
  EMPTY_DEPLOYMENT,
  EMPTY_FIELD_DIAGNOSTICS,
  PROBE_STATE_LABEL,
  STEP_STATE_LABEL,
  TOKEN_STATUS_LABEL,
  type ChecklistStep,
  type DeploymentReport,
  type DiagnosticLine,
  type FieldDiagnostics,
  type InstallToken,
  type IssuedToken,
  type LabelReview,
  type MachineLabel,
  type ProbeState,
  type StepState,
  type TokenLogEntry,
  type TokenStatus,
} from "./types";

const TOKEN_STATUSES: TokenStatus[] = ["active", "used", "expired", "revoked"];
const STEP_STATES: StepState[] = ["done", "pending", "unknown"];
const PROBE_STATES: ProbeState[] = ["ok", "warning", "failed", "unknown"];

/**
 * Tanınmayan token durumu "süresi doldu" olur.
 *
 * "Kullanılabilir"e düşmek, sunucunun anlamadığımız bir durumundaki tokenı
 * kullanılabilir göstermek olurdu; güvenli yön kapalı olandır.
 */
export function parseTokenStatus(value: unknown): TokenStatus {
  return TOKEN_STATUSES.includes(value as TokenStatus)
    ? (value as TokenStatus)
    : "expired";
}

/** Tanınmayan adım durumu "ölçülemedi" olur. */
export function parseStepState(value: unknown): StepState {
  return STEP_STATES.includes(value as StepState) ? (value as StepState) : "unknown";
}

/** Tanınmayan tanılama durumu "ölçülmedi" olur. */
export function parseProbeState(value: unknown): ProbeState {
  return PROBE_STATES.includes(value as ProbeState) ? (value as ProbeState) : "unknown";
}

export function parseLogEntry(value: unknown): TokenLogEntry {
  const row = record(value);
  return {
    atMs: numberOr(row.at_ms, 0),
    action: stringOr(row.action, "bilinmiyor"),
    actor: stringOrNull(row.actor),
    detail: stringOrNull(row.step) ?? stringOrNull(row.reason) ?? stringOrNull(row.from),
  };
}

export function parseToken(value: unknown): InstallToken {
  const row = record(value);
  const status = parseTokenStatus(row.status);
  return {
    id: stringOr(row.id, "bilinmiyor"),
    digestPrefix: stringOr(row.digest_prefix, ""),
    createdAtMs: numberOr(row.created_at_ms, 0),
    expiresAtMs: numberOr(row.expires_at_ms, 0),
    createdBy: stringOr(row.created_by, "sistem"),
    site: stringOr(row.site, ""),
    usedAtMs: numberOrNull(row.used_at_ms),
    usedBy: stringOrNull(row.used_by),
    usedFrom: stringOrNull(row.used_from),
    revokedAtMs: numberOrNull(row.revoked_at_ms),
    revokedReason: stringOrNull(row.revoked_reason),
    usageLog: Array.isArray(row.usage_log) ? row.usage_log.map(parseLogEntry) : [],
    status,
    statusLabel: stringOr(row.status_label, TOKEN_STATUS_LABEL[status]),
    remainingMs: numberOrNull(row.remaining_ms),
    usable: row.usable === true,
  };
}

export function parseTokens(value: unknown): InstallToken[] {
  const row = record(value);
  return Array.isArray(row.tokens) ? row.tokens.map(parseToken) : [];
}

/**
 * Üretim yanıtı; token metni yalnızca burada bulunur.
 *
 * Metin boş gelirse üretim başarısız olmuştur ve arayüz bunu göstermelidir —
 * boş bir metni "token" diye kopyalatmak, kurulumu sahada bozar.
 */
export function parseIssuedToken(value: unknown): IssuedToken {
  const row = record(value);
  return {
    ...parseToken(value),
    token: stringOr(row.token, ""),
    note: stringOr(row.note, ""),
  };
}

export function parseMachineLabel(value: unknown): MachineLabel {
  const row = record(value);
  return {
    machineId: stringOr(row.machine_id, ""),
    label: stringOr(row.label, ""),
    line: stringOr(row.line, ""),
    qr: stringOr(row.qr, ""),
    printedAtMs: numberOrNull(row.printed_at_ms),
    createdAtMs: numberOr(row.created_at_ms, 0),
    createdBy: stringOr(row.created_by, "sistem"),
    note: stringOr(row.note, ""),
  };
}

/** `/api/runtime/machine-labels` yanıtı. */
export function parseLabelReview(value: unknown): LabelReview {
  const row = record(value);
  const suggestions: Record<string, string | null> = {};
  const raw = record(row.suggestions);
  for (const [machine, suggestion] of Object.entries(raw)) {
    // Türetilemeyen öneri `null` kalır; uydurulmuş bir etiket sahada yanlış
    // makineye yapıştırılan kâğıt demektir.
    suggestions[machine] = typeof suggestion === "string" ? suggestion : null;
  }
  return {
    labels: Array.isArray(row.labels) ? row.labels.map(parseMachineLabel) : [],
    duplicates: Array.isArray(row.duplicates)
      ? row.duplicates.map((item) => stringOr(item, "")).filter((item) => item.length > 0)
      : [],
    unlabeled: Array.isArray(row.unlabeled)
      ? row.unlabeled.map((item) => stringOr(item, "")).filter((item) => item.length > 0)
      : [],
    suggestions,
    machineCount: numberOr(row.machine_count, 0),
  };
}

export function parseChecklistStep(value: unknown): ChecklistStep {
  const row = record(value);
  const state = parseStepState(row.state);
  return {
    id: stringOr(row.id, "bilinmiyor"),
    label: stringOr(row.label, "Adım"),
    state,
    // Nedeni olmayan bir adım kullanıcıya hiçbir şey söylemez.
    reason: stringOr(row.reason, STEP_STATE_LABEL[state]),
    action: stringOrNull(row.action),
  };
}

/** `/api/runtime/deployment-checklist` yanıtı. */
export function parseDeployment(value: unknown): DeploymentReport {
  const row = record(value);
  if (Object.keys(row).length === 0) return EMPTY_DEPLOYMENT;
  const steps = Array.isArray(row.steps) ? row.steps.map(parseChecklistStep) : [];
  return {
    steps,
    done: numberOr(row.done, steps.filter((item) => item.state === "done").length),
    pending: numberOr(row.pending, 0),
    unknown: numberOr(row.unknown, 0),
    total: numberOr(row.total, steps.length),
    ready: row.ready === true,
    ratio: numberOrNull(row.ratio),
    summary: stringOr(row.summary, "Kontrol listesi okundu."),
  };
}

export function parseDiagnosticLine(value: unknown): DiagnosticLine {
  const row = record(value);
  const state = parseProbeState(row.state);
  const measured = numberOrNull(row.value);
  const text = stringOrNull(row.text);
  return {
    id: stringOr(row.id, "bilinmiyor"),
    label: stringOr(row.label, "Ölçüt"),
    state,
    value: measured,
    unit: stringOrNull(row.unit),
    text,
    reason:
      stringOrNull(row.reason) ??
      (measured === null && text === null ? "Sunucu bu satırı bildirmedi" : null),
    measured: measured !== null || text !== null,
  };
}

/** `/api/runtime/field-diagnostics` yanıtı. */
export function parseFieldDiagnostics(value: unknown): FieldDiagnostics {
  const row = record(value);
  if (Object.keys(row).length === 0) return EMPTY_FIELD_DIAGNOSTICS;
  const lines = Array.isArray(row.lines) ? row.lines.map(parseDiagnosticLine) : [];
  const state = parseProbeState(row.state);
  return {
    atMs: numberOr(row.at_ms, 0),
    endpoint: stringOr(row.endpoint, ""),
    state,
    stateLabel: stringOr(row.state_label, PROBE_STATE_LABEL[state]),
    lines,
    measuredCount: numberOr(
      row.measured_count,
      lines.filter((item) => item.measured).length,
    ),
    lineCount: numberOr(row.line_count, lines.length),
  };
}
