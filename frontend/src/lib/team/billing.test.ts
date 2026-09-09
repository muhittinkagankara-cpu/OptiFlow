import { describe, expect, it } from "vitest";
import {
  BILLING_NOTE,
  NEAR_LIMIT_RATIO,
  PLAN_LIMITS,
  isOverLimit,
  limitRow,
  limitRows,
  planCards,
  smallestFittingPlan,
  upgradeAvailability,
  type UsageSnapshot,
} from "./billing";
import { PLANS, PLAN_ORDER, monthlyFor } from "../sales";

function usage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return { users: 1, factories: 1, connectors: 0, ...overrides };
}

describe("PLAN_LIMITS", () => {
  it("her paket icin limit tanimlidir", () => {
    for (const id of PLAN_ORDER) {
      expect(PLAN_LIMITS[id]).toBeDefined();
    }
  });

  it("starter tek kullanicilidir", () => {
    expect(PLAN_LIMITS.starter.users).toBe(1);
  });

  it("growth starter'dan genistir", () => {
    expect(PLAN_LIMITS.growth.users).toBeGreaterThan(PLAN_LIMITS.starter.users ?? 0);
  });

  it("enterprise sinirsizdir ve bu sifirla gosterilmez", () => {
    // Sinirsiz `null`'dur; `0` yazsaydik "hic kullanici eklenemez" okunurdu.
    expect(PLAN_LIMITS.enterprise.users).toBeNull();
    expect(PLAN_LIMITS.enterprise.factories).toBeNull();
    expect(PLAN_LIMITS.enterprise.connectors).toBeNull();
  });
});

describe("limitRow", () => {
  it("sinirsiz limitte oran hesaplamaz", () => {
    const row = limitRow("users", 40, null);
    expect(row.status).toBe("unlimited");
    expect(row.ratio).toBeNull();
    expect(row.note).toBe("Sınırsız");
  });

  it("rahat kullanimda durum ok", () => {
    expect(limitRow("users", 2, 10).status).toBe("ok");
  });

  it("esik uzerinde sinira yaklasildi der", () => {
    expect(limitRow("users", 8, 10).status).toBe("near");
  });

  it("esik tam degerinde de uyarir", () => {
    expect(limitRow("factories", NEAR_LIMIT_RATIO * 10, 10).status).toBe("near");
  });

  it("limitte olmak asma sayilmaz", () => {
    expect(limitRow("users", 10, 10).status).toBe("near");
  });

  it("limit asilinca durum over", () => {
    expect(limitRow("users", 11, 10).status).toBe("over");
  });

  it("asilan limitte not sayilari yazar", () => {
    expect(limitRow("users", 11, 10).note).toBe("Limit aşıldı: 11/10");
  });

  it("normal durumda not kullanim/limit yazar", () => {
    expect(limitRow("connectors", 1, 5).note).toBe("1/5");
  });

  it("oran 0-1 arasina sikistirilir", () => {
    expect(limitRow("users", 40, 10).ratio).toBe(1);
  });

  it("sifir limitte oran tamdir", () => {
    // Bolme hatasi yerine dolu kabul edilir.
    expect(limitRow("users", 0, 0).ratio).toBe(1);
  });

  it("etiket Turkce yazilir", () => {
    expect(limitRow("connectors", 1, 5).label).toBe("Veri kaynağı");
  });
});

describe("limitRows", () => {
  it("uc satir doner", () => {
    expect(limitRows("growth", usage())).toHaveLength(3);
  });

  it("satir sirasi kullanici, fabrika, veri kaynagidir", () => {
    expect(limitRows("growth", usage()).map((row) => row.key)).toEqual([
      "users",
      "factories",
      "connectors",
    ]);
  });

  it("enterprise'ta hepsi sinirsizdir", () => {
    expect(
      limitRows("enterprise", usage({ users: 500 })).every(
        (row) => row.status === "unlimited",
      ),
    ).toBe(true);
  });
});

