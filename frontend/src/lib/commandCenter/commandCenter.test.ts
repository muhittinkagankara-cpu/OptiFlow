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
  closingStep,
  confidenceLine,
  factoryStatement,
  freshnessLine,
  leadDecision,
  moneyLine,
  operationalHealth,
  railStations,
  remainingTopics,
  runFreshness,
  runProvenance,
  runQuality,
  runQualityLine,
  runRanAt,
  utilizationState,
} from "./index";
import type { HealthIndicator } from "../factoryHealth";
import type { RunHistoryEntry } from "../runHistory";
import type { SimulationRunResponse } from "../../types/simulationTypes";

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

/* -------------------------------------------------------------------------- */
/* Zaman damgası ve tazelik (Sprint 2F-A)                                      */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-09-15T16:12:00.000Z");

function historyEntry(
  simulationId: string,
  ranAt: string,
): RunHistoryEntry {
  return {
    simulationId,
    factoryId: "f1",
    factoryName: "Demo Metal Hattı",
    ranAt,
    throughput: 1000,
    oee: 0.74,
    bottleneckName: "Torna",
    isStable: true,
    stationCount: 2,
    durationSeconds: 3.8,
  };
}

function runResponse(simulationId: string): SimulationRunResponse {
  return {
    simulation_id: simulationId,
    status: "completed",
    results: results(),
    master_seed: 1,
    duration_seconds: 3.8,
    warnings: [],
    headline: "",
  };
}

describe("runRanAt — koşumun saatini geçmişten bulur", () => {
  it("kimliği eşleşen kaydın saatini döner", () => {
    const history = [
      historyEntry("run-2", "2026-09-15T16:00:00.000Z"),
      historyEntry("run-1", "2026-09-15T15:00:00.000Z"),
    ];
    expect(runRanAt(runResponse("run-1"), history)).toBe(
      "2026-09-15T15:00:00.000Z",
    );
  });

  it("sıraya değil kimliğe göre eşleşir", () => {
    // Sıraya göre eşleşseydi, listenin başındaki başka bir koşumun saati bu
    // koşuma yazılırdı.
    const history = [
      historyEntry("run-2", "2026-09-15T16:00:00.000Z"),
      historyEntry("run-1", "2026-09-15T15:00:00.000Z"),
    ];
    expect(runRanAt(runResponse("run-2"), history)).toBe(
      "2026-09-15T16:00:00.000Z",
    );
  });

  it("eşleşme yoksa saat uydurmaz", () => {
    expect(runRanAt(runResponse("yok"), [historyEntry("run-1", "x")])).toBeNull();
  });

  it("koşum ya da geçmiş yoksa null döner", () => {
    expect(runRanAt(null, [])).toBeNull();
    expect(runRanAt(runResponse("run-1"), [])).toBeNull();
  });
});

describe("runProvenance — zaman damgasını taşır", () => {
  it("verilen damgayı aynen aktarır", () => {
    const p = runProvenance(results(), "2026-09-15T16:00:00.000Z");
    expect(p.ranAt).toBe("2026-09-15T16:00:00.000Z");
  });

  it("damga verilmezse null kalır", () => {
    expect(runProvenance(results()).ranAt).toBeNull();
  });

  it("koşum yokken damga da yoktur", () => {
    expect(runProvenance(null, "2026-09-15T16:00:00.000Z").ranAt).toBeNull();
  });
});

describe("runFreshness — tazelik", () => {
  const at = (iso: string) => runFreshness(iso, NOW);

  it("damga yoksa hiçbir şey çizilmez", () => {
    expect(runFreshness(null, NOW)).toBeNull();
  });

  it("geçersiz damga tazelik üretmez", () => {
    // Bozuk bir değeri "az önce" diye okumak, eski veriyi taze gösterirdi.
    expect(at("bu bir tarih değil")).toBeNull();
    expect(at("")).toBeNull();
  });

  it("bir dakikanın altı: az önce", () => {
    expect(at("2026-09-15T16:11:30.000Z")?.text).toBe("az önce");
  });

  it("dakikalar", () => {
    expect(at("2026-09-15T16:00:00.000Z")?.text).toBe("12 dk önce");
  });

  it("saatler", () => {
    expect(at("2026-09-15T13:12:00.000Z")?.text).toBe("3 saat önce");
  });

  it("bir günden eski koşum mutlak tarih ve saatle yazılır", () => {
    const fresh = at("2026-09-13T08:30:00.000Z");
    expect(fresh?.isOlderThanADay).toBe(true);
    // Tarih ve saat birlikte: "14 Eyl" tek başına hangi vardiya olduğunu
    // söylemez.
    expect(fresh?.text).toMatch(/\d/);
    expect(fresh?.text.split(" ").length).toBeGreaterThanOrEqual(3);
  });

  it("bir günün altındaki koşum eski işaretlenmez", () => {
    expect(at("2026-09-15T16:00:00.000Z")?.isOlderThanADay).toBe(false);
    expect(at("2026-09-14T17:00:00.000Z")?.isOlderThanADay).toBe(false);
  });

  it("ileri tarihli damga (saat kayması) eksi süre göstermez", () => {
    // Cihaz saati ileri gitmişse "-5 dk önce" bir hata gibi okunurdu.
    const fresh = at("2026-09-15T16:20:00.000Z");
    expect(fresh?.text).toBe("az önce");
    expect(fresh?.text).not.toContain("-");
  });

  it("saklanan değeri değiştirmez", () => {
    const iso = "2026-09-15T16:00:00.000Z";
    at(iso);
    expect(iso).toBe("2026-09-15T16:00:00.000Z");
  });
});

