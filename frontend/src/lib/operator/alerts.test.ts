import { describe, expect, it } from "vitest";
import { buildAlerts } from "./alerts";
import { scrapEntry, task } from "./fixtures";

describe("buildAlerts", () => {
  it("gorev yokken bildirim uretmez", () => {
    // "Her sey yolunda" demek de bir iddiadir; olcum yoksa sessiz kalinir.
    expect(buildAlerts([])).toEqual([]);
  });

  it("sakin vardiyada bildirim uretmez", () => {
    expect(buildAlerts([task("a", { status: "active" })])).toEqual([]);
  });

  it("yuksek fireyi bildirir", () => {
    const alerts = buildAlerts([
      task("a", { completedQuantity: 70, scrap: [scrapEntry("burr", 30)] }),
    ]);
    expect(alerts[0]).toMatchObject({ tone: "bad", taskId: "a" });
    expect(alerts[0].title).toContain("fire");
  });

  it("baslamamis acil isi bildirir", () => {
    const alerts = buildAlerts([task("a", { priority: "urgent", status: "pending" })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tone).toBe("warning");
  });

  it("baslamis acil is icin bildirim uretmez", () => {
    expect(buildAlerts([task("a", { priority: "urgent", status: "active" })])).toEqual(
      [],
    );
  });

  it("duraklatilmis isi bildirir", () => {
    const alerts = buildAlerts([task("a", { status: "paused" })]);
    expect(alerts[0].id).toBe("paused-a");
  });

  it("fire uyarisini acil is uyarisinin onune koyar", () => {
    // Hurda uretmeye devam etmek, bir ise gec baslamaktan pahalidir.
    const alerts = buildAlerts([
      task("a", { priority: "urgent", status: "pending" }),
      task("b", { completedQuantity: 50, scrap: [scrapEntry("other", 50)] }),
    ]);
    expect(alerts[0].tone).toBe("bad");
    expect(alerts[1].tone).toBe("warning");
  });

  it("hepsi bitince kapanis bildirimi ekler", () => {
    const alerts = buildAlerts([
      task("a", { status: "done" }),
      task("b", { status: "done" }),
    ]);
    expect(alerts.at(-1)).toMatchObject({ id: "all-done", tone: "info" });
  });

  it("hic parca islenmemis iste fire uyarisi vermez", () => {
    expect(buildAlerts([task("a", { completedQuantity: 0 })])).toEqual([]);
  });
});
