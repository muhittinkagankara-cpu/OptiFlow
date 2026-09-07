/**
 * Teknik rapor.
 *
 * Yönetici raporunun aksine burada ayrıntı **istenir**: her istasyonun sayıları,
 * ısı haritası, doluluk grafiği, kayıp kalemleri ve koşumun doğrulama uyarıları.
 * Süreç mühendisinin "bu sonuca neden güveneyim?" sorusunu yanıtlayan belge
 * budur, bu yüzden doğrulama bölümü atlanmaz — geçen bir koşum kadar geçmeyen
 * bir koşum da raporlanır.
 */

import { flowTotals } from "../actionItems";
import { classifyWarning } from "../resultsFormatting";
import {
  NOT_MEASURED,
  buildCover,
  decimal,
  fileDateStamp,
  money,
  percent,
  slugify,
} from "./shared";
import { splitWideTable } from "./tables";
import type {
  BarItem,
  HeatCell,
  ReportBlock,
  ReportContext,
  ReportDocument,
} from "./types";

export function buildTechnicalReport(context: ReportContext): ReportDocument {
  const results = context.result?.results ?? null;
  const report = context.report;

  const cover = buildCover(
    context,
    "Teknik Rapor",
    "İstasyon metrikleri, ısı haritası ve doğrulama",
  );

  const blocks: ReportBlock[] = [];

  if (results === null) {
    blocks.push({
      kind: "note",
      text: "Teknik rapor bir simülasyon koşumu gerektirir. Bir model çalıştırdıktan sonra bu rapor istasyon metrikleriyle dolar.",
      tone: "warning",
    });
    return { fileName: fileName(context, "teknik"), cover, blocks };
  }

  const totals = flowTotals(results);

  /* --- Hat göstergeleri --- */
  blocks.push({ kind: "heading", level: 1, text: "Hat Göstergeleri" });
  blocks.push({
    kind: "kpiGrid",
    items: [
      { label: "Hat OEE", value: percent(results.line_oee) },
      {
        label: "Throughput",
        value: `${decimal(results.throughput_per_minute, 2)} parça/dk`,
        hint: `Teorik üst sınır ${decimal(results.theoretical_max_throughput_per_minute, 2)}`,
      },
      { label: "Ortalama WIP", value: decimal(results.avg_wip, 1) },
      {
        label: "Ortalama akış süresi",
        value: `${decimal(results.avg_flow_time, 1)} dk`,
      },
      {
        label: "Kararlılık",
        value: results.is_stable ? "Kararlı" : "Kararsız",
        tone: results.is_stable ? "good" : "bad",
      },
      {
        label: "Fire oranı",
        value:
          totals.entered > 0
            ? percent(totals.scrapped / totals.entered, 1)
            : NOT_MEASURED,
        hint:
          totals.entered > 0
            ? `${totals.scrapped.toLocaleString("tr-TR")} / ${totals.entered.toLocaleString("tr-TR")} parça`
            : "Akış verisi yok",
      },
    ],
  });

  /* --- Doluluk grafiği --- */
  blocks.push({ kind: "heading", level: 2, text: "İstasyon Doluluğu" });
  blocks.push({
    kind: "bars",
    caption: "Her istasyonun zamanının ne kadarını işlem yaparak geçirdiği",
    items: utilizationBars(results.station_metrics),
  });

  /* --- İstasyon tablosu (sayfaya sığacak biçimde bölünür) --- */
  blocks.push({ kind: "pageBreak" });
  blocks.push({ kind: "heading", level: 1, text: "İstasyon Metrikleri" });
  for (const table of splitWideTable(stationTable(results.station_metrics))) {
    blocks.push(table);
  }

  /* --- Isı haritası --- */
  if (report !== null && report.heat.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: "Kayıp Isı Haritası" });
    blocks.push({
      kind: "heatmap",
      caption:
        "Renk, istasyonun toplam kayıp içindeki ağırlığını gösterir; tutar ayrıca yazılıdır.",
      cells: heatCells(report.heat),
      isRelative: report.heat.some((item) => item.is_relative),
    });
  }

  /* --- Kayıp kalemleri --- */
  if (report !== null) {
    blocks.push({ kind: "heading", level: 2, text: "Kayıp Kalemleri" });
    blocks.push({
      kind: "table",
      columns: ["Kalem", "Tutar", "Miktar", "Oran", "Dayanak"],
      widths: ["auto", "auto", "auto", "auto", "*"],
      numericColumns: [1, 2],
      rows: report.impact.components.map((component) => [
        component.label,
        // Oranı verilmemiş kalem sıfır değildir, hesaplanamamıştır.
        component.is_available ? money(component.amount) : NOT_MEASURED,
        `${decimal(component.quantity, 1)} ${component.quantity_unit}`,
        component.rate_value == null ? NOT_MEASURED : money(component.rate_value),
        component.basis,
      ]),
    });

    if (report.stations.length > 0) {
      blocks.push({
        kind: "table",
        caption: "İstasyon bazında kayıp dağılımı",
        columns: ["İstasyon", "Duruş", "Bekleme", "Hurda", "Fırsat", "Toplam"],
        widths: ["*", "auto", "auto", "auto", "auto", "auto"],
        numericColumns: [1, 2, 3, 4, 5],
        rows: report.stations.map((station) => [
          station.station_name + (station.is_bottleneck ? " (darboğaz)" : ""),
          money(station.downtime_loss),
          money(station.waiting_loss),
          money(station.scrap_loss),
          money(station.opportunity_loss),
          money(station.total_loss),
        ]),
      });
    }
  }

  /* --- Doğrulama --- */
  blocks.push({ kind: "pageBreak" });
  blocks.push({ kind: "heading", level: 1, text: "Doğrulama" });
  const validation = results.littles_law_validation;
  blocks.push({
    kind: "kpiGrid",
    items: [
      {
        label: "Little Yasası",
        value: validation.passed ? "Geçti" : "Geçmedi",
        tone: validation.passed ? "good" : "bad",
        hint: `Sapma %${decimal(validation.deviation_pct, 2)} (tolerans %${decimal(
          validation.tolerance_pct,
          1,
        )})`,
      },
      {
        label: "Geçen tekrar",
        value: `${validation.replications_passed} / ${validation.replications_checked}`,
      },
      {
        label: "%95 güven aralığı",
        value: `${decimal(results.confidence_interval_95[0], 0)} – ${decimal(
          results.confidence_interval_95[1],
          0,
        )}`,
        hint: "Toplam üretim için",
      },
    ],
  });

  const warnings = context.result?.warnings ?? [];
  if (warnings.length > 0) {
    blocks.push({
      kind: "table",
      caption: "Koşum uyarıları",
      columns: ["Bulgu", "Açıklama"],
      widths: ["auto", "*"],
      rows: warnings.map((warning) => {
        const classified = classifyWarning(warning);
        // `tone` uyarının ağırlığını taşır: "bad" hattı geçersiz kılan bir
        // bulgu, "warning" dikkat isteyen bir durum.
        return [classified.title, classified.message];
      }),
    });
  } else {
    blocks.push({
      kind: "note",
      text: "Koşum uyarı üretmedi.",
      tone: "good",
    });
  }

  return { fileName: fileName(context, "teknik"), cover, blocks };
}

