/**
 * Üretim zaman çizelgesi.
 *
 * Duruşlar ve alarmlar **tek** akışta gösterilir. İki ayrı liste olsaydı, bir
 * operatörün "makine neden durdu?" sorusunu yanıtlaması için iki listeyi
 * kafasında eşleştirmesi gerekirdi; oysa yanıt çoğu zaman duruşun hemen
 * öncesindeki alarmdadır.
 *
 * Gruplama saate göre yapılır: bir vardiya boyunca yüzlerce satır biriken bir
 * listede, "saat 14 civarı ne oldu?" sorusu ancak böyle yanıtlanabilir.
 */

import { formatClock, formatDuration } from "./format";
import type { TimelineEntry, UnifiedAlarmSeverity } from "./types";

/** Bir saatlik dilimdeki satırlar. */
export interface TimelineGroup {
  /** Dilimin başlangıcı (epoch ms). */
  hourStartMs: number;
  label: string;
  entries: TimelineEntry[];
}

const HOUR_MS = 3_600_000;

/** Satırları yeniden eskiye sıralar. */
export function sortEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((left, right) => right.atMs - left.atMs);
}

/** Yalnızca belirli türdeki satırlar. */
export function filterByType(
  entries: TimelineEntry[],
  type: TimelineEntry["type"] | "all",
): TimelineEntry[] {
  return type === "all" ? entries : entries.filter((item) => item.type === type);
}

/** Yalnızca süren (kapanmamış) satırlar. */
export function openEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.filter((item) => item.open);
}

/** Belirli bir makinenin satırları. */
export function forMachine(
  entries: TimelineEntry[],
  machineId: string,
): TimelineEntry[] {
  return entries.filter((item) => item.machineId === machineId);
}

/**
 * Ölçülmüş sürelerin toplamı; hiç ölçüm yoksa `null`.
 *
 * Sıfır dönmek, süresi hiç ölçülmemiş bir listeyi "toplam duruş yok" diye
 * özetlemek olurdu.
 */
export function totalDurationMs(entries: TimelineEntry[]): number | null {
  const measured = entries
    .map((item) => item.durationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return measured.length === 0
    ? null
    : measured.reduce((total, value) => total + value, 0);
}

/** Saat dilimlerine böler; her dilim yeniden eskiye sıralıdır. */
export function groupByHour(entries: TimelineEntry[]): TimelineGroup[] {
  const buckets = new Map<number, TimelineEntry[]>();

  for (const entry of sortEntries(entries)) {
    const hourStart = Math.floor(entry.atMs / HOUR_MS) * HOUR_MS;
    const bucket = buckets.get(hourStart);
    if (bucket === undefined) {
      buckets.set(hourStart, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => right - left)
    .map(([hourStartMs, items]) => ({
      hourStartMs,
      label: formatClock(hourStartMs),
      entries: items,
    }));
}

/** Ekranda satırın yanında yazan özet. */
export function describeEntry(entry: TimelineEntry): string {
  const duration = formatDuration(entry.durationMs);
  const machine = entry.machineId ?? "bilinmeyen makine";

  if (entry.type === "downtime") {
    return entry.open
      ? `${machine} duruşta (${duration})`
      : `${machine} durdu, ${duration} sürdü`;
  }

  /*
   * Alarm metni zaten makinenin adıyla başlıyorsa ön ek eklenmez. Eklenseydi
   * satır "FREZE_01: FREZE_01 kuyruğu 18 parça" diye okunurdu; tarayıcıda
   * görülen gerçek bir kusurdu.
   */
  const prefix = entry.reason.startsWith(machine) ? "" : `${machine}: `;
  return entry.open
    ? `${prefix}${entry.reason}`
    : `${prefix}${entry.reason} (kapandı)`;
}

/** Satırın rengini belirleyen ağırlık; duruşlar kritik sayılır. */
export function entrySeverity(entry: TimelineEntry): UnifiedAlarmSeverity {
  if (entry.type === "downtime") return entry.open ? "critical" : "info";
  return entry.severity ?? "warning";
}

/** Çizelgenin tek satırlık özeti. */
export interface TimelineSummary {
  total: number;
  downtimeCount: number;
  alarmCount: number;
  openCount: number;
  /** Ölçülmüş toplam duruş; hiç ölçüm yoksa `null`. */
  downtimeTotalMs: number | null;
}

export function summarize(entries: TimelineEntry[]): TimelineSummary {
  const downtime = filterByType(entries, "downtime");
  return {
    total: entries.length,
    downtimeCount: downtime.length,
    alarmCount: filterByType(entries, "alarm").length,
    openCount: openEntries(entries).length,
    downtimeTotalMs: totalDurationMs(downtime),
  };
}
