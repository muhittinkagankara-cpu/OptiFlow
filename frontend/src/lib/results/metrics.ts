/**
 * Sonuç sayfasının ölçüm şeridi için eşleme (Sprint 2G-C).
 *
 * `MetricGroup` ve `ConstraintRail` Command Center'da kurulmuş **ortak**
 * bileşenlerdir (`components/ui/`) ve bu sayfada olduğu gibi kullanılır —
 * ikinci bir görsel uygulama yazılmadı. Şeridin ihtiyacı olan tek şey,
 * Sonuç sayfasının kendi metriklerini o bileşenin beklediği alanlara
 * çevirmektir; bu dosya yalnızca o çeviriyi yapar.
 *
 * Burada hiçbir şey **hesaplanmaz**: değerlerin tamamı koşum yanıtında zaten
 * vardır. Biçimlendirme `lib/resultsFormatting`, kısıt özeti
 * `lib/dashboardMetrics.bottleneckSummary` işlevlerinden gelir; ikisi de
 * mevcut ve yetkili, yeniden yazılmadı.
 *
 * ## Yasa 2 ve kalan açık
 *
 * - Beklenen üretim, ölçülmüş %95 güven aralığını taşır.
 * - Hat OEE, kısıt istasyonunu ve doluluğunu taşır — ikisi de ölçülmüş.
 * - Akış süresi ve yarı mamul stoğu için koşum yanıtında **sonuç niteliğinde
 *   ölçülmüş bir alan yoktur**. Uydurmak yerine boş bırakılır ve `MetricGroup`
 *   sonucu olmayan satıra hiçbir şey yazmaz (Yasa 4). Bu, 2G denetiminde
 *   raporlanmış bilinen bir açıktır; burada gizlenmedi, kapatılmadı.
 */

import type { SimulationResults } from "../../types/simulationTypes";
import { bottleneckSummary } from "../dashboardMetrics";
import {
  formatDecimal,
  formatMinutes,
  formatPercent,
  formatUnits,
} from "../resultsFormatting";

/**
 * `MetricGroup`'un beklediği alanların saf veri karşılığı.
 *
 * React düğümü taşımaz: bu katman metin üretir, çizmek bileşenin işidir.
 */
export interface ResultsMetric {
  id: string;
  label: string;
  value: string | null;
  consequence: string | null;
}

/** Güven aralığı cümlesi; sınırlar ölçülemiyorsa `null`. */
function intervalLine(interval: [number, number] | undefined): string | null {
  if (!Array.isArray(interval)) {
    return null;
  }
  const [low, high] = interval;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  return `%95 aralık ${formatUnits(low)} – ${formatUnits(high)}`;
}

/**
 * Kısıt cümlesi; darboğaz eşleşmiyorsa `null`.
 *
 * Darboğaz `results.bottleneck_station_id` üzerinden bulunur — yeni bir kısıt
 * hesabı yapılmaz. Eşleşme yoksa bir istasyon uydurulmaz.
 */
function constraintLine(results: SimulationResults): string | null {
  const bottleneck = bottleneckSummary(results);
  if (bottleneck === null || !Number.isFinite(bottleneck.utilization)) {
    return null;
  }
  return `Kısıt ${bottleneck.name} · ${formatPercent(bottleneck.utilization)} dolu`;
}

/** Ölçülemeyen sayı "—" olur; sıfıra düşürülmez (Yasa 4). */
function measured(value: number, render: (value: number) => string): string | null {
  return Number.isFinite(value) ? render(value) : null;
}

export function resultsMetrics(results: SimulationResults): ResultsMetric[] {
  return [
    {
      id: "throughput",
      label: "Beklenen üretim",
      value: measured(
        results.total_throughput,
        (v) => `${formatUnits(v)} birim`,
      ),
      consequence: intervalLine(results.confidence_interval_95),
    },
    {
      id: "oee",
      label: "Hat OEE",
      value: measured(results.line_oee, (v) => formatPercent(v)),
      consequence: constraintLine(results),
    },
    {
      id: "flow",
      label: "Ortalama akış süresi",
      value: measured(results.avg_flow_time, (v) => formatMinutes(v)),
      consequence: null,
    },
    {
      id: "wip",
      label: "Ortalama WIP",
      value: measured(results.avg_wip, (v) => `${formatDecimal(v)} parça`),
      consequence: null,
    },
  ];
}
