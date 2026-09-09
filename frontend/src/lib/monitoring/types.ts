/**
 * Birleşik izleme katmanının türleri.
 *
 * Neden ayrı bir alarm türü
 * -------------------------
 * `lib/live/alarms.ts` benzetim ekranının kendi alarmlarını üretir: bir
 * senaryo koşarken kuyruk büyüdüğünde uyarı çıkarır. Sunucudan gelen alarmlar
 * ise **gerçek cihaz** verisinden doğar. İkisi aynı listede görünür ama
 * karıştırılamaz: bir operatörün "hangi makine gerçekten durdu?" sorusunun
 * yanıtı, benzetimden gelen bir satır olamaz.
 *
 * Bu yüzden her alarm bir `origin` taşır ve arayüz benzetim kaynaklı olanları
 * açıkça "Benzetim" diye etiketler.
 */

/**
 * Alarmın yaşam döngüsündeki yeri; sunucudaki değerlerle birebir aynı.
 *
 * `SILENCED` ile `RESOLVED` karıştırılmaz: susturulmuş bir alarmın nedeni
 * sürer, yalnızca bildirimi kesilmiştir. Bakımdaki bir makinenin duruş
 * alarmı kapatılsaydı, bakım bittiğinde gerçek bir arıza da kapanmış
 * görünürdü.
 *
 * `ESCALATED`, süresi içinde kimsenin ilgilenmediği alarmdır. `OPEN` olarak
 * kalsaydı, listede "birileri bakıyordur" sanılırdı.
 */
export type UnifiedAlarmState =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "SILENCED"
  | "ESCALATED"
  | "RESOLVED";

export const ALARM_STATE_LABEL: Record<UnifiedAlarmState, string> = {
  OPEN: "Açık",
  ACKNOWLEDGED: "Görüldü",
  SILENCED: "Susturuldu",
  ESCALATED: "Yükseltildi",
  RESOLVED: "Kapandı",
};

/** Bildirim zincirindeki kademeler; sunucudaki sırayla aynı. */
export const ESCALATION_CHAIN_LABEL: Record<number, string> = {
  1: "Operatör",
  2: "Vardiya amiri",
  3: "Üretim müdürü",
};

/** Alarmın ağırlığı. */
export type UnifiedAlarmSeverity = "critical" | "warning" | "info";

export const ALARM_SEVERITY_LABEL: Record<UnifiedAlarmSeverity, string> = {
  critical: "Kritik",
  warning: "Uyarı",
  info: "Bilgi",
};

/** Kritikten bilgiye doğru sıralama; listeleme bu sırayı kullanır. */
export const ALARM_SEVERITY_ORDER: UnifiedAlarmSeverity[] = [
  "critical",
  "warning",
  "info",
];

/**
 * Alarmın nereden geldiği.
 *
 * `runtime`: gerçek cihaz köprüsünden. `simulation`: ekranın kendi benzetim
 * senaryosundan. Arayüz ikisini aynı renkte gösteremez; benzetim satırı
 * "Benzetim" rozetiyle çıkar.
 */
export type AlarmOrigin = "runtime" | "simulation";

export const ALARM_ORIGIN_LABEL: Record<AlarmOrigin, string> = {
  runtime: "Gerçek",
  simulation: "Benzetim",
};

/** Sunucudaki kural kimlikleri. */
export type UnifiedAlarmRule =
  | "queue_high"
  | "machine_down"
  | "machine_blocked"
  | "no_data"
  | "runtime_disconnected"
  | "simulation";

export const ALARM_RULE_LABEL: Record<UnifiedAlarmRule, string> = {
  queue_high: "Kuyruk yüksek",
  machine_down: "Makine durdu",
  machine_blocked: "Makine bloke",
  no_data: "Veri gelmiyor",
  runtime_disconnected: "Bağlantı koptu",
  simulation: "Benzetim uyarısı",
};

