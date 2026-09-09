/**
 * Bağlayıcı sağlık skoru.
 *
 * Bağlayıcı katmanı (`lib/connectors`) durumu ve gecikmeyi zaten tutuyor;
 * burada bunlar tek bir 0-100 skoruna indirgenir. Skorun amacı, beş kaynağın
 * hangisine önce bakılacağını söylemektir.
 *
 * **Bu sürümde hiçbir bağlantı gerçek bir cihaza gitmez.** Skor, benzetim
 * verisinden hesaplanır ve her kart `isRealConnection: false` taşır; arayüz
 * bunu "Benzetim" olarak yazar. Gerçek bir istemci eklendiğinde tek değişecek
 * şey bu bayrağın kaynağı olacak — hesap aynı kalacak.
 */

import {
  CONNECTOR_LABEL,
  averageLatency,
  type ConnectorConfig,
  type ConnectorRuntime,
  type ConnectorState,
} from "../connectors";
import type { ConnectorHealthCard, ReadinessBand } from "./types";

/** Skorun bileşen ağırlıkları; toplamı 100. */
export const HEALTH_WEIGHTS = {
  /** Bağlı mı? */
  status: 45,
  /** Gecikme kabul edilebilir mi? */
  latency: 20,
  /** Veri tazeliği. */
  freshness: 20,
  /** Yeniden deneme ve senkron hatası yokluğu. */
  stability: 15,
} as const;

/** Bu gecikmeye kadar tam puan verilir (ms). */
export const GOOD_LATENCY_MS = 120;

/** Bu gecikmeden sonra gecikme puanı sıfırlanır (ms). */
export const BAD_LATENCY_MS = 800;

/** Veri bu süreden yeniyse tazelik tam puan alır (ms). */
export const FRESH_WINDOW_MS = 60_000;

/** Veri bu süreden eskiyse tazelik puanı sıfırlanır (ms). */
export const STALE_WINDOW_MS = 15 * 60_000;

/** Skor bandlarının alt sınırları. */
export const HEALTH_BANDS = { green: 85, blue: 65, orange: 40 } as const;

export function healthBand(score: number | null): ReadinessBand {
  if (score === null) {
    return "red";
  }
  if (score >= HEALTH_BANDS.green) {
    return "green";
  }
  if (score >= HEALTH_BANDS.blue) {
    return "blue";
  }
  return score >= HEALTH_BANDS.orange ? "orange" : "red";
}

/** İki uç arasında doğrusal azalan puan. */
function taper(value: number, good: number, bad: number): number {
  if (value <= good) {
    return 1;
  }
  if (value >= bad) {
    return 0;
  }
  return (bad - value) / (bad - good);
}

/**
 * Tek bir bağlantının sağlık kartı.
 *
 * Hiç ölçüm yapılmamış bir kaynağın skoru `null`'dır — sıfır değil. Sıfır
 * "ölçtük, kötü çıktı" demektir; hiç bağlanılmamış bir kaynak için bu yanlış
 * olurdu.
 */