/* -------------------------------------------------------------------------- */

type StationMetrics = NonNullable<
  ReportContext["result"]
>["results"]["station_metrics"][number];

function stationTable(stations: StationMetrics[]) {
  return {
    caption: "Tüm istasyonlar",
    columns: [
      "İstasyon",
      "Doluluk",
      "OEE",
      "Kuyruk",
      "Bekleme (dk)",
      "Giren",
      "Tamamlanan",
      "Hurda",
      "Reddedilen",
    ],
    numericColumns: [1, 2, 3, 4, 5, 6, 7, 8],
    rows: stations.map((station) => [
      station.station_name + (station.is_bottleneck ? " (darboğaz)" : ""),
      percent(station.utilization),
      percent(station.oee.oee),
      decimal(station.avg_queue_length, 1),
      decimal(station.avg_wait_time, 1),
      String(station.flow.entered),
      String(station.flow.completed),
      String(station.flow.scrapped),
      String(station.flow.rejected),
    ]),
  };
}

function utilizationBars(stations: StationMetrics[]): BarItem[] {
  return stations.map((station) => ({
    label: station.station_name,
    ratio: Math.min(1, Math.max(0, station.utilization)),
    display: percent(station.utilization),
    tone: station.is_bottleneck
      ? "bad"
      : station.utilization >= 0.8
        ? "warning"
        : "good",
  }));
}

function heatCells(
  heat: NonNullable<ReportContext["report"]>["heat"],
): HeatCell[] {
  return heat.map((item) => ({
    stationName: item.station_name,
    score: item.score,
    band: item.band,
    lossLabel: money(item.total_loss),
    isBottleneck: item.is_bottleneck,
  }));
}

function fileName(context: ReportContext, kind: string): string {
  const factory = slugify(context.factoryName ?? "fabrika");
  return `optiflow-${kind}-${factory}-${fileDateStamp(context.generatedAt)}`;
}
