/**
 * Command Center sunum mantığının testleri (Sprint 2D).
 *
 * Buradaki her test bir **dürüstlük kuralını** korur: ölçülmemiş bir şey
 * uydurulmamalı, ölçülmüş bir şey gizlenmemeli ve eşikler tek bir yerden
 * gelmeli. İş kuralları bu klasörde değil; testler de onları sınamaz, yalnızca
 * sunuma çevrilirken bozulmadığını sınar.
 */

import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_CRITICAL,
  BOTTLENECK_WARNING,
  type ActionItem,
} from "../actionItems";
import type { SimulationResults } from "../../types/simulationTypes";
import {
  confidenceLine,
  factoryStatement,
  leadDecision,
  moneyLine,
  railStations,
  remainingTopics,
  runProvenance,
  utilizationState,
} from "./index";

function station(id: string, name: string, utilization: number) {
  return {
    station_id: id,
    station_name: name,
    utilization,
    avg_queue_length: 1,
    avg_wait_time: 2,
    oee: { availability: 0.9, performance: 0.9, quality: 0.98, oee: 0.79 },
    is_bottleneck: false,
    flow: { entered: 100, completed: 98, scrapped: 1, rejected: 1 },
  };
}

function results(overrides: Partial<SimulationResults> = {}): SimulationResults {
  return {
    total_throughput: 1000,
    confidence_interval_95: [980, 1020],
    station_metrics: [
      station("s1", "Kesim", 0.55),
      station("s2", "Torna", 0.82),
    ],
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

function action(id: string, priority: ActionItem["priority"]): ActionItem {
  return {
    id,
    priority,
    title: `${id} başlığı`,
    detail: `${id} ayrıntısı`,
    target: "simulation",
    actionLabel: "Aç",
  };
}

describe("factoryStatement — ekranı açan cümle", () => {
  it("koşum yokken kısıt uydurmaz, ölçüm yapılmadığını söyler", () => {
    const statement = factoryStatement(null);
    expect(statement.headline).toContain("ölçülmedi");
    expect(statement.action?.target).toBe("simulation");
  });

  it("kısıt varsa istasyon adını cümleye koyar", () => {
    const statement = factoryStatement(results());
    expect(statement.headline).toBe("Bugün hattınızı Torna sınırlıyor.");
    expect(statement.action).toBeNull();
  });

  it("darboğaz istasyonu sonuçlarla eşleşmezse istasyon adı uydurmaz", () => {
    // Yanlış bir istasyon adı, kullanıcıyı yanlış makineye yönlendirirdi.
    const statement = factoryStatement(
      results({ bottleneck_station_id: "yok" }),
    );
    expect(statement.headline).toContain("belirlenemedi");
    expect(statement.headline).not.toContain("Torna");
  });

  it("kapasite ölçülemezse cümle yine kurulur, oran atlanır", () => {
    const statement = factoryStatement(
      results({ theoretical_max_throughput_per_minute: 0 }),
    );
    expect(statement.headline).toContain("Torna");
    expect(statement.detail).toContain("Torna");
  });
});

describe("railStations — kısıt şeridi", () => {
  it("koşum yoksa boş döner ve şerit çizilmez", () => {
    expect(railStations(null)).toEqual([]);
  });

  it("her istasyonu ölçülmüş doluluğuyla taşır", () => {
    const rail = railStations(results());
    expect(rail).toHaveLength(2);
    expect(rail[0]).toMatchObject({ label: "Kesim", share: 0.55, value: "%55" });
    expect(rail[1]).toMatchObject({ label: "Torna", share: 0.82, value: "%82" });
  });

  it("kısıtı yalnızca darboğaz istasyonunda işaretler", () => {
    const rail = railStations(results());
    expect(rail.filter((s) => s.isConstraint).map((s) => s.label)).toEqual([
      "Torna",
    ]);
  });

  it("istasyon ya da oran uydurmaz", () => {
    const rail = railStations(results({ station_metrics: [] }));
    expect(rail).toEqual([]);
  });
});

describe("utilizationState — eşikler tek kaynaktan gelir", () => {
  it("actionItems eşikleriyle aynı sınırları kullanır", () => {
    expect(utilizationState(BOTTLENECK_CRITICAL)).toBe("fault");
    expect(utilizationState(BOTTLENECK_WARNING)).toBe("warn");
    expect(utilizationState(BOTTLENECK_WARNING - 0.01)).toBe("ok");
  });

  it("eşiğin hemen altı uyarı değildir", () => {
    expect(utilizationState(0.5)).toBe("ok");
  });
});

describe("karar seçimi", () => {
  it("liste boşsa karar yoktur", () => {
    expect(leadDecision([])).toBeNull();
    expect(remainingTopics([])).toEqual([]);
  });

  it("ilk madde karara, kalanı konulara gider", () => {
    const items = [action("a", "critical"), action("b", "warning"), action("c", "info")];
    expect(leadDecision(items)?.id).toBe("a");
    expect(remainingTopics(items).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("sıralamayı değiştirmez — önceliklendirme actionItems'ın işidir", () => {
    const items = [action("z", "info"), action("y", "critical")];
    expect(leadDecision(items)?.id).toBe("z");
  });
});

describe("moneyLine — Yasa 4", () => {
  it("tutar varsa neden ve eylem yazılmaz", () => {
    expect(moneyLine("₺1.000")).toEqual({
      amount: "₺1.000",
      reason: null,
      action: null,
    });
  });

  it("tutar yoksa gizlenmez; nedeni ve eylemi taşır", () => {
    const line = moneyLine(null);
    expect(line.amount).toBeNull();
    expect(line.reason).toBe("Maliyet oranları girilmedi");
    expect(line.action?.target).toBe("finance");
  });
});

describe("runProvenance — bu sayı nereden geldi", () => {
  it("koşum yokken doğrulanmamış köken bildirir", () => {
    const p = runProvenance(null);
    expect(p.origin).toBe("unverified");
    expect(p.replications).toBeNull();
    expect(p.interval).toBeNull();
  });

  it("koşum varsa benzetim kökenini ve ölçülmüş aralığı taşır", () => {
    const p = runProvenance(results());
    expect(p.origin).toBe("simulated");
    expect(p.replications).toBe(30);
    expect(p.interval).toContain("%95");
  });

  it("canlı veri olduğunu asla iddia etmez", () => {
    // Ekrandaki her sayı son simülasyon koşumundan gelir; KURAL 1.
    expect(runProvenance(results()).origin).not.toBe("live");
  });

  it("aralık sayısal değilse uydurmaz", () => {
    const p = runProvenance(
      results({ confidence_interval_95: [Number.NaN, Number.NaN] }),
    );
    expect(p.interval).toBeNull();
  });
});

describe("confidenceLine", () => {
  it("ölçüm yoksa satır hiç çizilmez", () => {
    expect(confidenceLine(runProvenance(null))).toBeNull();
  });

  it("tekrar sayısı ve aralığı birlikte yazar", () => {
    const line = confidenceLine(runProvenance(results()));
    expect(line).toContain("30 tekrar");
    expect(line).toContain("%95");
  });
});
