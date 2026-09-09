/**
 * Yönetici doğrulama raporu.
 *
 * Rapor katmanının `ReportDocument` şemasını kullanır: kapak, bloklar, Türkçe
 * glifleri gömülü yazı tipi ve sayfa taşması orada bir kez çözülmüştür. Bu
 * dosya yalnızca **neyin hangi sırayla yazılacağına** karar verir ve saf
 * kalır; PDF üretimi `lib/reports/pdf.ts` işidir.
 *
 * Raporun iddiası tek cümlededir: "Simülasyon sonuçları gerçek üretimle %94
 * uyumlu." Bu cümlenin altında hemen güven skoru ve ölçümün kapsamı yazar —
 * kapsamı gizlenmiş bir doğruluk oranı, ilk itirazda çöker.
 */

import {
  NOT_MEASURED,
  fileDateStamp,
  formatReportDate,
  percent,
  slugify,
  type BarItem,
  type BlockTone,
  type ReportBlock,
  type ReportDocument,
} from "../reports";
import { accuracyHeadline, trDecimal } from "./analysis";
import { accuracyTrend } from "./timeline";
import {
  CONFIDENCE_LABEL,
  METRIC_LABEL,
  METRIC_ORDER,
  METRIC_UNIT,
  type AccuracyBand,
  type ConfidenceScore,
  type MetricComparison,
  type ValidationFinding,
  type ValidationMetric,
  type ValidationSnapshot,
  type ValidationSummary,
} from "./types";

export interface ValidationReportInput {
  factoryName: string | null;
  orgName: string | null;
  generatedAt: Date;
  summary: ValidationSummary;
  confidence: ConfidenceScore;
  findings: ValidationFinding[];
  /** Bu fabrikanın geçmiş ölçümleri; yoksa boş dizi. */
  history: ValidationSnapshot[];
}

/** İndirilen dosyanın adı (uzantısız). */
export function validationReportFileName(input: ValidationReportInput): string {
  return `optiflow-dogrulama-${slugify(input.factoryName ?? "fabrika")}-${fileDateStamp(input.generatedAt)}`;
}

