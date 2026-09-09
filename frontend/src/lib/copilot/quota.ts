/**
 * Kota motoru — paket başına analiz hakkı.
 *
 * Sınırlar satış katmanındaki paketlerle aynı adları taşır ve tek bir yerde
 * durur. İki yerde tanımlansaydı, teklifte "aylık 100 analiz" yazan bir müşteri
 * üründe başka bir sınıra çarpardı.
 *
 * Motorun tamamı saftır: sayaç, dönem sıfırlaması ve uyarı eşikleri hep
 * dışarıdan verilen `nowMs` ile hesaplanır. Saat içeride okunsaydı, "dönem
 * bitince sıfırlanıyor mu?" sorusu ancak otuz gün beklenerek sınanabilirdi.
 */

import type { CopilotTier, QuotaSnapshot, QuotaState } from "./types";

/**
 * Paket başına dönem hakkı.
 *
 * `starter` sıfırdır: AI kapalıdır ve arayüz bunu yükseltme çağrısıyla söyler.
 * `enterprise` `null`'dır — sınırsız; sıfır ile karıştırılmaması için ayrı bir
 * değer kullanılır.
 */
export const QUOTA_LIMITS: Record<CopilotTier, number | null> = {
  starter: 0,
  growth: 100,
  enterprise: null,
};

/** Dönem uzunluğu (gün). */
export const PERIOD_DAYS = 30;

export const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1_000;

/** Kalan hak bu oranın altına düştüğünde uyarı gösterilir. */
export const WARNING_RATIO = 0.2;

/** Kalan hak bu sayının altındaysa uyarı her hâlükârda gösterilir. */
export const WARNING_ABSOLUTE = 10;

/** Yeni bir hesabın kota durumu. */
export function initialQuota(tier: CopilotTier, nowMs: number): QuotaState {
  return { tier, used: 0, periodStartMs: nowMs };
}

/** Dönem sonu. */
export function periodEnd(state: QuotaState): number {
  return state.periodStartMs + PERIOD_MS;
}

/**
 * Dönemi gerekiyorsa yeniler.
 *
 * Sıfırlama okuma anında yapılır; arka planda bir zamanlayıcıya bağlanmaz.
 * Zamanlayıcıya bağlansaydı, sekmesi kapalı duran bir kullanıcının dönemi hiç
 * yenilenmezdi.
 */
export function resetIfExpired(state: QuotaState, nowMs: number): QuotaState {
  if (nowMs < periodEnd(state)) {
    return state;
  }
  /*
   * Kaç dönem geçtiyse o kadar ileri alınır; tek dönem eklemek, aylarca
   * kullanılmayan bir hesapta dönem başlangıcını geçmişte bırakırdı.
   */
  const elapsed = nowMs - state.periodStartMs;
  const periods = Math.floor(elapsed / PERIOD_MS);
  return {
    tier: state.tier,
    used: 0,
    periodStartMs: state.periodStartMs + periods * PERIOD_MS,
  };
}

/** Paketin dönem sınırı. */
export function limitOf(tier: CopilotTier): number | null {
  return QUOTA_LIMITS[tier];
}

/** Kalan hak; sınırsız pakette `null`. */
export function remaining(state: QuotaState, nowMs: number): number | null {
  const current = resetIfExpired(state, nowMs);
  const limit = limitOf(current.tier);
  if (limit === null) {
    return null;
  }
  return Math.max(0, limit - current.used);
}

/** Yeni bir analiz yapılabilir mi? */
export function canAsk(state: QuotaState, nowMs: number): boolean {
  const left = remaining(state, nowMs);
  return left === null || left > 0;
}

/**
 * Bir analiz harcar.
 *
 * Hak yoksa sayaç **artmaz** ve `allowed: false` döner: reddedilen bir isteğin
 * kotadan düşmesi, kullanıcının hakkını sessizce yemek olurdu.
 */
export function consume(
  state: QuotaState,
  nowMs: number,
): { state: QuotaState; allowed: boolean; reason: string | null } {
  const current = resetIfExpired(state, nowMs);
  const limit = limitOf(current.tier);

  if (limit === 0) {
    return {
      state: current,
      allowed: false,
      reason:
        "Starter pakette AI Copilot kapalıdır. Growth pakete geçtiğinizde dönem başına 100 analiz açılır.",
    };
  }

  if (limit !== null && current.used >= limit) {
    return {
      state: current,
      allowed: false,
      reason: `Bu dönemin ${limit} analiz hakkı doldu. Hak, ${PERIOD_DAYS} günlük dönem yenilendiğinde geri gelir.`,
    };
  }

  return {
    state: { ...current, used: current.used + 1 },
    allowed: true,
    reason: null,
  };
}

/**
 * Kullanıcıya gösterilecek uyarı.
 *
 * Hak bittiğinde değil, **bitmeden önce** uyarılır: bir yöneticinin sunum
 * ortasında hakkının bittiğini öğrenmesi, ürünün suçu olarak görülür.
 */
export function warningFor(state: QuotaState, nowMs: number): string | null {
  const left = remaining(state, nowMs);
  const limit = limitOf(state.tier);

  if (limit === 0) {
    return "Starter pakette AI Copilot kapalı.";
  }
  if (left === null || limit === null) {
    return null;
  }
  if (left === 0) {
    return "Analiz hakkınız doldu.";
  }
  if (left <= Math.max(WARNING_ABSOLUTE, Math.ceil(limit * WARNING_RATIO))) {
    return `${left} analiz hakkınız kaldı.`;
  }
  return null;
}

/** Arayüzün okuduğu tek özet. */
export function quotaSnapshot(state: QuotaState, nowMs: number): QuotaSnapshot {
  const current = resetIfExpired(state, nowMs);
  const limit = limitOf(current.tier);

  return {
    tier: current.tier,
    used: current.used,
    limit,
    remaining: remaining(current, nowMs),
    periodEndMs: periodEnd(current),
    warning: warningFor(current, nowMs),
    allowed: canAsk(current, nowMs),
  };
}

/* -------------------------------------------------------------------------- */
/* Saklama                                                                     */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "optiflow.copilot.quota";

export function isValidQuota(value: unknown): value is QuotaState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    (item.tier === "starter" || item.tier === "growth" || item.tier === "enterprise") &&
    typeof item.used === "number" &&
    Number.isFinite(item.used) &&
    item.used >= 0 &&
    typeof item.periodStartMs === "number"
  );
}

export function parseQuota(
  raw: string | null,
  fallback: QuotaState,
): QuotaState {
  if (raw === null) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidQuota(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function recallQuota(fallback: QuotaState): QuotaState {
  try {
    return parseQuota(window.localStorage.getItem(STORAGE_KEY), fallback);
  } catch {
    // Gizli sekmede depolama okuması hata verir; kota o oturum için sıfırdan
    // başlar ve bu, uygulamayı durdurmaktan iyidir.
    return fallback;
  }
}

export function rememberQuota(state: QuotaState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Depolama yoksa kota yalnızca bu oturumda yaşar. */
  }
}
