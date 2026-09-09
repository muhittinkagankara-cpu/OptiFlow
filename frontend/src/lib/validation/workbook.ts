/**
 * Doğrulama verisinin Excel çıktısı — beş sekme.
 *
 * `lib/reports/excel.ts` ile aynı iki kuralı izler: eksik değer **boş
 * hücredir** (tire yazmak sütunu metne çevirip ortalamayı bozar) ve yüzdeler
 * 0-1 arası sayı olarak yazılır, biçimlendirme Excel'e bırakılır. PDF okunmak,
 * Excel işlenmek içindir; mühendis bu dosyayı açıp kendi grafiğini kuracaktır.
 */

import { fileDateStamp, slugify } from "../reports";
import type { SheetSpec, SheetValue } from "../reports";
import {
  CONFIDENCE_LABEL,
  METRIC_LABEL,
  METRIC_ORDER,
  METRIC_UNIT,
  type ConfidenceScore,
  type ValidationFinding,
  type ValidationSnapshot,
  type ValidationSummary,
} from "./types";

export interface ValidationWorkbookInput {
  factoryName: string | null;
  generatedAt: Date;
  summary: ValidationSummary;
  confidence: ConfidenceScore;
  findings: ValidationFinding[];
  history: ValidationSnapshot[];
}

/** Çalışma kitabının dosya adı (uzantısız). */
export function validationWorkbookFileName(
  input: ValidationWorkbookInput,
): string {
  return `optiflow-dogrulama-${slugify(input.factoryName ?? "fabrika")}-${fileDateStamp(input.generatedAt)}`;
}

export function buildValidationWorkbook(
  input: ValidationWorkbookInput,
): SheetSpec[] {
  return [
    summarySheet(input),
    stationSheet(input.summary),
    errorSheet(input.summary, input.findings),
    timelineSheet(input.history),
    confidenceSheet(input.confidence),
  ];
}

/* -------------------------------------------------------------------------- */

function summarySheet(input: ValidationWorkbookInput): SheetSpec {
  const { summary, confidence } = input;

  const rows: SheetValue[][] = [
    ["Fabrika", input.factoryName ?? "Kaydedilmemiş model", null],
    ["Genel doğruluk", summary.overallAccuracy, "0-1"],
    ["Güven skoru", confidence.score, "0-1"],
    [
      "Güven seviyesi",
      confidence.level === null ? null : CONFIDENCE_LABEL[confidence.level],
      null,
    ],
    ["İstasyon sayısı", summary.stationCount, "adet"],
    ["Ölçüm girilen istasyon", summary.measuredStationCount, "adet"],
    ["Ölçüm noktası", summary.measuredPointCount, "adet"],
    ["Ölçüm penceresi", summary.shiftMinutes, "dakika"],
    ...METRIC_ORDER.map((metric): SheetValue[] => [
      `Doğruluk — ${METRIC_LABEL[metric]}`,
      summary.metricAccuracy[metric],
      "0-1",
    ]),
  ];

  return { name: "Summary", columns: ["Alan", "Değer", "Birim"], rows };
}

function stationSheet(summary: ValidationSummary): SheetSpec {
  const columns = [
    "İstasyon",
    "Ölçüt",
    "Birim",
    "Model",
    "Saha",
    "Sapma (0-1)",
    "Doğruluk (0-1)",
  ];

  const rows: SheetValue[][] = [];
  for (const station of summary.stations) {
    for (const metric of METRIC_ORDER) {
      const comparison = station.metrics[metric];
      rows.push([
        station.stationName,
        METRIC_LABEL[metric],
        METRIC_UNIT[metric],
        comparison.simulated,
        comparison.real,
        comparison.errorRatio,
        comparison.accuracy,
      ]);
    }
  }

  if (rows.length === 0) {
    return {
      name: "Stations",
      columns,
      rows: [],
      emptyNote:
        "Bir simülasyon koşumu bulunmadığı için karşılaştırılacak istasyon yok.",
    };
  }

  return { name: "Stations", columns, rows };
}

/**
 * Sapma sekmesi.
 *
 * Yalnızca gerçekten ölçülmüş satırlar yazılır; boş satırlar `Stations`
 * sekmesinde zaten görünür. Buradaki liste "nereye bakılacak" listesidir ve
 * sapma büyüklüğüne göre sıralıdır.
 */
function errorSheet(
  summary: ValidationSummary,
  findings: ValidationFinding[],
): SheetSpec {
  const columns = [
    "İstasyon",
    "Ölçüt",
    "Sapma (0-1)",
    "Doğruluk (0-1)",
    "Bulgu",
    "Öneri",
  ];

  const findingByKey = new Map(
    findings.map((finding) => [`${finding.stationId}-${finding.metric}`, finding]),
  );

  const rows: SheetValue[][] = [];
  for (const station of summary.stations) {
    for (const metric of METRIC_ORDER) {
      const comparison = station.metrics[metric];
      if (comparison.accuracy === null || comparison.errorRatio === null) {
        continue;
      }
      const finding = findingByKey.get(`${station.stationId}-${metric}`) ?? null;
      rows.push([
        station.stationName,
        METRIC_LABEL[metric],
        comparison.errorRatio,
        comparison.accuracy,
        finding?.text ?? null,
        finding?.advice ?? null,
      ]);
    }
  }

  rows.sort((a, b) => Math.abs(Number(b[2] ?? 0)) - Math.abs(Number(a[2] ?? 0)));

  if (rows.length === 0) {
    return {
      name: "Errors",
      columns,
      rows: [],
      emptyNote: "Gerçek veri girilmediği için sapma hesaplanamadı.",
    };
  }

  return { name: "Errors", columns, rows };
}

function timelineSheet(history: ValidationSnapshot[]): SheetSpec {
  const columns = [
    "Ölçüm tarihi",
    "Doğruluk (0-1)",
    "Güven (0-1)",
    "Güven seviyesi",
    "Ölçülen istasyon",
    "İstasyon sayısı",
  ];

  if (history.length === 0) {
    return {
      name: "Timeline",
      columns,
      rows: [],
      emptyNote:
        "Bu fabrikanın kayıtlı doğrulaması yok; ilk ölçüm kaydedildiğinde burada listelenir.",
    };
  }

  return {
    name: "Timeline",
    columns,
    rows: history.map((item): SheetValue[] => [
      item.measuredAt,
      item.overallAccuracy,
      item.confidenceScore,
      item.confidenceLevel === null
        ? null
        : CONFIDENCE_LABEL[item.confidenceLevel],
      item.measuredStationCount,
      item.stationCount,
    ]),
  };
}

function confidenceSheet(confidence: ConfidenceScore): SheetSpec {
  const columns = ["Bileşen", "Skor (0-1)", "Açıklama"];

  const reasonOf = (factor: string): string | null =>
    confidence.reasons.find((reason) => reason.factor === factor)?.text ?? null;

  const rows: SheetValue[][] = [
    ["Veri doluluğu", confidence.parts.coverage, reasonOf("coverage")],
    ["Ölçülen sapma", confidence.parts.deviation, reasonOf("deviation")],
    ["İstasyon kapsamı", confidence.parts.scale, reasonOf("scale")],
    ["Ölçüm süresi", confidence.parts.duration, reasonOf("duration")],
    [
      "Toplam",
      confidence.score,
      confidence.level === null ? null : CONFIDENCE_LABEL[confidence.level],
    ],
  ];

  return { name: "Confidence", columns, rows };
}
