/**
 * Operasyon değerlerinin okunur karşılıkları.
 *
 * Tek kural: ölçülmeyen değer sıfır gösterilmez. Hiç istek almamış bir
 * sunucunun hata oranı "%0" değil "—"dır; ikisi farklı bilgilerdir.
 */

import type { ProcessMetrics } from "./types";

/** Ölçülmemiş değerin ekrandaki karşılığı. */
export const EMPTY = "—";

/** Çalışma süresini okunur biçime çevirir. */
export function formatUptime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return EMPTY;

  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds} sn`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} gün` : `${days} gün ${restHours} sa`;
}

/** Bellek (MB); ölçülmediyse "—". */
export function formatMemory(mb: number | null): string {
  if (mb === null || !Number.isFinite(mb)) return EMPTY;
  return `${mb.toFixed(1)} MB`;
}

/** İşlemci kullanımı (%); ölçülmediyse "—". */
export function formatCpu(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return EMPTY;
  return `%${percent.toFixed(1)}`;
}

/** Oranı yüzdeye çevirir; ölçülmediyse "—". */
export function formatRatio(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return EMPTY;
  return `%${(ratio * 100).toFixed(digits)}`;
}

/** Epoch milisaniyeyi tarih-saat biçimine çevirir. */
export function formatTimestamp(atMs: number | null): string {
  if (atMs === null || !Number.isFinite(atMs) || atMs <= 0) return EMPTY;
  const date = new Date(atMs);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Sağlamanın kısa gösterimi; boşsa "—". */
export function shortChecksum(checksum: string): string {
  return checksum ? checksum.slice(0, 12) : EMPTY;
}

/**
 * Ölçüm yapılamıyorsa nedenini söyleyen açıklama; yapılabiliyorsa `null`.
 *
 * "—" tek başına bir arıza gibi okunur; nedeni yazılmalıdır.
 */
export function measurementNotice(metrics: ProcessMetrics | null): string | null {
  if (metrics === null) return "Sunucudan ölçüm okunmadı.";
  if (!metrics.measurementAvailable) {
    return "Bellek ve işlemci ölçümü bu kurulumda yapılamıyor (psutil kurulu değil).";
  }
  return null;
}
