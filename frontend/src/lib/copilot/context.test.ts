import { describe, expect, it } from "vitest";
import {
  results as simResults,
  report as financeReport,
  station,
} from "../intelligence/fixtures";
import { sampleConfigs, sampleRuntimes, initialState } from "../connectors";
import { sampleLeads } from "../sales";
import {
  allFacts,
  availableSources,
  buildContext,
  contextCompleteness,
  displayOf,
  factOf,
  sectionOf,
  type ContextInput,
} from "./context";
import type { InventoryAnalysis } from "../../types/simulationTypes";
import type { ValidationSummary } from "../validation";

const NOW = 1_700_000_000_000;

function input(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    factoryName: "Kuzey Metal",
    nowMs: NOW,
    results: null,
    report: null,
    validation: null,
    confidence: null,
    live: null,
    inventory: null,
    validationHistory: null,
    leads: null,
    connectors: null,
    ...overrides,
  };
}

function validationSummary(
  overrides: Partial<ValidationSummary> = {},
): ValidationSummary {
  return {
    stations: [],
    metricAccuracy: { cycleTime: 0.9, throughput: null, queue: null, scrap: null },
    overallAccuracy: 0.9,
    bestStation: null,
    worstStation: null,
    biggestGap: null,
    stationCount: 4,
    measuredStationCount: 3,
    measuredPointCount: 9,
    shiftMinutes: 480,
    ...overrides,
  };
}

function inventoryItem(
  overrides: Partial<InventoryAnalysis> = {},
): InventoryAnalysis {
  return {
    item_id: "i1",
    item_name: "Sac levha",
    unit: "adet",
    service_level: 0.95,
    z_value: 1.65,
    is_applicable: true,
    annual_demand: 1_000,
    economic_order_quantity: 120,
    safety_stock: 40,
    reorder_point: 80,
    orders_per_year: 8,
    days_between_orders: 45,
    annual_ordering_cost: 1_000,
    annual_holding_cost: 900,
    total_annual_cost: 1_900,
    current_stock: 150,
    days_of_stock: 12,
    days_until_reorder: 5,
    covers_lead_time: true,
    status: "ok",
    recommendation: "Takip edin.",
    ...overrides,
  };
}

/** Fikstürdeki rapor bileşensizdir; kayıp kalemi sınamaları bunu doldurur. */
function reportWithComponents(
  components: {
    label: string;
    amount: number;
    is_available: boolean;
  }[],
) {
  const base = financeReport();
  return {
    ...base,
    impact: {
      ...base.impact,
      components: components.map((component) => ({
        name: component.label.toLowerCase(),
        label: component.label,
        amount: component.amount,
        provenance: "calculated" as const,
        quantity: 1,
        quantity_unit: "adet",
        rate_name: "oran",
        rate_value: 1,
        is_available: component.is_available,
        basis: "test",
      })),
    },
  };
}

describe("buildContext — bölümler", () => {
  it("sekiz katmanin hepsini kurar", () => {
    const context = buildContext(input());
    expect(context.sections).toHaveLength(8);
  });

  it("veri yoksa bolumu eksik isaretler ve nedenini yazar", () => {
    // Eksik veriyi sessizce atlamak, cevabin neden yuzeysel oldugunu
    // anlatmazdi.
    const context = buildContext(input());
    const finance = sectionOf(context, "finance");
    expect(finance.available).toBe(false);
    expect(finance.missingReason).toContain("Maliyet oranları");
    expect(finance.facts).toEqual([]);
  });

  it("fabrika adini ve ani tasir", () => {
    const context = buildContext(input());
    expect(context.factoryName).toBe("Kuzey Metal");
    expect(context.generatedAtMs).toBe(NOW);
  });
});

describe("buildContext — simülasyon", () => {
  const context = buildContext(input({ results: simResults() }));

  it("cikti hizini ve OEE'yi ekler", () => {
    expect(displayOf(context, "throughput_per_minute")).toContain("parça/dk");
    expect(displayOf(context, "line_oee")).toMatch(/^%\d+$/);
  });

  it("darbogazi ve dolulugunu ekler", () => {
    expect(displayOf(context, "bottleneck_name")).not.toBeNull();
    expect(displayOf(context, "bottleneck_utilization")).toMatch(/^%\d+$/);
  });

  it("istasyon sayisini sayar", () => {
    expect(factOf(context, "station_count")?.numeric).toBe(
      simResults().station_metrics.length,
    );
  });

  it("en yuksek fireli istasyonu bulur", () => {
    const withScrap = buildContext(
      input({
        results: simResults({
          station_metrics: [
            station("a", "Alfa", 0.5, {
              flow: { entered: 100, completed: 98, scrapped: 2, rejected: 0 },
            }),
            station("b", "Beta", 0.5, {
              flow: { entered: 100, completed: 90, scrapped: 10, rejected: 0 },
            }),
          ],
        }),
      }),
    );
    expect(displayOf(withScrap, "worst_scrap_station")).toBe("Beta");
    expect(displayOf(withScrap, "worst_scrap_ratio")).toBe("%10,0");
  });

  it("hic fire yoksa fire olgusu eklenmez", () => {
    const noScrap = buildContext(
      input({
        results: simResults({
          station_metrics: [
            station("a", "Alfa", 0.5, {
              flow: { entered: 100, completed: 100, scrapped: 0, rejected: 0 },
            }),
          ],
        }),
      }),
    );
    expect(factOf(noScrap, "worst_scrap_station")).toBeNull();
  });

  it("kararlilik bilgisini metin olarak tasir", () => {
    expect(displayOf(context, "is_stable")).toBe("evet");
    const unstable = buildContext(
      input({ results: simResults({ is_stable: false }) }),
    );
    expect(displayOf(unstable, "is_stable")).toBe("hayır");
  });
});

