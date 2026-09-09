/**
 * Abonelik hazırlığı — ödeme **alınmaz**.
 *
 * Stripe ya da başka bir ödeme sağlayıcısı bağlı değil. Bu ekran yalnızca
 * paketleri, limitleri ve mevcut kullanımın limite göre yerini gösterir;
 * "Yükselt" düğmesi bir ödeme akışı başlatmaz ve arayüz bunu yazar.
 *
 * Fiyatlar **satış katmanından** okunur (`lib/sales/pricing.ts`). İkinci bir
 * fiyat listesi tutmak, teklifte ve üründe farklı rakamlar görünmesine yol
 * açardı — bu, müşteriyle yaşanabilecek en kötü tutarsızlıktır.
 */

import { PLANS, PLAN_ORDER, monthlyFor, type PlanId } from "../sales";

/** Paket başına kaynak limitleri. */
export interface PlanLimits {
  /** Kullanıcı sayısı sınırı; sınırsızsa `null`. */
  users: number | null;
  /** Fabrika sayısı sınırı; sınırsızsa `null`. */
  factories: number | null;
  /** Veri kaynağı (bağlayıcı) sınırı; sınırsızsa `null`. */
  connectors: number | null;
}

/**
 * Limitler.
 *
 * Starter tek kullanıcılıdır: paket zaten tek kişilik bir başlangıç aboneliği
 * olarak satılıyor. Enterprise'da sınır yoktur ve bu `null` ile gösterilir —
 * sıfırla karıştırılmaması için.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: { users: 1, factories: 1, connectors: 1 },
  growth: { users: 10, factories: 5, connectors: 5 },
  enterprise: { users: null, factories: null, connectors: null },
};

export interface UsageSnapshot {
  users: number;
  factories: number;
  connectors: number;
}

export type LimitStatus = "ok" | "near" | "over" | "unlimited";

export interface LimitRow {
  key: keyof PlanLimits;
  label: string;
  used: number;
  limit: number | null;
  /** 0-1 arası doluluk; sınırsızda `null`. */
  ratio: number | null;
  status: LimitStatus;
  note: string;
}

/** Doluluğun bu oranını geçen limit "sınıra yaklaştı" sayılır. */
export const NEAR_LIMIT_RATIO = 0.8;

const LABELS: Record<keyof PlanLimits, string> = {
  users: "Kullanıcı",
  factories: "Fabrika",
  connectors: "Veri kaynağı",
};

/** Tek bir limitin durumu. */
export function limitRow(
  key: keyof PlanLimits,
  used: number,
  limit: number | null,
): LimitRow {
  if (limit === null) {
    return {
      key,
      label: LABELS[key],
      used,
      limit: null,
      ratio: null,
      status: "unlimited",
      note: "Sınırsız",
    };
  }

  const ratio = limit === 0 ? 1 : used / limit;
  const status: LimitStatus =
    used > limit ? "over" : ratio >= NEAR_LIMIT_RATIO ? "near" : "ok";

  return {
    key,
    label: LABELS[key],
    used,
    limit,
    ratio: Math.min(1, Math.max(0, ratio)),
    status,
    note:
      status === "over"
        ? `Limit aşıldı: ${used}/${limit}`
        : status === "near"
          ? `Sınıra yaklaşıldı: ${used}/${limit}`
          : `${used}/${limit}`,
  };
}

/** Paketin bütün limit satırları. */
export function limitRows(tier: PlanId, usage: UsageSnapshot): LimitRow[] {
  const limits = PLAN_LIMITS[tier];
  return [
    limitRow("users", usage.users, limits.users),
    limitRow("factories", usage.factories, limits.factories),
    limitRow("connectors", usage.connectors, limits.connectors),
  ];
}

/** Herhangi bir limit aşıldı mı? */
export function isOverLimit(tier: PlanId, usage: UsageSnapshot): boolean {
  return limitRows(tier, usage).some((row) => row.status === "over");
}

/**
 * Mevcut kullanımı taşıyabilecek en küçük paket.
 *
 * "Şu an hangi pakete ihtiyacınız var?" sorusunun yanıtıdır ve satış
 * konuşmasında kullanılan öneriyle **aynı** motordan çıkar.
 */
export function smallestFittingPlan(usage: UsageSnapshot): PlanId {
  const fitting = PLAN_ORDER.find((tier) => !isOverLimit(tier, usage));
  return fitting ?? "enterprise";
}

export interface PlanCard {
  id: PlanId;
  label: string;
  /** Makine sayısına göre hesaplanan aylık ücret. */
  monthly: number;
  setupFee: number;
  limits: PlanLimits;
  features: string[];
  /** Bu paket mevcut kullanımı taşıyabilir mi? */
  fitsUsage: boolean;
  isCurrent: boolean;
  isRecommended: boolean;
}

/**
 * Paket kartları.
 *
 * Aylık ücret, satış katmanının `monthlyFor` işleviyle hesaplanır: makine
 * sayısı arttıkça fiyat da artar ve bu, teklifte görülen rakamla birebir aynı
 * formülden çıkar.
 */
export function planCards(
  current: PlanId,
  usage: UsageSnapshot,
  machineCount: number,
): PlanCard[] {
  const recommended = smallestFittingPlan(usage);

  return PLAN_ORDER.map((id) => {
    const plan = PLANS[id];

    return {
      id,
      label: plan.label,
      monthly: monthlyFor(id, machineCount),
      setupFee: plan.setupFee,
      limits: PLAN_LIMITS[id],
      features: plan.features,
      fitsUsage: !isOverLimit(id, usage),
      isCurrent: id === current,
      isRecommended: id === recommended && id !== current,
    };
  });
}

/**
 * Ödeme akışının durumu.
 *
 * Tek bir yerde durur ve arayüz bunu aynen gösterir: ödeme sağlayıcısı bağlı
 * olmadığı sürece "Yükselt" düğmesi bir şey satın almaz.
 */
export const BILLING_NOTE =
  "Ödeme sağlayıcısı bağlı değil. Paket değişikliği bu ekrandan yapılamaz; satış ekibiyle görüşmeniz gerekir.";

/** Yükseltme düğmesine basıldığında ne olacağı. */
export function upgradeAvailability(): { available: false; reason: string } {
  return { available: false, reason: BILLING_NOTE };
}
