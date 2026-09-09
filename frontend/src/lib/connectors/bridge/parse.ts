/**
 * Sunucu yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcılar **savunmacıdır**: eksik ya da beklenmedik bir alan geldiğinde
 * çökmez, o alanı `null` yapar. Bunun nedeni ağ değil sürüm farkıdır — eski
 * bir sunucuya bağlanan yeni bir arayüz, tanımadığı bir gövdeyle karşılaşınca
 * boş bir ekran yerine "ölçülmedi" göstermelidir.
 *
 * Sayı alanları için `numberOrNull` kullanılır: `0` geçerli bir ölçümdür ve
 * korunur, `null`/eksik/`NaN` ise ölçülmemiştir. İkisini birbirine karıştıran
 * bir dönüşüm, ölçülmemiş gecikmeyi "0 ms" diye gösterirdi.
 */

import type {
  BridgeConnection,
  BridgeEvent,
  BridgeEventLevel,
  BridgeEventPage,
  BridgeHealth,
  BridgeKind,
  BridgeProbe,
  BridgeStatus,
  BridgeSummary,
} from "./types";

const KINDS: BridgeKind[] = ["rest", "opcua", "mqtt"];
const STATUSES: BridgeStatus[] = [
  "idle",
  "connecting",
  "connected",
  "retrying",
  "failed",
  "disconnected",
];
const LEVELS: BridgeEventLevel[] = ["info", "warning", "critical"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Sayı ya da `null`; `0` korunur, `NaN` ölçülmemiş sayılır. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sayı ya da varsayılan; sayaçlar için (ölçülmüş sıfır anlamlıdır). */
export function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function parseKind(value: unknown): BridgeKind {
  return KINDS.includes(value as BridgeKind) ? (value as BridgeKind) : "rest";
}

/**
 * Durum çözümlemesi.
 *
 * Tanınmayan bir durum **"Test edilmedi"** sayılır. `connected`'a düşmek
 * mümkün değildir: bilinmeyen bir değerin bağlantı doğrulaması olarak
 * okunması, sözleşmenin en tehlikeli ihlali olurdu.
 */
export function parseStatus(value: unknown): BridgeStatus {
  return STATUSES.includes(value as BridgeStatus) ? (value as BridgeStatus) : "idle";
}

export function parseLevel(value: unknown): BridgeEventLevel {
  return LEVELS.includes(value as BridgeEventLevel)
    ? (value as BridgeEventLevel)
    : "info";
}

export function parseHealth(value: unknown): BridgeHealth {
  const item = record(value);
  return {
    avgLatencyMs: numberOrNull(item.avg_latency_ms),
    medianLatencyMs: numberOrNull(item.median_latency_ms),
    maxLatencyMs: numberOrNull(item.max_latency_ms),
    samples: numberOr(item.samples, 0),
    reconnects: numberOr(item.reconnects, 0),
    packets: numberOr(item.packets, 0),
    errors: numberOr(item.errors, 0),
    errorRate: numberOrNull(item.error_rate),
    uptimeMs: numberOrNull(item.uptime_ms),
    lastPacketAtMs: numberOrNull(item.last_packet_at_ms),
    lastError: stringOrNull(item.last_error),
  };
}

export function parseProbe(value: unknown): BridgeProbe | null {
  if (value === null || value === undefined) {
    return null;
  }
  const item = record(value);
  return {
    ok: item.ok === true,
    latencyMs: numberOrNull(item.latency_ms),
    detail: typeof item.detail === "string" ? item.detail : "",
    evidence: stringOrNull(item.evidence),
    bytesReceived: numberOrNull(item.bytes_received),
    atMs: numberOr(item.at_ms, 0),
  };
}

export function parseConnection(value: unknown): BridgeConnection {
  const item = record(value);
  return {
    connectionId: typeof item.connection_id === "string" ? item.connection_id : "",
    kind: parseKind(item.kind),
    label: typeof item.label === "string" ? item.label : "",
    endpoint: typeof item.endpoint === "string" ? item.endpoint : "",
    port: numberOrNull(item.port),
    username: stringOrNull(item.username),
    hasPassword: item.has_password === true,
    topics: Array.isArray(item.topics)
      ? item.topics.filter((topic): topic is string => typeof topic === "string")
      : [],
    securityPolicy:
      typeof item.security_policy === "string" ? item.security_policy : "None",
    qos: numberOr(item.qos, 1),
    timeoutMs: numberOr(item.timeout_ms, 5_000),
    maxRetries: numberOr(item.max_retries, 0),
    status: parseStatus(item.status),
    everVerified: item.ever_verified === true,
    attempt: numberOr(item.attempt, 0),
    health: parseHealth(item.health),
    lastProbe: parseProbe(item.last_probe),
  };
}

export function parseConnections(value: unknown): BridgeConnection[] {
  const item = record(value);
  return Array.isArray(item.connections) ? item.connections.map(parseConnection) : [];
}

export function parseSummary(value: unknown): BridgeSummary {
  const item = record(value);
  return {
    total: numberOr(item.total, 0),
    connected: numberOr(item.connected, 0),
    failed: numberOr(item.failed, 0),
    retrying: numberOr(item.retrying, 0),
    idle: numberOr(item.idle, 0),
    verifiedEver: numberOr(item.verified_ever, 0),
    avgLatencyMs: numberOrNull(item.avg_latency_ms),
    totalPackets: numberOr(item.total_packets, 0),
    totalErrors: numberOr(item.total_errors, 0),
    reconnects: numberOr(item.reconnects, 0),
    bufferedEvents: numberOr(item.buffered_events, 0),
    subscribers: numberOr(item.subscribers, 0),
    atMs: numberOr(item.at_ms, 0),
  };
}

export function parseEvent(value: unknown): BridgeEvent {
  const item = record(value);
  return {
    sequence: numberOr(item.sequence, 0),
    connectionId: typeof item.connection_id === "string" ? item.connection_id : "",
    kind: typeof item.kind === "string" ? item.kind : "unknown",
    level: parseLevel(item.level),
    message: typeof item.message === "string" ? item.message : "",
    atMs: numberOr(item.at_ms, 0),
    data: record(item.data),
  };
}

export function parseEventPage(value: unknown): BridgeEventPage {
  const item = record(value);
  return {
    events: Array.isArray(item.events) ? item.events.map(parseEvent) : [],
    buffered: numberOr(item.buffered, 0),
    capacity: numberOr(item.capacity, 0),
    droppedBefore: numberOrNull(item.dropped_before),
  };
}

/** İstek gövdesini sunucunun beklediği alan adlarına çevirir. */
export function toRequestBody(request: {
  connectionId: string;
  kind: BridgeKind;
  label: string;
  endpoint: string;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  topics?: string[];
  securityPolicy?: string;
  qos?: number;
  timeoutMs?: number;
  maxRetries?: number;
}): Record<string, unknown> {
  return {
    connection_id: request.connectionId,
    kind: request.kind,
    label: request.label,
    endpoint: request.endpoint,
    port: request.port ?? null,
    username: request.username ?? null,
    password: request.password ?? null,
    topics: request.topics ?? [],
    security_policy: request.securityPolicy ?? "None",
    qos: request.qos ?? 1,
    timeout_ms: request.timeoutMs ?? 5_000,
    max_retries: request.maxRetries ?? 0,
  };
}