describe("buildContext — finans", () => {
  const context = buildContext(input({ report: financeReport() }));

  it("toplam ve kurtarilabilir kaybi ekler", () => {
    expect(factOf(context, "total_loss")?.numeric).toBe(
      financeReport().impact.total_loss,
    );
    expect(factOf(context, "recoverable_loss")).not.toBeNull();
  });

  it("en buyuk kayip kalemini bulur", () => {
    const withComponents = buildContext(
      input({
        report: reportWithComponents([
          { label: "Arıza kaybı", amount: 400, is_available: true },
          { label: "Bekleme kaybı", amount: 900, is_available: true },
        ]),
      }),
    );
    expect(displayOf(withComponents, "dominant_loss_label")).toBe("Bekleme kaybı");
    expect(displayOf(withComponents, "dominant_loss_amount")).toContain("900");
  });

  it("olculemeyen bileseni en buyuk kalem saymaz", () => {
    // Olculememis bir kalemin tutari, en buyuk kalem yarisina sokulmaz.
    const built = buildContext(
      input({
        report: reportWithComponents([
          { label: "Ölçülemeyen kalem", amount: 999_999, is_available: false },
          { label: "Bekleme kaybı", amount: 900, is_available: true },
        ]),
      }),
    );
    expect(displayOf(built, "dominant_loss_label")).toBe("Bekleme kaybı");
    expect(displayOf(built, "dominant_loss_amount")).not.toContain("999.999");
  });

  it("aylik projeksiyonu yalnizca gunluk kayip varsa ekler", () => {
    const withoutDaily = buildContext(
      input({ report: { ...financeReport(), daily_loss: null } }),
    );
    expect(factOf(withoutDaily, "monthly_loss")).toBeNull();
  });

  it("girilmemis maliyet oranlarini yazar", () => {
    const report = financeReport();
    const doctored = {
      ...report,
      impact: { ...report.impact, missing_inputs: ["Fire maliyeti"] },
    };
    expect(displayOf(buildContext(input({ report: doctored })), "missing_inputs")).toBe(
      "Fire maliyeti",
    );
  });

  it("veri dolulugunu ve guveni tasir", () => {
    expect(displayOf(context, "data_completeness")).toMatch(/^%\d+$/);
    expect(displayOf(context, "finance_confidence")).toMatch(/^%\d+$/);
  });
});

describe("buildContext — ısı haritası", () => {
  it("en sicak istasyonu ve bandini ekler", () => {
    const context = buildContext(input({ report: financeReport() }));
    const heat = sectionOf(context, "heatmap");
    if (heat.available) {
      expect(displayOf(context, "hottest_station")).not.toBeNull();
      expect(displayOf(context, "hottest_band")).not.toBeNull();
    }
  });

  it("isi verisi yoksa nedenini yazar", () => {
    const context = buildContext(
      input({ report: { ...financeReport(), heat: [] } }),
    );
    expect(sectionOf(context, "heatmap").available).toBe(false);
    expect(sectionOf(context, "heatmap").missingReason).toContain("finans raporu");
  });
});

describe("buildContext — doğrulama", () => {
  it("dogruluk ve kapsami ekler", () => {
    const context = buildContext(input({ validation: validationSummary() }));
    expect(displayOf(context, "model_accuracy")).toBe("%90");
    expect(displayOf(context, "measured_stations")).toBe("3/4");
  });

  it("dogruluk olculmemisse bolumu eksik sayar", () => {
    const context = buildContext(
      input({ validation: validationSummary({ overallAccuracy: null }) }),
    );
    expect(sectionOf(context, "validation").available).toBe(false);
  });

  it("guven skorunu ekler", () => {
    const context = buildContext(
      input({
        validation: validationSummary(),
        confidence: {
          score: 0.83,
          level: "high",
          parts: { coverage: 1, deviation: 1, scale: 1, duration: 1 },
          reasons: [],
        },
      }),
    );
    expect(displayOf(context, "validation_confidence")).toBe("%83");
  });

  it("en buyuk sapmayi mutlak deger olarak ekler", () => {
    const context = buildContext(
      input({
        validation: validationSummary({
          biggestGap: {
            stationId: "torna",
            stationName: "Torna",
            metric: "scrap",
            errorRatio: -0.42,
          },
        }),
      }),
    );
    expect(displayOf(context, "biggest_gap")).toBe("%42");
  });
});