describe("hat sağlığı ile koşum üstverisinin ayrılması (Sprint 2F-C)", () => {
  const indicators: HealthIndicator[] = [
    { id: "stability", label: "Kararlılık", value: "Kararlı", tone: "good", hint: "" },
    { id: "validation", label: "Doğrulama", value: "Geçti", tone: "good", hint: "" },
    { id: "scrap", label: "Fire oranı", value: "%1.1", tone: "good", hint: "" },
    { id: "rejected", label: "Tampon reddi", value: "%0.0", tone: "good", hint: "" },
    { id: "balance", label: "Hat dengesi", value: "%23 fark", tone: "good", hint: "" },
    { id: "replications", label: "Tekrar", value: "30×", tone: "good", hint: "" },
  ];

  it("şeritte yalnızca fabrikaya ait göstergeler kalır", () => {
    const ids = operationalHealth(indicators).map((item) => item.id);
    expect(ids).toEqual(["stability", "scrap", "rejected", "balance"]);
  });

  it("koşuma ait göstergeler ayrı toplanır", () => {
    // Doğrulama ve tekrar, hattın değil koşumun niteliğini anlatır.
    expect(runQuality(indicators).map((item) => item.id)).toEqual([
      "validation",
      "replications",
    ]);
  });

  it("hiçbir gösterge kaybolmaz — ikisinin toplamı girdiye eşittir", () => {
    // Ayırma bir silme değildir; her gösterge iki kümeden birine düşer.
    expect(
      operationalHealth(indicators).length + runQuality(indicators).length,
    ).toBe(indicators.length);
  });

  it("gösterge değerleri ve tonları olduğu gibi kalır", () => {
    const stability = operationalHealth(indicators)[0];
    expect(stability.value).toBe("Kararlı");
    expect(stability.tone).toBe("good");
  });

  it("koşum satırı tekrar sayısını iki kez yazmaz", () => {
    // "30 tekrar" zaten güven satırında geçiyor; ikinci kez yazmak iki ayrı
    // ölçüm varmış izlenimi bırakırdı.
    const line = runQualityLine(indicators, "30 tekrar · %95 aralık 554 – 588");
    expect(line).toBe("30 tekrar · %95 aralık 554 – 588 · Doğrulama: Geçti");
    expect(line!.match(/tekrar/g)).toHaveLength(1);
    expect(line).not.toContain("30×");
  });

  it("doğrulama sonucu kararın yanında görünür", () => {
    // Şeritten çıktı ama ekrandan çıkmadı; başka hiçbir yerde yazılmıyor.
    expect(runQualityLine(indicators, null)).toBe("Doğrulama: Geçti");
  });

  it("geçmeyen doğrulama da aynı yerde yazılır", () => {
    const failed = indicators.map((item) =>
      item.id === "validation" ? { ...item, value: "Geçmedi" } : item,
    );
    expect(runQualityLine(failed, null)).toBe("Doğrulama: Geçmedi");
  });

  it("yazacak bir şey yoksa satır hiç çizilmez", () => {
    // Boş bir "Koşum:" etiketi, ölçüm varmış izlenimi bırakırdı (Yasa 4).
    expect(runQualityLine([], null)).toBeNull();
  });

  it("koşum yoksa şerit boş kalır, uydurulmuş gösterge üretilmez", () => {
    expect(operationalHealth([])).toEqual([]);
    expect(runQuality([])).toEqual([]);
  });
});

