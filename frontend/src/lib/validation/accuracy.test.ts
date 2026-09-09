import { describe, expect, it } from "vitest";
import {
  BAND_THRESHOLDS,
  MAX_ERROR_RATIO,
  bandOf,
  buildValidation,
  compareMetric,
  observationWindowMinutes,
  realMetricValue,
  simulatedStations,
} from "./accuracy";
import { FIXTURE_WINDOW_MINUTES, sampleConfig, sampleResults } from "./fixtures";
import { blankRealData, type RealDataSet, type RealStationMeasurement } from "./types";

const MEASURED_AT = new Date("2026-09-07T08:00:00");

function measurement(
  overrides: Partial<RealStationMeasurement> = {},
): RealStationMeasurement {
  return {
    stationId: "torna",
    stationName: "Torna",
    cycleTimeMinutes: null,
    producedUnits: null,
    waitMinutes: null,
    scrapUnits: null,
    operatorCount: null,
    machineCount: null,
    ...overrides,
  };
}

function dataWith(
  stations: RealStationMeasurement[],
  shiftMinutes: number | null = 480,
): RealDataSet {
  return { shiftMinutes, measuredAt: MEASURED_AT.toISOString(), stations };
}

describe("observationWindowMinutes", () => {
  it("isinma suresini duser", () => {
    // Motor isinma bitiminde sayaclari sifirlar; toplam sureye bolmek uretimi
    // sistematik olarak dusuk gosterirdi.
    expect(observationWindowMinutes(sampleConfig())).toBe(FIXTURE_WINDOW_MINUTES);
  });

  it("isinma suresi toplami asarsa sifira duser", () => {
    const config = sampleConfig();
    config.warmup_period_minutes = config.simulation_duration_minutes + 100;
    expect(observationWindowMinutes(config)).toBe(0);
  });
});

describe("simulatedStations", () => {
  it("cevrim suresini modeldeki servis suresinden okur", () => {
    const stations = simulatedStations(sampleConfig(), sampleResults());
    expect(stations.find((item) => item.stationId === "torna")?.cycleTimeMinutes).toBe(
      2.4,
    );
  });

  it("uretim hizini gozlem penceresine boler", () => {
    const stations = simulatedStations(sampleConfig(), sampleResults());
    const torna = stations.find((item) => item.stationId === "torna");
    expect(torna?.throughputPerMinute).toBeCloseTo(2_900 / FIXTURE_WINDOW_MINUTES, 6);
  });

  it("fire oranini giren parcaya boler", () => {
    const stations = simulatedStations(sampleConfig(), sampleResults());
    const torna = stations.find((item) => item.stationId === "torna");
    // 59 hurda / (2900 + 59) giren
    expect(torna?.scrapRatio).toBeCloseTo(59 / 2_959, 6);
  });

  it("kosum yoksa bos doner", () => {
    expect(simulatedStations(sampleConfig(), null)).toEqual([]);
    expect(simulatedStations(null, sampleResults())).toEqual([]);
  });
});

describe("realMetricValue", () => {
  it("uretim adedini vardiya suresiyle hiza cevirir", () => {
    expect(
      realMetricValue(measurement({ producedUnits: 240 }), "throughput", 480),
    ).toBeCloseTo(0.5, 6);
  });

  it("vardiya suresi yoksa uretim olculmemis sayilir", () => {
    // 400 parca sekiz saatte de bir saatte de uretilmis olabilir.
    expect(
      realMetricValue(measurement({ producedUnits: 400 }), "throughput", null),
    ).toBeNull();
  });

  it("fire orani icin hem hurda hem saglam adet gerekir", () => {
    expect(realMetricValue(measurement({ scrapUnits: 5 }), "scrap", 480)).toBeNull();
    expect(
      realMetricValue(
        measurement({ scrapUnits: 5, producedUnits: 95 }),
        "scrap",
        480,
      ),
    ).toBeCloseTo(0.05, 6);
  });

  it("sifir bekleme gercek bir olcumdur", () => {
    expect(realMetricValue(measurement({ waitMinutes: 0 }), "queue", 480)).toBe(0);
  });

  it("negatif ve gecersiz degerler olcum sayilmaz", () => {
    expect(
      realMetricValue(measurement({ cycleTimeMinutes: -2 }), "cycleTime", 480),
    ).toBeNull();
    expect(
      realMetricValue(measurement({ waitMinutes: Number.NaN }), "queue", 480),
    ).toBeNull();
  });
});

describe("compareMetric", () => {
  it("sapmayi gercege gore olcer", () => {
    // (2,4 - 2,0) / 2,4 = %16,67 — model gercegin altinda kaliyor.
    const result = compareMetric("cycleTime", 2, 2.4);
    expect(result.errorRatio).toBeCloseTo(0.4 / 2.4, 6);
    expect(result.accuracy).toBeCloseTo(1 - 0.4 / 2.4, 6);
  });

  it("modelin fazla tahmini negatif isaret alir", () => {
    const result = compareMetric("cycleTime", 3, 2.4);
    expect(result.errorRatio).toBeLessThan(0);
  });

  it("tam ortusmede dogruluk tamdir", () => {
    expect(compareMetric("queue", 2.5, 2.5).accuracy).toBe(1);
  });

  it("olculmeyen deger karsilastirmaya girmez", () => {
    expect(compareMetric("scrap", 0.02, null).accuracy).toBeNull();
    expect(compareMetric("scrap", null, 0.02).accuracy).toBeNull();
  });

  it("iki taraf da sifirsa sapma yoktur", () => {
    // Fire hic olmamis, model de olmayacagini soylemis.
    const result = compareMetric("scrap", 0, 0);
    expect(result.errorRatio).toBe(0);
    expect(result.accuracy).toBe(1);
  });

  it("gercek sifirken modelin farkli demesi tavana yazilir", () => {
    const result = compareMetric("scrap", 0.05, 0);
    expect(Math.abs(result.errorRatio ?? 0)).toBe(MAX_ERROR_RATIO);
    expect(result.accuracy).toBe(0);
  });

  it("yuzde yuzu asan sapma dogrulugu eksiye dusurmez", () => {
    const result = compareMetric("throughput", 10, 1);
    expect(result.accuracy).toBe(0);
  });
});

