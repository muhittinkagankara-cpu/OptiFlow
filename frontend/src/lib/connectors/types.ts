/**
 * Bağlayıcı katmanının şeması.
 *
 * Amaç, bugünden **sözleşmeyi** sabitlemektir: OptiFlow yarın bir PLC'ye
 * (OPC UA), bir sensöre (MQTT) ya da bir MES'e (REST) bağlandığında ekranların
 * hiçbiri değişmesin. Bileşenler bu dosyadaki tipleri görür; hangi protokolün
 * konuştuğunu bilmez.
 *
 *     PLC ─OPC UA─┐
 *     MES ─REST───┼─▶ Bağlayıcı katmanı ─▶ Canlı depo ─▶ Arayüz
 *     Sensör ─MQTT┘
 *
 * Bu sürümde gerçek bir soket açılmaz. Bağlantı testi ve veri akışı benzetimle
 * çalışır ve arayüz bunu açıkça söyler — sahte veriyi gerçek sanan bir
 * yönetici, olmayan bir arızaya ekip gönderir. "Hazır mimari" ile "çalışan
 * bağlantı" arasındaki fark, ürünün dürüstlüğünün sınandığı yerdir.
 */

/** Desteklenen kaynak türleri. */
export type ConnectorKind = "opcua" | "mqtt" | "rest" | "csv" | "erp";

/** Ekranda ve raporlarda sabit sıra. */
export const CONNECTOR_ORDER: ConnectorKind[] = [
  "opcua",
  "mqtt",
  "rest",
  "csv",
  "erp",
];

export const CONNECTOR_LABEL: Record<ConnectorKind, string> = {
  opcua: "OPC UA",
  mqtt: "MQTT",
  rest: "REST",
  csv: "CSV Otomatik İçe Aktarma",
  erp: "ERP",
};

export const CONNECTOR_DESCRIPTION: Record<ConnectorKind, string> = {
  opcua: "Denetleyiciden (PLC) doğrudan etiket aboneliği.",
  mqtt: "Sensör ve kenar cihazlardan konu (topic) yayını.",
  rest: "MES ya da satıcı sisteminden dönemsel okuma.",
  csv: "İzlenen klasöre bırakılan dosyaların otomatik alınması.",
  erp: "Sipariş, stok ve iş emri verisinin kurumsal sistemden okunması.",
};

/**
 * Bağlantının o anki hâli.
 *
 * `retrying` ayrı bir durumdur: "hata" ile "yeniden deniyor" kullanıcı için
 * aynı şey değildir. Biri müdahale ister, öteki beklemeyi. Tek bir "error"
 * durumu, her ağ dalgalanmasında operatörü boşuna telefona sarılırdı.
 */
export type ConnectorStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "failed"
  | "disconnected";

export const STATUS_LABEL: Record<ConnectorStatus, string> = {
  idle: "Bağlanmadı",
  connecting: "Bağlanıyor",
  connected: "Bağlı",
  retrying: "Yeniden deneniyor",
  failed: "Başarısız",
  disconnected: "Bağlantı kesildi",
};

/** Durumun renk tonu; renk tek başına bilgi taşımaz, etiketle birlikte gider. */
export type StatusTone = "good" | "warning" | "bad" | "neutral";

/* -------------------------------------------------------------------------- */
/* Ayarlar                                                                     */
/* -------------------------------------------------------------------------- */

/** Bir ayar alanının değeri. Girilmemiş alan `null`'dır, boş metin değil. */
export type SettingValue = string | number | boolean | null;

export type ConnectorSettings = Record<string, SettingValue>;

/** Ayar formunun tek bir alanı. Form bu şemadan çizilir, elle yazılmaz. */
export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "select" | "boolean";
  /** Boş bırakılamaz mı? */
  required: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  /** Gizli tutulması gereken alan (parola, anahtar). */
  secret?: boolean;
}

/** Kullanıcının tanımladığı tek bir bağlantı. */
export interface ConnectorConfig {
  id: string;
  kind: ConnectorKind;
  name: string;
  settings: ConnectorSettings;
  /** Kopma hâlinde kendiliğinden yeniden bağlanılsın mı? */
  autoReconnect: boolean;
}

/* -------------------------------------------------------------------------- */
/* Çalışma zamanı                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Bir bağlantının anlık durumu.
 *
 * Zaman damgaları milisaniye cinsindendir ve **dışarıdan verilir**; katmanda
 * hiçbir yerde `Date.now()` okunmaz. Okunsaydı testler çalıştıkları saate göre
 * farklı sonuç verir, yeniden deneme aralıkları sınanamazdı.
 */
export interface ConnectorRuntime {
  configId: string;
  status: ConnectorStatus;
  /** Kaçıncı yeniden deneme; bağlıyken 0. */
  attempt: number;
  /** Bir sonraki denemenin zamanı; beklemiyorsa `null`. */
  nextRetryAtMs: number | null;
  /** Son başarılı senkronun anı; hiç olmadıysa `null`. */
  lastSyncAtMs: number | null;
  /** Son ölçülen gidiş-dönüş süresi (ms); ölçülmediyse `null`. */
  lastLatencyMs: number | null;
  /** Son ölçümler; ortalama ve mini grafik bunlardan çıkar. */
  latencySamplesMs: number[];
  /** Senkron sırasında oluşan hata sayısı. */
  syncErrors: number;
  /** Kaç kayıt alındı (benzetimde de gerçek sayıdır). */
  recordsReceived: number;
  /** Son durumun nedeni; yoksa `null`. */
  detail: string | null;
}

