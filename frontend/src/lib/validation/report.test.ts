import { describe, expect, it } from "vitest";
import { buildValidation } from "./accuracy";
import { buildFindings } from "./analysis";
import { buildConfidence } from "./confidence";
import {
  sampleConfig,
  sampleRealData,
  sampleResults,
  sampleTimeline,
} from "./fixtures";
import {
  buildValidationReport,
  validationReportFileName,
  type ValidationReportInput,
} from "./report";
import { buildValidationWorkbook } from "./workbook";
import type { ReportBlock } from "../reports";
import { blankRealData } from "./types";

const GENERATED_AT = new Date("2026-09-07T15:06:00");
const CONFIG = sampleConfig();

function inputWith(measured: boolean, history = sampleTimeline(GENERATED_AT)) {
  const data = measured
    ? sampleRealData(GENERATED_AT)
    : blankRealData(CONFIG.stations, GENERATED_AT);
  const summary = buildValidation(CONFIG, sampleResults(), data);
  const confidence = buildConfidence(summary);
  return {
    factoryName: "Kuzey Metal Hattı",
    orgName: "OptiFlow",
    generatedAt: GENERATED_AT,
    summary,
    confidence,
    findings: buildFindings(summary),
    history,
  } satisfies ValidationReportInput;
}

/** Belirli türdeki blokları süzer. */
function blocksOf(
  document: ReturnType<typeof buildValidationReport>,
  kind: ReportBlock["kind"],
) {
  return document.blocks.filter((block) => block.kind === kind);
}

describe("validationReportFileName", () => {
  it("fabrika adini ve tarihi tasir", () => {
    expect(validationReportFileName(inputWith(true))).toBe(
      "optiflow-dogrulama-kuzey-metal-hatti-2026-09-07",
    );
  });
});