describe("tazelik cümlesi (Sprint 2F-E)", () => {
  it("bir günün altındaki koşumu göreli anlatır", () => {
    expect(freshnessLine({ text: "12 dk önce", isOlderThanADay: false })).toBe(
      "Son koşum 12 dk önce",
    );
  });

  it("eski koşuma yazılı bir eskilik notu ekler", () => {
    // "14 Eyl 16:00" tek başına bakışta eski olduğunu söylemez; okuyup bugünün
    // tarihiyle karşılaştırmayı gerektirir.
    expect(
      freshnessLine({ text: "14 Eyl 16:00", isOlderThanADay: true }),
    ).toBe("Son koşum 14 Eyl 16:00 · bir günden eski");
  });

  it("tazelik yoksa cümle uydurulmaz", () => {
    expect(freshnessLine(null)).toBeNull();
  });

  it("benzetim verisi için canlılık iddiası üretmez", () => {
    const line = freshnessLine({ text: "az önce", isOlderThanADay: false })!;
    expect(line).not.toMatch(/Canlı|Aktif|Şimdi/);
  });
});

describe("koşum satırında zaman (Sprint 2F-E)", () => {
  const indicators: HealthIndicator[] = [
    { id: "validation", label: "Doğrulama", value: "Geçti", tone: "good", hint: "" },
    { id: "replications", label: "Tekrar", value: "30×", tone: "good", hint: "" },
  ];

  it("zaman satırın başına gelir", () => {
    const line = runQualityLine(indicators, "30 tekrar", {
      text: "4 dk önce",
      isOlderThanADay: false,
    });
    expect(line).toBe("4 dk önce · 30 tekrar · Doğrulama: Geçti");
  });

  it("üstteki rozetin sözcüklerini yinelemez", () => {
    // Üstte "Son koşum 4 dk önce" yazıyor; burada satırın etiketi zaten
    // "KOŞUM" olduğu için aynı sözcükler ikinci kez yazılmaz.
    const line = runQualityLine(indicators, null, {
      text: "4 dk önce",
      isOlderThanADay: false,
    })!;
    expect(line).not.toContain("Son koşum");
  });

  it("eski koşum burada da eski işaretlenir", () => {
    const line = runQualityLine(indicators, null, {
      text: "14 Eyl 16:00",
      isOlderThanADay: true,
    });
    expect(line).toBe("14 Eyl 16:00 · bir günden eski · Doğrulama: Geçti");
  });

  it("tazelik verilmezse zaman uydurulmaz", () => {
    expect(runQualityLine(indicators, "30 tekrar")).toBe(
      "30 tekrar · Doğrulama: Geçti",
    );
  });

  it("hiçbir şey ölçülemiyorsa satır çizilmez", () => {
    expect(runQualityLine([], null, null)).toBeNull();
  });
});

describe("kapanış adımı (Yasa 5, Sprint 2F-E)", () => {
  const karar: ActionItem = {
    id: "bottleneck",
    priority: "critical",
    title: "Hat kararsız",
    detail: "Kuyruklar büyümeye devam ediyor.",
    target: "simulation",
    actionLabel: "Modeli aç",
  };
  const konu: ActionItem = {
    id: "scrap",
    priority: "warning",
    title: "Fire oranı yüksek",
    detail: "Fire eşiği aşıldı.",
    target: "inventory",
    actionLabel: "Envantere git",
  };

  it("kararın kendi eylemini ve hedefini kullanır", () => {
    // Yeni bir gezinme hedefi ya da yeni bir eylem etiketi üretilmez.
    const step = closingStep(karar, [konu])!;
    expect(step.actionLabel).toBe("Modeli aç");
    expect(step.target).toBe("simulation");
  });

  it("var olan önceliklendirmeyi cümleye çevirir", () => {
    const step = closingStep(karar, [konu])!;
    expect(step.text).toContain("Hat kararsız");
    expect(step.text).toContain("diğer konu bundan sonra gelir");
  });

  it("birden çok konuyu sayıyla anlatır", () => {
    const step = closingStep(karar, [konu, { ...konu, id: "buffer" }])!;
    expect(step.text).toContain("diğer 2 konu");
  });

  it("konu yoksa çizilmez — anlamsız yineleme olurdu", () => {
    // O durumda son blok zaten karar bloğudur ve birincil eylemle biter.
    expect(closingStep(karar, [])).toBeNull();
  });

  it("karar yoksa çizilmez", () => {
    expect(closingStep(null, [konu])).toBeNull();
  });

  it("uydurma öneri, para ya da aciliyet dili üretmez", () => {
    const step = closingStep(karar, [konu])!;
    expect(step.text).not.toMatch(/₺|\d+\s*TL/);
    expect(step.text).not.toMatch(/hemen|acele|kaçırma|tebrikler|yapay zekâ/i);
    // Metindeki tek sayı konu adedidir; yeni bir ölçüm iddiası yoktur.
    expect(step.text.match(/\d+/g)).toBeNull();
  });
});
