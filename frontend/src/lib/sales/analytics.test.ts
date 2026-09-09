import { describe, expect, it } from "vitest";
import {
  averageWonMonthly,
  conversionFunnel,
  hasReached,
  monthlyWonRevenue,
  reachedCount,
} from "./analytics";
import { sampleLeads } from "./fixtures";
import type { Lead, LeadStage } from "./types";

const NOW = new Date("2026-09-05T09:00:00");

function lead(id: string, stage: LeadStage, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    company: `Firma ${id}`,
    sector: "Metal",
    city: "İstanbul",
    contactName: "Yetkili",
    phone: "0500 000 00 00",
    email: "test@example.com",
    machineCount: 10,
    employeeCount: 30,
    note: "",
    stage,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    demo: null,
    wonMonthly: null,
    ...overrides,
  };
}

describe("hasReached", () => {
  it("kazanilmis kayit her duraktan gecmis sayilir", () => {
    // Kanban sutunundaki kart adedi kullanilsaydi, kazanilmis bir firma
    // "demo yapildi" sayisina girmez ve donusum sahte bicimde duserdi.
    const won = lead("a", "won");
    expect(hasReached(won, "new")).toBe(true);
    expect(hasReached(won, "demo")).toBe(true);
    expect(hasReached(won, "won")).toBe(true);
  });

  it("yeni kayit sonraki duraklara ulasmamistir", () => {
    const fresh = lead("a", "new");
    expect(hasReached(fresh, "new")).toBe(true);
    expect(hasReached(fresh, "demo")).toBe(false);
  });
});

describe("reachedCount", () => {
  it("duraga ulasmis kayitlari sayar", () => {
    const leads = [
      lead("a", "new"),
      lead("b", "demo"),
      lead("c", "won"),
    ];
    expect(reachedCount(leads, "new")).toBe(3);
    expect(reachedCount(leads, "demo")).toBe(2);
    expect(reachedCount(leads, "won")).toBe(1);
  });
});

describe("conversionFunnel", () => {
  it("uc adim uretir", () => {
    const funnel = conversionFunnel(sampleLeads(NOW));
    expect(funnel.map((step) => step.label)).toEqual([
      "Lead → Demo",
      "Demo → Teklif",
      "Teklif → Kazanıldı",
    ]);
  });

  it("bos hatta oranlari null birakir", () => {
    // Sifir gostermek, olcum yapilmadigi halde "hic donusmedi" demek olurdu.
    for (const step of conversionFunnel([])) {
      expect(step.rate).toBeNull();
      expect(step.fromCount).toBe(0);
    }
  });

  it("orani dogru hesaplar", () => {
    const leads = [
      lead("a", "new"),
      lead("b", "new"),
      lead("c", "demo"),
      lead("d", "demo"),
    ];
    // Dordunun hepsi "new"e ulasti, ikisi "demo"ya → %50
    const funnel = conversionFunnel(leads);
    expect(funnel[0].fromCount).toBe(4);
    expect(funnel[0].toCount).toBe(2);
    expect(funnel[0].rate).toBeCloseTo(0.5, 6);
  });

  it("oran hicbir zaman biri asmaz", () => {
    for (const step of conversionFunnel(sampleLeads(NOW))) {
      if (step.rate !== null) {
        expect(step.rate).toBeGreaterThanOrEqual(0);
        expect(step.rate).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("monthlyWonRevenue", () => {
  it("istenen ay sayisi kadar kova uretir", () => {
    const months = monthlyWonRevenue([], NOW, 6);
    expect(months).toHaveLength(6);
    expect(months[months.length - 1].month).toBe("2026-09");
  });

  it("kayitsiz ayi sifir gosterir", () => {
    // Burada sifir bir olcumdur: o ay hicbir anlasma kazanilmamistir.
    const months = monthlyWonRevenue([], NOW, 3);
    expect(months.every((item) => item.monthlyRevenue === 0)).toBe(true);
    expect(months.every((item) => item.wonCount === 0)).toBe(true);
  });

  it("kazanma ayini kapanis tarihinden alir", () => {
    // Kaydin acildigi ay degil, anlasmanin kapandigi ay.
    const won = lead("a", "won", {
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      wonMonthly: 10_000,
    });
    const months = monthlyWonRevenue([won], NOW, 6);
    const august = months.find((item) => item.month === "2026-08");
    expect(august?.monthlyRevenue).toBe(10_000);
    expect(august?.wonCount).toBe(1);
    // Kaydın açıldığı ay (Mayıs) pencerede var ama geliri yok.
    const may = months.find((item) => item.month === "2026-05");
    expect(may?.monthlyRevenue).toBe(0);
    expect(may?.wonCount).toBe(0);
  });

  it("pencere disinda kapanani saymaz", () => {
    const old = lead("a", "won", {
      updatedAt: "2025-01-10T00:00:00.000Z",
      wonMonthly: 99_000,
    });
    const months = monthlyWonRevenue([old], NOW, 6);
    expect(months.reduce((sum, item) => sum + item.monthlyRevenue, 0)).toBe(0);
  });

  it("kazanilmamis kaydi saymaz", () => {
    const sent = lead("a", "sent", { wonMonthly: 50_000 });
    const months = monthlyWonRevenue([sent], NOW, 6);
    expect(months.reduce((sum, item) => sum + item.wonCount, 0)).toBe(0);
  });

  it("gecersiz tarihte cokmez", () => {
    const broken = lead("a", "won", { updatedAt: "bozuk", wonMonthly: 1_000 });
    expect(() => monthlyWonRevenue([broken], NOW, 6)).not.toThrow();
  });

  it("aylari eskiden yeniye siralar", () => {
    const months = monthlyWonRevenue([], NOW, 4);
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i].month > months[i - 1].month).toBe(true);
    }
  });
});

describe("averageWonMonthly", () => {
  it("hic kazanilmamissa null doner", () => {
    // Sifir gostermek "ortalama sifir lira" demek olurdu.
    expect(averageWonMonthly([lead("a", "demo")])).toBeNull();
  });

  it("kazanilan anlasmalarin ortalamasini verir", () => {
    const leads = [
      lead("a", "won", { wonMonthly: 10_000 }),
      lead("b", "won", { wonMonthly: 20_000 }),
      lead("c", "demo"),
    ];
    expect(averageWonMonthly(leads)).toBe(15_000);
  });
});
