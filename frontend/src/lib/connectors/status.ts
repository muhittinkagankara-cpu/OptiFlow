/**
 * Durum ve sağlık hesabı.
 *
 * "Kaç bağlantı ayakta?" sorusunun yanıtı tek bir yerde üretilir; sağlık
 * panosu, bağlantı kartı ve olay günlüğü aynı sayıyı gösterir. Üç ekran kendi
 * saymasını yapsaydı, biri `retrying` durumunu bağlı sayar ve pano ile kart
 * birbirini yalanlardı.
 *
 * Ölçülmemiş değer burada da sıfır değildir: hiç gecikme örneği yoksa ortalama
 * `null` döner ve arayüz "—" yazar. Sıfır milisaniyelik bir gecikme, mükemmel
 * bir bağlantı anlamına gelirdi.
 */

import {
  type ConnectorRuntime,
  type ConnectorState,
  type ConnectorStatus,
  type HealthSnapshot,
  type StatusTone,
} from "./types";

/** Son kaç gecikme örneği saklanır (mini grafik bu kadar nokta çizer). */
export const LATENCY_WINDOW = 20;

/** Bu sürenin üzerindeki gecikme yavaş sayılır ve turuncu gösterilir. */
export const SLOW_LATENCY_MS = 400;

const TONE: Record<ConnectorStatus, StatusTone> = {
  idle: "neutral",
  connecting: "warning",
  connected: "good",
  retrying: "warning",
  failed: "bad",
  disconnected: "bad",
};

export function statusTone(status: ConnectorStatus): StatusTone {
  return TONE[status];
}

/** Veri akışı var mı? Yalnızca `connected` sayılır. */
export function isOnline(status: ConnectorStatus): boolean {
  return status === "connected";
}

/** Kullanıcının müdahalesi gerekiyor mu? */
export function needsAttention(status: ConnectorStatus): boolean {
  return status === "failed" || status === "disconnected";
}

/** Boş bir çalışma zamanı durumu. */
export function idleRuntime(configId: string): ConnectorRuntime {
  return {
    configId,
    status: "idle",
    attempt: 0,
    nextRetryAtMs: null,
    lastSyncAtMs: null,
    lastLatencyMs: null,
    latencySamplesMs: [],
    syncErrors: 0,
    recordsReceived: 0,
    detail: null,
  };
}

/**
 * Gecikme örneğini pencereye ekler.
 *
 * Pencere sabit uzunluktadır: sınırsız biriktirilseydi, günlerce açık kalan
 * bir sekmede dizi sürekli büyür ve ortalama, saatler önceki ağ koşullarını
 * yansıtmaya devam ederdi.
 */
export function pushLatency(samples: number[], latencyMs: number): number[] {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    return samples;
  }
  const next = [...samples, latencyMs];
  return next.slice(Math.max(next.length - LATENCY_WINDOW, 0));
}

/** Örneklerin ortalaması; örnek yoksa `null`. */
export function averageLatency(samples: number[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  const total = samples.reduce((sum, value) => sum + value, 0);
  return total / samples.length;
}

/**
 * Sağlık özeti.
 *
 * `connecting` durumu hiçbir kovaya konulmaz ama toplamda sayılır: geçici bir
 * durumu "bağlı" ya da "kopuk" saymak, panonun bir saniye sonra kendi kendini
 * düzelten yanlış bir sayı göstermesi demek olurdu.
 */
export function healthSnapshot(state: ConnectorState): HealthSnapshot {
  const runtimes = state.configs.map(
    (config) => state.runtimes[config.id] ?? idleRuntime(config.id),
  );

  let connected = 0;
  let disconnected = 0;
  let retrying = 0;
  let failed = 0;
  let syncErrors = 0;
  let totalRecords = 0;
  let lastUpdateAtMs: number | null = null;
  const latencies: number[] = [];

  for (const runtime of runtimes) {
    if (runtime.status === "connected") {
      connected += 1;
      const average = averageLatency(runtime.latencySamplesMs);
      if (average !== null) {
        latencies.push(average);
      }
    } else if (runtime.status === "retrying") {
      retrying += 1;
    } else if (runtime.status === "failed") {
      failed += 1;
    } else if (runtime.status === "disconnected") {
      disconnected += 1;
    }

    syncErrors += runtime.syncErrors;
    totalRecords += runtime.recordsReceived;

    if (
      runtime.lastSyncAtMs !== null &&
      (lastUpdateAtMs === null || runtime.lastSyncAtMs > lastUpdateAtMs)
    ) {
      lastUpdateAtMs = runtime.lastSyncAtMs;
    }
  }

  return {
    connected,
    disconnected,
    retrying,
    failed,
    total: state.configs.length,
    syncErrors,
    avgLatencyMs: averageLatency(latencies),
    lastUpdateAtMs,
    totalRecords,
  };
}

/** Mini grafiğin noktaları: bağlı bağlantıların gecikme örnekleri. */
export function latencySeries(
  state: ConnectorState,
  configId: string,
): { index: number; latencyMs: number }[] {
  const runtime = state.runtimes[configId];
  if (!runtime) {
    return [];
  }
  return runtime.latencySamplesMs.map((latencyMs, index) => ({
    index,
    latencyMs,
  }));
}

/** Gecikmenin tonu; ölçüm yoksa nötr. */
export function latencyTone(latencyMs: number | null): StatusTone {
  if (latencyMs === null) {
    return "neutral";
  }
  return latencyMs <= SLOW_LATENCY_MS ? "good" : "warning";
}

/**
 * "3 dk önce" biçiminde göreli zaman.
 *
 * Gelecek bir zaman damgası "az önce" olarak gösterilir: sunucu ile tarayıcı
 * saatinin birkaç saniye kayması olağandır ve "-4 sn önce" yazan bir arayüz
 * bozuk görünür.
 */
export function relativeTime(atMs: number | null, nowMs: number): string {
  if (atMs === null) {
    return "—";
  }
  const diff = nowMs - atMs;
  if (diff < 0 || diff < 5_000) {
    return "az önce";
  }
  const seconds = Math.floor(diff / 1_000);
  if (seconds < 60) {
    return `${seconds} sn önce`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  return `${Math.floor(hours / 24)} gün önce`;
}
