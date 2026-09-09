/**
 * Canlı cihaz akışının arayüz tarafındaki modeli.
 *
 * Sunucu dört olay türü yayar ve ekran yalnızca bunları anlar:
 * `device_data`, `alarm`, `oee_update`, `production_update`. Tanınmayan bir
 * tür sessizce yok sayılır — sunucuya eklenen yeni bir olay, eski bir arayüzü
 * çökertmemelidir.
 *
 * Sıra numarası neden burada da var
 * ---------------------------------
 * Sunucu yinelemeyi zaten eler. Ama tarayıcı bağlantısı koptuğunda akış
 * **yeniden açılır** ve sunucu tamponundaki son olaylar yeniden gönderilir;
 * bu, sunucu açısından yineleme değildir. Sayacı iki kez işleyen bir ekran
 * üretimi olduğundan yüksek gösterir, bu yüzden eleme burada da yapılır.
 */

/** Canlı akışta gelen olay türleri. */
export type LiveStreamEventKind =
  | "device_data"
  | "alarm"
  | "oee_update"
  | "production_update";

export const LIVE_STREAM_KINDS: LiveStreamEventKind[] = [
  "device_data",
  "alarm",
  "oee_update",
  "production_update",
];

/** Ölçümün geldiği protokol. */
export type StreamProtocol = "rest" | "opcua" | "mqtt" | "unknown";

export const PROTOCOL_LABEL: Record<StreamProtocol, string> = {
  rest: "REST yoklama",
  opcua: "OPC UA aboneliği",
  mqtt: "MQTT aboneliği",
  unknown: "Bilinmeyen kaynak",
};

/** Ölçümün güvenilirliği. */
export type StreamQuality = "good" | "uncertain" | "bad";

export const QUALITY_LABEL: Record<StreamQuality, string> = {
  good: "İyi",
  uncertain: "Belirsiz",
  bad: "Bozuk",
};

/** Akıştan gelen tek bir cihaz ölçümü. */
export interface DeviceDataRow {
  connectorId: string;
  machineId: string;
  field: string;
  value: unknown;
  timestampMs: number;
  protocol: StreamProtocol;
  quality: StreamQuality;
  sequence: number;
  origin: string | null;
  unit: string | null;
  /** Bozuk kaliteli ya da değersiz ölçüm metriği güncellemez. */
  usable: boolean;
}

/** Yineleme denetiminin anahtarı. */
export function rowKey(row: Pick<DeviceDataRow, "connectorId" | "sequence">): string {
  return `${row.connectorId}::${row.sequence}`;
}

/** Akışın o anki durumu; sunucudaki `StreamHealth` ile birebir. */
export type StreamHealthId =
  | "running"
  | "idle"
  | "backpressure"
  | "failing"
  | "stopped";

export const STREAM_HEALTH_LABEL: Record<StreamHealthId, string> = {
  running: "Çalışıyor",
  idle: "Veri bekleniyor",
  backpressure: "Kuyruk dolu",
  failing: "Hata alıyor",
  stopped: "Durduruldu",
};

/** Dağıtıcı kuyruğunun durumu. */
export interface QueueStats {
  depth: number;
  capacity: number;
  /** Yer açmak için düşürülen olay sayısı. */
  dropped: number;
  peakDepth: number;
  fillRatio: number;
  full: boolean;
  underPressure: boolean;
}

/** Dağıtıcı ölçümleri; hesaplanamayan alan `null`. */
export interface DispatcherStats {
  processed: number;
  duplicates: number;
  unusable: number;
  dropped: number;
  queue: QueueStats;
  /** Saniyedeki olay sayısı; ölçülemiyorsa `null`. */
  eventsPerSecond: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  /** Kayıp oranı (0-1); hiç olay akmadıysa `null`. */
  lossRatio: number | null;
  sinks: SinkStats[];
}

export interface SinkStats {
  name: string;
  delivered: number;
  errors: number;
  lastError: string | null;
}

/** Akış motorunun özeti; Runtime panosu bunu gösterir. */
export interface StreamStats {
  streams: number;
  running: number;
  health: StreamHealthId;
  /** Ortalama yoklama sıklığı (Hz); yoklayıcı yoksa `null`. */
  pollRateHz: number | null;
  dispatcher: DispatcherStats;
}

/** Tek bir akışın durumu. */
export interface StreamSourceState {
  connectorId: string;
  protocol: string;
  running: boolean;
  health: StreamHealthId;
  firstDataAtMs: number | null;
  lastDataAtMs: number | null;
}

/**
 * Ekrandaki besleme rozeti.
 *
 * Üç durum ayrı ayrı gösterilir çünkü kullanıcı için farklı eylemler demektir:
 * gerçek veri akıyorsa hiçbir şey; demo ise bu bir benzetimdir; bağlantı
 * bekleniyorsa cihaz tarafında bir sorun vardır.
 */
export type FeedBadgeId = "real" | "demo" | "waiting";

export const FEED_BADGE_LABEL: Record<FeedBadgeId, string> = {
  real: "Gerçek Veri",
  demo: "Demo",
  waiting: "Bağlantı Bekleniyor",
};
