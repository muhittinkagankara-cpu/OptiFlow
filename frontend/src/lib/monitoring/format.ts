/**
 * İzleme değerlerinin okunur karşılıkları.
 *
 * Tek kural: **ölçülmeyen değer sıfır gösterilmez.** Her biçimlendirici
 * `null` girdisinde `EMPTY` döner ve arayüz onun yanına nedeni yazar. Sıfır
 * yazılsaydı, hiç ölçülmemiş bir OEE "%0" görünür ve çalışan bir hat durmuş
 * sanılırdı.
 */

import type { MonitoringKpi, OeeView, ProductionStatus } from "./types";

/** Ölçülmemiş değerin ekrandaki karşılığı. */
export const EMPTY = "—";

/** Ölçülmemiş bir değerin yanında yazılan varsayılan neden. */
export const DEFAULT_REASON = "Bu değer ölçülmedi.";

/** Yüzde biçimi; `null` ise "—". */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return `%${value.toFixed(digits)}`;
}

/** 0-1 arası oranı yüzdeye çevirip biçimler. */
export function formatRatioAsPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return formatPercent(value * 100, digits);
}

/** Adet biçimi; ölçülmüş sıfır "0" olarak yazılır. */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return Math.round(value).toLocaleString("tr-TR");
}

/** Ondalıklı ölçüm biçimi. */
export function formatDecimal(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Süreyi okunur biçime çevirir.
 *
 * Bir saatin altındaki süreler dakika olarak yazılır: "0,8 sa" yerine "48 dk"
 * vardiya konuşmasına daha yakındır.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return EMPTY;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1_000)} sn`;
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} sa` : `${hours} sa ${remainder} dk`;
}

/** Dakika cinsinden duruş; `null` ise "—". */
export function formatMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return `${formatDecimal(value, 1)} dk`;
}

/** Saatlik çıktı. */
export function formatThroughput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return `${formatDecimal(value, 1)} adet/sa`;
}

/** Epoch milisaniyeyi saat:dakika biçimine çevirir. */
export function formatClock(atMs: number | null): string {
  if (atMs === null || !Number.isFinite(atMs) || atMs <= 0) return EMPTY;
  const date = new Date(atMs);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Bir KPI alanının nedeni; yoksa varsayılan açıklama. */
export function reasonFor(
  reasons: Record<string, string>,
  key: string,
): string {
  return reasons[key] ?? DEFAULT_REASON;
}

/** Ekrandaki tek bir KPI kartı. */
export interface KpiCard {
  key: string;
  label: string;
  value: string;
  /** Değer ölçülemediyse yazılacak neden; ölçüldüyse `null`. */
  reason: string | null;
  measured: boolean;
}

function card(
  key: string,
  label: string,
  value: number | null,
  format: (input: number | null) => string,
  reasons: Record<string, string>,
): KpiCard {
  const measured = value !== null && Number.isFinite(value);
  return {
    key,
    label,
    value: format(value),
    reason: measured ? null : reasonFor(reasons, key),
    measured,
  };
}

/**
 * KPI'ları ekran kartlarına çevirir.
 *
 * Karar burada verilir, bileşende değil: hangi alanın hangi biçimde ve hangi
 * nedenle gösterileceği bir üründür ve sınanabilir olmalıdır.
 */
export function toKpiCards(kpi: MonitoringKpi): KpiCard[] {
  return [
    card("production", "Üretim", kpi.production, formatCount, kpi.reasons),
    card("scrap", "Fire", kpi.scrap, formatCount, kpi.reasons),
    card("queue", "Kuyruk", kpi.queue, formatCount, kpi.reasons),
    card("throughput", "Hız", kpi.throughput, formatThroughput, kpi.reasons),
    card(
      "availability",
      "Kullanılabilirlik",
      kpi.availability,
      (value) => formatRatioAsPercent(value),
      kpi.reasons,
    ),
    card("downtime", "Duruş", kpi.downtimeMinutes, formatMinutes, kpi.reasons),
  ];
}

/** OEE çarpanlarını kartlara çevirir. */
export function toOeeCards(oee: OeeView): KpiCard[] {
  const rows: [string, string, number | null][] = [
    ["availability", "Kullanılabilirlik", oee.percent.availability],
    ["performance", "Performans", oee.percent.performance],
    ["quality", "Kalite", oee.percent.quality],
    ["oee", "OEE", oee.percent.oee],
  ];

  return rows.map(([key, label, value]) => ({
    key,
    label,
    value: formatPercent(value),
    reason: value === null ? reasonFor(oee.reasons, key) : null,
    measured: value !== null,
  }));
}

/**
 * Üretim durumunun tek cümlelik özeti.
 *
 * Operatör panosunun başlığında durur; sayılar ölçülmediyse cümle bunu söyler
 * ("OEE ölçülmedi") ve boş bir yüzde göstermez.
 */
export function summarizeProduction(status: ProductionStatus): string {
  const oee =
    status.oeePercent === null ? "OEE ölçülmedi" : `OEE ${formatPercent(status.oeePercent)}`;
  const machines = `${status.runningMachines}/${status.totalMachines} makine çalışıyor`;
  const alarms =
    status.activeAlarms === 0 ? "açık alarm yok" : `${status.activeAlarms} alarm açık`;
  return `${oee} · ${machines} · ${alarms}`;
}
