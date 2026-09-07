import { describe, expect, it } from "vitest";
import {
  bottleneckSummary,
  capacityShare,
  dailyThroughput,
  monthlyLoss,
  monthlyRecoverable,
  morningBrief,
  paretoOfComponents,
  paybackDays,
  SHIFT_MINUTES,
  WORKING_DAYS_PER_MONTH,
} from "./dashboardMetrics";
import type {
  FinancialReport,
  LossComponent,
  SimulationResults,
} from "../types/simulationTypes";

function station(id: string, name: string, utilization: number) {
  return {
    station_id: id,
    station_name: name,
    utilization,
    avg_queue_length: 1,
    avg_wait_time: 2,
    oee: { availability: 0.9, performance: 0.9, quality: 0.98, oee: 0.79 },
    is_bottleneck: false,
    flow: { entered: 100, completed: 95, scrapped: 3, rejected: 2 },
  };
}

function results(overrides: Partial<SimulationResults> = {}): SimulationResults {
  return {
    total_throughput: 1000,
    confidence_interval_95: [980, 1020],
    station_metrics: [
      station("s1", "Kesim", 0.62),
      station("s2", "Dikiş", 0.93),
    ],
    bottleneck_station_id: "s2",
    littles_law_validation: {
      passed: true,
      deviation_pct: 1.2,
      tolerance_pct: 5,
      replications_checked: 10,
      replications_passed: 10,
    },
    num_replications: 10,
    is_stable: true,
    avg_wip: 12,
    avg_flow_time: 30,
    throughput_per_minute: 2,
    line_oee: 0.74,
    theoretical_max_throughput_per_minute: 2.5,
    ...overrides,
  };
}

function component(
  name: string,
  amount: number,
  isAvailable = true,
): LossComponent {
  return {
    name,
    label: name,
    amount,
    provenance: "calculated",
    quantity: 1,
    quantity_unit: "saat",
    rate_name: `${name}_rate`,
    rate_value: 1,
    is_available: isAvailable,
    basis: "test",
  };
}

function report(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    impact: {
      downtime_loss: 400,
      waiting_loss: 300,
      scrap_loss: 200,
      opportunity_loss: 100,
      total_loss: 1000,
      confidence: 0.8,
      data_completeness: 1,
      components: [
        component("downtime_loss", 400),
        component("waiting_loss", 300),
        component("scrap_loss", 200),
        component("opportunity_loss", 100),
      ],
      missing_inputs: [],
      notes: [],
    },
    stations: [],
    suggestions: [],
    recoverable_loss: 800,
    daily_loss: 500,
    window_minutes: 1000,
    heat: [],
    top_loss_stations: [],
    ...overrides,
  };
}

describe("dailyThroughput", () => {
  it("vardiya suresiyle olcekler", () => {
    expect(dailyThroughput(results())).toBe(2 * SHIFT_MINUTES);
  });

  it("kosum yoksa null doner", () => {
    expect(dailyThroughput(null)).toBeNull();
  });

  it("vardiya suresi pozitif degilse null doner", () => {
    // Sifir dakikalik bir vardiya "gunde sifir uretim" degil, anlamsiz bir
    // girdidir; sifir gostermek onu bir olcum gibi sunmak olurdu.
    expect(dailyThroughput(results(), 0)).toBeNull();
  });
});

describe("capacityShare", () => {
  it("teorik ust sinira gore orani verir", () => {
    expect(capacityShare(results())).toBeCloseTo(0.8, 10);
  });

  it("teorik sinir sifirsa null doner", () => {
    expect(
      capacityShare(results({ theoretical_max_throughput_per_minute: 0 })),
    ).toBeNull();
  });
});

describe("bottleneckSummary", () => {
  it("darbogaz istasyonunu adiyla dondurur", () => {
    expect(bottleneckSummary(results())).toEqual({
      name: "Dikiş",
      utilization: 0.93,
    });
  });

  it("darbogaz kimligi listede yoksa null doner", () => {
    expect(bottleneckSummary(results({ bottleneck_station_id: "yok" }))).toBeNull();
  });
});