/** Birleşik listedeki tek bir alarm. */
export interface UnifiedAlarm {
  /** Sunucudaki kimlik (`kural::konu`) ya da benzetim kimliği. */
  id: string;
  rule: UnifiedAlarmRule;
  ruleLabel: string;
  /** Alarmın konusu: makine ya da bağlantı kimliği. */
  subject: string;
  severity: UnifiedAlarmSeverity;
  severityLabel: string;
  state: UnifiedAlarmState;
  stateLabel: string;
  origin: AlarmOrigin;
  originLabel: string;
  message: string;
  raisedAtMs: number;
  updatedAtMs: number;
  acknowledgedBy: string | null;
  acknowledgedAtMs: number | null;
  resolvedAtMs: number | null;
  /** Alarmın süresi; sunucu hesaplamadıysa `null`. */
  durationMs: number | null;
  /** Alarm ne kadardır sahipsiz? İlgilenildiyse `null`. */
  unattendedMs: number | null;
  /** Susturan kişi; susturulmadıysa `null`. */
  silencedBy: string | null;
  /** Susturmanın bitiş anı; süresiz susturma yoktur. */
  silencedUntilMs: number | null;
  /** Susturma nedeni (bakım, planlı duruş); yoksa `null`. */
  silenceReason: string | null;
  /** Yükseltme anı; yükseltilmediyse `null`. */
  escalatedAtMs: number | null;
  /** Bildirim zincirindeki kademe; yükseltilmediyse 0. */
  escalationLevel: number;
  /** Kaç kez yinelenen bildirim üretildi? */
  repeatCount: number;
  /** Kuralın ölçtüğü değerler (kuyruk uzunluğu, eşik, sessizlik süresi). */
  context: Record<string, unknown>;
}

/** Alarm sayaçları. */
export interface AlarmCounts {
  active: number;
  open: number;
  acknowledged: number;
  silenced: number;
  escalated: number;
  critical: number;
  history: number;
  raisedTotal: number;
  resolvedTotal: number;
}

export const EMPTY_ALARM_COUNTS: AlarmCounts = {
  active: 0,
  open: 0,
  acknowledged: 0,
  silenced: 0,
  escalated: 0,
  critical: 0,
  history: 0,
  raisedTotal: 0,
  resolvedTotal: 0,
};

/** Alarm merkezinin tam görünümü. */
export interface UnifiedAlarmState_ {
  active: UnifiedAlarm[];
  history: UnifiedAlarm[];
  counts: AlarmCounts;
}

/** OEE ve üç çarpanı; hesaplanamayan alan `null`. */
export interface OeeView {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  /** Yüzdeye çevrilmiş kopya; arayüz bunu gösterir. */
  percent: {
    availability: number | null;
    performance: number | null;
    quality: number | null;
    oee: number | null;
  };
  /** Hangi çarpan neden hesaplanamadı? */
  reasons: Record<string, string>;
  complete: boolean;
}

/** Runtime KPI kartları; ölçülemeyen alan `null`. */
export interface MonitoringKpi {
  production: number | null;
  scrap: number | null;
  queue: number | null;
  throughput: number | null;
  availability: number | null;
  downtimeMinutes: number | null;
  activeMachines: number;
  blockedMachines: number;
  downMachines: number;
  unknownMachines: number;
  totalMachines: number;
  measuredMachines: number;
  alarmCount: number;
  openAlarmCount: number;
  /** Hesaplanamayan alanların nedenleri. */
  reasons: Record<string, string>;
}

/** Operatör panosundaki "Üretim Durumu" kartı. */
export interface ProductionStatus {
  oee: number | null;
  oeePercent: number | null;
  oeeReasons: Record<string, string>;
  activeAlarms: number;
  openAlarms: number;
  runningMachines: number;
  blockedMachines: number;
  downMachines: number;
  totalMachines: number;
  downtimeMinutes: number | null;
  openDowntime: number;
  reasons: Record<string, string>;
}

/** Zaman çizelgesindeki bir satır. */
export type TimelineEntryType = "downtime" | "alarm";

export interface TimelineEntry {
  type: TimelineEntryType;
  atMs: number;
  endMs: number | null;
  machineId: string | null;
  durationMs: number | null;
  reason: string;
  severity: UnifiedAlarmSeverity | null;
  state: UnifiedAlarmState | null;
  open: boolean;
}

/** Köprünün sağlık skoru. */
export interface HealthScoreView {
  /** 0-100; hiçbir bileşen ölçülemediyse `null`. */
  score: number | null;
  label: string;
  connections: HealthScoreConnection[];
  measured: number;
  total: number;
}

export interface HealthScoreConnection {
  connectionId: string;
  score: number | null;
  label: string;
  components: Record<string, number | null>;
  missing: string[];
}
