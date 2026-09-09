/**
 * Geçmiş trend katmanı.
 *
 *     telemetry tablosu → /api/runtime/telemetry/trend → parse → chart → ekran
 *
 * Bu katmanda benzetim yoktur: her nokta bir cihazdan gerçekten okunmuş bir
 * ölçümdür. Ölçümü olmayan kova çizilmez, sıfıra indirilmez.
 */

export {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  gapRatio,
  pathOf,
  pointsOf,
  scaleOf,
  segmentsOf,
  seriesPaths,
  type ChartPoint,
  type ChartScale,
  type ChartSegment,
} from "./chart";
export {
  NOT_MEASURED,
  axisLabel,
  formatClock,
  formatDay,
  formatPercent,
  formatValue,
  originLabel,
  seriesCaption,
  windowLabel,
} from "./format";
export { parseBucket, parseBuckets, parseSeries, parseSummary, parseTags, parseWindowId } from "./parse";
export {
  TREND_WINDOW_LABEL,
  TREND_WINDOW_ORDER,
  emptySeries,
  type TelemetryTag,
  type TrendBucket,
  type TrendSeries,
  type TrendSummary,
  type TrendWindowId,
} from "./types";