describe("bandOf", () => {
  it("esiklere gore renk verir", () => {
    expect(bandOf(BAND_THRESHOLDS.good)).toBe("good");
    expect(bandOf(BAND_THRESHOLDS.warning)).toBe("warning");
    expect(bandOf(BAND_THRESHOLDS.warning - 0.01)).toBe("bad");
    expect(bandOf(null)).toBeNull();
  });
});

describe("buildValidation", () => {
  const config = sampleConfig();
  const results = sampleResults();

  it("olcum girilmediginde dogruluk uretmez", () => {
    const summary = buildValidation(
      config,
      results,
      blankRealData(config.stations, MEASURED_AT),
    );
    expect(summary.overallAccuracy).toBeNull();
    expect(summary.measuredPointCount).toBe(0);
    expect(summary.bestStation).toBeNull();
    expect(summary.worstStation).toBeNull();
    expect(summary.biggestGap).toBeNull();
    expect(summary.stationCount).toBe(4);
  });

  it("olculmeyen olcut agirligini olculenlere birakir", () => {
    // Yalnizca cevrim suresi girildi: istasyon dogrulugu bu tek olcute esittir.
    const summary = buildValidation(
      config,
      results,
      dataWith([measurement({ cycleTimeMinutes: 2.4 })]),
    );
    const torna = summary.stations.find((item) => item.stationId === "torna");
    expect(torna?.measuredCount).toBe(1);
    expect(torna?.accuracy).toBe(1);
    expect(summary.overallAccuracy).toBe(1);
  });

  it("olcum girilmemis istasyon ortalamayi bozmaz", () => {
    const summary = buildValidation(
      config,
      results,
      dataWith([measurement({ cycleTimeMinutes: 2.4 })]),
    );
    expect(summary.measuredStationCount).toBe(1);
    expect(
      summary.stations.filter((station) => station.accuracy === null),
    ).toHaveLength(3);
  });

  it("modelde olmayan istasyon karsilastirmaya girmez", () => {
    const summary = buildValidation(
      config,
      results,
      dataWith([
        measurement({ stationId: null, stationName: "Boyahane", cycleTimeMinutes: 4 }),
      ]),
    );
    expect(summary.measuredPointCount).toBe(0);
  });

  it("en dogru ve en sapan istasyonu ayirir", () => {
    const summary = buildValidation(
      config,
      results,
      dataWith([
        measurement({ stationId: "torna", cycleTimeMinutes: 2.4 }),
        measurement({
          stationId: "kaynak",
          stationName: "Kaynak",
          cycleTimeMinutes: 4.5,
        }),
      ]),
    );
    expect(summary.bestStation?.stationId).toBe("torna");
    expect(summary.worstStation?.stationId).toBe("kaynak");
  });

  it("butun istasyonlar ayni dogruluktaysa uc nokta gostermez", () => {
    // Ayni istasyonu hem "en dogru" hem "en sapan" diye gostermek yanlis olurdu.
    const summary = buildValidation(
      config,
      results,
      dataWith([
        measurement({ stationId: "torna", cycleTimeMinutes: 2.4 }),
        measurement({
          stationId: "kaynak",
          stationName: "Kaynak",
          cycleTimeMinutes: 3,
        }),
      ]),
    );
    expect(summary.bestStation).toBeNull();
    expect(summary.worstStation).toBeNull();
  });

  it("en buyuk sapmayi isaretiyle birlikte bulur", () => {
    const summary = buildValidation(
      config,
      results,
      dataWith([
        measurement({ stationId: "torna", cycleTimeMinutes: 2.5 }),
        measurement({
          stationId: "kaynak",
          stationName: "Kaynak",
          cycleTimeMinutes: 6,
        }),
      ]),
    );
    expect(summary.biggestGap?.stationId).toBe("kaynak");
    expect(summary.biggestGap?.metric).toBe("cycleTime");
    expect(summary.biggestGap?.errorRatio).toBeGreaterThan(0);
  });

  it("vardiya suresi olmadan uretim olcutu bos kalir", () => {
    const summary = buildValidation(
      config,
      results,
      dataWith([measurement({ producedUnits: 140 })], null),
    );
    expect(summary.metricAccuracy.throughput).toBeNull();
    expect(summary.overallAccuracy).toBeNull();
  });

  it("kosum yokken hicbir istasyon uretmez", () => {
    const summary = buildValidation(null, null, dataWith([measurement()]));
    expect(summary.stations).toEqual([]);
    expect(summary.stationCount).toBe(0);
    expect(summary.overallAccuracy).toBeNull();
  });
});
