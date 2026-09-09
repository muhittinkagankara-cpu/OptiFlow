/**
 * Yeniden bağlanma motoru — üstel geri çekilme (exponential backoff).
 *
 * Bir fabrika ağında bağlantı kopar: anahtar yeniden başlar, kablo tekmelenir,
 * PLC bakıma alınır. Kopan bağlantıyı saniyede bir yeniden denemek iki şeyi
 * birden bozar — ağı gereksiz yükler ve olay günlüğünü kullanılmaz hâle
 * getirir. Bu yüzden bekleme süresi her denemede ikiye katlanır ve bir tavana
 * oturur.
 *
 * Zaman **dışarıdan** verilir. `Date.now()` burada okunsaydı, "beşinci deneme
 * ne zaman?" sorusu ancak gerçek zamanda bekleyerek sınanabilirdi.
 */

import type { ConnectorRuntime, ConnectorStatus } from "./types";

/** İlk yeniden deneme bu kadar bekler. */
export const BASE_DELAY_MS = 1_000;

/** Her denemede bekleme bu katsayıyla büyür. */
export const BACKOFF_FACTOR = 2;

/**
 * Beklemenin üst sınırı.
 *
 * Bir dakika, bir insanın "hâlâ mı bağlanmadı?" diye bakma aralığıdır. Daha
 * uzun bir tavan, ağ geri geldiğinde bağlantının dakikalarca ölü kalmasına yol
 * açardı.
 */
export const MAX_DELAY_MS = 60_000;

/**
 * Bu kadar başarısız denemeden sonra vazgeçilir.
 *
 * Sonsuz denemek, gerçekte yanlış yapılandırılmış bir bağlantıyı sonsuza kadar
 * "yeniden deniyor" olarak gösterirdi; kullanıcı yanlış adresi hiç fark etmezdi.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Verilen denemenin bekleme süresi.
 *
 * `attempt` 1'den başlar: birinci yeniden deneme `BASE_DELAY_MS` bekler,
 * ikincisi iki katı, üçüncüsü dört katı. Sıfır ve negatif değerler taban
 * süreye çekilir — çağıranın sayaç hatası, sıfır beklemeli bir döngüye
 * dönüşmemelidir.
 */
export function backoffDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const delay = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, safeAttempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/** Bir sonraki denemenin zamanı. */
export function nextRetryAt(attempt: number, nowMs: number): number {
  return nowMs + backoffDelay(attempt);
}

/** Denemenin sonucu. */
export type AttemptOutcome = "success" | "failure";

export interface RetryState {
  status: ConnectorStatus;
  attempt: number;
  nextRetryAtMs: number | null;
}

/**
 * Bir denemenin sonucunu duruma işler.
 *
 * Başarıda sayaç sıfırlanır: art arda gelen kısa kopmalarda bekleme süresinin
 * birikmesi, sağlıklı bir hattı giderek yavaşlatırdı.
 *
 * `autoReconnect` kapalıysa başarısızlık doğrudan `failed`'a gider; kullanıcı
 * kendi bağlanmayı seçmiştir ve arkasından sessizce denemeye devam etmek,
 * bakım için bilerek kapatılmış bir hattı sürekli rahatsız etmek olurdu.
 */
export function applyAttempt(
  current: RetryState,
  outcome: AttemptOutcome,
  nowMs: number,
  autoReconnect = true,
): RetryState {
  if (outcome === "success") {
    return { status: "connected", attempt: 0, nextRetryAtMs: null };
  }

  const attempt = current.attempt + 1;

  if (!autoReconnect || attempt >= MAX_ATTEMPTS) {
    return { status: "failed", attempt, nextRetryAtMs: null };
  }

  return {
    status: "retrying",
    attempt,
    nextRetryAtMs: nextRetryAt(attempt, nowMs),
  };
}

/** Bekleyen bir denemenin vakti geldi mi? */
export function isRetryDue(runtime: ConnectorRuntime, nowMs: number): boolean {
  return (
    runtime.status === "retrying" &&
    runtime.nextRetryAtMs !== null &&
    nowMs >= runtime.nextRetryAtMs
  );
}

/** Bir sonraki denemeye kalan süre (ms); beklemiyorsa `null`. */
export function timeUntilRetry(
  runtime: ConnectorRuntime,
  nowMs: number,
): number | null {
  if (runtime.status !== "retrying" || runtime.nextRetryAtMs === null) {
    return null;
  }
  return Math.max(0, runtime.nextRetryAtMs - nowMs);
}

/** Kaç deneme hakkı kaldı. */
export function attemptsLeft(runtime: ConnectorRuntime): number {
  return Math.max(0, MAX_ATTEMPTS - runtime.attempt);
}

/**
 * Kullanıcıya gösterilecek deneme cümlesi.
 *
 * Sayı yazılır: "yeniden deneniyor" tek başına, kullanıcıya ne kadar
 * bekleyeceğini ya da ne zaman müdahale etmesi gerektiğini söylemez.
 */
export function retryLabel(runtime: ConnectorRuntime, nowMs: number): string | null {
  if (runtime.status === "failed") {
    return `${runtime.attempt} deneme başarısız oldu; ayarları kontrol edin.`;
  }
  const remaining = timeUntilRetry(runtime, nowMs);
  if (remaining === null) {
    return null;
  }
  const seconds = Math.ceil(remaining / 1_000);
  return `${runtime.attempt}. deneme başarısız; ${seconds} sn sonra yeniden denenecek.`;
}
