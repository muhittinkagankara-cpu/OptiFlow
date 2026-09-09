/**
 * Live Factory'nin runtime beslemesi.
 *
 * Ekranın okuduğu kaynak **makine görüntüleridir** (snapshot), olay akışı
 * değil: kullanıcı ekranı açtığında geçmişi yeniden oynatmak gerekmez, son
 * durum zaten hazırdır. Akış açıkken gelen olaylar bu durumu güncel tutar.
 *
 * Bu dosyadaki her şey saftır. Ölçülemeyen alan `null` kalır; ekran "—"
 * gösterir ve nedenini yazar.
 */

import { numberOr, numberOrNull, stringOrNull } from "./parse";
import type { MachineStateId } from "./devices";

/** Canlı üretim ekranındaki runtime kaynağının kimliği. */
export const RUNTIME_SOURCE_ID = "runtime";

/** İstasyon durumları — sprint sözleşmesindeki dört hâl artı bilinmeyen. */
export type StationStatusId = "running" | "idle" | "blocked" | "down" | "unknown";

export const STATION_STATUS_LABEL: Record<StationStatusId, string> = {
  running: "Çalışıyor",
  idle: "Boşta",
  blocked: "Bloke",
  down: "Duruş",
  unknown: "Bilinmiyor",
};

const STATUSES: StationStatusId[] = ["running", "idle", "blocked", "down", "unknown"];

/**
 * Sunucudan gelen durumu ekranın durumuna çevirir.
 *
 * Tanınmayan bir değer "Bilinmiyor" olur; `running`'e düşmek mümkün değildir —
 * duran bir makineyi çalışıyor göstermek bu ekranın en pahalı hatasıdır.
 */
export function parseStationStatus(value: unknown): StationStatusId {
  return STATUSES.includes(value as StationStatusId)
    ? (value as StationStatusId)
    : "unknown";
}

/** Bir makinenin runtime'dan okunan son durumu. */
export interface RuntimeMachine {
  machineId: string;
  status: StationStatusId;
  statusLabel: string;
  productionCount: number | null;
  scrapCount: number | null;
  queueLength: number | null;
  downtimeMinutes: number | null;
  throughputPerHour: number | null;
  cycleTimeSeconds: number | null;
  oee: number | null;
  /** Metrik → yazan bağlantı; çakışmalar buradan görünür. */
  sources: Record<string, string>;
  sampleCount: number;
  updatedAtMs: number;
}

/** Canlı üretim KPI'ları; ölçülemeyen alan `null`. */
export interface RuntimeKpi {
  production: number | null;
  scrap: number | null;
  queue: number | null;
  throughput: number | null;
  /** Çalışan makine oranı (0-1); hiç durum bildirilmemişse `null`. */
  availability: number | null;
  downtimeMinutes: number | null;
  activeMachines: number;
  totalMachines: number;
  unknownMachines: number;
  measuredMachines: number;
}

/** Bir metriğin başka bir kaynak tarafından üzerine yazılması. */
export interface MetricOverwrite {
  machineId: string;
  metric: string;
  previousSource: string;
  newSource: string;
  atMs: number;
}