describe("monthlyLoss", () => {
  it("gunluk kaybi calisma gunuyle carpar", () => {
    expect(monthlyLoss(report())).toBe(500 * WORKING_DAYS_PER_MONTH);
  });

  it("gunluk kayip yoksa null doner", () => {
    // `daily_loss` yalnizca gunluk uretim suresi girildiginde dolar; yoksa
    // aylik projeksiyon da uretilemez.
    expect(monthlyLoss(report({ daily_loss: null }))).toBeNull();
  });

  it("rapor yoksa null doner", () => {
    expect(monthlyLoss(null)).toBeNull();
  });
});

describe("monthlyRecoverable", () => {
  it("kurtarilabilir payi aylik kayba uygular", () => {
    // 800/1000 = %80 kurtarilabilir; 500 x 22 x 0.8
    expect(monthlyRecoverable(report())).toBeCloseTo(500 * 22 * 0.8, 6);
  });

  it("toplam kayip sifirsa null doner", () => {
    const zero = report();
    zero.impact.total_loss = 0;
    expect(monthlyRecoverable(zero)).toBeNull();
  });
});

describe("paybackDays", () => {
  it("yatirimi gunluk kurtarilabilir tutara boler", () => {
    // gunluk kurtarilabilir = 500 x 0.8 = 400
    expect(paybackDays(report(), 2000)).toBeCloseTo(5, 6);
  });

  it("yatirim sifirsa null doner", () => {
    expect(paybackDays(report(), 0)).toBeNull();
  });

  it("gunluk kayip yoksa null doner", () => {
    expect(paybackDays(report({ daily_loss: null }), 1000)).toBeNull();
  });
});

describe("paretoOfComponents", () => {
  it("buyukten kucuge sirali kumulatif pay uretir", () => {
    const pareto = paretoOfComponents(report());
    expect(pareto.map((item) => item.name)).toEqual([
      "downtime_loss",
      "waiting_loss",
      "scrap_loss",
      "opportunity_loss",
    ]);
    expect(pareto[0].cumulativeShare).toBeCloseTo(0.4, 6);
    expect(pareto[3].cumulativeShare).toBeCloseTo(1, 6);
  });

  it("hesaplanamayan kalemi disarida birakir", () => {
    // Orani verilmedigi icin hesaplanamayan bir kalem, sifir tutarli bir
    // cubuk olarak cizilseydi "burada kayip yok" diye okunurdu.
    const withMissing = report();
    withMissing.impact.components = [
      component("downtime_loss", 400),
      component("scrap_loss", 0, false),
    ];
    const pareto = paretoOfComponents(withMissing);
    expect(pareto).toHaveLength(1);
    expect(pareto[0].name).toBe("downtime_loss");
  });

  it("rapor yoksa bos dizi doner", () => {
    expect(paretoOfComponents(null)).toEqual([]);
  });
});

describe("morningBrief", () => {
  it("kosum yokken kullaniciyi ilk adima yonlendirir", () => {
    const brief = morningBrief(null, null);
    expect(brief.headline).toContain("Henüz bir koşum yok");
    expect(brief.lines).toHaveLength(3);
  });

  it("darbogazi basliga tasir", () => {
    const brief = morningBrief(results(), null);
    expect(brief.headline).toContain("Dikiş");
  });

  it("kararsiz hatti risk olarak bildirir", () => {
    const brief = morningBrief(results({ is_stable: false }), null);
    expect(brief.lines[2].value).toContain("kararsız");
  });

  it("maliyet orani yokken en kritik istasyon darbogazdir", () => {
    // Para bilgisi olmadan "en cok kaybettiren" istasyon bilinemez; elde olan
    // en iyi cevap darbogazdir ve uydurma bir tutar gosterilmez.
    const brief = morningBrief(results(), null);
    expect(brief.lines[0].label).toBe("En kritik istasyon");
    expect(brief.lines[0].value).toBe("Dikiş");
  });

  it("maliyet orani varsa en cok kaybettiren istasyonu one alir", () => {
    // En sicak istasyon her zaman en pahali istasyon degildir; para bilgisi
    // varken onu kullanmamak, elde olan daha iyi cevabi gormezden gelmektir.
    const withStations = report({
      stations: [
        {
          station_id: "s1",
          station_name: "Kesim",
          downtime_loss: 500,
          waiting_loss: 0,
          scrap_loss: 0,
          opportunity_loss: 0,
          total_loss: 500,
          is_bottleneck: false,
        },
      ],
    });
    const brief = morningBrief(results(), withStations);
    expect(brief.lines[0].value).toBe("Kesim");
  });
});
