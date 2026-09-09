/**
 * Trend yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcı savunmacıdır: eksik ya da tanınmayan bir alan geldiğinde çökmez,
 * o alanı `null` yapar. `0` korunur, `NaN` ve sonsuz düşürülür — "ölçüldü ve
 * sıfır" ile "ölçülmedi" farklı bilgilerdir.
 */

import { numberOr, numberOrNull, record, stringOr } from "../monitoring/parse";
import {
  TREND_WINDOW_LABEL,
  TREND_WINDOW_ORDER,
  type TelemetryTag,
  type TrendBucket,
  type TrendSeries,
  type TrendSummary,
  type TrendWindowId,
} from "./types";

/** Tanınmayan pencere kimliği `null` döner; varsayılana düşülmez.
 *
 * Varsayılana düşseydi, yedi günlük veri isteyen kullanıcı bir saatlik
 * grafiğe bakar ve yanlış bir dönem okurdu.
 */
export function parseWindowId(value: unknown): TrendWindowId | null {
  return TREND_WINDOW_ORDER.includes(value as TrendWindowId)
    ? (value as TrendWindowId)
    : null;
}

export function parseBucket(value: unknown): TrendBucket {
  const row = record(value);
  return {
    startMs: numberOr(row.start_ms, 0),
    endMs: numberOr(row.end_ms, 0),
    count: numberOr(row.count, 0),
    average: numberOrNull(row.average),
    min: numberOrNull(row.min),
    max: numberOrNull(row.max),
    last: numberOrNull(row.last),
  };
}

export function parseBuckets(value: unknown): TrendBucket[] {
  return Array.isArray(value) ? value.map(parseBucket) : [];
}

export function parseSummary(value: unknown): TrendSummary {
  const row = record(value);
  const filled = numberOr(row.filled_buckets, 0);
  return {
    average: numberOrNull(row.average),
    min: numberOrNull(row.min),
    max: numberOrNull(row.max),
    filledBuckets: filled,
    coverage: numberOrNull(row.coverage),
    // Sunucu neden yazmadıysa ve veri de yoksa, arayüzün gösterecek bir şeyi
    // olmalı: boş bir grafiğin yanında hiçbir açıklama olmaması, kullanıcıya
    // arızalı bir ekran izlenimi verirdi.
    reason:
      typeof row.reason === "string" && row.reason.length > 0
        ? row.reason
        : filled > 0
          ? null
          : "Bu aralıkta kayıtlı ölçüm yok",
  };
}

/** `/api/runtime/telemetry/trend` yanıtı. */
export function parseSeries(value: unknown): TrendSeries {
  const row = record(value);
  const window = parseWindowId(row.window) ?? "1h";
  return {
    device: stringOr(row.device, "bilinmiyor"),
    tag: stringOr(row.tag, "bilinmiyor"),
    window,
    windowLabel: stringOr(row.label, TREND_WINDOW_LABEL[window]),
    buckets: parseBuckets(row.buckets),
    totalPoints: numberOr(row.total_points, 0),
    hasData: row.has_data === true,
    summary: parseSummary(row.summary),
    excluded: numberOr(row.excluded, 0),
    startMs: numberOr(row.start_ms, 0),
    endMs: numberOr(row.end_ms, 0),
    origin: stringOr(row.origin, "bilinmiyor"),
  };
}

/** `/api/runtime/telemetry/tags` yanıtı. */
export function parseTags(value: unknown): TelemetryTag[] {
  const row = record(value);
  const items = Array.isArray(row.tags) ? row.tags : [];
  return items
    .map((item) => {
      const entry = record(item);
      return {
        device: stringOr(entry.device, ""),
        tag: stringOr(entry.tag, ""),
      };
    })
    .filter((item) => item.device.length > 0 && item.tag.length > 0);
}