export interface RuntimeLiveState {
  machines: RuntimeMachine[];
  kpi: RuntimeKpi;
  overwrites: MetricOverwrite[];
  persistence: { mode: string; persistent: boolean };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function parseRuntimeMachine(value: unknown): RuntimeMachine {
  const item = record(value);
  const status = parseStationStatus(item.status);
  const sources = record(item.sources);
  return {
    machineId: typeof item.machine_id === "string" ? item.machine_id : "",
    status,
    statusLabel:
      typeof item.status_label === "string" && item.status_label !== ""
        ? item.status_label
        : STATION_STATUS_LABEL[status],
    productionCount: numberOrNull(item.production_count),
    scrapCount: numberOrNull(item.scrap_count),
    queueLength: numberOrNull(item.queue_length),
    downtimeMinutes: numberOrNull(item.downtime_minutes),
    throughputPerHour: numberOrNull(item.throughput_per_hour),
    cycleTimeSeconds: numberOrNull(item.cycle_time_seconds),
    oee: numberOrNull(item.oee),
    sources: Object.fromEntries(
      Object.entries(sources).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    sampleCount: numberOr(item.sample_count, 0),
    updatedAtMs: numberOr(item.updated_at_ms, 0),
  };
}

export function parseRuntimeKpi(value: unknown): RuntimeKpi {
  const item = record(value);
  return {
    production: numberOrNull(item.production),
    scrap: numberOrNull(item.scrap),
    queue: numberOrNull(item.queue),
    throughput: numberOrNull(item.throughput),
    availability: numberOrNull(item.availability),
    downtimeMinutes: numberOrNull(item.downtime_minutes),
    activeMachines: numberOr(item.active_machines, 0),
    totalMachines: numberOr(item.total_machines, 0),
    unknownMachines: numberOr(item.unknown_machines, 0),
    measuredMachines: numberOr(item.measured_machines, 0),
  };
}

export function parseOverwrite(value: unknown): MetricOverwrite {
  const item = record(value);
  return {
    machineId: typeof item.machine_id === "string" ? item.machine_id : "",
    metric: typeof item.metric === "string" ? item.metric : "",
    previousSource: typeof item.previous_source === "string" ? item.previous_source : "",
    newSource: typeof item.new_source === "string" ? item.new_source : "",
    atMs: numberOr(item.at_ms, 0),
  };
}

export function parseRuntimeLiveState(value: unknown): RuntimeLiveState {
  const item = record(value);
  const persistence = record(item.persistence);
  return {
    machines: Array.isArray(item.machines) ? item.machines.map(parseRuntimeMachine) : [],
    kpi: parseRuntimeKpi(item.kpi),
    overwrites: Array.isArray(item.overwrites)
      ? item.overwrites.map(parseOverwrite)
      : [],
    persistence: {
      mode: stringOrNull(persistence.mode) ?? "memory",
      persistent: persistence.persistent === true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime panosu                                                              */
/* -------------------------------------------------------------------------- */

export interface RuntimeDashboard {
  connections: number;
  verified: number;
  streamsRunning: number;
  reconnects: number;
  recoveries: number;
  eventsBuffered: number;
  /** Ölçülemeyen olay hızı `null` kalır. */
  eventsPerSecond: number | null;
  persistedEvents: number;
  snapshots: number;
  persistenceMode: string;
  persistent: boolean;
  atMs: number;
}

export function parseRuntimeDashboard(value: unknown): RuntimeDashboard {
  const item = record(value);
  return {
    connections: numberOr(item.connections, 0),
    verified: numberOr(item.verified, 0),
    streamsRunning: numberOr(item.streams_running, 0),
    reconnects: numberOr(item.reconnects, 0),
    recoveries: numberOr(item.recoveries, 0),
    eventsBuffered: numberOr(item.events_buffered, 0),
    eventsPerSecond: numberOrNull(item.events_per_second),
    persistedEvents: numberOr(item.persisted_events, 0),
    snapshots: numberOr(item.snapshots, 0),
    persistenceMode: stringOrNull(item.persistence_mode) ?? "memory",
    persistent: item.persistent === true,
    atMs: numberOr(item.at_ms, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Alarm senkronizasyonu                                                       */
/* -------------------------------------------------------------------------- */

/** Alarmın yaşam döngüsü. */
export type AlarmState = "OPEN" | "ACK" | "RESOLVED";

export const ALARM_STATE_LABEL: Record<AlarmState, string> = {
  OPEN: "Açık",
  ACK: "Görüldü",
  RESOLVED: "Kapandı",
};

export interface RuntimeAlarm {
  /** `machineId::kind` — aynı makine ve tür için tek alarm. */
  id: string;
  machineId: string;
  kind: "down" | "blocked" | "stale";
  message: string;
  state: AlarmState;
  raisedAtMs: number;
  updatedAtMs: number;
}

/** Bir makineden bu süredir ölçüm gelmiyorsa veri eskimiş sayılır (ms). */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * Makine görüntülerinden alarm üretir.
 *
 * Üç neden vardır ve üçü de gerçek veriden çıkar: duruş, bloke ve **veri
 * eskimesi**. Sonuncusu ayrı bir alarmdır çünkü "makine duruyor" ile
 * "makineden haber alamıyoruz" farklı sorunlardır ve farklı kişiyi ilgilendirir.
 */
export function alarmsFromMachines(
  machines: RuntimeMachine[],
  nowMs: number,
): RuntimeAlarm[] {
  const alarms: RuntimeAlarm[] = [];

  for (const machine of machines) {
    if (machine.status === "down") {
      alarms.push({
        id: `${machine.machineId}::down`,
        machineId: machine.machineId,
        kind: "down",
        message: `${machine.machineId} duruş bildirdi.`,
        state: "OPEN",
        raisedAtMs: machine.updatedAtMs,
        updatedAtMs: machine.updatedAtMs,
      });
    } else if (machine.status === "blocked") {
      alarms.push({
        id: `${machine.machineId}::blocked`,
        machineId: machine.machineId,
        kind: "blocked",
        message: `${machine.machineId} bloke; önü dolu ya da ayarda.`,
        state: "OPEN",
        raisedAtMs: machine.updatedAtMs,
        updatedAtMs: machine.updatedAtMs,
      });
    }

    if (machine.updatedAtMs > 0 && nowMs - machine.updatedAtMs > STALE_AFTER_MS) {
      alarms.push({
        id: `${machine.machineId}::stale`,
        machineId: machine.machineId,
        kind: "stale",
        message: `${machine.machineId} makinesinden ölçüm gelmiyor; ekrandaki değer eski.`,
        state: "OPEN",
        raisedAtMs: machine.updatedAtMs,
        updatedAtMs: nowMs,
      });
    }
  }

  return alarms;
}

/**
 * Yeni alarmları mevcutlarla birleştirir.
 *
 * Çift alarm üretilmez: aynı kimlikteki bir alarm zaten varsa **durumu
 * korunur** — operatör "görüldü" dediyse, bir sonraki yenilemede alarm yeniden
 * "açık" olmamalıdır. Kaybolan bir neden alarmı silmez, `RESOLVED` yapar:
 * kapanan bir alarmın izi, kapanmasının kendisi kadar önemlidir.
 */
export function mergeAlarms(
  current: RuntimeAlarm[],
  incoming: RuntimeAlarm[],
  nowMs: number,
): RuntimeAlarm[] {
  const incomingIds = new Set(incoming.map((alarm) => alarm.id));
  const byId = new Map(current.map((alarm) => [alarm.id, alarm]));

  for (const alarm of incoming) {
    const existing = byId.get(alarm.id);
    if (existing === undefined) {
      byId.set(alarm.id, alarm);
      continue;
    }
    byId.set(alarm.id, {
      ...existing,
      message: alarm.message,
      // Kapanmış bir alarmın nedeni yeniden ortaya çıktıysa yeniden açılır.
      state: existing.state === "RESOLVED" ? "OPEN" : existing.state,
      updatedAtMs: nowMs,
    });
  }

  for (const [id, alarm] of byId) {
    if (!incomingIds.has(id) && alarm.state !== "RESOLVED") {
      byId.set(id, { ...alarm, state: "RESOLVED", updatedAtMs: nowMs });
    }
  }

  return [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

/** Alarmı "görüldü" işaretler. */
export function acknowledgeAlarm(
  alarms: RuntimeAlarm[],
  id: string,
  nowMs: number,
): RuntimeAlarm[] {
  return alarms.map((alarm) =>
    alarm.id === id && alarm.state === "OPEN"
      ? { ...alarm, state: "ACK", updatedAtMs: nowMs }
      : alarm,
  );
}

/** Açık (kapanmamış) alarmlar. */
export function openAlarms(alarms: RuntimeAlarm[]): RuntimeAlarm[] {
  return alarms.filter((alarm) => alarm.state !== "RESOLVED");
}

/* -------------------------------------------------------------------------- */
/* Ekran yardımcıları                                                          */
/* -------------------------------------------------------------------------- */

/** Bir makinenin ölçülemeyen alanları. */
export function unmeasuredOf(machine: RuntimeMachine): string[] {
  const fields: [string, number | null][] = [
    ["Üretim", machine.productionCount],
    ["Kuyruk", machine.queueLength],
    ["Duruş", machine.downtimeMinutes],
    ["Saatlik çıktı", machine.throughputPerHour],
  ];
  return fields.filter(([, value]) => value === null).map(([label]) => label);
}

/**
 * Aynı makinenin bir metriğini birden çok kaynak mı yazıyor?
 *
 * Sessiz üzerine yazma bu ürünün kaçındığı şeydir: hangi kaynağın kazandığı
 * ekranda görünür.
 */
export function conflictingMachines(overwrites: MetricOverwrite[]): string[] {
  return [...new Set(overwrites.map((item) => item.machineId))].sort();
}

/** Görüntünün ne kadar eski olduğunu anlatan kısa metin. */
export function freshnessLabel(machine: RuntimeMachine, nowMs: number): string {
  if (machine.updatedAtMs === 0) {
    return "Hiç ölçüm alınmadı";
  }
  const age = Math.max(0, nowMs - machine.updatedAtMs);
  if (age < 60_000) {
    return "az önce";
  }
  const minutes = Math.floor(age / 60_000);
  return minutes < 60 ? `${minutes} dk önce` : `${Math.floor(minutes / 60)} sa önce`;
}

/** Makine durumundan alarm var mı? */
export function hasCriticalStatus(machine: RuntimeMachine): boolean {
  return machine.status === "down";
}

/** Sunucudan gelen makine durumunu cihaz durumu tipine çevirir. */
export function toDeviceState(status: StationStatusId): MachineStateId {
  return status === "blocked" ? "setup" : (status as MachineStateId);
}