describe("buildContext — envanter", () => {
  it("kalem sayisini ve kritikleri sayar", () => {
    const context = buildContext(
      input({
        inventory: [
          inventoryItem(),
          inventoryItem({ item_id: "i2", status: "critical", days_of_stock: 3 }),
        ],
      }),
    );
    expect(displayOf(context, "inventory_items")).toBe("2");
    expect(displayOf(context, "inventory_critical")).toBe("1");
  });

  it("stoku ilk bitecek kalemi bulur", () => {
    const context = buildContext(
      input({
        inventory: [
          inventoryItem({ item_name: "Sac", days_of_stock: 12 }),
          inventoryItem({ item_id: "i2", item_name: "Boya", days_of_stock: 3 }),
        ],
      }),
    );
    expect(displayOf(context, "inventory_worst_item")).toBe("Boya");
    expect(displayOf(context, "inventory_worst_days")).toBe("3 gün");
  });

  it("bos envanter bolumu eksik sayilir", () => {
    expect(sectionOf(buildContext(input({ inventory: [] })), "inventory").available).toBe(
      false,
    );
  });
});

describe("buildContext — satış ve bağlayıcılar", () => {
  it("satis hattini ozetler", () => {
    const context = buildContext(input({ leads: sampleLeads(new Date(NOW)) }));
    expect(factOf(context, "crm_total")?.numeric).toBeGreaterThan(0);
    expect(factOf(context, "crm_won")).not.toBeNull();
  });

  it("baglayici sagligini ozetler", () => {
    const state = initialState(sampleConfigs(), [], [], sampleRuntimes(NOW));
    const context = buildContext(input({ connectors: state }));
    expect(displayOf(context, "connector_connected")).toBe("2/5");
    expect(displayOf(context, "connector_latency")).toContain("ms");
  });

  it("baglanti tanimli degilse bolumu eksik sayar", () => {
    const context = buildContext(input({ connectors: initialState([], [], []) }));
    expect(sectionOf(context, "connectors").available).toBe(false);
  });
});

describe("buildContext — kaydedilmiş doğrulama", () => {
  const snapshot = {
    id: "v1",
    factoryId: null,
    factoryName: "Kuzey Metal",
    measuredAt: new Date(NOW).toISOString(),
    overallAccuracy: 0.92,
    confidenceScore: 0.73,
    confidenceLevel: "medium" as const,
    measuredStationCount: 2,
    stationCount: 4,
  };

  it("ekran kapaliyken son kaydedilmis olcumu kullanir", () => {
    const context = buildContext(input({ validationHistory: [snapshot] }));
    expect(displayOf(context, "model_accuracy")).toBe("%92");
    expect(displayOf(context, "measured_stations")).toBe("2/4");
  });

  it("olcumun tarihini de yazar", () => {
    // Aylar once alinmis bir oran, bugunun olcumu gibi sunulmamali.
    const context = buildContext(input({ validationHistory: [snapshot] }));
    expect(displayOf(context, "validation_measured_at")).not.toBeNull();
  });

  it("en son olcumu secer", () => {
    const older = {
      ...snapshot,
      id: "v0",
      measuredAt: new Date(NOW - 86_400_000).toISOString(),
      overallAccuracy: 0.7,
    };
    const context = buildContext(input({ validationHistory: [older, snapshot] }));
    expect(displayOf(context, "model_accuracy")).toBe("%92");
  });

  it("acik ekran verisi kayitli olcumun onune gecer", () => {
    const context = buildContext(
      input({ validation: validationSummary(), validationHistory: [snapshot] }),
    );
    expect(displayOf(context, "model_accuracy")).toBe("%90");
  });

  it("olcumsuz kayitlar bolumu acmaz", () => {
    const context = buildContext(
      input({
        validationHistory: [{ ...snapshot, overallAccuracy: null }],
      }),
    );
    expect(sectionOf(context, "validation").available).toBe(false);
  });
});

describe("okuma yardımcıları", () => {
  const context = buildContext(
    input({ results: simResults(), report: financeReport() }),
  );

  it("olguyu anahtarla bulur", () => {
    expect(factOf(context, "line_oee")?.source).toBe("simulation");
  });

  it("taninmayan anahtarda bos doner", () => {
    expect(factOf(context, "yok")).toBeNull();
    expect(displayOf(context, "yok")).toBeNull();
  });

  it("dolu katmanlari listeler", () => {
    const sources = availableSources(context);
    expect(sources).toContain("simulation");
    expect(sources).toContain("finance");
    expect(sources).not.toContain("live");
  });

  it("tum olgulari duz listeye cevirir", () => {
    expect(allFacts(context).length).toBeGreaterThan(10);
  });

  it("doluluk oranini hesaplar", () => {
    const completeness = contextCompleteness(context);
    expect(completeness).toBeGreaterThan(0);
    expect(completeness).toBeLessThanOrEqual(1);
  });

  it("bos baglamda doluluk sifirdir", () => {
    expect(contextCompleteness(buildContext(input()))).toBe(0);
  });

  it("olmayan katman istendiginde eksik bolum doner", () => {
    expect(sectionOf(buildContext(input()), "live").available).toBe(false);
  });
});
