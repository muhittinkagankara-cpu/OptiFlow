/**
 * Operatör deneyiminin veri şeması.
 *
 * Bu tipler bir **MES sözleşmesinin taslağıdır**, simülasyon motorunun değil.
 * `SimulationConfig` bir fabrikanın nasıl kurulduğunu anlatır; buradaki
 * `OperatorTask` ise vardiyada o istasyonda ne yapıldığını anlatır. İkisini
 * aynı tipte birleştirmek cazip görünürdü ama yanlış olurdu: biri modelin
 * girdisi, diğeri sahadan gelen olay akışıdır ve bağımsız değişirler.
 *
 * Bu sürümde gerçek bir MES bağlantısı **yoktur**. Görevler
 * `LocalOperatorProvider` tarafından üretilir ve arayüz bunu her ekranda
 * açıkça söyler — çalışıyormuş gibi görünen ama uydurma sayı gösteren bir
 * operatör paneli, hattaki insanı yanlış karar vermeye iter.
 */

/** Görevin yaşam döngüsü. */
export type TaskStatus = "pending" | "active" | "paused" | "done";

/**
 * Görev önceliği.
 *
 * Üç kademe, arayüzdeki üç renge birebir karşılık gelir (kırmızı / turuncu /
 * yeşil). Renk hiçbir zaman tek başına bilgi taşımaz: her kademenin bir de
 * yazılı etiketi vardır, çünkü hat aydınlatması ve renk körlüğü kırmızı ile
 * turuncuyu ayırt edilemez hâle getirebilir.
 */
export type TaskPriority = "urgent" | "high" | "normal";

/** Hurda nedeni — vardiyada en sık girilen dört kalem. */
export type ScrapReason = "burr" | "scratch" | "dimension" | "other";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Bekliyor",
  active: "Çalışıyor",
  paused: "Duraklatıldı",
  done: "Tamamlandı",
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Acil",
  high: "Öncelikli",
  normal: "Normal",
};

export const SCRAP_REASON_LABEL: Record<ScrapReason, string> = {
  burr: "Çapak",
  scratch: "Çizik",
  dimension: "Ölçü Hatası",
  other: "Diğer",
};

/** Sıralamada kullanılan öncelik ağırlığı; küçük olan önce gelir. */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
};

/** Sıralamada kullanılan durum ağırlığı; küçük olan önce gelir. */
export const STATUS_ORDER: Record<TaskStatus, number> = {
  active: 0,
  paused: 1,
  pending: 2,
  done: 3,
};

/** Bir hurda kaydı. */
export interface ScrapEntry {
  id: string;
  taskId: string;
  reason: ScrapReason;
  quantity: number;
  /**
   * Eklenen fotoğraf sayısı.
   *
   * Fotoğrafın kendisi bu sürümde saklanmaz (yer tutucu); yalnızca kaç tane
   * eklendiği tutulur. Sahte bir görsel üretip saklamak, sonradan gerçek
   * dosyalarla değiştirilmesi gereken bir veri yükü bırakırdı.
   */
  photoCount: number;
  note: string | null;
  /** ISO 8601 zaman damgası. */
  at: string;
}

/** Operatöre atanmış tek bir iş. */
export interface OperatorTask {
  id: string;
  /** İş emri numarası — sahada işin kimliği budur. */
  workOrder: string;
  stationId: string;
  stationName: string;
  machineName: string;
  operatorName: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Hedeflenen adet. */
  targetQuantity: number;
  /** Sağlam üretilmiş adet (hurda dâhil değildir). */
  completedQuantity: number;
  /** Bir parçanın çevrim süresi (saniye). */
  cycleSeconds: number;
  /** İşin tahmini toplam süresi (dakika). */
  estimatedMinutes: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Bu göreve harcanmış toplam süre (saniye). */
  workedSeconds: number;
  scrap: ScrapEntry[];
}

/** Vardiya penceresi. */
export interface ShiftWindow {
  label: string;
  startedAt: string;
  endsAt: string;
}

/** `taskProgress` çıktısı. */
export interface TaskProgress {
  completed: number;
  target: number;
  remaining: number;
  /** 0-1 arası doluluk; hedef bilinmiyorsa 0. */
  ratio: number;
  isComplete: boolean;
}

/** Tek bir hurda nedeninin payı. */
export interface ScrapReasonShare {
  reason: ScrapReason;
  label: string;
  quantity: number;
  /** Nedenin toplam hurda içindeki payı (0-1). */
  share: number;
}

/** `scrapSummary` çıktısı. */
export interface ScrapSummary {
  total: number;
  byReason: ScrapReasonShare[];
  /**
   * Hurda oranı = hurda / (sağlam + hurda).
   *
   * Hiç parça işlenmemişse `null` döner. Sıfır göstermek "fire yok, her şey
   * yolunda" demek olurdu; oysa henüz ölçülecek bir şey yoktur.
   */
  rate: number | null;
  tone: "good" | "warning" | "bad" | "neutral";
  photoCount: number;
}

/** `buildShiftSummary` çıktısı. */
export interface ShiftSummary {
  produced: number;
  scrapped: number;
  /** Sağlam / toplam işlenen; hiç iş yapılmadıysa `null`. */
  yieldRate: number | null;
  workedMinutes: number;
  taskCount: number;
  completedCount: number;
  allDone: boolean;
  tone: "good" | "warning" | "bad" | "neutral";
  /** Vardiya sonundaki kısa mesaj. */
  headline: string;
  detail: string;
}
