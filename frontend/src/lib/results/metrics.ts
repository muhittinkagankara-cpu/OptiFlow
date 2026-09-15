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
 * ## Yasa 2
 *
 * Dört değerin dördü de bir sonuç satırı taşır:
 *
 * - Beklenen üretim → ölçülmüş %95 güven aralığı.
 * - Hat OEE → kısıt istasyonu ve doluluğu.
 * - Akış süresi ve WIP → kendi %95 güven aralıkları.
 *
 * Son ikisi 2G denetiminde açık kalmıştı: koşum yanıtında sonuç niteliğinde
 * bir alan yoktu. Sprint `3f1999f` bu aralıkları backend'de zaten hesaplanan
 * istatistiklerden açtı; burada yeni bir hesap yapılmaz, gelen iki sınır
 * biçimlendirilir. Aralık gelmeyen koşumlarda (eski kayıtlar, demo kümesi)
 * satır yazılmaz — sınır uydurulmaz (Yasa 4).
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

/**
 * Güven aralığı cümlesi; sınırlar ölçülemiyorsa `null`.
 *
 * Aralık **backend'de** hesaplanır; burada yalnızca iki sınır biçimlendirilir.
 * Birim ve ondalık basamak çağırandan gelir, çünkü üretim tam sayı birim,
 * akış süresi dakika, WIP ise parça cinsindendir.
 */
function intervalLine(
  interval: [number, number] | undefined | null,
  render: (value: number) => string,
  suffix = "",
): string | null {
  if (!Array.isArray(interval)) {
    return null;
  }
  const [low, high] = interval;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  return `%95 aralık ${render(low)} – ${render(high)}${suffix}`;
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
      consequence: intervalLine(results.confidence_interval_95, formatUnits),
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
      /* Sınırlar iki ondalıkla yazılır: dar bir aralık tek ondalıkta
         "5.0 – 5.0" hâline gelir ve ölçülmüş belirsizliği yok gösterirdi. */
      consequence: intervalLine(
        results.avg_flow_time_ci_95,
        (v) => formatDecimal(v, 2),
        " dk",
      ),
    },
    {
      id: "wip",
      label: "Ortalama WIP",
      value: measured(results.avg_wip, (v) => `${formatDecimal(v)} parça`),
      consequence: intervalLine(
        results.avg_wip_ci_95,
        (v) => formatDecimal(v, 2),
        " parça",
      ),
    },
  ];
}
