/**
 * Sunucu köprüsünün şeması — backend `simulation_engine/runtime` ile eşleşir.
 *
 * Tarayıcı artık cihazlara **doğrudan** bağlanmaz: bağlantıyı sunucu kurar,
 * tarayıcı sonucu okur. Bunun ürün açısından iki karşılığı var — fabrika
 * ağındaki bir PLC'ye tarayıcıdan zaten erişilemezdi ve cihaz parolası
 * istemciye hiç inmez.
 *
 * Dürüstlük sözleşmesi burada da aynıdır: ölçülmeyen her alan `null` gelir ve
 * arayüz "Doğrulanmadı" yazar. Sunucu bir alanı hiç göndermediyse de sonuç
 * `null`'dur — eksik alanı sıfıra çevirmek, ölçülmemiş bir değeri ölçülmüş
 * gibi göstermenin en sessiz yoludur.
 */

/** Köprünün desteklediği protokoller. */
export type BridgeKind = "rest" | "opcua" | "mqtt";

/** Sunucudaki bağlantı durumu. */
export type BridgeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "failed"
  | "disconnected";

/**
 * Durum metinleri.
 *
 * Yalnızca `connected` "Bağlandı" der ve o da ancak sunucu gerçek bir cihaz
 * yanıtı aldığında yazılır. Ötekiler ne olduğunu değil, **ne olmadığını**
 * söyler.
 */
export const BRIDGE_STATUS_LABEL: Record<BridgeStatus, string> = {
  idle: "Test edilmedi",
  connecting: "Deneniyor",
  connected: "Bağlandı (doğrulandı)",
  retrying: "Yeniden deneniyor",
  failed: "Bağlantı kurulamadı",
  disconnected: "Kapatıldı",
};

export const BRIDGE_KIND_LABEL: Record<BridgeKind, string> = {
  rest: "REST",
  opcua: "OPC UA",
  mqtt: "MQTT",
};

/** Sunucunun ölçtüğü sağlık değerleri; ölçülemeyen alan `null`. */
export interface BridgeHealth {
  avgLatencyMs: number | null;
  medianLatencyMs: number | null;
  maxLatencyMs: number | null;
  samples: number;
  reconnects: number;
  packets: number;
  errors: number;
  errorRate: number | null;
  uptimeMs: number | null;
  lastPacketAtMs: number | null;
  lastError: string | null;
}

/** Son denemenin sonucu; hiç denenmediyse `null`. */
export interface BridgeProbe {
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  /** Cihazdan gelen somut kanıt; yoksa `null`. */
  evidence: string | null;
  bytesReceived: number | null;
  atMs: number;
}

/** Sunucudaki tek bir bağlantı. */
export interface BridgeConnection {
  connectionId: string;
  kind: BridgeKind;
  label: string;
  endpoint: string;
  port: number | null;
  username: string | null;
  /** Parola yanıtta hiç gelmez; yalnızca var olup olmadığı bilinir. */
  hasPassword: boolean;
  topics: string[];
  securityPolicy: string;
  qos: number;
  timeoutMs: number;
  maxRetries: number;
  status: BridgeStatus;
  /** Bir kez bile gerçek yanıt alındı mı? */
  everVerified: boolean;
  attempt: number;
  health: BridgeHealth;
  lastProbe: BridgeProbe | null;
}

/** Organizasyonun toplu sağlık özeti. */
export interface BridgeSummary {
  total: number;
  connected: number;
  failed: number;
  retrying: number;
  idle: number;
  verifiedEver: number;
  /** Ölçümü olan bağlantıların ortalaması; hiç ölçüm yoksa `null`. */
  avgLatencyMs: number | null;
  totalPackets: number;
  totalErrors: number;
  reconnects: number;
  bufferedEvents: number;
  subscribers: number;
  atMs: number;
}

export type BridgeEventLevel = "info" | "warning" | "critical";

/** Sunucudan gelen tek bir olay. */
export interface BridgeEvent {
  sequence: number;
  connectionId: string;
  kind: string;
  level: BridgeEventLevel;
  message: string;
  atMs: number;
  data: Record<string, unknown>;
}

/** Olay listesi yanıtı. */
export interface BridgeEventPage {
  events: BridgeEvent[];
  buffered: number;
  capacity: number;
  /**
   * Tampon taştıysa hangi sıra numarasına kadarki olayların kaybolduğu.
   *
   * `null` ise hiçbir olay kaybolmamıştır. Arayüz bunu gösterir; eksik bir
   * aralığı sessizce atlamak, "hiç hata olmadı" sanılmasına yol açardı.
   */
  droppedBefore: number | null;
}

/** Bağlantı isteği gövdesi. */
export interface BridgeConnectRequest {
  connectionId: string;
  kind: BridgeKind;
  label: string;
  endpoint: string;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  topics?: string[];
  securityPolicy?: string;
  qos?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Köprü çağrılarının sonucu; hata durumunda `error` doludur. */
export interface BridgeResult<T> {
  data: T | null;
  error: string | null;
}