describe("buildValidationReport", () => {
  it("kapakta dogruluk, guven ve kapsam yazar", () => {
    const document = buildValidationReport(inputWith(true));
    const labels = document.cover.facts.map((fact) => fact.label);
    expect(labels).toEqual([
      "Genel doğruluk",
      "Güven",
      "Ölçülen istasyon",
      "Ölçüm penceresi",
    ]);
    expect(document.cover.subtitle).toContain("uyumlu");
  });

  it("olcum yokken uyduruk bir oran yazmaz", () => {
    const document = buildValidationReport(inputWith(false));
    expect(document.cover.facts[0].value).toBe("—");
    expect(document.cover.subtitle).toContain("ölçüm bekleniyor");
    const notes = blocksOf(document, "note");
    expect(
      notes.some(
        (note) => note.kind === "note" && note.text.includes("hesaplanamadı"),
      ),
    ).toBe(true);
  });

  it("olculmemis istasyon icin sapma satiri uretmez", () => {
    // Ornek veride Montaj bos; tabloda yalnizca olculen satirlar olmali.
    const document = buildValidationReport(inputWith(true));
    const table = document.blocks.find(
      (block) => block.kind === "table" && block.columns[0] === "İstasyon",
    );
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") {
      expect(table.rows.every((row) => row[0] !== "Montaj")).toBe(true);
      // Uc istasyon x dort olcut
      expect(table.rows).toHaveLength(12);
    }
  });

  it("sapma grafigi yalnizca olculen istasyonlari cizer", () => {
    const document = buildValidationReport(inputWith(true));
    const bars = blocksOf(document, "bars")[0];
    if (bars?.kind === "bars") {
      expect(bars.items.map((item) => item.label)).toEqual([
        "Kesim",
        "Torna",
        "Kaynak",
      ]);
      expect(bars.items.every((item) => item.ratio > 0 && item.ratio <= 1)).toBe(
        true,
      );
    }
  });

  it("gecmisteki her olcum bir satir olur", () => {
    const history = sampleTimeline(GENERATED_AT);
    const document = buildValidationReport(inputWith(true, history));
    const table = document.blocks.find(
      (block) => block.kind === "table" && block.columns[0] === "Ölçüm tarihi",
    );
    if (table?.kind === "table") {
      expect(table.rows).toHaveLength(history.length);
      expect(table.rows[0][3]).toBe("2 / 4");
    }
  });

  it("gecmis yokken ilk olcum oldugunu soyler", () => {
    const document = buildValidationReport(inputWith(true, []));
    const paragraphs = blocksOf(document, "paragraph");
    expect(
      paragraphs.some(
        (block) =>
          block.kind === "paragraph" && block.text.includes("ilk doğrulaması"),
      ),
    ).toBe(true);
  });

  it("her bulgu icin metin ve oneri yazar", () => {
    const input = inputWith(true);
    const document = buildValidationReport(input);
    const notes = blocksOf(document, "note");
    for (const finding of input.findings) {
      expect(
        notes.some((note) => note.kind === "note" && note.text === finding.text),
      ).toBe(true);
    }
  });

  it("gomulu yazi tipinde olmayan glif tasimaz", () => {
    // Rapor katmanindaki Roboto alt kumesi sembol bloklarini icermez; boyle bir
    // karakter sessizce notdef basilir ve musteriye bos hucre gider.
    const document = buildValidationReport(inputWith(true));
    const text = [
      document.cover.title,
      document.cover.subtitle,
      ...document.cover.facts.map((fact) => `${fact.label} ${fact.value}`),
      ...document.blocks.flatMap((block) => {
        if (block.kind === "table") {
          return [...block.columns, ...block.rows.flat(), block.caption ?? ""];
        }
        if (block.kind === "kpiGrid") {
          return block.items.flatMap((item) => [
            item.label,
            item.value,
            item.hint ?? "",
          ]);
        }
        if (block.kind === "bars") {
          return block.items.flatMap((item) => [item.label, item.display]);
        }
        return "text" in block ? [block.text] : [];
      }),
    ].join(" ");

    /*
     * Eksi isareti (U+2212) bilincli olarak muaftir: gomulu Roboto onu
     * iceriyor. Bu, tahmin degil olcumdur — uretilen PDF'ten pdf.js ile metin
     * cikarildiginda dort sayfada da notdef bulunmadi ve isaret dogru okundu.
     */
    const verified = new Set(["−"]);
    const unsupported = [...text].find((char) => {
      if (verified.has(char)) {
        return false;
      }
      const code = char.codePointAt(0) ?? 0;
      return (code >= 0x2190 && code <= 0x2bff) || code >= 0x1f000;
    });
    expect(unsupported).toBeUndefined();
  });
});

describe("buildValidationWorkbook", () => {
  it("bes sekme uretir", () => {
    const input = inputWith(true);
    const sheets = buildValidationWorkbook(input);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Stations",
      "Errors",
      "Timeline",
      "Confidence",
    ]);
  });

  it("eksik olcumu bos hucre yazar, sifir yazmaz", () => {
    const sheets = buildValidationWorkbook(inputWith(true));
    const stations = sheets.find((sheet) => sheet.name === "Stations");
    const montaj = stations?.rows.filter((row) => row[0] === "Montaj") ?? [];
    expect(montaj).toHaveLength(4);
    expect(montaj.every((row) => row[4] === null)).toBe(true);
  });

  it("sapma sekmesi buyukten kucuge sirali", () => {
    const sheets = buildValidationWorkbook(inputWith(true));
    const errors = sheets.find((sheet) => sheet.name === "Errors");
    const magnitudes = (errors?.rows ?? []).map((row) =>
      Math.abs(Number(row[2])),
    );
    const sorted = [...magnitudes].sort((a, b) => b - a);
    expect(magnitudes).toEqual(sorted);
  });

  it("olcum yokken sekmeler nedenini yazar", () => {
    const sheets = buildValidationWorkbook(inputWith(false, []));
    const errors = sheets.find((sheet) => sheet.name === "Errors");
    const timeline = sheets.find((sheet) => sheet.name === "Timeline");
    expect(errors?.emptyNote).toContain("Gerçek veri girilmediği");
    expect(timeline?.emptyNote).toContain("kayıtlı doğrulaması yok");
  });
});
