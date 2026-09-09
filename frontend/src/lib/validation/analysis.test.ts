import { describe, expect, it } from "vitest";
import { buildValidation } from "./accuracy";
import {
  MAX_FINDINGS,
  MIN_REPORTABLE_ERROR,
  accuracyHeadline,
  buildFindings,
  confidenceHeadline,
  emptyFindingMessage,
} from "./analysis";
import { buildConfidence } from "./confidence";
import { sampleConfig, sampleResults } from "./fixtures";
import { blankRealData, type RealDataSet, type RealStationMeasurement } from "./types";

const MEASURED_AT = new Date("2026-09-07T08:00:00");
const CONFIG = sampleConfig();
const RESULTS = sampleResults();

function measurement(
  overrides: Partial<RealStationMeasurement> & { stationId: string },
): RealStationMeasurement {
  return {
    stationName: overrides.stationId,
    cycleTimeMinutes: null,
    producedUnits: null,
    waitMinutes: null,
    scrapUnits: null,
    operatorCount: null,
    machineCount: null,
    ...overrides,
  };
}

function data(
  stations: RealStationMeasurement[],
  shiftMinutes: number | null = 480,
): RealDataSet {
  return { shiftMinutes, measuredAt: MEASURED_AT.toISOString(), stations };
}

function summaryOf(stations: RealStationMeasurement[], shift?: number | null) {
  return buildValidation(CONFIG, RESULTS, data(stations, shift ?? 480));
}

describe("accuracyHeadline", () => {
  it("olcum yoksa cumle kurmaz", () => {
    // "%0 uyumlu" demek, olcum yapilmadigini degil modelin yanlis oldugunu
    // soylerdi.
    const summary = buildValidation(
      CONFIG,
      RESULTS,
      blankRealData(CONFIG.stations, MEASURED_AT),
    );
    expect(accuracyHeadline(summary)).toBeNull();
  });

  it("olculen dogrulugu yuzdeyle yazar", () => {
    const summary = summaryOf([
      measurement({ stationId: "torna", stationName: "Torna", cycleTimeMinutes: 2.4 }),
    ]);
    expect(accuracyHeadline(summary)).toBe(
      "Simülasyon sonuçları gerçek üretimle %100 uyumlu.",
    );
  });
});

describe("confidenceHeadline", () => {
  it("skor yokken bos doner", () => {
    const summary = buildValidation(
      CONFIG,
      RESULTS,
      blankRealData(CONFIG.stations, MEASURED_AT),
    );
    expect(confidenceHeadline(buildConfidence(summary))).toBeNull();
  });

  it("seviye ve skoru birlikte yazar", () => {
    const summary = summaryOf([
      measurement({ stationId: "torna", stationName: "Torna", cycleTimeMinutes: 2.4 }),
    ]);
    const text = confidenceHeadline(buildConfidence(summary));
    expect(text).toMatch(/güven/);
    expect(text).toMatch(/%\d+/);
  });
});

describe("buildFindings", () => {
  it("kucuk farklar bulgu uretmez", () => {
    // Olcum gurultusu bandinin icindeki fark, listeyi doldurup gercek
    // sapmalari asagi iterdi.
    const barelyOff = 2.4 / (1 - MIN_REPORTABLE_ERROR / 2);
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: barelyOff,
      }),
    ]);
    expect(buildFindings(summary)).toEqual([]);
  });

  it("gercek sure uzunsa 'uzun' der ve iki degeri de yazar", () => {
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: 2.9,
      }),
    ]);
    const [finding] = buildFindings(summary);
    expect(finding.text).toContain("Torna istasyonunda çevrim süresi");
    expect(finding.text).toContain("daha uzun");
    expect(finding.text).toContain("model 2,40 dk");
    expect(finding.text).toContain("saha 2,90 dk");
  });

  it("gercek sure kisaysa yon degisir", () => {
    const summary = summaryOf([
      measurement({
        stationId: "kaynak",
        stationName: "Kaynak",
        cycleTimeMinutes: 2,
      }),
    ]);
    const [finding] = buildFindings(summary);
    expect(finding.text).toContain("daha kısa");
  });

  it("bekleme suresi yuksekse bunu soyler", () => {
    const summary = summaryOf([
      measurement({
        stationId: "kaynak",
        stationName: "Kaynak",
        waitMinutes: 9,
      }),
    ]);
    const [finding] = buildFindings(summary);
    expect(finding.metric).toBe("queue");
    expect(finding.text).toContain("bekleme süresi modele göre");
    expect(finding.text).toContain("yüksek");
  });

  it("fire tahminden dusukse dusuk yazar", () => {
    // Modelde ~%2 fire var; sahada %1 olcelim.
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        producedUnits: 99,
        scrapUnits: 1,
      }),
    ]);
    const scrap = buildFindings(summary).find((item) => item.metric === "scrap");
    expect(scrap?.text).toContain("fire oranı tahmin edilenden");
    expect(scrap?.text).toContain("düşük");
  });

  it("onerisi olculen degeri tasir", () => {
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: 2.9,
      }),
    ]);
    const [finding] = buildFindings(summary);
    expect(finding.advice).toContain("2,90 dakikaya");
  });

  it("buyukten kucuge siralar ve sinirda keser", () => {
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: 2.9,
        waitMinutes: 3.4,
        producedUnits: 142,
        scrapUnits: 4,
      }),
      measurement({
        stationId: "kaynak",
        stationName: "Kaynak",
        cycleTimeMinutes: 9,
        waitMinutes: 20,
        producedUnits: 40,
        scrapUnits: 20,
      }),
    ]);
    const findings = buildFindings(summary, 3);
    expect(findings).toHaveLength(3);
    expect(findings[0].magnitude).toBeGreaterThanOrEqual(findings[1].magnitude);
    expect(findings[1].magnitude).toBeGreaterThanOrEqual(findings[2].magnitude);
    expect(buildFindings(summary).length).toBeLessThanOrEqual(MAX_FINDINGS);
  });

  it("buyuk sapma kirmizi, kucuk sapma turuncu tonlanir", () => {
    const summary = summaryOf([
      measurement({
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: 2.9,
      }),
      measurement({
        stationId: "kaynak",
        stationName: "Kaynak",
        cycleTimeMinutes: 12,
      }),
    ]);
    const findings = buildFindings(summary);
    expect(findings[0].tone).toBe("bad");
    expect(findings[findings.length - 1].tone).toBe("warning");
  });
});

describe("emptyFindingMessage", () => {
  it("olcum yoklugunu sapmasizliktan ayirir", () => {
    const empty = buildValidation(
      CONFIG,
      RESULTS,
      blankRealData(CONFIG.stations, MEASURED_AT),
    );
    expect(emptyFindingMessage(empty)).toContain("Henüz gerçek veri girilmedi");

    const matching = summaryOf([
      measurement({ stationId: "torna", stationName: "Torna", cycleTimeMinutes: 2.4 }),
    ]);
    expect(emptyFindingMessage(matching)).toContain("sapma yok");
  });
});
