import { describe, expect, it } from "vitest";
import { applyEvent, applyEvents } from "./events";
import { buildDemoTasks, taskFromCode } from "./seed";
import { task } from "./fixtures";

const T0 = "2026-09-04T08:00:00.000Z";
const T1 = "2026-09-04T08:30:00.000Z";

describe("applyEvent", () => {
  it("isi baslatir", () => {
    const [updated] = applyEvent([task("a")], {
      type: "task_started",
      taskId: "a",
      at: T0,
    });
    expect(updated.status).toBe("active");
    expect(updated.startedAt).toBe(T0);
  });

  it("calisan isi yeniden baslatmak sayaci sifirlamaz", () => {
    const started = task("a", { status: "active", startedAt: T0 });
    const [updated] = applyEvent([started], {
      type: "task_started",
      taskId: "a",
      at: T1,
    });
    expect(updated.startedAt).toBe(T0);
  });

  it("duraklatinca gecen sureyi ekler", () => {
    // 08:00 -> 08:30 = 1800 sn
    const [updated] = applyEvent([task("a", { status: "active", startedAt: T0 })], {
      type: "task_paused",
      taskId: "a",
      at: T1,
    });
    expect(updated.status).toBe("paused");
    expect(updated.workedSeconds).toBe(1800);
    expect(updated.startedAt).toBeNull();
  });

  it("calismayan isi duraklatmak durumu degistirmez", () => {
    const [updated] = applyEvent([task("a", { status: "pending" })], {
      type: "task_paused",
      taskId: "a",
      at: T1,
    });
    expect(updated.status).toBe("pending");
  });

  it("tamamlayinca bitis zamanini yazar", () => {
    const [updated] = applyEvent([task("a", { status: "active", startedAt: T0 })], {
      type: "task_completed",
      taskId: "a",
      at: T1,
    });
    expect(updated.status).toBe("done");
    expect(updated.finishedAt).toBe(T1);
    expect(updated.workedSeconds).toBe(1800);
  });

  it("uretilen adedi ekler", () => {
    const [updated] = applyEvent([task("a", { completedQuantity: 5 })], {
      type: "unit_produced",
      taskId: "a",
      at: T0,
      quantity: 3,
    });
    expect(updated.completedQuantity).toBe(8);
  });

  it("sifir ya da negatif adedi yok sayar", () => {
    const before = task("a", { completedQuantity: 5 });
    const [updated] = applyEvent([before], {
      type: "unit_produced",
      taskId: "a",
      at: T0,
      quantity: -2,
    });
    expect(updated.completedQuantity).toBe(5);
  });

  it("hurda kaydi ekler", () => {
    const [updated] = applyEvent([task("a")], {
      type: "scrap_recorded",
      taskId: "a",
      at: T0,
      reason: "burr",
      quantity: 4,
      photoCount: 2,
      note: "Kenar çapağı",
    });
    expect(updated.scrap).toHaveLength(1);
    expect(updated.scrap[0]).toMatchObject({
      reason: "burr",
      quantity: 4,
      photoCount: 2,
      taskId: "a",
    });
  });

  it("sifir adetli hurda kaydi olusturmaz", () => {
    const [updated] = applyEvent([task("a")], {
      type: "scrap_recorded",
      taskId: "a",
      at: T0,
      reason: "other",
      quantity: 0,
      photoCount: 0,
      note: null,
    });
    expect(updated.scrap).toEqual([]);
  });

  it("taninmayan gorev kimligini sessizce gecer", () => {
    // MES baglantisinda baska bir operatorun olayi gelebilir.
    const before = [task("a")];
    expect(
      applyEvent(before, { type: "task_started", taskId: "yok", at: T0 }),
    ).toEqual(before);
  });

  it("girdiyi degistirmez", () => {
    const before = task("a");
    applyEvent([before], { type: "task_started", taskId: "a", at: T0 });
    expect(before.status).toBe("pending");
  });

  it("gecersiz zaman damgasinda sure eklemez", () => {
    const [updated] = applyEvent(
      [task("a", { status: "active", startedAt: "gecersiz" })],
      { type: "task_paused", taskId: "a", at: T1 },
    );
    expect(updated.workedSeconds).toBe(0);
  });

  it("geriye giden zamanda sure eklemez", () => {
    // Negatif sure, vardiya ozetini geriye goturur.
    const [updated] = applyEvent(
      [task("a", { status: "active", startedAt: T1 })],
      { type: "task_paused", taskId: "a", at: T0 },
    );
    expect(updated.workedSeconds).toBe(0);
  });
});

describe("applyEvents", () => {
  it("olaylari sirayla uygular", () => {
    const [updated] = applyEvents([task("a")], [
      { type: "task_started", taskId: "a", at: T0 },
      { type: "unit_produced", taskId: "a", at: T0, quantity: 10 },
      { type: "task_completed", taskId: "a", at: T1 },
    ]);
    expect(updated.status).toBe("done");
    expect(updated.completedQuantity).toBe(10);
    expect(updated.workedSeconds).toBe(1800);
  });

  it("bos olay dizisinde listeyi degistirmez", () => {
    const before = [task("a")];
    expect(applyEvents(before, [])).toEqual(before);
  });
});

describe("buildDemoTasks", () => {
  it("istasyon adlarini kullanir", () => {
    const tasks = buildDemoTasks(["Pres", "Boyama"], "Ayşe");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].stationName).toBe("Pres");
    expect(tasks[0].operatorName).toBe("Ayşe");
  });

  it("istasyon yoksa genel hatti kullanir", () => {
    expect(buildDemoTasks([], "Ayşe")).toHaveLength(4);
  });

  it("en fazla dort gorev uretir", () => {
    // Yirmi kart, operatorun sonuna kadar kaydirmayacagi bir yigin olurdu.
    const many = Array.from({ length: 20 }, (_, i) => `İstasyon ${i}`);
    expect(buildDemoTasks(many, "Ayşe")).toHaveLength(4);
  });

  it("deterministiktir", () => {
    expect(buildDemoTasks(["Pres"], "Ayşe")).toEqual(
      buildDemoTasks(["Pres"], "Ayşe"),
    );
  });

  it("tahmini sureyi cevrim suresinden turetir", () => {
    // 120 adet x 45 sn = 90 dk
    expect(buildDemoTasks(["Pres"], "Ayşe")[0].estimatedMinutes).toBe(90);
  });
});

describe("taskFromCode", () => {
  const tasks = buildDemoTasks(["Pres", "Boyama"], "Ayşe");

  it("is emri numarasini bulur", () => {
    expect(taskFromCode(tasks, tasks[1].workOrder)?.id).toBe(tasks[1].id);
  });

  it("istasyon adiyla da bulur", () => {
    expect(taskFromCode(tasks, "boyama")?.stationName).toBe("Boyama");
  });

  it("taninmayan kodda null doner", () => {
    expect(taskFromCode(tasks, "XYZ-999")).toBeNull();
  });

  it("bos kodda null doner", () => {
    expect(taskFromCode(tasks, "   ")).toBeNull();
  });
});
