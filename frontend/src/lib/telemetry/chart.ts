/**
 * Trend grafiğinin geometrisi.
 *
 * Bileşen yalnızca çizer; ölçek, eksen ve nokta hesabı burada yapılır.
 * Hesap bileşenin içinde olsaydı, "boş kova nasıl çizilir?" sorusunun yanıtı
 * test edilemezdi.
 *
 * Boş kova neden çizilmez
 * -----------------------
 * Ölçümü olmayan bir kova için nokta üretilmez ve çizgi orada **kesilir**.
 * Sıfıra inen bir çizgi, cihazın kapalı olduğu saatleri "üretim durdu" gibi
 * gösterirdi; iki dolu kovayı düz bir çizgiyle birleştirmek ise olmayan bir
 * ölçümü varmış gibi göstermek olurdu.
 */

import type { TrendBucket, TrendSeries } from "./types";

/** Çizim alanının varsayılan ölçüleri (SVG birimi). */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 180;

/** Eksen etiketleri için ayrılan boşluk. */
export const CHART_PADDING = { top: 8, right: 8, bottom: 18, left: 36 };

/** Grafikteki tek bir nokta. */
export interface ChartPoint {
  x: number;
  y: number;
  /** Kovanın sırası; ipucu (tooltip) bunu kullanır. */
  index: number;
  value: number;
  startMs: number;
  endMs: number;
}

/** Bir kesintisiz çizgi parçası. */
export interface ChartSegment {
  points: ChartPoint[];
}

/** Grafiğin ölçeği; veri yoksa alanlar `null`. */
export interface ChartScale {
  min: number | null;
  max: number | null;
  /** Değer aralığı; tek bir değer varsa 0 olur. */
  span: number | null;
}

/**
 * Serideki değer aralığı.
 *
 * Bütün değerler aynıysa aralık sıfırdır ve çizgi ortadan geçer. Sıfır
 * aralıkla bölme yapılsaydı sonuç sonsuz olur ve grafik çizilmezdi.
 */
export function scaleOf(buckets: TrendBucket[]): ChartScale {
  const values = buckets
    .filter((bucket) => bucket.count > 0 && bucket.average !== null)
    .map((bucket) => bucket.average as number);
  if (values.length === 0) {
    return { min: null, max: null, span: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}

/**
 * Kovaları çizim noktalarına çevirir.
 *
 * Boş kovalar atlanır; bu yüzden dönen dizinin uzunluğu kova sayısından az
 * olabilir. Nokta sayısını kova sayısına eşitlemek, olmayan ölçümleri
 * uydurmak olurdu.
 */
export function pointsOf(
  buckets: TrendBucket[],
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
): ChartPoint[] {
  if (buckets.length === 0) return [];
  const scale = scaleOf(buckets);
  if (scale.min === null || scale.max === null) return [];

  const innerWidth = Math.max(1, width - CHART_PADDING.left - CHART_PADDING.right);
  const innerHeight = Math.max(1, height - CHART_PADDING.top - CHART_PADDING.bottom);
  const step = buckets.length > 1 ? innerWidth / (buckets.length - 1) : 0;
  const span = scale.span === null || scale.span === 0 ? 1 : scale.span;

  const points: ChartPoint[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.count === 0 || bucket.average === null) return;
    const ratio = scale.span === 0 ? 0.5 : (bucket.average - (scale.min as number)) / span;
    points.push({
      x: CHART_PADDING.left + step * index,
      // SVG'de y aşağı doğru büyür; yüksek değer yukarıda görünmelidir.
      y: CHART_PADDING.top + innerHeight - ratio * innerHeight,
      index,
      value: bucket.average,
      startMs: bucket.startMs,
      endMs: bucket.endMs,
    });
  });
  return points;
}

/**
 * Noktaları kesintisiz parçalara böler.
 *
 * Araya boş kova girdiğinde yeni bir parça başlar: çizgi orada kesilir ve
 * veri boşluğu görünür olur.
 */
export function segmentsOf(points: ChartPoint[]): ChartSegment[] {
  const segments: ChartSegment[] = [];
  let current: ChartPoint[] = [];
  let previousIndex: number | null = null;

  for (const point of points) {
    if (previousIndex !== null && point.index !== previousIndex + 1) {
      if (current.length > 0) segments.push({ points: current });
      current = [];
    }
    current.push(point);
    previousIndex = point.index;
  }
  if (current.length > 0) segments.push({ points: current });
  return segments;
}

/** Bir parçayı SVG yol verisine çevirir; tek noktalı parça da çizilir. */
export function pathOf(segment: ChartSegment): string {
  if (segment.points.length === 0) return "";
  const [head, ...rest] = segment.points;
  const parts = [`M ${head.x.toFixed(2)} ${head.y.toFixed(2)}`];
  for (const point of rest) {
    parts.push(`L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

/** Serinin bütün çizgi yolları. */
export function seriesPaths(
  series: TrendSeries,
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
): string[] {
  return segmentsOf(pointsOf(series.buckets, width, height))
    .map(pathOf)
    .filter((path) => path.length > 0);
}

/**
 * Veri olmayan kovaların oranı.
 *
 * Kova yoksa `null` döner: bölünecek bir şey olmadığında "%0 boşluk" demek,
 * hiç veri istenmemiş bir grafiği eksiksiz göstermek olurdu.
 */
export function gapRatio(buckets: TrendBucket[]): number | null {
  if (buckets.length === 0) return null;
  const empty = buckets.filter((bucket) => bucket.count === 0).length;
  return empty / buckets.length;
}