export function buildValidationReport(
  input: ValidationReportInput,
): ReportDocument {
  const { summary, confidence, findings, history } = input;
  const blocks: ReportBlock[] = [];

  /* --- Sonuç --- */
  blocks.push({ kind: "heading", level: 1, text: "Doğruluk Sonucu" });

  const headline = accuracyHeadline(summary);
  blocks.push({
    kind: "note",
    text:
      headline ??
      "Gerçek üretim verisi girilmediği için doğruluk hesaplanamadı. Bu rapor yalnızca ölçümün kapsamını gösterir.",
    tone: headline === null ? "neutral" : toneOfAccuracy(summary.overallAccuracy),
  });

  blocks.push({
    kind: "kpiGrid",
    items: [
      {
        label: "Genel doğruluk",
        value: percent(summary.overallAccuracy),
        hint: `${summary.measuredPointCount} ölçüm noktası`,
        tone: toneOfAccuracy(summary.overallAccuracy),
      },
      {
        label: "Güven skoru",
        value: percent(confidence.score),
        hint:
          confidence.level === null
            ? "Ölçüm yok"
            : CONFIDENCE_LABEL[confidence.level],
        tone: toneOfConfidence(confidence),
      },
      {
        label: "En doğru istasyon",
        value: summary.bestStation?.stationName ?? NOT_MEASURED,
        hint:
          summary.bestStation === null
            ? "Karşılaştırılacak iki ölçüm gerekiyor"
            : percent(summary.bestStation.accuracy),
        tone: "good",
      },
      {
        label: "En sapan istasyon",
        value: summary.worstStation?.stationName ?? NOT_MEASURED,
        hint:
          summary.worstStation === null
            ? "Karşılaştırılacak iki ölçüm gerekiyor"
            : percent(summary.worstStation.accuracy),
        tone: "bad",
      },
    ],
  });

  /* --- Sapma grafiği --- */
  const bars = accuracyBars(summary);
  if (bars.length > 0) {
    blocks.push({
      kind: "bars",
      caption: "İstasyon doğruluğu (ölçüm girilen istasyonlar)",
      items: bars,
    });
  }

  /* --- Ölçüt bazında --- */
  blocks.push({ kind: "heading", level: 2, text: "Ölçüt Bazında Doğruluk" });
  blocks.push({
    kind: "table",
    columns: ["Ölçüt", "Birim", "Doğruluk", "Ölçülen istasyon"],
    widths: ["*", "auto", "auto", "auto"],
    numericColumns: [2, 3],
    rows: METRIC_ORDER.map((metric) => [
      METRIC_LABEL[metric],
      METRIC_UNIT[metric],
      percent(summary.metricAccuracy[metric]),
      String(measuredStationsFor(summary, metric)),
    ]),
  });

  /* --- İstasyon karşılaştırması --- */
  blocks.push({ kind: "pageBreak" });
  blocks.push({ kind: "heading", level: 1, text: "İstasyon Karşılaştırması" });

  const comparisonRows = stationRows(summary);
  if (comparisonRows.length === 0) {
    blocks.push({
      kind: "note",
      text: "Hiçbir istasyon için gerçek ölçüm girilmedi.",
      tone: "neutral",
    });
  } else {
    blocks.push({
      kind: "table",
      caption: "Yalnızca ölçüm girilen satırlar listelenir.",
      columns: ["İstasyon", "Ölçüt", "Model", "Saha", "Sapma"],
      widths: ["*", "auto", "auto", "auto", "auto"],
      numericColumns: [2, 3, 4],
      rows: comparisonRows,
    });
  }

  /* --- Güven --- */
  blocks.push({ kind: "heading", level: 2, text: "Güven Değerlendirmesi" });
  blocks.push({
    kind: "table",
    columns: ["Bileşen", "Skor"],
    widths: ["*", "auto"],
    numericColumns: [1],
    rows: [
      ["Veri doluluğu", percent(confidence.parts.coverage)],
      ["Ölçülen sapma", percent(confidence.parts.deviation)],
      ["İstasyon kapsamı", percent(confidence.parts.scale)],
      ["Ölçüm süresi", percent(confidence.parts.duration)],
    ],
  });

  for (const reason of confidence.reasons) {
    blocks.push({ kind: "note", text: reason.text, tone: "warning" });
  }

  /* --- Bulgular --- */
  blocks.push({ kind: "heading", level: 1, text: "Bulgular ve Öneriler" });
  if (findings.length === 0) {
    blocks.push({
      kind: "paragraph",
      text: "Raporlanacak sapma bulunmadı; girilen ölçümler modelin kabul bandı içinde kaldı.",
    });
  } else {
    for (const finding of findings) {
      blocks.push({ kind: "note", text: finding.text, tone: finding.tone });
      blocks.push({ kind: "paragraph", text: finding.advice, muted: true });
    }
  }

  /* --- Geçmiş --- */
  blocks.push({ kind: "heading", level: 2, text: "Doğrulama Geçmişi" });
  if (history.length === 0) {
    blocks.push({
      kind: "paragraph",
      text: "Bu fabrikanın kayıtlı ilk doğrulaması. İkinci ölçümden sonra doğruluğun yönü de raporlanır.",
      muted: true,
    });
  } else {
    blocks.push({
      kind: "table",
      columns: ["Ölçüm tarihi", "Doğruluk", "Güven", "Ölçülen istasyon"],
      widths: ["*", "auto", "auto", "auto"],
      numericColumns: [1, 2, 3],
      rows: history.map((item) => [
        formatReportDate(new Date(item.measuredAt)),
        percent(item.overallAccuracy),
        percent(item.confidenceScore),
        `${item.measuredStationCount} / ${item.stationCount}`,
      ]),
    });

    const trend = accuracyTrend(history);
    if (trend.delta !== null) {
      blocks.push({
        kind: "note",
        text: trendSentence(trend.delta, trend.direction),
        tone: trend.direction === "down" ? "warning" : "good",
      });
    }
  }

  return {
    fileName: validationReportFileName(input),
    cover: {
      title: "Doğrulama Raporu",
      subtitle:
        headline ?? "Gerçek üretim verisiyle karşılaştırma — ölçüm bekleniyor",
      factoryName: input.factoryName ?? "Kaydedilmemiş model",
      generatedAtLabel: formatReportDate(input.generatedAt),
      orgName: input.orgName,
      facts: [
        { label: "Genel doğruluk", value: percent(summary.overallAccuracy) },
        {
          label: "Güven",
          value:
            confidence.level === null
              ? NOT_MEASURED
              : `${CONFIDENCE_LABEL[confidence.level]} (${percent(confidence.score)})`,
        },
        {
          label: "Ölçülen istasyon",
          value: `${summary.measuredStationCount} / ${summary.stationCount}`,
        },
        {
          label: "Ölçüm penceresi",
          value:
            summary.shiftMinutes === null
              ? NOT_MEASURED
              : `${trDecimal(summary.shiftMinutes, 0)} dk`,
        },
      ],
    },
    blocks,
  };
}

