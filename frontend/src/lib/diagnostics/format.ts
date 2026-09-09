/**
 * Tanılama ekranının metinleri.
 *
 * Ölçülmemiş her değer "—" ile gösterilir ve yanında nedeni yazar. Bu ekranın
 * bütün amacı sistemin **ne bilmediğini** de göstermektir; eksik bir sayıyı
 * sıfırla doldurmak, ekranı işlevsiz kılardı.
 */

import { NOT_MEASURED } from "../telemetry/format";
import {
  DIAGNOSTIC_LEVEL_LABEL,
  type DiagnosticLevel,
  type DiagnosticMetric,
  type DiagnosticsReport,
  type StreamLiveness,
} from "./types";

export { NOT_MEASURED };

/** Ölçütün değeri ve birimi; ölçülmemişse "—". */
export function metricValue(metric: DiagnosticMetric): string {
  if (metric.value === null) return NOT_MEASURED;
  const number = metric.value.toLocaleString("tr-TR", {
    maximumFractionDigits: metric.value >= 100 ? 0 : 2,
  });
  return metric.unit ? `${number} ${metric.unit}` : number;
}

/** Ölçütün altında görünen açıklama; ölçülmüşse boş kalır. */
export function metricNote(metric: DiagnosticMetric): string {
  return metric.reason ?? "";
}

export function levelLabel(level: DiagnosticLevel): string {
  return DIAGNOSTIC_LEVEL_LABEL[level];
}

/**
 * Süreyi okunur biçime çevirir; ölçülmemişse "—".
 *
 * Bir dakikanın altı saniye, altı dakika, üstü saat olarak yazılır: "5400000
 * ms" hiçbir operatörün okuyamayacağı bir sayıdır.
 */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return NOT_MEASURED;
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)} sn`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} dk`;
  return `${Math.round(ageMs / 3_600_000)} sa`;
}

/**
 * Bir akışın durum cümlesi.
 *
 * Hiç veri gelmemiş bir akış "bayat" değildir; henüz başlamamıştır. İkisini
 * aynı cümleyle anlatmak, yeni kurulmuş bir bağlantıyı arızalı gösterirdi.
 */
export function streamCaption(stream: StreamLiveness): string {
  if (stream.ageMs === null) {
    return `${stream.connectorId} · henüz veri gelmedi`;
  }
  const parts = [`${stream.connectorId}`, `son veri ${formatAge(stream.ageMs)} önce`];
  if (stream.reconnects > 0) {
    parts.push(`${stream.reconnects} kez yeniden bağlandı`);
  }
  return parts.join(" · ");
}

/**
 * Raporun özet cümlesi.
 *
 * Kaç ölçütün ölçüldüğü açıkça yazılır: sekiz ölçütten ikisinin ölçüldüğü bir
 * ekranda "her şey normal" demek yanıltıcı olurdu.
 */
export function reportCaption(report: DiagnosticsReport): string {
  if (report.metricCount === 0) return "Tanılama verisi henüz yüklenmedi";
  return `${report.metricCount} ölçütten ${report.measuredCount} tanesi ölçüldü`;
}

/**
 * Kalıcılık modunun uyarısı; veritabanı modunda uyarı yoktur.
 *
 * Bellek modunda telemetri sunucu yeniden başladığında kaybolur; bunu
 * yazmamak, kullanıcının kalıcı sandığı bir geçmişi kaybetmesi demektir.
 */
export function persistenceWarning(mode: string): string | null {
  if (mode === "database") return null;
  if (mode === "memory") {
    return "Telemetri bellekte tutuluyor; sunucu yeniden başladığında geçmiş kaybolur.";
  }
  return "Kalıcılık modu bildirilmedi; geçmişin saklandığı doğrulanamadı.";
}

/**
 * Saklanan geçmişin süresi; tablo boşsa `null`.
 *
 * "0 gün geçmiş var" demek, hiç veri olmayan bir tabloyu bir günlük geçmişi
 * olan bir tabloyla aynı göstermek olurdu.
 */
export function historySpanMs(report: DiagnosticsReport): number | null {
  if (report.oldestTelemetryMs === null || report.atMs <= 0) return null;
  return Math.max(0, report.atMs - report.oldestTelemetryMs);
}
