/**
 * Trend ekranının metinleri.
 *
 * Ölçülmemiş her değer "—" ile gösterilir ve yanında nedeni yazar. Sıfır
 * gösterilseydi, hiç ölçüm almamış bir etiket "ortalama 0" diye okunurdu.
 */

import { TREND_WINDOW_LABEL, type TrendSeries, type TrendWindowId } from "./types";

/** Ölçülmemiş değerin yerine konan işaret. */
export const NOT_MEASURED = "—";

/** Sayıyı okunur biçime çevirir; ölçülmemişse "—". */
export function formatValue(value: number | null, digits = 1): string {
  if (value === null) return NOT_MEASURED;
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** Oranı yüzdeye çevirir; ölçülmemişse "—". */
export function formatPercent(ratio: number | null): string {
  if (ratio === null) return NOT_MEASURED;
  return `%${Math.round(ratio * 100)}`;
}

/** Saat:dakika; geçersiz an için "—". */
export function formatClock(atMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return NOT_MEASURED;
  return new Date(atMs).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Gün/ay; haftalık pencerede eksende kullanılır. */
export function formatDay(atMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return NOT_MEASURED;
  return new Date(atMs).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Pencereye göre eksen etiketi.
 *
 * Bir saatlik pencerede saat:dakika, daha uzunlarda gün/ay okunur. Haftalık
 * bir grafiğin ekseninde saat yazsaydı, aynı saat yedi kez tekrarlanır ve
 * hangi günün olduğu anlaşılmazdı.
 */
export function axisLabel(atMs: number, window: TrendWindowId): string {
  return window === "1h" ? formatClock(atMs) : formatDay(atMs);
}

/** Pencerenin insan okunur adı. */
export function windowLabel(window: TrendWindowId): string {
  return TREND_WINDOW_LABEL[window];
}

/**
 * Serinin durum cümlesi.
 *
 * Veri yoksa nedeni; varsa kaç ölçümün kaç kovaya düştüğü yazılır. Dışarıda
 * kalan ölçümler ayrıca söylenir: sessizce atılan bir ölçüm, kullanıcının
 * eksik bir grafiğe bakıp nedenini bilmemesi demektir.
 */
export function seriesCaption(series: TrendSeries): string {
  if (!series.hasData) {
    return series.summary.reason ?? "Bu aralıkta kayıtlı ölçüm yok";
  }
  const parts = [
    `${series.totalPoints} ölçüm`,
    `${series.summary.filledBuckets}/${series.buckets.length} aralık dolu`,
  ];
  if (series.excluded > 0) {
    parts.push(`${series.excluded} ölçüm bozuk kalite nedeniyle hesap dışı`);
  }
  return parts.join(" · ");
}

/**
 * Verinin kaynağı hakkındaki rozet metni.
 *
 * Sunucu `telemetry` derse veri gerçek zaman serisinden gelmiştir. Başka bir
 * değer geldiğinde bu **varsayılmaz**; kaynağın ne olduğu olduğu gibi yazılır.
 */
export function originLabel(origin: string): string {
  return origin === "telemetry" ? "Kayıtlı telemetri" : `Kaynak: ${origin}`;
}
