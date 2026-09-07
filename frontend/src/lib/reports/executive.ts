/**
 * Yönetici raporu.
 *
 * Bir sayfalık karar belgesi: fabrikanın durumu, dört sayı ve ne yapılması
 * gerektiği. Teknik ayrıntı bilinçli olarak yoktur — istasyon tablosu ve
 * doğrulama teknik rapordadır.
 *
 * Cümleler burada **yazılmaz**, `lib/intelligence` katmanından alınır. Aynı
 * yorum ekranda ve PDF'te farklı olsaydı, toplantıda ekranı açan kişiyle raporu
 * okuyan kişi iki farklı hikâye duyardı.
 */

import {
  MAX_PRIORITY_CARDS,
  SEVERITY_LABEL,
  buildExecutiveSummary,
  buildPriorityCards,
} from "../intelligence";
import { bottleneckSummary, monthlyLoss } from "../dashboardMetrics";
import { NOT_MEASURED, buildCover, decimal, fileDateStamp, money, percent, slugify } from "./shared";
import type { KpiItem, ReportBlock, ReportContext, ReportDocument } from "./types";

export function buildExecutiveReport(context: ReportContext): ReportDocument {
  const results = context.result?.results ?? null;
  const report = context.report;

  const cover = buildCover(
    context,
    "Yönetici Raporu",
    "Üretim durumu, finansal etki ve öncelikli aksiyonlar",
  );

  const blocks: ReportBlock[] = [];

  /* --- Yönetici özeti --- */
  const summary = buildExecutiveSummary(results, report);
  blocks.push({ kind: "heading", level: 1, text: "Yönetici Özeti" });
  blocks.push({ kind: "paragraph", text: summary.headline });
  blocks.push({ kind: "paragraph", text: summary.detail, muted: true });

  /* --- Dört sayı --- */
  blocks.push({ kind: "heading", level: 2, text: "Temel Göstergeler" });
  blocks.push({ kind: "kpiGrid", items: headlineKpis(context) });

  if (results === null) {
    blocks.push({
      kind: "note",
      text: "Bu rapor bir simülasyon koşumu olmadan üretildi; sayılar ölçülmediği için boş bırakıldı.",
      tone: "warning",
    });
    return { fileName: fileName(context, "yonetici"), cover, blocks };
  }

  /* --- Öncelikler --- */
  const priorities = buildPriorityCards(results, report);
  if (priorities.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: "Öncelikli Aksiyonlar" });
    blocks.push({
      kind: "table",
      caption: `Aciliyet ve parasal etkiye göre sıralı ilk ${Math.min(
        priorities.length,
        MAX_PRIORITY_CARDS,
      )} bulgu`,
      columns: ["Bulgu", "Aciliyet", "İstasyon", "Parasal etki", "Beklenen kazanç"],
      widths: ["*", "auto", "auto", "auto", "*"],
      numericColumns: [3],
      rows: priorities.map((card) => [
        card.title,
        SEVERITY_LABEL[card.severity],
        card.station ?? NOT_MEASURED,
        // Maliyet oranları girilmediyse tutar uydurulmaz.
        card.monetaryImpact === null ? NOT_MEASURED : money(card.monetaryImpact),
        card.expectedGain,
      ]),
    });
  }

  /* --- Finansal etki --- */
  blocks.push({ kind: "heading", level: 2, text: "Finansal Etki" });
  if (report === null) {
    blocks.push({
      kind: "note",
      text: "Maliyet oranları girilmediği için parasal etki hesaplanamadı. Finans ekranındaki oranları doldurduğunuzda bu bölüm rakamlarla dolar.",
      tone: "warning",
    });
  } else {
    blocks.push({
      kind: "table",
      columns: ["Kalem", "Tutar", "Payı"],
      widths: ["*", "auto", "auto"],
      numericColumns: [1, 2],
      rows: lossRows(report.impact.total_loss, [
        ["Duruş kaybı", report.impact.downtime_loss],
        ["Bekleme kaybı", report.impact.waiting_loss],
        ["Hurda kaybı", report.impact.scrap_loss],
        ["Fırsat kaybı", report.impact.opportunity_loss],
        ["Toplam", report.impact.total_loss],
      ]),
    });
    blocks.push({
      kind: "note",
      text: `Kurtarılabilir tutar ${money(report.recoverable_loss)}. Güven düzeyi %${Math.round(
        report.impact.confidence * 100,
      )}; veri tamlığı %${Math.round(report.impact.data_completeness * 100)}.`,
      tone: "neutral",
    });

    if (report.impact.missing_inputs.length > 0) {
      blocks.push({
        kind: "note",
        text: `Girilmeyen oranlar nedeniyle hesaplanamayan kalemler var: ${report.impact.missing_inputs.join(", ")}.`,
        tone: "warning",
      });
    }
  }

  blocks.push({
    kind: "note",
    text: "Rakamlar bir simülasyon koşumundan üretilmiştir; ölçülemeyen değerler sıfır değil, tire (—) ile gösterilir.",
    tone: "neutral",
  });

  return { fileName: fileName(context, "yonetici"), cover, blocks };
}

/* -------------------------------------------------------------------------- */

/** Kapaktan sonraki dört sayı: OEE, throughput, darboğaz, kayıp. */
function headlineKpis(context: ReportContext): KpiItem[] {
  const results = context.result?.results ?? null;
  const bottleneck = bottleneckSummary(results);
  const monthly = monthlyLoss(context.report);

  return [
    {
      label: "Hat OEE",
      value: results === null ? NOT_MEASURED : percent(results.line_oee),
      hint: "Kullanılabilirlik × performans × kalite",
      tone: oeeTone(results?.line_oee ?? null),
    },
    {
      label: "Throughput",
      value:
        results === null
          ? NOT_MEASURED
          : `${decimal(results.throughput_per_minute, 2)} parça/dk`,
      hint:
        results === null
          ? "Koşum yok"
          : `Toplam ${Math.round(results.total_throughput).toLocaleString("tr-TR")} birim`,
    },
    {
      label: "Darboğaz",
      value: bottleneck?.name ?? NOT_MEASURED,
      hint:
        bottleneck === null
          ? "Belirgin bir kısıt yok"
          : `${percent(bottleneck.utilization)} doluluk`,
      tone: bottleneck === null ? "good" : "warning",
    },
    {
      label: "Aylık kayıp",
      value: money(monthly),
      hint:
        monthly === null
          ? "Maliyet oranları girilmedi"
          : "Koşum penceresinden ölçeklendi",
      tone: monthly === null ? "neutral" : "bad",
    },
  ];
}

function oeeTone(value: number | null): KpiItem["tone"] {
  if (value === null) {
    return "neutral";
  }
  if (value >= 0.7) {
    return "good";
  }
  return value >= 0.5 ? "warning" : "bad";
}

/** Kayıp kalemleri ve toplam içindeki payları. */
function lossRows(total: number, items: [string, number][]): string[][] {
  return items.map(([label, amount]) => [
    label,
    money(amount),
    // Toplam sıfırken pay hesaplanamaz; "%0" demek yanıltıcı olurdu.
    total > 0 ? percent(amount / total) : NOT_MEASURED,
  ]);
}

function fileName(context: ReportContext, kind: string): string {
  const factory = slugify(context.factoryName ?? "fabrika");
  return `optiflow-${kind}-${factory}-${fileDateStamp(context.generatedAt)}`;
}
