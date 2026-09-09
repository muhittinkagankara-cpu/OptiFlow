/**
 * Cihaz verisinin tarayıcı tarafı.
 *
 * Sunucudan gelen `/api/runtime/devices` yanıtı burada çözülür. Bütün sayısal
 * alanlar `number | null`'dır: sunucu bir ölçümü hesaplayamadıysa `null`
 * gönderir ve arayüz "—" gösterir. Eksik bir alanı sıfıra çevirmek, ölçülmemiş
 * bir değeri ölçülmüş gibi göstermenin en sessiz yoludur.
 *
 * Besleme durumu (`feedStatus`) bu dosyanın en önemli kararıdır: canlı üretim
 * ekranındaki verinin gerçek mi, benzetim mi, beklenen mi yoksa doğrulanmamış
 * mı olduğunu tek bir yerde belirler. Dört durum ayrı ayrı vardır çünkü
 * kullanıcı için dördü de farklı bir eylem anlamına gelir.
 */

import { numberOr, numberOrNull, stringOrNull } from "./parse";

/** Sunucunun tanıdığı ölçüm türleri. */
export type DeviceMetric =
  | "production_count"
  | "scrap_count"
  | "queue_length"
  | "machine_status"
  | "downtime_minutes"
  | "throughput_per_hour"
  | "cycle_time_seconds"
  | "oee"
  | "unknown";

export const METRIC_LABEL: Record<DeviceMetric, string> = {
  production_count: "Üretim adedi",
  scrap_count: "Fire adedi",
  queue_length: "Kuyruk uzunluğu",
  machine_status: "Makine durumu",
  downtime_minutes: "Duruş süresi (dk)",
  throughput_per_hour: "Saatlik çıktı",
  cycle_time_seconds: "Çevrim süresi (sn)",
  oee: "OEE",
  unknown: "Tanınmayan ölçüm",
};

export type MachineStateId = "running" | "idle" | "down" | "setup" | "unknown";

export const MACHINE_STATE_LABEL: Record<MachineStateId, string> = {
  running: "Çalışıyor",
  idle: "Boşta",
  down: "Duruş",
  setup: "Ayar",
  unknown: "Bilinmiyor",
};

export type DeviceQuality = "good" | "uncertain" | "bad";

/** Cihazdan gelen tek bir ölçüm. */
export interface DeviceReading {
  connectionId: string;
  machineId: string;
  metric: DeviceMetric;
  value: number | string | boolean | null;
  atMs: number;
  source: string;
  quality: DeviceQuality;
  unit: string | null;
  origin: string | null;
  usable: boolean;
}

/** Bir makinenin gerçek veriden çıkarılan durumu. */
export interface MachineSnapshot {
  machineId: string;
  productionCount: number | null;
  scrapCount: number | null;
  queueLength: number | null;
  state: MachineStateId;
  downtimeMinutes: number | null;
  throughputPerHour: number | null;
  cycleTimeSeconds: number | null;
  oee: number | null;
  lastSeenMs: number | null;
  sampleCount: number;
  /** Hesaplanamayan alanların nedenleri. */
  notes: Record<string, string>;
}

/** Çevrilemeyen bir yük ya da eşleşmeyen bir alan. */
export interface DeviceProblem {
  connectionId: string;
  reason: string;
  atMs: number;
  origin: string | null;
  sample: string | null;
}

/** Verisi gelen ama ekranda yeri olmayan makine. */
export interface MappingWarning {
  machineId: string;
  reason: string;
  sampleCount: number;
}

/** Bir akışın sunucudaki durumu. */
export interface StreamStatus {
  connectionId: string;
  kind: string;
  running: boolean;
  hasData: boolean;
  firstDataAtMs: number | null;
  lastDataAtMs: number | null;
  payloads: number;
  eventsPublished: number;
  problems: number;
  consecutiveFailures: number;
  lastError: string | null;
  intervalMs: number | null;
  monitoredItems: number | null;
}

export interface DeviceSummary {
  deviceEvents: number;
  problems: number;
  machines: number;
  mappingWarnings: number;
  productionCount: number | null;
  measuredMachines: number;
  machinesRunning: number;
  machinesDown: number;
}

export interface DevicePage {
  events: DeviceReading[];
  machines: MachineSnapshot[];
  problems: DeviceProblem[];
  mappingWarnings: MappingWarning[];
  streams: StreamStatus[];
  summary: DeviceSummary;
}

/* -------------------------------------------------------------------------- */
/* Çözümleme                                                                   */
/* -------------------------------------------------------------------------- */

const METRICS: DeviceMetric[] = [
  "production_count",
  "scrap_count",
  "queue_length",
  "machine_status",
  "downtime_minutes",
  "throughput_per_hour",
  "cycle_time_seconds",
  "oee",
  "unknown",
];

