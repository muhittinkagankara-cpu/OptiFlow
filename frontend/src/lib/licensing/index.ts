/**
 * Lisans katmanı.
 *
 *     /api/runtime/license → parse → format → ekran
 *
 * Bu katman ödeme almaz; hakları ve sınırları taşır. Süresi dolan bir lisans
 * izlemeyi kesmez — engellenen şey büyümedir.
 */

export {
  NOT_MEASURED,
  UNLIMITED,
  blockedLabel,
  licenseCaption,
  licenseWarning,
  limitRatio,
  limitTone,
  limitValue,
  remainingLabel,
  statusLabel,
  tierLabel,
} from "./format";
export {
  parseLicense,
  parseLicenseView,
  parseLimitCheck,
  parseLimits,
  parseStatus,
  parseTier,
  parseUsage,
} from "./parse";
export {
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
