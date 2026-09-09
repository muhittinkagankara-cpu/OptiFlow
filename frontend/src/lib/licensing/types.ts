/**
 * Lisans katmanının türleri.
 *
 * Bu katman **ödeme almaz**; yalnızca hakları ve sınırları taşır. Gerçek bir
 * ödeme sağlayıcısı bağlanmadığı sürece "ödendi" diyen bir alan yoktur.
 *
 * `null` sınır **sınırsız** demektir
 * ---------------------------------
 * Kurumsal planda makine sınırı yoktur ve bu `null` ile yazılır. Çok büyük bir
 * sayı (999999) kullanılsaydı, arayüz "999999 makineden 12'si kullanılıyor"
 * gibi anlamsız bir doluluk gösterirdi.
 *
 * Süresi dolan lisans ekranı karartmaz
 * ------------------------------------
 * Engellenen şey büyümedir: yeni kullanıcı, yeni makine, yeni fabrika. Üretim
 * hattını izleyen bir ekranın ticari bir nedenle kararması, fabrikada gerçek
 * bir arızayı görünmez kılardı.
 */

/** Lisans planı; sunucudaki değerlerle birebir aynı. */
export type LicenseTier = "trial" | "starter" | "growth" | "enterprise";

export const LICENSE_TIER_LABEL: Record<LicenseTier, string> = {
  trial: "Deneme",
  starter: "Başlangıç",
  growth: "Büyüme",
  enterprise: "Kurumsal",
};

/** Ekrandaki sıralama; küçükten büyüğe. */
export const LICENSE_TIER_ORDER: LicenseTier[] = [
  "trial",
  "starter",
  "growth",
  "enterprise",
];

/** Lisansın o andaki durumu. */
export type LicenseStatus =
  | "active"
  | "expiring"
  | "expired"
  | "revoked"
  | "pending"
  | "missing";

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  active: "Etkin",
  expiring: "Bitiyor",
  expired: "Süresi doldu",
  revoked: "İptal edildi",
  pending: "Başlamadı",
  missing: "Lisans yok",
};

/** Bir planın sınırları; `null` sınırsız demektir. */
export interface LicenseLimits {
  users: number | null;
  machines: number | null;
  factories: number | null;
}

/** Lisans kaydı. */
export interface License {
  orgId: string;
  tier: LicenseTier;
  tierLabel: string;
  customer: string;
  startsAtMs: number;
  expiresAtMs: number;
  limits: LicenseLimits;
  revokedAtMs: number | null;
  revokedReason: string | null;
  issuedAtMs: number;
  issuedBy: string;
  status: LicenseStatus | null;
  statusLabel: string | null;
  /** Bitişe kalan süre; süresi dolduysa `null`. */
  remainingMs: number | null;
  remainingDays: number | null;
  isTrial: boolean;
}

/** Kiracının kullanımı; sayılamayan kaynak `null`. */
export interface UsageCounts {
  users: number | null;
  machines: number | null;
  factories: number | null;
}

/** Tek bir sınırın durumu. */
export interface LimitCheck {
  resource: string;
  label: string;
  used: number | null;
  limit: number | null;
  /** Sınır aşıldı mı? Ölçülemiyorsa `null` — "aşılmadı" demek değildir. */
  exceeded: boolean | null;
  ratio: number | null;
  reason: string | null;
}

/** Lisans ekranının tam görünümü. */
export interface LicenseView {
  license: License | null;
  status: LicenseStatus;
  statusLabel: string;
  limits: LimitCheck[];
  usage: UsageCounts;
  /** Süresi dolduğunda engellenen işlemler. */
  blocked: string[];
  healthy: boolean;
  /** Sorun varsa nedeni; yoksa `null`. */
  reason: string | null;
}

/** Lisans okunmadan önceki görünüm. */
export const EMPTY_LICENSE_VIEW: LicenseView = {
  license: null,
  status: "missing",
  statusLabel: LICENSE_STATUS_LABEL.missing,
  limits: [],
  usage: { users: null, machines: null, factories: null },
  blocked: [],
  healthy: false,
  reason: "Lisans durumu henüz okunmadı.",
};
