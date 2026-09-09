/**
 * Canlı akış yüklerinin çözümlenmesi.
 *
 * Ayrıştırıcılar savunmacıdır: tanımadıkları bir alanı `null` yapar, çökmez.
 * Sayılarda `0` korunur, `NaN` ve sonsuz düşürülür — "ölçüldü ve sıfır" ile
 * "ölçülmedi" farklı bilgilerdir.
 *
 * Tanınmayan olay türü **yok sayılır**, hata verilmez: sunucuya eklenen yeni
 * bir tür, güncellenmemiş bir arayüzü çökertmemelidir.
 */

import {
  LIVE_STREAM_KINDS,
  type DeviceDataRow,
  type DispatcherStats,
  type LiveStreamEventKind,
  type QueueStats,
  type SinkStats,
  type StreamHealthId,
  type StreamProtocol,
  type StreamQuality,
  type StreamSourceState,
  type StreamStats,
} from "./types";

const PROTOCOLS: StreamProtocol[] = ["rest", "opcua", "mqtt", "unknown"];
const QUALITIES: StreamQuality[] = ["good", "uncertain", "bad"];
const HEALTHS: StreamHealthId[] = [
  "running",
  "idle",
  "backpressure",
  "failing",
  "stopped",
];

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Sayı ya da `null`; `0` korunur, `NaN` ölçülmemiş sayılır. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

/** Tanınmayan protokol "bilinmeyen" olur; uydurulmaz. */
export function parseProtocol(value: unknown): StreamProtocol {
  return PROTOCOLS.includes(value as StreamProtocol)
    ? (value as StreamProtocol)
    : "unknown";
}

/**
 * Tanınmayan kalite "belirsiz" sayılır.
 *
 * "İyi" varsayılsaydı, sunucunun yeni bir kalite adı eklediği gün bütün
 * şüpheli ölçümler sağlam görünürdü; "bozuk" varsaymak ise sağlam ölçümleri
 * atardı. Ortadaki seçenek ikisinin de zararını sınırlar.
 */
export function parseQuality(value: unknown): StreamQuality {
  return QUALITIES.includes(value as StreamQuality)
    ? (value as StreamQuality)
    : "uncertain";
}

export function parseHealth(value: unknown): StreamHealthId {
  return HEALTHS.includes(value as StreamHealthId)
    ? (value as StreamHealthId)
    : "stopped";
}

/** Olay türü; tanınmıyorsa `null` (yok sayılır). */
export function parseEventKind(value: unknown): LiveStreamEventKind | null {
  return LIVE_STREAM_KINDS.includes(value as LiveStreamEventKind)
    ? (value as LiveStreamEventKind)
    : null;
}

/** Tek bir cihaz ölçümü. */
export function parseDeviceRow(value: unknown): DeviceDataRow {
  const row = record(value);
  const quality = parseQuality(row.quality);
  return {
    connectorId: stringOr(row.connector_id, "bilinmiyor"),
    machineId: stringOr(row.machine_id, "bilinmiyor"),
    field: stringOr(row.field, "unknown"),
    value: row.value ?? null,
    timestampMs: numberOr(row.timestamp, 0),
    protocol: parseProtocol(row.source_protocol),
    quality,
    sequence: numberOr(row.sequence, 0),
    origin: stringOrNull(row.origin),
    unit: stringOrNull(row.unit),
    // Sunucu `usable` göndermezse kaliteden çıkarılır; varsayılan olarak
    // kullanılabilir saymak, bozuk bir ölçümü sayaçlara katmak olurdu.
    usable:
      typeof row.usable === "boolean"
        ? row.usable
        : quality !== "bad" && row.value !== null && row.value !== undefined,
  };
}

export function parseDeviceRows(value: unknown): DeviceDataRow[] {
  const payload = record(value);
  const rows = Array.isArray(payload.events) ? payload.events : [];
  return rows.map(parseDeviceRow);
}

/**
 * SSE karesinin gövdesini çözer.
 *
 * Sunucu her olayı `{sequence, connection_id, kind, data, ...}` biçiminde
 * yollar; ekranın ilgilendiği kısım `kind` ve `data`.
 */
export interface LiveStreamFrame {
  kind: LiveStreamEventKind;
  connectionId: string;
  data: Record<string, unknown>;
  atMs: number;
}

export function parseFrame(value: unknown): LiveStreamFrame | null {
  const payload = record(value);
  const kind = parseEventKind(payload.kind);
  if (kind === null) return null;

  return {
    kind,
    connectionId: stringOr(payload.connection_id, "runtime"),
    data: record(payload.data),
    atMs: numberOr(payload.at_ms, 0),
  };
}

export function parseQueue(value: unknown): QueueStats {
  const row = record(value);
  return {
    depth: numberOr(row.depth, 0),
    capacity: numberOr(row.capacity, 0),
    dropped: numberOr(row.dropped, 0),
    peakDepth: numberOr(row.peak_depth, 0),
    fillRatio: numberOr(row.fill_ratio, 0),
    full: row.full === true,
    underPressure: row.under_pressure === true,
  };
}

function parseSink(value: unknown): SinkStats {
  const row = record(value);
  return {
    name: stringOr(row.name, "bilinmiyor"),
    delivered: numberOr(row.delivered, 0),
    errors: numberOr(row.errors, 0),
    lastError: stringOrNull(row.last_error),
  };
}

export function parseDispatcher(value: unknown): DispatcherStats {
  const row = record(value);
  return {
    processed: numberOr(row.processed, 0),
    duplicates: numberOr(row.duplicates, 0),
    unusable: numberOr(row.unusable, 0),
    dropped: numberOr(row.dropped, 0),
    queue: parseQueue(row.queue),
    eventsPerSecond: numberOrNull(row.events_per_second),
    avgLatencyMs: numberOrNull(row.avg_latency_ms),
    maxLatencyMs: numberOrNull(row.max_latency_ms),
    lossRatio: numberOrNull(row.loss_ratio),
    sinks: Array.isArray(row.sinks) ? row.sinks.map(parseSink) : [],
  };
}

export function parseStreamStats(value: unknown): StreamStats {
  const row = record(value);
  return {
    streams: numberOr(row.streams, 0),
    running: numberOr(row.running, 0),
    health: parseHealth(row.health),
    pollRateHz: numberOrNull(row.poll_rate_hz),
    dispatcher: parseDispatcher(row.dispatcher),
  };
}

export function parseSourceState(value: unknown): StreamSourceState {
  const row = record(value);
  return {
    connectorId: stringOr(row.connector_id, stringOr(row.connection_id, "bilinmiyor")),
    protocol: stringOr(row.protocol, "unknown"),
    running: row.running === true,
    health: parseHealth(row.health),
    firstDataAtMs: numberOrNull(row.first_data_at_ms),
    lastDataAtMs: numberOrNull(row.last_data_at_ms),
  };
}