describe("isOverLimit", () => {
  it("tek kisilik kullanim starter'a sigar", () => {
    expect(isOverLimit("starter", usage())).toBe(false);
  });

  it("iki kullanici starter'i asar", () => {
    expect(isOverLimit("starter", usage({ users: 2 }))).toBe(true);
  });

  it("fabrika sayisi da limit asabilir", () => {
    expect(isOverLimit("starter", usage({ factories: 3 }))).toBe(true);
  });

  it("veri kaynagi da limit asabilir", () => {
    expect(isOverLimit("growth", usage({ connectors: 9 }))).toBe(true);
  });

  it("enterprise hicbir kullanimda asilmaz", () => {
    expect(isOverLimit("enterprise", usage({ users: 9_999, factories: 500 }))).toBe(false);
  });
});

describe("smallestFittingPlan", () => {
  it("tek kisilik kullanimda starter onerilir", () => {
    expect(smallestFittingPlan(usage())).toBe("starter");
  });

  it("dort kullanicida growth onerilir", () => {
    expect(smallestFittingPlan(usage({ users: 4 }))).toBe("growth");
  });

  it("cok buyuk kullanimda enterprise onerilir", () => {
    expect(smallestFittingPlan(usage({ users: 60, factories: 12 }))).toBe("enterprise");
  });

  it("tek bir kaynagin asilmasi paketi buyutur", () => {
    expect(smallestFittingPlan(usage({ connectors: 3 }))).toBe("growth");
  });
});

describe("planCards", () => {
  it("her paket icin bir kart doner", () => {
    expect(planCards("starter", usage(), 10)).toHaveLength(PLAN_ORDER.length);
  });

  it("aylik ucret satis katmaniyla ayni formulden gelir", () => {
    // Ikinci bir fiyat listesi tutulsaydi teklifle urun ayrisirdi.
    const cards = planCards("starter", usage(), 12);
    for (const card of cards) {
      expect(card.monthly).toBe(monthlyFor(card.id, 12));
    }
  });

  it("makine sayisi arttikca fiyat artar", () => {
    const az = planCards("growth", usage(), 5)[1].monthly;
    const cok = planCards("growth", usage(), 25)[1].monthly;
    expect(cok).toBeGreaterThan(az);
  });

  it("kurulum ucreti paket tanimindan gelir", () => {
    expect(planCards("starter", usage(), 0)[0].setupFee).toBe(PLANS.starter.setupFee);
  });

  it("mevcut paket isaretlenir", () => {
    const cards = planCards("growth", usage(), 10);
    expect(cards.filter((card) => card.isCurrent).map((card) => card.id)).toEqual([
      "growth",
    ]);
  });

  it("mevcut paket yeterliyse oneri gosterilmez", () => {
    const cards = planCards("starter", usage(), 10);
    expect(cards.some((card) => card.isRecommended)).toBe(false);
  });

  it("kullanim buyudugunde bir ust paket onerilir", () => {
    const cards = planCards("starter", usage({ users: 6 }), 10);
    expect(cards.find((card) => card.isRecommended)?.id).toBe("growth");
  });

  it("kucuk paketin kullanimi tasiyamadigi yazilir", () => {
    const cards = planCards("starter", usage({ users: 6 }), 10);
    expect(cards[0].fitsUsage).toBe(false);
    expect(cards[2].fitsUsage).toBe(true);
  });

  it("ozellik listesi paket tanimindan gelir", () => {
    expect(planCards("starter", usage(), 0)[0].features).toEqual(PLANS.starter.features);
  });
});

describe("upgradeAvailability", () => {
  it("odeme saglayicisi bagli olmadigi icin yukseltme kapalidir", () => {
    // Stripe ya da baska bir saglayici bagli degil; dugme bir sey satin almaz.
    expect(upgradeAvailability().available).toBe(false);
  });

  it("neden tek yerden okunur", () => {
    expect(upgradeAvailability().reason).toBe(BILLING_NOTE);
  });

  it("not odeme saglayicisinin bagli olmadigini soyler", () => {
    expect(BILLING_NOTE).toContain("Ödeme sağlayıcısı bağlı değil");
  });
});
