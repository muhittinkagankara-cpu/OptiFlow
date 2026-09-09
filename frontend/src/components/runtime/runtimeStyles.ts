/**
 * Runtime ekranlarının ortak sözlüğü.
 *
 * Renk hiçbir yerde tek başına bilgi taşımaz: her rozetin yanında durumun adı
 * yazılıdır ("Bağlandı (doğrulandı)", "Doğrulanmadı"). Renk körlüğü olan bir
 * operatörün de aynı bilgiyi okuyabilmesi gerekir.
 */

import type {
  BridgeStatus,
  FeedStatus,
  MatrixVerdict,
} from "../../lib/connectors";
import type { BadgeTone } from "../ui/Primitives";

/** Ölçülemeyen değerlerin ekrandaki karşılığı. */
export const NOT_MEASURED = "—";

export const STATUS_TONE: Record<BridgeStatus, BadgeTone> = {
  idle: "neutral",
  connecting: "info",
  connected: "good",
  retrying: "warning",
  failed: "bad",
  disconnected: "neutral",
};

export const VERDICT_TONE: Record<MatrixVerdict, BadgeTone> = {
  verified: "good",
  simulated: "warning",
  unverified: "neutral",
};

export const LEVEL_TONE: Record<string, BadgeTone> = {
  info: "neutral",
  warning: "warning",
  critical: "bad",
};

/** Gecikmenin okunur hâli; ölçülmemişse "—". */
export function showLatency(value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  return `${Math.round(value)} ms`;
}

/** Süre (ms) → "3 dk 12 sn"; ölçülmemişse "—". */
export function showDuration(value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} dk ${seconds} sn` : `${seconds} sn`;
}

/** Sayının okunur hâli. */
export function showCount(value: number): string {
  return value.toLocaleString("tr-TR");
}

/** Oranın yüzdesi; ölçülmemişse "—". */
export function showRate(value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  return `%${(value * 100).toFixed(1).replace(".", ",")}`;
}

/** Olay anının saati. */
export function showClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Besleme durumunun rozet tonu. */
export const FEED_TONE: Record<FeedStatus, BadgeTone> = {
  real: "good",
  waiting: "info",
  simulated: "warning",
  unverified: "neutral",
};

/** Ölçüm kalitesinin rozet tonu. */
export const QUALITY_TONE: Record<string, BadgeTone> = {
  good: "good",
  uncertain: "warning",
  bad: "bad",
};

/**
 * Sayının okunur hâli; ölçülmemişse "—".
 *
 * `0` ile `null` arasındaki farkı korumak bu işlevin tek işidir: ölçülmüş bir
 * sıfır gösterilir, ölçülmemiş bir değer gösterilmez.
 */
export function showNumber(value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  return Number.isInteger(value)
    ? value.toLocaleString("tr-TR")
    : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