const STATES: MachineStateId[] = ["running", "idle", "down", "setup", "unknown"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function parseMetric(value: unknown): DeviceMetric {
  return METRICS.includes(value as DeviceMetric)
    ? (value as DeviceMetric)
    : "unknown";
}

/**
 * Makine durumu.
 *
 * Tanınmayan bir değer "Bilinmiyor" olur; `running`'e düşmek mümkün değildir —
 * duran bir makineyi çalışıyor göstermek, bu ekranda yapılabilecek en pahalı
 * hatadır.
 */
export function parseMachineState(value: unknown): MachineStateId {
  return STATES.includes(value as MachineStateId)
    ? (value as MachineStateId)
    : "unknown";
}

export function parseQuality(value: unknown): DeviceQuality {
  return value === "good" || value === "uncertain" || value === "bad"
    ? value
    : "uncertain";
}

export function parseReading(value: unknown): DeviceReading {
  const item = record(value);
  const raw = item.value;
  return {
    connectionId: typeof item.connection_id === "string" ? item.connection_id : "",
    machineId: typeof item.machine_id === "string" ? item.machine_id : "",
    metric: parseMetric(item.metric),
    value:
      typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean"
        ? raw
        : null,
    atMs: numberOr(item.at_ms, 0),
    source: typeof item.source === "string" ? item.source : "",
    quality: parseQuality(item.quality),
    unit: stringOrNull(item.unit),
    origin: stringOrNull(item.origin),
    usable: item.usable === true,
  };
}

export function parseSnapshot(value: unknown): MachineSnapshot {
  const item = record(value);
  const notes = record(item.notes);
  return {
    machineId: typeof item.machine_id === "string" ? item.machine_id : "",
    productionCount: numberOrNull(item.production_count),
    scrapCount: numberOrNull(item.scrap_count),
    queueLength: numberOrNull(item.queue_length),
    state: parseMachineState(item.state),
    downtimeMinutes: numberOrNull(item.downtime_minutes),
    throughputPerHour: numberOrNull(item.throughput_per_hour),
    cycleTimeSeconds: numberOrNull(item.cycle_time_seconds),
    oee: numberOrNull(item.oee),
    lastSeenMs: numberOrNull(item.last_seen_ms),
    sampleCount: numberOr(item.sample_count, 0),
    notes: Object.fromEntries(
      Object.entries(notes).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
}

export function parseProblem(value: unknown): DeviceProblem {
  const item = record(value);
  return {
    connectionId: typeof item.connection_id === "string" ? item.connection_id : "",
    reason: typeof item.reason === "string" ? item.reason : "",
    atMs: numberOr(item.at_ms, 0),
    origin: stringOrNull(item.origin),
    sample: stringOrNull(item.sample),
  };
}

export function parseMappingWarning(value: unknown): MappingWarning {
  const item = record(value);
  return {
    machineId: typeof item.machine_id === "string" ? item.machine_id : "",
    reason: typeof item.reason === "string" ? item.reason : "",
    sampleCount: numberOr(item.sample_count, 0),
  };
}

export function parseStream(value: unknown): StreamStatus {
  const item = record(value);
  return {
    connectionId: typeof item.connection_id === "string" ? item.connection_id : "",
    kind: typeof item.kind === "string" ? item.kind : "",
    running: item.running === true,
    hasData: item.has_data === true,
    firstDataAtMs: numberOrNull(item.first_data_at_ms),
    lastDataAtMs: numberOrNull(item.last_data_at_ms),
    payloads: numberOr(item.payloads, 0),
    eventsPublished: numberOr(item.events_published, 0),
    problems: numberOr(item.problems, 0),
    consecutiveFailures: numberOr(item.consecutive_failures, 0),
    lastError: stringOrNull(item.last_error),
    intervalMs: numberOrNull(item.interval_ms),
    monitoredItems: numberOrNull(item.monitored_items),
  };
}

export function parseDevicePage(value: unknown): DevicePage {
  const item = record(value);
  const summary = record(item.summary);
  return {
    events: Array.isArray(item.events) ? item.events.map(parseReading) : [],
    machines: Array.isArray(item.machines) ? item.machines.map(parseSnapshot) : [],
    problems: Array.isArray(item.problems) ? item.problems.map(parseProblem) : [],
    mappingWarnings: Array.isArray(item.mapping_warnings)
      ? item.mapping_warnings.map(parseMappingWarning)
      : [],
    streams: Array.isArray(item.streams) ? item.streams.map(parseStream) : [],
    summary: {
      deviceEvents: numberOr(summary.device_events, 0),
      problems: numberOr(summary.problems, 0),
      machines: numberOr(summary.machines, 0),
      mappingWarnings: numberOr(summary.mapping_warnings, 0),
      productionCount: numberOrNull(summary.production_count),
      measuredMachines: numberOr(summary.measured_machines, 0),
      machinesRunning: numberOr(summary.machines_running, 0),
      machinesDown: numberOr(summary.machines_down, 0),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Besleme durumu                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Canlı üretim ekranındaki verinin kaynağı.
 *
 * Dördü de ayrı bir eyleme karşılık gelir:
 *
 * - `real`      — cihazdan veri akıyor; ekrandaki sayılar gerçektir.
 * - `waiting`   — akış açık ama henüz ölçüm gelmedi; beklemek ya da eşlemeyi
 *                 kontrol etmek gerekir.
 * - `simulated` — veri üretiliyor ama bir cihazdan gelmiyor (demo/kayıt).
 * - `unverified`— hiçbir bağlantı doğrulanmadı; önce bağlantı kurulmalı.
 */
export type FeedStatus = "real" | "waiting" | "simulated" | "unverified";

export const FEED_LABEL: Record<FeedStatus, string> = {
  real: "Gerçek Veri",
  waiting: "Veri Bekleniyor",
  simulated: "Benzetim",
  unverified: "Doğrulanmadı",
};

export interface FeedInput {
  /** Sunucudaki akışlar. */
  streams: StreamStatus[];
  /** Ekranda şu an benzetim sağlayıcısı mı seçili? */
  simulatedProvider: boolean;
  /** En az bir bağlantı gerçekten doğrulandı mı? */
  anyVerifiedConnection: boolean;
}

export interface FeedVerdict {
  status: FeedStatus;
  label: string;
  /** Durumun tek cümlelik gerekçesi. */
  reason: string;
}

/**
 * Ekranın besleme durumu.
 *
 * Soru şudur: **bu ekranda gördüğüm sayılar nereden geliyor?**
 *
 * Sıralamada ekranın kendi kaynağı önce gelir. İlk yazımda gerçek akış
 * benzetimi yeniyordu ve tarayıcıda görüldü ki bu, demo senaryosuyla çizilen
 * canlı ekranın tepesine "Gerçek Veri" yazdırıyor: köprüde veri akıyor olması,
 * ekrandaki sayıların cihazdan geldiği anlamına gelmez. Ekran benzetim
 * gösteriyorsa şerit **Benzetim** der ve cihaz verisinin başka bir yerde
 * aktığını ayrıca söyler.
 */
export function feedStatus(input: FeedInput): FeedVerdict {
  const withData = input.streams.filter((stream) => stream.hasData);

  if (input.simulatedProvider) {
    return {
      status: "simulated",
      label: FEED_LABEL.simulated,
      reason:
        withData.length > 0
          ? `Ekrandaki veri üretilmiş bir senaryodan geliyor. Cihaz verisi ${withData.length} kaynaktan akıyor; görmek için kaynağı değiştirin.`
          : "Ekrandaki veri üretilmiş bir senaryodan geliyor; cihazdan değil.",
    };
  }

  if (withData.length > 0) {
    return {
      status: "real",
      label: FEED_LABEL.real,
      reason: `${withData.length} kaynaktan cihaz verisi akıyor.`,
    };
  }

  const running = input.streams.filter((stream) => stream.running);
  if (running.length > 0) {
    return {
      status: "waiting",
      label: FEED_LABEL.waiting,
      reason:
        "Akış açık ama cihazdan henüz ölçüm gelmedi. Eşleme tablosunu ve konu/düğüm adlarını kontrol edin.",
    };
  }

  return {
    status: "unverified",
    label: FEED_LABEL.unverified,
    reason: input.anyVerifiedConnection
      ? "Bağlantı doğrulandı ama veri akışı başlatılmadı."
      : "Hiçbir cihaz bağlantısı doğrulanmadı.",
  };
}

/**
 * Bu kaynak kimliği benzetim mi üretiyor?
 *
 * Demo senaryosu ve kayıttan oynatma gerçek cihaz verisi değildir; ikisi de
 * ekranın nasıl göründüğünü göstermek içindir. Liste burada durur ki canlı
 * ekran bu kararı kendi içinde vermesin.
 */
export const SIMULATED_SOURCE_IDS = ["demo", "replay"];

export function isSimulatedSourceId(sourceId: string): boolean {
  return SIMULATED_SOURCE_IDS.includes(sourceId);
}

/** Bir makinenin ölçülemeyen alanları; ekranda "—" ile gösterilir. */
export function unmeasuredFields(snapshot: MachineSnapshot): string[] {
  const fields: [string, number | null][] = [
    ["Üretim adedi", snapshot.productionCount],
    ["Kuyruk uzunluğu", snapshot.queueLength],
    ["Duruş süresi", snapshot.downtimeMinutes],
    ["Saatlik çıktı", snapshot.throughputPerHour],
  ];
  return fields.filter(([, value]) => value === null).map(([label]) => label);
}

/** Akışın kullanıcıya gösterilecek tek cümlelik özeti. */
export function describeStream(stream: StreamStatus): string {
  if (!stream.running) {
    return "Akış kapalı.";
  }
  if (!stream.hasData) {
    return stream.lastError === null
      ? "Akış açık; cihazdan henüz ölçüm gelmedi."
      : `Akış açık ama son deneme başarısız: ${stream.lastError}`;
  }
  return `${stream.eventsPublished} ölçüm alındı.`;
}
