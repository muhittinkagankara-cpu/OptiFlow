/**
 * Bağlantı runtime sözleşmesi — gerçek cihazla konuşan katman.
 *
 * Bağlayıcı katmanının (`lib/connectors`) üstünde durur ve tek bir soruyu
 * yanıtlar: **bu uç noktaya gerçekten gidilebildi mi?**
 *
 * Sözleşmenin en önemli alanı `attempted`'dır. Bir sonuç ancak gerçek bir
 * istek yapıldıysa "bağlandı" diyebilir; istek hiç yapılmadıysa sonuç
 * `attempted: false` taşır ve arayüz **"Doğrulanmadı"** yazar. Benzetimle
 * üretilmiş bir "connected", bu katmanda üretilemez — üreten bir kod yoktur.
 *
 *     Kullanıcı "Bağlantıyı test et" ──▶ RuntimeClient.test()
 *                                            │
 *                    gerçek HTTP / soket ────┤ attempted: true  → ok / hata
 *                    istemci yok       ──────┘ attempted: false → "Doğrulanmadı"
 *
 * Zaman ve rastgelelik dışarıdan verilir; katmanda hiçbir yerde saat okunmaz
 * (ölçülen gecikme dışında — o zaten ölçümün kendisidir).
 */

import type { ConnectorKind, ConnectorSettings } from "../types";

/** Runtime'ın gördüğü bağlantı durumu. */
export type RuntimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

export const RUNTIME_STATUS_LABEL: Record<RuntimeStatus, string> = {
  idle: "Test edilmedi",
  connecting: "Bağlanıyor",
  connected: "Bağlandı",
  disconnected: "Bağlantı kapatıldı",
  failed: "Bağlantı kurulamadı",
};

/**
 * Bir denemenin sonucu.
 *
 * `attempted: false` olan bir sonuç asla `connected` olamaz; bu, tip düzeyinde
 * değil ama `probeStatus` yardımcısında tek yerde güvence altına alınır.
 */
export interface RuntimeProbe {
  /** Deneme gerçekten yapıldı mı? İstemci yoksa `false`. */
  attempted: boolean;
  /** Uç nokta yanıt verdi mi? */
  ok: boolean;
  status: RuntimeStatus;
  /** HTTP durum kodu; HTTP dışı protokollerde `null`. */
  httpStatus: number | null;
  /** Ölçülen gidiş-dönüş süresi (ms); ölçülemediyse `null`. */
  latencyMs: number | null;
  /** Yanıt gövdesinin boyutu (bayt); ölçülemediyse `null`. */
  sizeBytes: number | null;
  /** Kullanıcıya gösterilecek açıklama. */
  detail: string;
  /** Yanıt gövdesi; okunamadıysa `null`. */
  payload: unknown;
  /** Denemenin anı. */
  atMs: number;
}

/** Hiç denenmemiş bir sonuç. */
export function notAttempted(reason: string, atMs: number): RuntimeProbe {
  return {
    attempted: false,
    ok: false,
    status: "idle",
    httpStatus: null,
    latencyMs: null,
    sizeBytes: null,
    detail: reason,
    payload: null,
    atMs,
  };
}

/**
 * Sonucun durumunu belirler.
 *
 * Tek kapı: "bağlandı" sonucu yalnızca gerçekten denenmiş **ve** başarılı bir
 * denemeden çıkabilir. Bu işlev olmadan her runtime kendi durumunu üretir ve
 * biri er geç sahte bir `connected` yazardı.
 */
export function probeStatus(attempted: boolean, ok: boolean): RuntimeStatus {
  if (!attempted) {
    return "idle";
  }
  return ok ? "connected" : "failed";
}

/**
 * Runtime istemcisi.
 *
 * `isImplemented`, bu protokol için gerçek bir istemcinin var olup olmadığını
 * söyler. `false` olduğunda `test()` yine çağrılabilir ama sonucu
 * `attempted: false` olur — yani "Doğrulanmadı".
 */
export interface RuntimeClient {
  readonly kind: ConnectorKind;
  readonly name: string;
  /** Bu protokolde gerçek bir istemci var mı? */
  readonly isImplemented: boolean;
  /** Neden yok / nasıl çalışıyor; arayüzde açıklama olarak görünür. */
  readonly description: string;
  /** Tek seferlik bağlantı denemesi. */
  test(settings: ConnectorSettings, nowMs: number): Promise<RuntimeProbe>;
}

/** Sürekli veri çeken runtime'ların ek sözleşmesi. */
export interface PollingRuntime extends RuntimeClient {
  /** Yoklamayı başlatır; her yanıtta `onPayload` çağrılır. */
  start(
    settings: ConnectorSettings,
    onPayload: (probe: RuntimeProbe) => void,
  ): void;
  stop(): void;
  readonly isRunning: boolean;
}

/** Bir runtime'ın yoklama yeteneği var mı? */
export function asPollingRuntime(client: RuntimeClient): PollingRuntime | null {
  const candidate = client as unknown as Partial<PollingRuntime>;
  return typeof candidate.start === "function" &&
    typeof candidate.stop === "function"
    ? (candidate as PollingRuntime)
    : null;
}
