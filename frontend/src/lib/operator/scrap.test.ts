import { describe, expect, it } from "vitest";
import { SCRAP_CRITICAL, collectScrap, scrapSummary } from "./scrap";
import { scrapEntry, task } from "./fixtures";

describe("scrapSummary", () => {
  it("hurda yokken oran sifir ve ton iyidir", () => {
    const summary = scrapSummary([], 100);
    expect(summary.total).toBe(0);
    expect(summary.rate).toBe(0);
    expect(summary.tone).toBe("good");
    expect(summary.byReason).toEqual([]);
  });

  it("hic parca islenmemisse oran null kalir", () => {
    // "%0 fire" demek, olcum yapilmadigi halde iyi sonuc bildirmek olurdu.
    const summary = scrapSummary([], 0);
    expect(summary.rate).toBeNull();
    expect(summary.tone).toBe("neutral");
  });

  it("orani islenen toplam uzerinden hesaplar", () => {
    // 10 hurda / (90 saglam + 10 hurda) = %10
    const summary = scrapSummary([scrapEntry("burr", 10)], 90);
    expect(summary.total).toBe(10);
    expect(summary.rate).toBeCloseTo(0.1, 6);
  });

  it("yuksek fireyi kotu olarak isaretler", () => {
    const summary = scrapSummary([scrapEntry("scratch", 30)], 70);
    expect(summary.rate).toBeGreaterThanOrEqual(SCRAP_CRITICAL);
    expect(summary.tone).toBe("bad");
  });

  it("esik arasindaki fireyi uyari sayar", () => {
    // %6: uyari esiginin ustunde, kritik esigin altinda.
    const summary = scrapSummary([scrapEntry("other", 6)], 94);
    expect(summary.tone).toBe("warning");
  });

  it("nedenleri buyukten kucuge siralar ve paylarini verir", () => {
    const summary = scrapSummary(
      [
        scrapEntry("burr", 2),
        scrapEntry("dimension", 6),
        scrapEntry("scratch", 2),
      ],
      90,
    );
    expect(summary.byReason.map((item) => item.reason)).toEqual([
      "dimension",
      "burr",
      "scratch",
    ]);
    expect(summary.byReason[0].share).toBeCloseTo(0.6, 6);
    expect(summary.byReason[0].label).toBe("Ölçü Hatası");
  });

  it("girilmemis nedenleri listelemez", () => {
    const summary = scrapSummary([scrapEntry("burr", 3)], 50);
    expect(summary.byReason).toHaveLength(1);
  });

  it("ayni nedenin birden fazla kaydini toplar", () => {
    const summary = scrapSummary(
      [scrapEntry("burr", 3, { id: "s1" }), scrapEntry("burr", 4, { id: "s2" })],
      50,
    );
    expect(summary.byReason[0].quantity).toBe(7);
  });

  it("fotograf sayilarini toplar", () => {
    const summary = scrapSummary(
      [
        scrapEntry("burr", 1, { photoCount: 2 }),
        scrapEntry("other", 1, { photoCount: 1 }),
      ],
      10,
    );
    expect(summary.photoCount).toBe(3);
  });

  it("ilk parca hurdaysa oran yuzde yuzdur", () => {
    const summary = scrapSummary([scrapEntry("burr", 1)], 0);
    expect(summary.rate).toBe(1);
    expect(summary.tone).toBe("bad");
  });
});

describe("collectScrap", () => {
  it("tum gorevlerin kayitlarini tek listede toplar", () => {
    const entries = collectScrap([
      task("a", { scrap: [scrapEntry("burr", 1)] }),
      task("b", { scrap: [scrapEntry("other", 2)] }),
      task("c"),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("gorev yoksa bos doner", () => {
    expect(collectScrap([])).toEqual([]);
  });
});