/* -------------------------------------------------------------------------- */
/* Olay günlüğü                                                                */
/* -------------------------------------------------------------------------- */

export type ConnectorEventKind =
  | "connected"
  | "disconnected"
  | "retrying"
  | "failed"
  | "data"
  | "sync"
  | "test"
  | "error"
  | "config";

export const EVENT_KIND_LABEL: Record<ConnectorEventKind, string> = {
  connected: "Bağlandı",
  disconnected: "Koptu",
  retrying: "Yeniden bağlanıyor",
  failed: "Başarısız",
  data: "Veri geldi",
  sync: "Senkron",
  test: "Test",
  error: "Hata",
  config: "Ayar",
};

export type EventLevel = "info" | "warning" | "critical";

export interface ConnectorEvent {
  id: string;
  /** Olayın ait olduğu bağlantı; genel olaylarda `null`. */
  configId: string | null;
  connectorName: string | null;
  atMs: number;
  kind: ConnectorEventKind;
  level: EventLevel;
  text: string;
}

/* -------------------------------------------------------------------------- */
/* Eşleme                                                                      */
/* -------------------------------------------------------------------------- */

/** OptiFlow'un beslenmesi gereken alanları. */
export type OptiFlowField =
  | "queue"
  | "cycleTime"
  | "productionCount"
  | "scrap"
  | "machineState";

export const FIELD_ORDER: OptiFlowField[] = [
  "queue",
  "cycleTime",
  "productionCount",
  "scrap",
  "machineState",
];

export const FIELD_LABEL: Record<OptiFlowField, string> = {
  queue: "Kuyruk",
  cycleTime: "Çevrim süresi",
  productionCount: "Üretim adedi",
  scrap: "Fire",
  machineState: "Makine durumu",
};

/** Alanın beklediği veri tipi; eşleme doğrulaması buna bakar. */
export type ValueType = "number" | "boolean" | "string" | "enum";

export const FIELD_TYPE: Record<OptiFlowField, ValueType> = {
  queue: "number",
  cycleTime: "number",
  productionCount: "number",
  scrap: "number",
  machineState: "enum",
};

export const FIELD_UNIT: Record<OptiFlowField, string> = {
  queue: "adet",
  cycleTime: "sn",
  productionCount: "adet",
  scrap: "adet",
  machineState: "durum",
};

/**
 * Kaynak tarafındaki tek bir okunabilir nokta.
 *
 * OPC UA'da bir düğüm (`ns=2;s=Line1.Station3.Queue`), MQTT'de bir konu
 * (`hat1/torna/kuyruk`), REST'te bir alan (`stations[2].queue`). Üçü de aynı
 * tiple temsil edilir: eşleme ekranının hangi protokolle konuştuğunu bilmesi
 * gerekmez.
 */
export interface SourceNode {
  id: string;
  connectorId: string;
  kind: ConnectorKind;
  /** Protokoldeki adres. */
  address: string;
  /** İnsan tarafından okunan ad. */
  label: string;
  dataType: ValueType;
  unit: string | null;
  /** Son okunan örnek değer; henüz okunmadıysa `null`. */
  sample: string | null;
}

/** Bir kaynağın hangi istasyonun hangi alanını beslediği. */
export interface FieldMapping {
  id: string;
  sourceId: string;
  stationId: string;
  field: OptiFlowField;
}

/* -------------------------------------------------------------------------- */
/* Doğrulama                                                                   */
/* -------------------------------------------------------------------------- */

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  /** Sorunun türü; arayüz aynı türü gruplar. */
  code:
    | "missing_node"
    | "conflicting_mapping"
    | "type_mismatch"
    | "empty_field"
    | "unused_source"
    | "invalid_value";
  text: string;
  /** İlgili eşleme ya da alan; arayüz bunu vurgular. */
  mappingId: string | null;
  stationId: string | null;
  field: OptiFlowField | null;
}

/* -------------------------------------------------------------------------- */
/* Bütün durum                                                                 */
/* -------------------------------------------------------------------------- */

export interface ConnectorState {
  configs: ConnectorConfig[];
  /** Bağlantı kimliğine göre çalışma zamanı durumu. */
  runtimes: Record<string, ConnectorRuntime>;
  sources: SourceNode[];
  mappings: FieldMapping[];
  /** En yeni önde olacak biçimde sıralı olay günlüğü. */
  events: ConnectorEvent[];
}

/** Sağlık panosunun okuduğu özet. */
export interface HealthSnapshot {
  connected: number;
  disconnected: number;
  retrying: number;
  failed: number;
  total: number;
  syncErrors: number;
  /** Bağlı bağlantıların ortalama gecikmesi; ölçüm yoksa `null`. */
  avgLatencyMs: number | null;
  /** En son alınan verinin anı; hiç veri gelmediyse `null`. */
  lastUpdateAtMs: number | null;
  totalRecords: number;
}
