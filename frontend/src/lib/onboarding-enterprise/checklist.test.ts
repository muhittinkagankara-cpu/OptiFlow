import { describe, expect, it } from "vitest";
import {
  STEP_VIEW,
  buildChecklist,
  buildGuide,
  completedCount,
  fitsBudget,
  guideSummary,
  guideTotalMinutes,
  lastCompleted,
  nextItem,
  progressRatio,
  remainingMinutes,
} from "./checklist";
import { buildReadiness } from "./readiness";
import {
  completedSignals,
  completedState,
  emptySignals,
  emptyState,
  sampleState,
} from "./fixtures";
import {
  GUIDE_BUDGET_MINUTES,
  STEP_MINUTES,
  STEP_ORDER,
  type ChecklistItem,
} from "./types";

const EMPTY = buildChecklist(buildReadiness(emptyState(), emptySignals()));
const PARTIAL = buildChecklist(
  buildReadiness(sampleState(), { ...emptySignals(), savedFactoryCount: 1 }),
);
const DONE = buildChecklist(buildReadiness(completedState(), completedSignals()));

describe("buildChecklist", () => {
  it("yedi madde uretir ve sira akisla aynidir", () => {
    expect(EMPTY.map((item) => item.id)).toEqual(STEP_ORDER);
  });

  it("her madde bir ekrana baglidir", () => {
    for (const item of EMPTY) {
      expect(item.view).toBe(STEP_VIEW[item.id]);
      expect(item.view).not.toBe("");
    }
  });

  it("her maddenin sure tahmini vardir", () => {
    for (const item of EMPTY) {
      expect(item.minutes).toBe(STEP_MINUTES[item.id]);
    }
  });

  it("tamamlanma bilgisini hazirlik raporundan alir", () => {
    // Ikinci bir tamamlanma kaynagi olsaydi kart ile puan tablosu ayrisirdi.
    const report = buildReadiness(completedState(), completedSignals());
    const items = buildChecklist(report);
    for (const category of report.categories) {
      const item = items.find((entry) => entry.id === category.id);
      expect(item?.done).toBe(category.complete);
    }
  });

  it("ipucu metnini kategoriden tasir", () => {
    expect(EMPTY[0].hint).toContain("Şirket adı");
  });

  it("bos kurulumda hicbir madde tamamlanmamistir", () => {
    expect(EMPTY.every((item) => !item.done)).toBe(true);
  });

  it("tamamlanmis kurulumda hepsi bitmistir", () => {
    expect(DONE.every((item) => item.done)).toBe(true);
  });
});

describe("completedCount / progressRatio", () => {
  it("tamamlanan sayisini verir", () => {
    expect(completedCount(EMPTY)).toBe(0);
    expect(completedCount(DONE)).toBe(DONE.length);
  });

  it("orani hesaplar", () => {
    expect(progressRatio(DONE)).toBe(1);
    expect(progressRatio(EMPTY)).toBe(0);
  });

  it("madde yoksa sifir degil bos doner", () => {
    // Sifir "hicbiri tamamlanmadi" demektir; madde yokken bu yanlis olurdu.
    expect(progressRatio([])).toBeNull();
  });

  it("yarim kurulumda oran arada kalir", () => {
    const ratio = progressRatio(PARTIAL) ?? 0;
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

describe("nextItem / lastCompleted", () => {
  it("siradaki tamamlanmamis maddeyi verir", () => {
    expect(nextItem(EMPTY)?.id).toBe("company");
  });

  it("tamamlanmislar atlanir", () => {
    expect(nextItem(PARTIAL)?.done).toBe(false);
  });

  it("hepsi bittiyse bos doner", () => {
    expect(nextItem(DONE)).toBeNull();
  });

  it("son tamamlanani bulur", () => {
    expect(lastCompleted(PARTIAL)?.done).toBe(true);
  });

  it("hic tamamlanan yoksa bos doner", () => {
    expect(lastCompleted(EMPTY)).toBeNull();
  });
});

describe("remainingMinutes", () => {
  it("kalan adimlarin suresini toplar", () => {
    expect(remainingMinutes(EMPTY)).toBe(guideTotalMinutes(EMPTY));
  });

  it("tamamlanan adimlar sayilmaz", () => {
    expect(remainingMinutes(DONE)).toBe(0);
  });

  it("yarim kurulumda toplamdan kucuktur", () => {
    expect(remainingMinutes(PARTIAL)).toBeLessThan(guideTotalMinutes(PARTIAL));
  });
});

describe("buildGuide", () => {
  const guide = buildGuide(EMPTY);

  it("her adim icin birikimli sure hesaplar", () => {
    expect(guide[0].cumulativeMinutes).toBe(EMPTY[0].minutes);
    expect(guide[guide.length - 1].cumulativeMinutes).toBe(
      guideTotalMinutes(EMPTY),
    );
  });

  it("birikimli sure monoton artar", () => {
    for (let index = 1; index < guide.length; index += 1) {
      expect(guide[index].cumulativeMinutes).toBeGreaterThan(
        guide[index - 1].cumulativeMinutes,
      );
    }
  });

  it("butceyi asan adimi isaretler", () => {
    // 30 dakika sozu tutulamiyorsa gizlemek yerine gostermek gerekir.
    const tight = buildGuide(EMPTY, 5);
    expect(tight[0].withinBudget).toBe(true);
    expect(tight[tight.length - 1].withinBudget).toBe(false);
  });

  it("varsayilan butcede tum adimlar siga", () => {
    expect(guide.every((step) => step.withinBudget)).toBe(true);
  });

  it("kontrol listesi alanlarini korur", () => {
    expect(guide[0].label).toBe(EMPTY[0].label);
    expect(guide[0].view).toBe(EMPTY[0].view);
  });
});

describe("fitsBudget / guideTotalMinutes", () => {
  it("toplam sure otuz dakikayi asmaz", () => {
    // "Ilk 30 dakikada kurulum" sozu, adim sureleri tutmuyorsa bos bir slogandir.
    expect(guideTotalMinutes(EMPTY)).toBeLessThanOrEqual(GUIDE_BUDGET_MINUTES);
    expect(fitsBudget(EMPTY)).toBe(true);
  });

  it("dar butcede sigmadigini soyler", () => {
    expect(fitsBudget(EMPTY, 5)).toBe(false);
  });
});

describe("guideSummary", () => {
  it("yarim kurulumda tamamlanan ve kalan sureyi yazar", () => {
    const summary = guideSummary(PARTIAL);
    expect(summary).toContain("adımdan");
    expect(summary).toContain("dakika");
  });

  it("bitmis kurulumda canliya cagirir", () => {
    expect(guideSummary(DONE)).toContain("canlı bağlantıya");
  });

  it("bos listede coker degil", () => {
    const items: ChecklistItem[] = [];
    expect(guideSummary(items)).toContain("0 adımdan");
  });
});
