/**
 * Bağlantı tanılaması — ölçülen ne varsa o, ölçülmeyen "Doğrulanmadı".
 *
 * Tanılama paneli sahada tek bir soruya hizmet eder: "bağlantı çalışmıyorsa
 * neden çalışmıyor?" Bu soruya ancak gerçek denemelerden toplanan sayılarla
 * yanıt verilebilir. Bu yüzden buradaki her alan, **hiç denenmemişken `null`**
 * döner ve arayüz onu "Doğrulanmadı" olarak yazar.
 *
 * Sıfır yazmak en tehlikeli seçenek olurdu: "0 hata" ile "hiç denenmedi" aynı
 * ekranda aynı görünür ve kullanıcı çalışmayan bir bağlantıyı sağlıklı sanır.
 */

import type { RuntimeProbe } from "./types";

export interface Diagnostics {
  /** Kaç deneme yapıldı. */
  attempts: number;
  /** Kaçı başarılı. */
  successes: number;
  /** Kaçı başarısız. */
  failures: number;
  /** Zaman aşımına uğrayan deneme sayısı. */
  timeouts: number;
  /** Son başarılı denemenin anı; hiç başarı yoksa `null`. */
  lastSuccessAtMs: number | null;
  /** Son denemenin anı; hiç deneme yoksa `null`. */
  lastAttemptAtMs: number | null;
  /** Son ölçülen gecikme; ölçüm yoksa `null`. */
  lastLatencyMs: number | null;
  /** Başarılı denemelerin ortalama gecikmesi; ölçüm yoksa `null`. */
  averageLatencyMs: number | null;
  /** Art arda başarısız deneme sayısı (yeniden deneme sayacı). */
  consecutiveFailures: number;
  /** İlk başarılı denemeden bu yana geçen süre; bağlantı yoksa `null`. */
  connectedSinceMs: number | null;
  /** Son hatanın nedeni; hata yoksa `null`. */
  lastError: string | null;
}

/** Hiç deneme yapılmamış tanılama. */
export function emptyDiagnostics(): Diagnostics {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    lastSuccessAtMs: null,
    lastAttemptAtMs: null,
    lastLatencyMs: null,
    averageLatencyMs: null,
    consecutiveFailures: 0,
    connectedSinceMs: null,
    lastError: null,
  };
}

/**
 * Gecikme ortalamasının hesabında tutulan örnek sayısı.
 *
 * Bağlayıcı katmanındaki `LATENCY_WINDOW` ile aynı işi görür ama ayrı bir addır:
 * ikisi aynı adla dışa aktarıldığında barrel dosyası belirsiz kalıyordu ve
 * "hangi pencere?" sorusu okuyanı da durduruyordu.
 */
export const DIAGNOSTIC_LATENCY_WINDOW = 20;

interface InternalState {
  diagnostics: Diagnostics;
  samples: number[];
}

/**
 * Bir deneme sonucunu tanılamaya işler.
 *
 * `attempted: false` olan sonuçlar **sayılmaz**: istemci olmadığı için hiç
 * gidilmemiş bir deneme, başarısız bir deneme değildir. İkisini karıştırmak,
 * OPC UA iskeletini "sürekli hata veriyor" gibi gösterirdi.
 */
export function applyProbe(
  state: InternalState,
  probe: RuntimeProbe,
): InternalState {
  if (!probe.attempted) {
    return state;
  }

  const samples =
    probe.ok && probe.latencyMs !== null
      ? [...state.samples, probe.latencyMs].slice(-DIAGNOSTIC_LATENCY_WINDOW)
      : state.samples;

  const isTimeout = !probe.ok && probe.detail.toLowerCase().includes("zaman aşımı");

  const diagnostics: Diagnostics = {
    attempts: state.diagnostics.attempts + 1,
    successes: state.diagnostics.successes + (probe.ok ? 1 : 0),
    failures: state.diagnostics.failures + (probe.ok ? 0 : 1),
    timeouts: state.diagnostics.timeouts + (isTimeout ? 1 : 0),
    lastSuccessAtMs: probe.ok ? probe.atMs : state.diagnostics.lastSuccessAtMs,
    lastAttemptAtMs: probe.atMs,
    lastLatencyMs: probe.latencyMs ?? state.diagnostics.lastLatencyMs,
    averageLatencyMs:
      samples.length === 0
        ? null
        : Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    consecutiveFailures: probe.ok ? 0 : state.diagnostics.consecutiveFailures + 1,
    /*
     * Bağlantı süresi ilk başarıdan başlar ve bir başarısızlıkta sıfırlanır:
     * "iki saattir bağlı" cümlesi, arada kopma olduysa doğru değildir.
     */
    connectedSinceMs: probe.ok
      ? (state.diagnostics.connectedSinceMs ?? probe.atMs)
      : null,
    lastError: probe.ok ? null : probe.detail,
  };

  return { diagnostics, samples };
}

