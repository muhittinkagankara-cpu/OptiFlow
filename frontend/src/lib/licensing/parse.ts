/**
 * Lisans yanıtlarının çözümlenmesi.
 *
 * En kritik ayrım burada korunur: bir sınır için `null` **sınırsız**, bir
 * kullanım için `null` **sayılamadı** demektir. İkisi de sıfıra çevrilseydi,
 * kurumsal plan en kısıtlı plan olur ve bozuk bir sayaç sınırın hiç dolmadığı
 * izlenimini verirdi.
 */

import { numberOr, numberOrNull, record, stringOr, stringOrNull } from "../monitoring/parse";
import {
  EMPTY_LICENSE_VIEW,
  LICENSE_STATUS_LABEL,
  LICENSE_TIER_LABEL,
  LICENSE_TIER_ORDER,
  type License,
  type LicenseLimits,
  type LicenseStatus,
  type LicenseTier,
  type LicenseView,
  type LimitCheck,
  type UsageCounts,
} from "./types";

const STATUSES: LicenseStatus[] = [
  "active",
  "expiring",
  "expired",
  "revoked",
  "pending",
  "missing",
];

/**
 * Tanınmayan plan "deneme" olur.
 *
 * Kurumsala düşseydi, sunucunun anlamadığımız bir planı sınırsız görünür ve
 * sınır hiç uygulanmazdı. En dar plana düşmek güvenli yöndür.
 */
export function parseTier(value: unknown): LicenseTier {
  return LICENSE_TIER_ORDER.includes(value as LicenseTier)
    ? (value as LicenseTier)
    : "trial";
}

/**
 * Tanınmayan durum "lisans yok" olur.
 *
 * "Etkin"e düşmek, sunucunun anlamadığımız bir durumunu sağlıklı göstermek
 * olurdu.
 */
export function parseStatus(value: unknown): LicenseStatus {
  return STATUSES.includes(value as LicenseStatus)
    ? (value as LicenseStatus)
    : "missing";
}

export function parseLimits(value: unknown): LicenseLimits {
  const row = record(value);
  return {
    users: numberOrNull(row.users),
    machines: numberOrNull(row.machines),
    factories: numberOrNull(row.factories),
  };
}

export function parseUsage(value: unknown): UsageCounts {
  const row = record(value);
  return {
    users: numberOrNull(row.users),
    machines: numberOrNull(row.machines),
    factories: numberOrNull(row.factories),
  };
}

export function parseLicense(value: unknown): License | null {
  const row = record(value);
  if (Object.keys(row).length === 0) return null;
  const tier = parseTier(row.tier);
  const status = row.status === null || row.status === undefined ? null : parseStatus(row.status);
  return {
    orgId: stringOr(row.org_id, ""),
    tier,
    tierLabel: stringOr(row.tier_label, LICENSE_TIER_LABEL[tier]),
    customer: stringOr(row.customer, ""),
    startsAtMs: numberOr(row.starts_at_ms, 0),
    expiresAtMs: numberOr(row.expires_at_ms, 0),
    limits: parseLimits(row.limits),
    revokedAtMs: numberOrNull(row.revoked_at_ms),
    revokedReason: stringOrNull(row.revoked_reason),
    issuedAtMs: numberOr(row.issued_at_ms, 0),
    issuedBy: stringOr(row.issued_by, "sistem"),
    status,
    statusLabel:
      status === null ? null : stringOr(row.status_label, LICENSE_STATUS_LABEL[status]),
    remainingMs: numberOrNull(row.remaining_ms),
    remainingDays: numberOrNull(row.remaining_days),
    isTrial: row.is_trial === true,
  };
}

export function parseLimitCheck(value: unknown): LimitCheck {
  const row = record(value);
  return {
    resource: stringOr(row.resource, "bilinmiyor"),
    label: stringOr(row.label, "Sınır"),
    used: numberOrNull(row.used),
    limit: numberOrNull(row.limit),
    // Yalnızca gerçek bir `true`/`false` kabul edilir; eksik alan `null` kalır
    // ve arayüz "ölçülemedi" der.
    exceeded: typeof row.exceeded === "boolean" ? row.exceeded : null,
    ratio: numberOrNull(row.ratio),
    reason: stringOrNull(row.reason),
  };
}

/** `/api/runtime/license` yanıtı. */
export function parseLicenseView(value: unknown): LicenseView {
  const row = record(value);
  if (Object.keys(row).length === 0) return EMPTY_LICENSE_VIEW;
  const status = parseStatus(row.status);
  return {
    license: parseLicense(row.license),
    status,
    statusLabel: stringOr(row.status_label, LICENSE_STATUS_LABEL[status]),
    limits: Array.isArray(row.limits) ? row.limits.map(parseLimitCheck) : [],
    usage: parseUsage(row.usage),
    blocked: Array.isArray(row.blocked)
      ? row.blocked.map((item) => stringOr(item, "")).filter((item) => item.length > 0)
      : [],
    healthy: row.healthy === true,
    reason: stringOrNull(row.reason),
  };
}
