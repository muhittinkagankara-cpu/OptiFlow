import { describe, expect, it } from "vitest";
import { buildShiftSummary } from "./shift";
import { scrapEntry, task } from "./fixtures";

describe("buildShiftSummary", () => {
  it("gorev yokken kutlama yapmaz", () => {
    const summary = buildShiftSummary([]);
    expect(summary.taskCount).toBe(0);
    expect(summary.allDone).toBe(false);
    expect(summary.yieldRate).toBeNull();
    expect(summary.headline).toContain("görev atanmamış");
  });

  it("tum gorevler bittiginde tebrik eder", () => {
    const summary = buildShiftSummary([
      task("a", { status: "done", completedQuantity: 100 }),
      task("b", { status: "done", completedQuantity: 80 }),
    ]);
    expect(summary.allDone).toBe(true);
    expect(summary.produced).toBe(180);
    expect(summary.headline).toContain("Tebrikler");
  });

  it("fire yuksekken kutlamaz", () => {
    // Yuksek fireli bir vardiyayi kutlamak, yanlis geri bildirim olurdu.
    const summary = buildShiftSummary([
      task("a", {
        status: "done",
        completedQuantity: 70,
        scrap: [scrapEntry("burr", 30)],
      }),
    ]);
    expect(summary.allDone).toBe(true);
    expect(summary.tone).toBe("bad");
    expect(summary.headline).not.toContain("Tebrikler");
    expect(summary.headline).toContain("fire");
  });

  it("yarim vardiyada fire uyarisi verirken 'tamamlandi' demez", () => {
    // Dortte biri bitmis bir vardiyaya "tamamlandi" demek, operatorun kalan
    // isleri unutmasina yol acardi.
    const summary = buildShiftSummary([
      task("a", {
        status: "done",
        completedQuantity: 70,
        scrap: [scrapEntry("burr", 30)],
      }),
      task("b", { status: "pending" }),
    ]);
    expect(summary.allDone).toBe(false);
    expect(summary.tone).toBe("bad");
    expect(summary.headline).toBe("Fire oranı yüksek.");
  });

  it("hurda sifirken verim tamdir", () => {
    const summary = buildShiftSummary([
      task("a", { status: "done", completedQuantity: 50 }),
    ]);
    expect(summary.scrapped).toBe(0);
    expect(summary.yieldRate).toBe(1);
    expect(summary.tone).toBe("good");
  });

  it("verimi islenen toplam uzerinden hesaplar", () => {
    // 90 saglam / (90 + 10) = %90
    const summary = buildShiftSummary([
      task("a", {
        status: "done",
        completedQuantity: 90,
        scrap: [scrapEntry("scratch", 10)],
      }),
    ]);
    expect(summary.yieldRate).toBeCloseTo(0.9, 6);
  });

  it("yarim kalan isin uretimini de sayar", () => {
    // Yarim kalan iste uretilen parcalar da gercekten uretilmistir.
    const summary = buildShiftSummary([
      task("a", { status: "active", completedQuantity: 25 }),
      task("b", { status: "pending" }),
    ]);
    expect(summary.produced).toBe(25);
    expect(summary.completedCount).toBe(0);
    expect(summary.headline).toContain("devam ediyor");
  });

  it("kismen bitmis vardiyada kalanlari hatirlatir", () => {
    const summary = buildShiftSummary([
      task("a", { status: "done", completedQuantity: 10 }),
      task("b", { status: "pending" }),
    ]);
    expect(summary.completedCount).toBe(1);
    expect(summary.detail).toContain("1 görev tamamlandı");
  });

  it("calisma suresini dakikaya cevirir", () => {
    const summary = buildShiftSummary([
      task("a", { workedSeconds: 1800 }),
      task("b", { workedSeconds: 900 }),
    ]);
    expect(summary.workedMinutes).toBeCloseTo(45, 6);
  });

  it("hicbir sey uretilmemisse verim null kalir", () => {
    const summary = buildShiftSummary([task("a"), task("b")]);
    expect(summary.yieldRate).toBeNull();
    expect(summary.tone).toBe("neutral");
  });
});
