/**
 * İskelet yükleme göstergesinin geometrisi (Sprint 1A).
 *
 * İskeletin işi, gelecek içeriğin **ölçüsünü** önceden ayırmaktır: içerik
 * geldiğinde düzen zıplamaz ve kullanıcı ne beklediğini bilir. Dönen bir
 * gösterge ikisini de yapmaz (MASTER §12, ANTI-PATTERNS #13).
 *
 * Geometri burada, bileşende değil, çünkü bu bir karar: "bir metin bloğu üç
 * satırdır ve son satır kısadır" cümlesi sınanabilir bir kuraldır.
 */

import type { SkeletonShape } from "./types";

/** Tek bir iskelet çubuğu: yüzde genişlik ve piksel yükseklik. */
export interface SkeletonBar {
  /** Kapsayıcının yüzdesi olarak genişlik (1–100). */
  widthPercent: number;
  /** Piksel yükseklik. */
  heightPx: number;
}

/** Biçim verildiğinde, satır sayısı belirtilmemişse kullanılacak varsayılan. */
export const DEFAULT_ROWS: Record<SkeletonShape, number> = {
  text: 3,
  metric: 1,
  table: 5,
  chart: 1,
};

/** Satır sayısının kabul edilen aralığı. */
export const MIN_ROWS = 1;
export const MAX_ROWS = 12;

/** Aralık dışındaki satır sayılarını sınırlar. */
export function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) {
    return MIN_ROWS;
  }
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(rows)));
}

/**
 * Metin bloğunun satır genişlikleri.
 *
 * Son satır bilinçli olarak kısadır: gerçek bir paragrafın son satırı da
 * kısadır. Hepsi eşit genişlikte olsaydı iskelet bir tabloya benzerdi ve
 * kullanıcı yanlış içeriği beklerdi.
 */
function textBars(rows: number): SkeletonBar[] {
  return Array.from({ length: rows }, (_, index) => ({
    widthPercent: index === rows - 1 && rows > 1 ? 62 : 100,
    heightPx: 12,
  }));
}

/**
 * Bir metrik: üstte küçük etiket, altta büyük değer.
 *
 * `rows` burada kaç **metrik** gösterileceğidir; her metrik iki çubuk üretir.
 */
function metricBars(rows: number): SkeletonBar[] {
  return Array.from({ length: rows }, () => [
    { widthPercent: 38, heightPx: 10 },
    { widthPercent: 64, heightPx: 28 },
  ]).flat();
}

/** Tablo satırları eşit yükseklikte ve tam genişliktedir. */
function tableBars(rows: number): SkeletonBar[] {
  return Array.from({ length: rows }, () => ({
    widthPercent: 100,
    heightPx: 20,
  }));
}

/** Grafik tek bir blok olarak ayrılır; sahte eksen ya da sahte çubuk çizilmez. */
function chartBars(rows: number): SkeletonBar[] {
  return Array.from({ length: rows }, () => ({
    widthPercent: 100,
    heightPx: 140,
  }));
}

/**
 * Biçime göre çizilecek çubukları üretir.
 *
 * `rows` verilmezse biçimin varsayılanı kullanılır.
 */
export function skeletonBars(
  shape: SkeletonShape,
  rows?: number,
): SkeletonBar[] {
  const count = clampRows(rows ?? DEFAULT_ROWS[shape]);
  switch (shape) {
    case "text":
      return textBars(count);
    case "metric":
      return metricBars(count);
    case "table":
      return tableBars(count);
    case "chart":
      return chartBars(count);
  }
}

/**
 * Ekran okuyucuya söylenecek metin.
 *
 * Görsel iskelet ekran okuyucu için anlamsızdır; ne yüklendiği yazıyla
 * söylenir. "Yükleniyor" tek başına yetersizdir — kullanıcı neyin geldiğini
 * bilmelidir.
 */
export function skeletonLabel(shape: SkeletonShape): string {
  switch (shape) {
    case "text":
      return "Metin yükleniyor";
    case "metric":
      return "Ölçüm yükleniyor";
    case "table":
      return "Tablo yükleniyor";
    case "chart":
      return "Grafik yükleniyor";
  }
}