export function healthCardOf(
  config: ConnectorConfig,
  runtime: ConnectorRuntime,
  nowMs: number,
): ConnectorHealthCard {
  const pingMs = runtime.lastLatencyMs ?? averageLatency(runtime.latencySamplesMs);
  const neverMeasured =
    runtime.status === "idle" &&
    runtime.lastSyncAtMs === null &&
    runtime.latencySamplesMs.length === 0;

  if (neverMeasured) {
    return {
      configId: config.id,
      name: config.name,
      kind: CONNECTOR_LABEL[config.kind],
      pingMs: null,
      lastDataAtMs: null,
      retryCount: runtime.attempt,
      score: null,
      band: "red",
      detail: "Bu kaynağa hiç bağlanılmadı; ölçüm yok.",
      isRealConnection: false,
    };
  }

  /* --- Durum --- */
  const statusRatio =
    runtime.status === "connected"
      ? 1
      : runtime.status === "connecting" || runtime.status === "retrying"
        ? 0.4
        : 0;

  /* --- Gecikme --- */
  const latencyRatio = pingMs === null ? 0 : taper(pingMs, GOOD_LATENCY_MS, BAD_LATENCY_MS);

  /* --- Tazelik --- */
  const age = runtime.lastSyncAtMs === null ? null : nowMs - runtime.lastSyncAtMs;
  const freshnessRatio =
    age === null ? 0 : taper(Math.max(age, 0), FRESH_WINDOW_MS, STALE_WINDOW_MS);

  /* --- Kararlılık --- */
  const penalty = runtime.attempt * 0.2 + runtime.syncErrors * 0.1;
  const stabilityRatio = Math.max(0, 1 - penalty);

  const score = Math.round(
    statusRatio * HEALTH_WEIGHTS.status +
      latencyRatio * HEALTH_WEIGHTS.latency +
      freshnessRatio * HEALTH_WEIGHTS.freshness +
      stabilityRatio * HEALTH_WEIGHTS.stability,
  );

  return {
    configId: config.id,
    name: config.name,
    kind: CONNECTOR_LABEL[config.kind],
    pingMs,
    lastDataAtMs: runtime.lastSyncAtMs,
    retryCount: runtime.attempt,
    score,
    band: healthBand(score),
    detail: explain(runtime, statusRatio, latencyRatio, freshnessRatio, stabilityRatio),
    isRealConnection: false,
  };
}

/** Skorun neden düştüğünü anlatan cümle. */
function explain(
  runtime: ConnectorRuntime,
  status: number,
  latency: number,
  freshness: number,
  stability: number,
): string {
  const problems: string[] = [];
  if (status < 1) {
    problems.push(
      runtime.status === "retrying"
        ? "bağlantı yeniden deneniyor"
        : "kaynak bağlı değil",
    );
  }
  if (latency < 0.6) {
    problems.push("gecikme yüksek");
  }
  if (freshness < 0.6) {
    problems.push("son veri eski");
  }
  if (stability < 0.8) {
    problems.push(
      `${runtime.attempt} yeniden deneme, ${runtime.syncErrors} senkron hatası`,
    );
  }

  return problems.length === 0
    ? "Kaynak bağlı, gecikme ve tazelik normal (benzetim)."
    : `Skoru düşüren: ${problems.join(", ")} (benzetim).`;
}

/** Bütün kaynakların sağlık kartları. */
export function healthCards(
  state: ConnectorState,
  nowMs: number,
): ConnectorHealthCard[] {
  return state.configs.map((config) =>
    healthCardOf(
      config,
      state.runtimes[config.id] ?? emptyRuntime(config.id),
      nowMs,
    ),
  );
}

function emptyRuntime(configId: string): ConnectorRuntime {
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
 * Bütün kaynakların ortalama skoru.
 *
 * Ölçümü olmayan kaynaklar ortalamaya **girmez** ama sayıları ayrıca döner:
 * hiç bağlanılmamış üç kaynağı sıfır sayıp ortalamayı düşürmek, tek bir
 * sağlıklı bağlantıyı da kötü göstermek olurdu.
 */
export function overallHealth(cards: ConnectorHealthCard[]): {
  score: number | null;
  measured: number;
  unmeasured: number;
  band: ReadinessBand;
} {
  const measured = cards.filter((card) => card.score !== null);
  const score =
    measured.length === 0
      ? null
      : Math.round(
          measured.reduce((sum, card) => sum + (card.score ?? 0), 0) /
            measured.length,
        );

  return {
    score,
    measured: measured.length,
    unmeasured: cards.length - measured.length,
    band: healthBand(score),
  };
}

/** En önce bakılması gereken kaynak; sorun yoksa `null`. */
export function worstCard(
  cards: ConnectorHealthCard[],
): ConnectorHealthCard | null {
  const problematic = cards.filter(
    (card) => card.score === null || card.score < HEALTH_BANDS.green,
  );
  if (problematic.length === 0) {
    return null;
  }
  return [...problematic].sort(
    (a, b) => (a.score ?? -1) - (b.score ?? -1),
  )[0];
}