/** Denemeleri sırayla işleyip tanılama üretir. */
export function buildDiagnostics(probes: RuntimeProbe[]): Diagnostics {
  let state: InternalState = { diagnostics: emptyDiagnostics(), samples: [] };
  for (const probe of probes) {
    state = applyProbe(state, probe);
  }
  return state.diagnostics;
}

/** Bağlantının ne kadar süredir ayakta olduğu (ms); bağlı değilse `null`. */
export function uptimeMs(
  diagnostics: Diagnostics,
  nowMs: number,
): number | null {
  if (diagnostics.connectedSinceMs === null) {
    return null;
  }
  return Math.max(0, nowMs - diagnostics.connectedSinceMs);
}

/** Başarı oranı (0-1); hiç deneme yoksa `null`. */
export function successRate(diagnostics: Diagnostics): number | null {
  if (diagnostics.attempts === 0) {
    return null;
  }
  return diagnostics.successes / diagnostics.attempts;
}

/** Panelde gösterilecek tek bir satır. */
export interface DiagnosticRow {
  label: string;
  /** Ölçülmüş değer; ölçülmediyse `null`. */
  value: string | null;
  /** Ölçülmediyse gösterilecek metin. */
  fallback: string;
}

/** Ölçülmemiş satırların ortak metni. */
export const UNVERIFIED = "Doğrulanmadı";

/**
 * Tanılama satırları.
 *
 * Hiç deneme yapılmamışsa **her satır** "Doğrulanmadı" döner. Bir kısmı
 * doluyken bir kısmının sıfır görünmesi, kullanıcıya kısmi bir bağlantı
 * olduğunu düşündürürdü.
 */
export function diagnosticRows(
  diagnostics: Diagnostics,
  nowMs: number,
): DiagnosticRow[] {
  const measured = diagnostics.attempts > 0;
  const uptime = uptimeMs(diagnostics, nowMs);

  return [
    {
      label: "Ping (son gecikme)",
      value:
        diagnostics.lastLatencyMs === null ? null : `${diagnostics.lastLatencyMs} ms`,
      fallback: UNVERIFIED,
    },
    {
      label: "Ortalama gecikme",
      value:
        diagnostics.averageLatencyMs === null
          ? null
          : `${diagnostics.averageLatencyMs} ms`,
      fallback: UNVERIFIED,
    },
    {
      label: "Zaman aşımı",
      value: measured ? `${diagnostics.timeouts} kez` : null,
      fallback: UNVERIFIED,
    },
    {
      label: "Son başarılı istek",
      value:
        diagnostics.lastSuccessAtMs === null
          ? null
          : relative(diagnostics.lastSuccessAtMs, nowMs),
      fallback: UNVERIFIED,
    },
    {
      label: "Hata sayısı",
      value: measured ? `${diagnostics.failures} / ${diagnostics.attempts}` : null,
      fallback: UNVERIFIED,
    },
    {
      label: "Art arda başarısız",
      value: measured ? `${diagnostics.consecutiveFailures}` : null,
      fallback: UNVERIFIED,
    },
    {
      label: "Bağlantı süresi",
      value: uptime === null ? null : formatDuration(uptime),
      fallback: UNVERIFIED,
    },
  ];
}

/** "3 dk önce" biçiminde göreli zaman. */
export function relative(atMs: number, nowMs: number): string {
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
  return `${Math.floor(minutes / 60)} sa önce`;
}

/** Süreyi okunur biçime çevirir. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) {
    return `${seconds} sn`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dk`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} sa ${minutes % 60} dk`;
}
