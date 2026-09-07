import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_CRITICAL,
  buildActionItems,
  countByPriority,
  flowTotals,
} from "./actionItems";
import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationResults,
} from "../types/simulationTypes";

function station(
  id: string,
  name: string,
  utilization: number,
  flow = { entered: 100, completed: 98, scrapped: 1, rejected: 1 },
) {
  return {
    station_id: id,
    station_name: name,
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
    station_metrics: [station("s1", "Kesim", 0.6), station("s2", "Dikiş", 0.7)],
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

function analysis(
  name: string,
  status: "ok" | "warning" | "critical",
  coversLeadTime = true,
  isApplicable = true,
): InventoryAnalysis {
  return {
    item_id: name,
    item_name: name,
    unit: "adet",
    service_level: 0.95,
    z_value: 1.65,
    is_applicable: isApplicable,
    annual_demand: 1000,
    economic_order_quantity: 100,
    safety_stock: 20,
    reorder_point: 50,
    orders_per_year: 10,
    days_between_orders: 36,
    annual_ordering_cost: 500,
    annual_holding_cost: 500,
    total_annual_cost: 1000,
    current_stock: 40,
    days_of_stock: 10,
    days_until_reorder: 2,
    covers_lead_time: coversLeadTime,
    status,
    recommendation: "test",
  };
}

const emptyReport = null as FinancialReport | null;

function ids(items: ReturnType<typeof buildActionItems>) {
  return items.map((item) => item.id);
}

describe("flowTotals", () => {
  it("istasyonlarin akis sayilarini toplar", () => {
    const totals = flowTotals(results());
    expect(totals).toEqual({ entered: 200, scrapped: 2, rejected: 2 });
  });
});

describe("buildActionItems — simulasyon kurallari", () => {
  it("kararsiz hatti kritik olarak bildirir", () => {
    const items = buildActionItems({
      results: results({ is_stable: false }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    const unstable = items.find((item) => item.id === "unstable");
    expect(unstable?.priority).toBe("critical");
  });

  it("cok dolu darbogazi kritik, orta dolulugu uyari yapar", () => {
    const critical = buildActionItems({
      results: results({
        station_metrics: [station("s1", "Kesim", 0.5), station("s2", "Dikiş", 0.97)],
      }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(critical)).toContain("bottleneck-critical");

    const warning = buildActionItems({
      results: results({
        station_metrics: [station("s1", "Kesim", 0.5), station("s2", "Dikiş", 0.88)],
      }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(warning)).toContain("bottleneck-warning");
    expect(ids(warning)).not.toContain("bottleneck-critical");
  });

  it("esigin altindaki darbogaz icin kart uretmez", () => {
    // Kisit disaridaysa (dusuk doluluk) bir "darbogaz sorunu" yoktur; kart
    // uretmek olmayan bir aciliyet yaratirdi.
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(items)).not.toContain("bottleneck-warning");
    expect(ids(items)).not.toContain("bottleneck-critical");
  });

  it("yuksek fire oranini uyari yapar", () => {
    const items = buildActionItems({
      results: results({
        station_metrics: [
          station("s1", "Kesim", 0.6, {
            entered: 100,
            completed: 80,
            scrapped: 20,
            rejected: 0,
          }),
        ],
        bottleneck_station_id: "s1",
      }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(items)).toContain("scrap");
  });

  it("tampon reddini fireden ayri bildirir", () => {
    const items = buildActionItems({
      results: results({
        station_metrics: [
          station("s1", "Kesim", 0.6, {
            entered: 100,
            completed: 80,
            scrapped: 0,
            rejected: 20,
          }),
        ],
        bottleneck_station_id: "s1",
      }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(items)).toContain("rejected");
    expect(ids(items)).not.toContain("scrap");
  });

  it("dogrulama gecmediyse uyarir", () => {
    const items = buildActionItems({
      results: results({
        littles_law_validation: {
          passed: false,
          deviation_pct: 12,
          tolerance_pct: 5,
          replications_checked: 10,
          replications_passed: 3,
        },
      }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(items)).toContain("littles-law");
  });
});

describe("buildActionItems — envanter kurallari", () => {
  it("tedarik suresini karsilamayan kalemi kritik yapar", () => {
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: [analysis("Kumaş", "critical", false)],
      factoryCount: 1,
    });
    const item = items.find((entry) => entry.id === "stock-uncovered");
    expect(item?.priority).toBe("critical");
    expect(item?.title).toContain("Kumaş");
  });

  it("hesaplanamayan kalemleri hic saymaz", () => {
    // Tuketim girilmemis bir kalem icin durum bilinmiyor; "kritik" saymak
    // olmayan bir aciliyet uydurmak olurdu.
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: [analysis("Vida", "critical", true, false)],
      factoryCount: 1,
    });
    expect(ids(items)).not.toContain("stock-critical");
  });

  it("birden cok kalemi tek kartta toplar", () => {
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: [analysis("A", "warning"), analysis("B", "warning")],
      factoryCount: 1,
    });
    const item = items.find((entry) => entry.id === "stock-warning");
    expect(item?.title).toContain("2 kalem");
  });

  it("envanter henuz yuklenmediyse kart uretmez", () => {
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    expect(ids(items).some((id) => id.startsWith("stock-"))).toBe(false);
  });
});

describe("buildActionItems — eksik girdiler", () => {
  it("maliyet orani yoksa bilgilendirici kart cikar", () => {
    const items = buildActionItems({
      results: results(),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    const item = items.find((entry) => entry.id === "no-rates");
    expect(item?.priority).toBe("info");
  });

  it("kosum yoksa ilk adima yonlendirir", () => {
    const items = buildActionItems({
      results: null,
      report: emptyReport,
      analyses: null,
      factoryCount: 0,
    });
    expect(ids(items)).toContain("no-run");
    expect(ids(items)).toContain("no-factory");
    // Kosum yokken simulasyona dair uyari uretilmez.
    expect(ids(items)).not.toContain("unstable");
  });
});

describe("buildActionItems — siralama", () => {
  it("kritik kartlar uyari ve bilgiden once gelir", () => {
    const items = buildActionItems({
      results: results({ is_stable: false }),
      report: emptyReport,
      analyses: [analysis("A", "warning")],
      factoryCount: 0,
    });
    const priorities = items.map((item) => item.priority);
    const firstInfo = priorities.indexOf("info");
    const lastCritical = priorities.lastIndexOf("critical");
    expect(lastCritical).toBeLessThan(firstInfo);
  });
});

describe("countByPriority", () => {
  it("her aciliyeti sayar", () => {
    const items = buildActionItems({
      results: results({ is_stable: false }),
      report: emptyReport,
      analyses: null,
      factoryCount: 1,
    });
    const counts = countByPriority(items);
    expect(counts.critical).toBeGreaterThanOrEqual(1);
    expect(counts.critical + counts.warning + counts.info).toBe(items.length);
  });

  it("bos listede hepsi sifirdir", () => {
    expect(countByPriority([])).toEqual({ critical: 0, warning: 0, info: 0 });
  });
});

describe("esikler", () => {
  it("kritik darbogaz esigi uyari esiginin ustundedir", () => {
    expect(BOTTLENECK_CRITICAL).toBeGreaterThan(0.85);
  });
});
