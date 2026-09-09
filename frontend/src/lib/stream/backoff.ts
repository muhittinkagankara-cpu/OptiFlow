/**
 * Yeniden bağlanma zamanlaması.
 *
 * Bir SSE bağlantısı koptuğunda hemen ve sürekli yeniden denemek, sunucuyu
 * saniyede onlarca istekle döver ve kopmanın nedeni sunucunun kendisiyse
 * durumu kötüleştirir. Bekleme her denemede ikiye katlanır ve bir tavanda
 * durur.
 *
 * Neden titreşim (jitter) var
 * ---------------------------
 * Sunucu yeniden başladığında bütün tarayıcılar aynı anda kopar. Bekleme
 * tam olarak aynı olsaydı, hepsi aynı saniyede yeniden bağlanır ve sunucuyu
 * ikinci kez düşürürdü. Titreşim, denemeleri zamana yayar.
 *
 * Bu modül saf: rastgelelik bile dışarıdan verilir, böylece test edilebilir.
 */

/** İlk yeniden deneme beklemesi (ms). */
export const BASE_DELAY_MS = 1_000;

/** Beklemenin üst sınırı (ms). */
export const MAX_DELAY_MS = 30_000;

/** Titreşimin oranı: beklemenin en fazla yüzde kaçı eklenir. */
export const JITTER_RATIO = 0.2;

/**
 * Verilen deneme sayısı için bekleme süresi (ms).
 *
 * İlk kopmada (`attempt = 1`) taban bekleme uygulanır; sıfırıncı deneme diye
 * bir şey yoktur — bağlantı koptuysa en az bir kez beklenir.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (safeAttempt - 1));
  const jitter = base * JITTER_RATIO * clamp01(random());
  return Math.round(Math.min(MAX_DELAY_MS, base + jitter));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Titreşimsiz taban bekleme; sınama ve gösterim için. */
export function baseDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (safeAttempt - 1));
}

/** Yeniden bağlanma durumu; bileşen bunu gösterir. */
export interface ReconnectState {
  /** Kaçıncı deneme? Sıfır, bağlantının hiç kopmadığını söyler. */
  attempts: number;
  /** Bir sonraki denemeye kalan bekleme (ms); bekleme yoksa `null`. */
  nextDelayMs: number | null;
  /** Son kopma nedeni; hiç kopmadıysa `null`. */
  lastError: string | null;
}

export const INITIAL_RECONNECT: ReconnectState = {
  attempts: 0,
  nextDelayMs: null,
  lastError: null,
};

/** Kopma sonrası yeni durum. */
export function noteDisconnect(
  state: ReconnectState,
  error: string | null,
  random: () => number = Math.random,
): ReconnectState {
  const attempts = state.attempts + 1;
  return {
    attempts,
    nextDelayMs: backoffDelayMs(attempts, random),
    lastError: error,
  };
}

/**
 * Başarılı bağlantı sonrası durum.
 *
 * Sayaç sıfırlanır ama `lastError` **korunur**: bir kez kopmuş bir akışın
 * geçmişi, yeniden bağlanınca silinmemeli — kullanıcı "az önce ne oldu?"
 * sorusunu ancak böyle yanıtlayabilir.
 */
export function noteConnected(state: ReconnectState): ReconnectState {
  return { attempts: 0, nextDelayMs: null, lastError: state.lastError };
}

/** Yeniden bağlanma durumunun okunur özeti. */
export function describeReconnect(state: ReconnectState): string {
  if (state.attempts === 0) {
    return state.lastError === null
      ? "Bağlantı kopmadı."
      : "Bağlantı yeniden kuruldu.";
  }
  const seconds = state.nextDelayMs === null ? null : Math.round(state.nextDelayMs / 1_000);
  return seconds === null
    ? `${state.attempts}. yeniden bağlanma denemesi.`
    : `${state.attempts}. deneme; ${seconds} sn sonra yeniden denenecek.`;
}