/* -------------------------------------------------------------------------- */

/** Ölçüm girilmiş istasyonların doğruluk çubukları. */
function accuracyBars(summary: ValidationSummary): BarItem[] {
  return summary.stations
    .filter(
      (station): station is typeof station & { accuracy: number } =>
        station.accuracy !== null,
    )
    .map((station) => ({
      label: station.stationName,
      ratio: station.accuracy,
      display: percent(station.accuracy),
      tone: toneOfBand(station.band),
    }));
}

/** Ölçüm girilmiş her satır için tek bir karşılaştırma satırı. */
function stationRows(summary: ValidationSummary): string[][] {
  const rows: string[][] = [];

  for (const station of summary.stations) {
    for (const metric of METRIC_ORDER) {
      const comparison = station.metrics[metric];
      if (comparison.accuracy === null) {
        continue;
      }
      rows.push([
        station.stationName,
        METRIC_LABEL[metric],
        formatValue(metric, comparison.simulated),
        formatValue(metric, comparison.real),
        signedPercent(comparison),
      ]);
    }
  }

  return rows;
}

/** Ölçüte göre birimli değer; oranlar yüzde, süreler ondalık. */
function formatValue(metric: ValidationMetric, value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  if (metric === "scrap") {
    return percent(value, 1);
  }
  return trDecimal(value, metric === "throughput" ? 2 : 1);
}

/**
 * Sapmanın işaretli gösterimi.
 *
 * İşaret korunur: "+%18" model sahadan düşük tahmin ediyor, "−%18" yüksek
 * tahmin ediyor demektir ve ikisi farklı müdahaleye götürür.
 */
function signedPercent(comparison: MetricComparison): string {
  if (comparison.errorRatio === null) {
    return NOT_MEASURED;
  }
  const sign = comparison.errorRatio > 0 ? "+" : comparison.errorRatio < 0 ? "−" : "";
  return `${sign}${percent(Math.abs(comparison.errorRatio), 1)}`;
}

function trendSentence(delta: number, direction: string): string {
  if (direction === "flat") {
    return "Doğruluk son iki ölçüm arasında değişmedi.";
  }
  const change = percent(Math.abs(delta), 1);
  return direction === "up"
    ? `Doğruluk son ölçüme göre ${change} arttı; model sahaya yaklaşıyor.`
    : `Doğruluk son ölçüme göre ${change} düştü; modelde güncellenmesi gereken varsayımlar var.`;
}

function measuredStationsFor(
  summary: ValidationSummary,
  metric: ValidationMetric,
): number {
  return summary.stations.filter(
    (station) => station.metrics[metric].accuracy !== null,
  ).length;
}

function toneOfAccuracy(accuracy: number | null): BlockTone {
  if (accuracy === null) {
    return "neutral";
  }
  if (accuracy >= 0.9) {
    return "good";
  }
  return accuracy >= 0.75 ? "warning" : "bad";
}

function toneOfConfidence(confidence: ConfidenceScore): BlockTone {
  if (confidence.level === null) {
    return "neutral";
  }
  if (confidence.level === "high") {
    return "good";
  }
  return confidence.level === "medium" ? "warning" : "bad";
}

function toneOfBand(band: AccuracyBand | null): BlockTone {
  if (band === "good") {
    return "good";
  }
  if (band === "warning") {
    return "warning";
  }
  return band === "bad" ? "bad" : "neutral";
}
