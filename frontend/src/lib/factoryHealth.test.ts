import { describe, expect, it } from "vitest";
import { buildHealthIndicators, utilizationSpread } from "./factoryHealth";
import type { SimulationResults } from "../types/simulationTypes";

function station(
  id: string,
  utilization: number,
  flow = { entered: 100, completed: 98, scrapped: 1, rejected: 1 },
) {
  return {
    station_id: id,
    station_name: id,
    utilization,
    avg_queue_length: 1,
    avg_wait_time: 2,
    oee: { availability: 0.9, performance: 0.9, quality: 0.98, oee: 0.79 },
    is_bottleneck: false,
    flow,
  };
}

function results(overrides: Partial<SimulationResults> = {}): SimulationResults {
  return {
    total_throughput: 1000,
    confidence_interval_95: [980, 1020],
    station_metrics: [station("s1", 0.6), station("s2", 0.8)],
    bottleneck_station_id: "s2",
    littles_law_validation: {
      passed: true,
      deviation_pct: 1,
      tolerance_pct: 5,
      replications_checked: 10,
      replications_passed: 10,
    },
    num_replications: 30,
    is_stable: true,
    avg_wip: 12,
    avg_flow_time: 30,
    throughput_per_minute: 2,
    line_oee: 0.74,
    theoretical_max_throughput_per_minute: 2.5,
    ...overrides,
  };
}

function byId(indicators: ReturnType<typeof buildHealthIndicators>, id: string) {
  return indicators.find((item) => item.id === id);
}

describe("utilizationSpread", () => {
  it("en dolu ve en bos istasyon arasindaki farki verir", () => {
    expect(utilizationSpread(results())).toBeCloseTo(0.2, 6);
  });

  it("tek istasyonlu hatta null doner", () => {
    // Sifir dondurmek "mukemmel dengeli" gibi okunurdu.
    expect(
      utilizationSpread(results({ station_metrics: [station("s1", 0.6)] })),
    ).toBeNull();
  });
});

describe("buildHealthIndicators", () => {
  it("kosum yoksa bos dizi doner", () => {
    expect(buildHealthIndicators(null)).toEqual([]);
  });

  it("kararli hatti iyi tonda bildirir", () => {
    expect(byId(buildHealthIndicators(results()), "stability")).toMatchObject({
      value: "Kararlı",
      tone: "good",
    });
  });

  it("kararsiz hatti kotu tonda bildirir", () => {
    expect(
      byId(buildHealthIndicators(results({ is_stable: false })), "stability"),
    ).toMatchObject({ value: "Kararsız", tone: "bad" });
  });

  it("dogrulama sonucunu tasir", () => {
    const failed = buildHealthIndicators(
      results({
        littles_law_validation: {
          passed: false,
          deviation_pct: 12,
          tolerance_pct: 5,
          replications_checked: 10,
          replications_passed: 2,
        },
      }),
    );
    expect(byId(failed, "validation")).toMatchObject({
      value: "Geçmedi",
      tone: "warning",
    });
  });

  it("fire ve ret oranlarini ayri gosterir", () => {
    const indicators = buildHealthIndicators(
      results({
        station_metrics: [
          station("s1", 0.6, {
            entered: 100,
            completed: 70,
            scrapped: 20,
            rejected: 10,
          }),
          station("s2", 0.8, {
            entered: 100,
            completed: 100,
            scrapped: 0,
            rejected: 0,
          }),
        ],
      }),
    );
    expect(byId(indicators, "scrap")).toMatchObject({
      value: "%10.0",
      tone: "warning",
    });
    expect(byId(indicators, "rejected")).toMatchObject({
      value: "%5.0",
      tone: "good",
    });
  });

  it("hic parca girmediyse akis gostergelerini uretmez", () => {
    // Sifira bolmek yerine gosterge hic cizilmez; "%0 fire" yaniltici olurdu.
    const indicators = buildHealthIndicators(
      results({
        station_metrics: [
          station("s1", 0.6, { entered: 0, completed: 0, scrapped: 0, rejected: 0 }),
          station("s2", 0.8, { entered: 0, completed: 0, scrapped: 0, rejected: 0 }),
        ],
      }),
    );
    expect(byId(indicators, "scrap")).toBeUndefined();
    expect(byId(indicators, "rejected")).toBeUndefined();
  });

  it("dengesiz hatti uyari olarak isaretler", () => {
    const indicators = buildHealthIndicators(
      results({ station_metrics: [station("s1", 0.1), station("s2", 0.95)] }),
    );
    expect(byId(indicators, "balance")).toMatchObject({ tone: "warning" });
  });

  it("az tekrarli kosumu uyarir", () => {
    expect(
      byId(buildHealthIndicators(results({ num_replications: 5 })), "replications"),
    ).toMatchObject({ value: "5×", tone: "warning" });
  });

  it("her gostergenin degeri yaziyla da okunur", () => {
    // Renk tek basina bilgi tasimamalidir.
    for (const indicator of buildHealthIndicators(results())) {
      expect(indicator.value.length).toBeGreaterThan(0);
      expect(indicator.hint.length).toBeGreaterThan(0);
    }
  });
});
