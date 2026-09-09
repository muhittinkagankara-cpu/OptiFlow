import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_BANDS,
  CONFIDENCE_WEIGHTS,
  FULL_SCALE_STATIONS,
  FULL_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  buildConfidence,
  levelOf,
} from "./confidence";
import { METRIC_ORDER, type ValidationSummary } from "./types";

/** Yalnizca guven skorunun okudugu alanlari tasiyan kucuk bir ozet. */
function summaryWith(overrides: Partial<ValidationSummary>): ValidationSummary {
  return {
    stations: [],
    metricAccuracy: {
      cycleTime: null,
      throughput: null,
      queue: null,
      scrap: null,
    },
    overallAccuracy: 0.95,
    bestStation: null,
    worstStation: null,
    biggestGap: null,
    stationCount: 4,
    measuredStationCount: 4,
    measuredPointCount: 4 * METRIC_ORDER.length,
    shiftMinutes: FULL_WINDOW_MINUTES,
    ...overrides,
  };
}

describe("agirliklar", () => {
  it("bilesenler bire tamamlanir", () => {
    const total = Object.values(CONFIDENCE_WEIGHTS).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("levelOf", () => {
  it("esiklere gore seviye verir", () => {
    expect(levelOf(CONFIDENCE_BANDS.high)).toBe("high");
    expect(levelOf(CONFIDENCE_BANDS.medium)).toBe("medium");
    expect(levelOf(CONFIDENCE_BANDS.medium - 0.01)).toBe("low");
    expect(levelOf(null)).toBeNull();
  });
});

describe("buildConfidence", () => {
  it("olcum yokken skor uretmez", () => {
    // Sifir "hesapladik, guven yok" demektir; burada hesaplanacak bir sey yok.
    const confidence = buildConfidence(
      summaryWith({ measuredPointCount: 0, overallAccuracy: null }),
    );
    expect(confidence.score).toBeNull();
    expect(confidence.level).toBeNull();
    expect(confidence.parts.coverage).toBeNull();
    expect(confidence.reasons[0].text).toContain("hiçbir gerçek ölçüm");
  });

  it("tam kapsam ve dusuk sapmada yuksek guven verir", () => {
    const confidence = buildConfidence(
      summaryWith({
        overallAccuracy: 0.96,
        measuredStationCount: FULL_SCALE_STATIONS,
        stationCount: FULL_SCALE_STATIONS,
        measuredPointCount: FULL_SCALE_STATIONS * METRIC_ORDER.length,
      }),
    );
    expect(confidence.level).toBe("high");
    expect(confidence.reasons).toEqual([]);
  });

  it("tek istasyonluk olcum yuksek dogrulukta bile guveni dusurur", () => {
    // Bir istasyonda %98 uyum, hattin tamami icin bir iddia degildir.
    const confidence = buildConfidence(
      summaryWith({
        overallAccuracy: 0.98,
        measuredStationCount: 1,
        measuredPointCount: 2,
      }),
    );
    expect(confidence.level).not.toBe("high");
    expect(confidence.reasons.map((item) => item.factor)).toContain("scale");
    expect(confidence.reasons.map((item) => item.factor)).toContain("coverage");
  });

  it("eksik alan sayisini gerekcede yazar", () => {
    const confidence = buildConfidence(
      summaryWith({ stationCount: 4, measuredPointCount: 5 }),
    );
    const coverage = confidence.reasons.find(
      (item) => item.factor === "coverage",
    );
    expect(coverage?.text).toContain("16 alandan 5");
  });

  it("olcum penceresi girilmediginde nedenini yazar", () => {
    const confidence = buildConfidence(summaryWith({ shiftMinutes: null }));
    expect(confidence.parts.duration).toBe(0);
    const duration = confidence.reasons.find(
      (item) => item.factor === "duration",
    );
    expect(duration?.text).toContain("penceresi girilmedi");
  });

  it("cok kisa olcum tam puanin yarisini gecemez", () => {
    const confidence = buildConfidence(
      summaryWith({ shiftMinutes: MIN_WINDOW_MINUTES - 1 }),
    );
    expect(confidence.parts.duration).toBeLessThanOrEqual(0.5);
    expect(confidence.parts.duration).toBeGreaterThan(0);
  });

  it("bir vardiyalik olcum sure puanini tamamlar", () => {
    const confidence = buildConfidence(
      summaryWith({ shiftMinutes: FULL_WINDOW_MINUTES }),
    );
    expect(confidence.parts.duration).toBe(1);
  });

  it("uzun olcum bir tavana oturur", () => {
    const confidence = buildConfidence(
      summaryWith({ shiftMinutes: FULL_WINDOW_MINUTES * 3 }),
    );
    expect(confidence.parts.duration).toBe(1);
  });

  it("yuksek sapma guveni dusurur ve nedenini yazar", () => {
    const confidence = buildConfidence(summaryWith({ overallAccuracy: 0.4 }));
    expect(confidence.parts.deviation).toBe(0.4);
    expect(confidence.reasons.map((item) => item.factor)).toContain("deviation");
    expect(confidence.level).not.toBe("high");
  });

  it("skor bilesenlerin agirlikli toplamidir", () => {
    const summary = summaryWith({
      overallAccuracy: 0.8,
      stationCount: 4,
      measuredStationCount: 2,
      measuredPointCount: 8,
      shiftMinutes: FULL_WINDOW_MINUTES,
    });
    const confidence = buildConfidence(summary);
    const expected =
      0.5 * CONFIDENCE_WEIGHTS.coverage +
      0.8 * CONFIDENCE_WEIGHTS.deviation +
      (2 / FULL_SCALE_STATIONS) * CONFIDENCE_WEIGHTS.scale +
      1 * CONFIDENCE_WEIGHTS.duration;
    expect(confidence.score).toBeCloseTo(expected, 6);
  });
});
