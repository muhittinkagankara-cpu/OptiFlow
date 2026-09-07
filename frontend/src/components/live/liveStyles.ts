/**
 * Canlı ekranın renk sözlüğü.
 *
 * Beş durumun rengi tek yerde durur çünkü aynı kodlama dört bileşende
 * görünüyor: diyagram düğümü, istasyon çekmecesi, olay çizgisi ve alarm
 * kartı. Her birinde ayrı yazılsaydı zamanla ayrışır ve "kırmızı" bir yerde
 * arıza, başka bir yerde kuyruk anlamına gelirdi.
 *
 * Renk hiçbir zaman tek başına bilgi taşımaz: `STATUS_LABEL` her durumun
 * yazılı karşılığını verir ve bileşenler ikisini birlikte gösterir.
 */

import type { AlarmLevel, MachineStatus } from "../../lib/live";

export interface StatusStyle {
  /** Kart/düğüm gövdesi. */
  box: string;
  /** Küçük durum noktası. */
  dot: string;
  /** Rozet. */
  chip: string;
  /** Kalın durum şeridi. */
  strip: string;
  /** Metin rengi. */
  text: string;
}

export const STATUS_STYLE: Record<MachineStatus, StatusStyle> = {
  running: {
    box: "border-emerald-400/60 bg-emerald-500/10",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    strip: "bg-emerald-500",
    text: "text-emerald-700",
  },
  idle: {
    box: "border-brand-400/50 bg-brand-500/10",
    dot: "bg-brand-500",
    chip: "border-brand-200 bg-brand-50 text-brand-700",
    strip: "bg-brand-500",
    text: "text-brand-700",
  },
  queued: {
    box: "border-amber-400/60 bg-amber-500/10",
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    strip: "bg-amber-500",
    text: "text-amber-700",
  },
  fault: {
    box: "border-red-400/60 bg-red-500/10",
    dot: "bg-red-500",
    chip: "border-red-200 bg-red-50 text-red-800",
    strip: "bg-red-500",
    text: "text-red-700",
  },
  setup: {
    box: "border-violet-400/60 bg-violet-500/10",
    dot: "bg-violet-500",
    chip: "border-violet-200 bg-violet-50 text-violet-700",
    strip: "bg-violet-500",
    text: "text-violet-700",
  },
};

export const ALARM_STYLE: Record<
  AlarmLevel,
  { box: string; chip: string; text: string }
> = {
  critical: {
    box: "border-red-400/50 bg-red-500/10",
    chip: "border-red-200 bg-red-50 text-red-800",
    text: "text-red-700",
  },
  warning: {
    box: "border-amber-400/50 bg-amber-500/10",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    text: "text-amber-700",
  },
  info: {
    box: "border-slate-200 bg-slate-100/60",
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    text: "text-slate-500",
  },
};

/**
 * Bir istasyonun darboğaz sayılıp sayılmadığı.
 *
 * Darboğaz ayrı bir **durum** değildir — arızalı bir istasyon da darboğaz
 * olabilir. Bu yüzden turuncu nabız, duruma değil bu koşula bağlanır ve
 * düğümün kendi rengini ezmez.
 */
export function isBottleneck(queue: number, longestQueue: number): boolean {
  return queue > 0 && queue === longestQueue;
}
