import { describe, expect, it } from "vitest";
import {
  BAND_THRESHOLDS,
  EXPECTED_MACHINES,
  READINESS_WEIGHTS,
  bandLabel,
  bandOf,
  buildReadiness,
  highestImpactStep,
  isSetupComplete,
  missingCategories,
  nextStepOf,
} from "./readiness";
import {
  completedSignals,
  completedState,
  emptySignals,
  emptyState,
  sampleCompany,
  sampleMachines,
  sampleState,
} from "./fixtures";
import { STEP_ORDER, type EnterpriseState, type ReadinessSignals } from "./types";

function state(overrides: Partial<EnterpriseState> = {}): EnterpriseState {
  return { ...sampleState(), ...overrides };
}

function signals(overrides: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return { ...emptySignals(), ...overrides };
}

describe("READINESS_WEIGHTS", () => {
  it("toplami yuz eder", () => {
    const total = Object.values(READINESS_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it("kanita dayali kategoriler agirligin yarisindan fazlasini tasir", () => {
    // Sirket adini yazarak %100 hazir gorunmek mumkun olmamali.
    const evidence =
      READINESS_WEIGHTS.simulation +
      READINESS_WEIGHTS.validation +
      READINESS_WEIGHTS.report +
      READINESS_WEIGHTS.connectors;
    expect(evidence).toBeGreaterThan(50);
  });

  it("her adimin bir agirligi vardir", () => {
    for (const step of STEP_ORDER) {
      expect(READINESS_WEIGHTS[step]).toBeGreaterThan(0);
    }
  });
});

describe("bandOf", () => {
  it("esiklere gore band verir", () => {
    expect(bandOf(BAND_THRESHOLDS.green)).toBe("green");
    expect(bandOf(BAND_THRESHOLDS.blue)).toBe("blue");
    expect(bandOf(BAND_THRESHOLDS.orange)).toBe("orange");
    expect(bandOf(BAND_THRESHOLDS.orange - 1)).toBe("red");
  });

  it("sifir kirmizidir", () => {
    expect(bandOf(0)).toBe("red");
  });

  it("tam puan yesildir", () => {
    expect(bandOf(100)).toBe("green");
  });

  it("her bandin bir etiketi vardir", () => {
    expect(bandLabel("green")).toContain("hazır");
    expect(bandLabel("red")).toContain("başlamadı");
  });
});

describe("buildReadiness — boş kurulum", () => {
  const report = buildReadiness(emptyState(), emptySignals());

  it("puan sifirdir", () => {
    expect(report.total).toBe(0);
    expect(report.band).toBe("red");
  });

  it("yedi kategori uretir ve sirasi sabittir", () => {
    expect(report.categories.map((category) => category.id)).toEqual(STEP_ORDER);
  });

  it("hicbir kategori tamamlanmamistir", () => {
    expect(report.categories.every((category) => !category.complete)).toBe(true);
  });

  it("eksiklerin nedenini yazar", () => {
    expect(report.categories[0].detail).toContain("Şirket adı");
    expect(
      report.categories.find((category) => category.id === "machines")?.detail,
    ).toContain("envanteri boş");
  });

  it("siradaki adimi onerir", () => {
    expect(report.nextStep).not.toBeNull();
  });
});

describe("buildReadiness — şirket kategorisi", () => {
  it("yalnizca ad girilince kismi puan verir", () => {
    const report = buildReadiness(
      state({
        company: { name: "A", logoDataUrl: null, sector: "", factoryCount: null, currency: "" },
      }),
      emptySignals(),
    );
    const company = report.categories[0];
    expect(company.earned).toBeGreaterThan(0);
    expect(company.earned).toBeLessThan(company.weight);
    expect(company.complete).toBe(false);
  });

  it("logo, sektor ve para birimi tam puani verir", () => {
    const report = buildReadiness(
      state({ company: { ...sampleCompany(), logoDataUrl: "data:image/png;base64,x" } }),
      emptySignals(),
    );
    const company = report.categories[0];
    expect(company.earned).toBe(company.weight);
    expect(company.complete).toBe(true);
  });

  it("bosluktan ibaret ad sayilmaz", () => {
    const report = buildReadiness(
      state({ company: { ...sampleCompany(), name: "   " } }),
      emptySignals(),
    );
    expect(report.categories[0].earned).toBe(0);
  });
});

describe("buildReadiness — fabrika kategorisi", () => {
  it("kaydedilmemis fabrika yarim puan alir", () => {
    const report = buildReadiness(sampleState(), emptySignals());
    const factory = report.categories.find((c) => c.id === "factory");
    expect(factory?.earned).toBeGreaterThan(0);
    expect(factory?.complete).toBe(false);
    expect(factory?.detail).toContain("kaydedilmedi");
  });

  it("sunucuya kaydedilmis fabrika tam puan alir", () => {
    const report = buildReadiness(sampleState(), signals({ savedFactoryCount: 1 }));
    const factory = report.categories.find((c) => c.id === "factory");
    expect(factory?.earned).toBe(READINESS_WEIGHTS.factory);
    expect(factory?.complete).toBe(true);
  });

  it("hic fabrika yoksa sifirdir", () => {
    const report = buildReadiness(state({ factories: [] }), emptySignals());
    expect(report.categories.find((c) => c.id === "factory")?.earned).toBe(0);
  });
});

describe("buildReadiness — makine kategorisi", () => {
  it("makine sayisiyla puan artar", () => {
    const few = buildReadiness(state({ machines: sampleMachines().slice(0, 1) }), emptySignals());
    const many = buildReadiness(state({ machines: sampleMachines() }), emptySignals());
    const earnedFew = few.categories.find((c) => c.id === "machines")?.earned ?? 0;
    const earnedMany = many.categories.find((c) => c.id === "machines")?.earned ?? 0;
    expect(earnedMany).toBeGreaterThan(earnedFew);
  });

  it("seri numarasi eksikse tam puan vermez", () => {
    const machines = Array.from({ length: EXPECTED_MACHINES }, (_, index) => ({
      ...sampleMachines()[0],
      id: `m${index}`,
      serialNumber: index === 0 ? null : `SN-${index}`,
    }));
    const report = buildReadiness(state({ machines }), emptySignals());
    const category = report.categories.find((c) => c.id === "machines");
    expect(category?.complete).toBe(false);
    expect(category?.detail).toContain("seri numarası eksik");
  });

  it("beklenen sayida ve tam kayitli envanter tam puan alir", () => {
    const machines = Array.from({ length: EXPECTED_MACHINES }, (_, index) => ({
      ...sampleMachines()[0],
      id: `m${index}`,
      serialNumber: `SN-${index}`,
    }));
    const report = buildReadiness(state({ machines }), emptySignals());
    const category = report.categories.find((c) => c.id === "machines");
    expect(category?.earned).toBe(READINESS_WEIGHTS.machines);
    expect(category?.complete).toBe(true);
  });

  it("beklenenden fazla makine puani asmaz", () => {
    const machines = Array.from({ length: EXPECTED_MACHINES * 3 }, (_, index) => ({
      ...sampleMachines()[0],
      id: `m${index}`,
      serialNumber: `SN-${index}`,
    }));
    const report = buildReadiness(state({ machines }), emptySignals());
    expect(report.categories.find((c) => c.id === "machines")?.earned).toBe(
      READINESS_WEIGHTS.machines,
    );
  });
});

describe("buildReadiness — kanıta dayalı kategoriler", () => {
  it("kosum yoksa simulasyon puani sifirdir", () => {
    const report = buildReadiness(sampleState(), emptySignals());
    expect(report.categories.find((c) => c.id === "simulation")?.earned).toBe(0);
  });

  it("kosum varsa tam puan verir", () => {
    const report = buildReadiness(sampleState(), signals({ hasSimulationRun: true }));
    const category = report.categories.find((c) => c.id === "simulation");
    expect(category?.earned).toBe(READINESS_WEIGHTS.simulation);
    expect(category?.detail).toContain("çalıştırıldı");
  });

  it("dogrulama olcumu tam puan verir", () => {
    const report = buildReadiness(sampleState(), signals({ validationCount: 1 }));
    expect(report.categories.find((c) => c.id === "validation")?.complete).toBe(true);
  });

  it("ikinci dogrulama puani artirmaz", () => {
    const one = buildReadiness(sampleState(), signals({ validationCount: 1 }));
    const two = buildReadiness(sampleState(), signals({ validationCount: 5 }));
    expect(one.categories.find((c) => c.id === "validation")?.earned).toBe(
      two.categories.find((c) => c.id === "validation")?.earned,
    );
  });

  it("rapor indirilmediyse puan yoktur", () => {
    const report = buildReadiness(sampleState(), completedSignals());
    expect(report.categories.find((c) => c.id === "report")?.earned).toBe(0);
  });

  it("rapor indirildiyse tam puan verir", () => {
    const report = buildReadiness(completedState(), completedSignals());
    expect(report.categories.find((c) => c.id === "report")?.earned).toBe(
      READINESS_WEIGHTS.report,
    );
  });

  it("baglayici puani bagli oranina gore artar", () => {
    const half = buildReadiness(
      sampleState(),
      signals({ connectorCount: 4, connectedCount: 2 }),
    );
    const full = buildReadiness(
      sampleState(),
      signals({ connectorCount: 4, connectedCount: 4 }),
    );
    const earnedHalf = half.categories.find((c) => c.id === "connectors")?.earned ?? 0;
    const earnedFull = full.categories.find((c) => c.id === "connectors")?.earned ?? 0;
    expect(earnedFull).toBeGreaterThan(earnedHalf);
    expect(earnedFull).toBe(READINESS_WEIGHTS.connectors);
  });

  it("baglayici aciklamasi benzetim oldugunu yazar", () => {
    const report = buildReadiness(
      sampleState(),
      signals({ connectorCount: 2, connectedCount: 1 }),
    );
    expect(report.categories.find((c) => c.id === "connectors")?.detail).toContain(
      "benzetim",
    );
  });
});

describe("buildReadiness — tamamlanmış kurulum", () => {
  const report = buildReadiness(completedState(), completedSignals());

  it("tam puan verir", () => {
    expect(report.total).toBe(100);
    expect(report.band).toBe("green");
  });

  it("siradaki adim kalmaz", () => {
    expect(report.nextStep).toBeNull();
    expect(isSetupComplete(report)).toBe(true);
    expect(missingCategories(report)).toEqual([]);
  });
});

describe("nextStepOf", () => {
  it("bos kurulumda ilk adimdan baslar", () => {
    // Tarayicida gorulen hata: agirliga gore secim, hic kurulum yapmamis
    // kullaniciyi sihirbazin ucuncu adimina atiyordu.
    expect(buildReadiness(emptyState(), emptySignals()).nextStep).toBe("company");
  });

  it("tamamlanan adimlari atlar", () => {
    const report = buildReadiness(completedState(), {
      ...completedSignals(),
      hasSimulationRun: false,
      validationCount: 0,
    });
    expect(report.nextStep).toBe("simulation");
  });

  it("akis sirasini korur", () => {
    const categories = [
      { id: "report" as const, label: "b", weight: 10, earned: 0, detail: "", complete: false },
      { id: "company" as const, label: "a", weight: 10, earned: 0, detail: "", complete: false },
    ];
    expect(nextStepOf(categories)).toBe("company");
  });

  it("hepsi tamamsa bos doner", () => {
    expect(
      nextStepOf([
        { id: "company", label: "a", weight: 10, earned: 10, detail: "", complete: true },
      ]),
    ).toBeNull();
  });
});

describe("highestImpactStep", () => {
  it("puani en cok artiracak adimi verir", () => {
    const report = buildReadiness(emptyState(), emptySignals());
    // Makineler ve simulasyon 20'ser puan; esitlikte akis sirasi kazanir.
    expect(highestImpactStep(report.categories)).toBe("machines");
  });

  it("hepsi tamamsa bos doner", () => {
    const report = buildReadiness(completedState(), completedSignals());
    expect(highestImpactStep(report.categories)).toBeNull();
  });
});
