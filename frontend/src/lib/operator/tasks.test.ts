import { describe, expect, it } from "vitest";
import {
  activeTask,
  remainingMinutes,
  sortTasks,
  taskCounts,
  taskProgress,
} from "./tasks";
import { task } from "./fixtures";

describe("taskProgress", () => {
  it("kalan adedi ve orani verir", () => {
    const progress = taskProgress(task("t1", { completedQuantity: 40 }));
    expect(progress.completed).toBe(40);
    expect(progress.remaining).toBe(60);
    expect(progress.ratio).toBeCloseTo(0.4, 6);
    expect(progress.isComplete).toBe(false);
  });

  it("hedef sifirken sifira bolmez", () => {
    const progress = taskProgress(task("t1", { targetQuantity: 0 }));
    expect(progress.ratio).toBe(0);
    expect(progress.remaining).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it("hedefi asan uretimde oran birde kalir", () => {
    // Fazla uretim, cubugun tasmasina yol acmamali.
    const progress = taskProgress(
      task("t1", { targetQuantity: 100, completedQuantity: 130 }),
    );
    expect(progress.ratio).toBe(1);
    expect(progress.remaining).toBe(0);
    expect(progress.isComplete).toBe(true);
  });

  it("negatif degerleri sifira cekerek okur", () => {
    const progress = taskProgress(
      task("t1", { targetQuantity: -5, completedQuantity: -3 }),
    );
    expect(progress.completed).toBe(0);
    expect(progress.target).toBe(0);
  });
});

describe("sortTasks", () => {
  it("calisan isi en uste alir", () => {
    const sorted = sortTasks([
      task("a", { priority: "urgent", status: "pending", workOrder: "İE-1" }),
      task("b", { priority: "normal", status: "active", workOrder: "İE-2" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("ayni durumda onceligi izler", () => {
    const sorted = sortTasks([
      task("a", { priority: "normal", workOrder: "İE-1" }),
      task("b", { priority: "urgent", workOrder: "İE-2" }),
      task("c", { priority: "high", workOrder: "İE-3" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("tamamlanan isi en alta koyar", () => {
    const sorted = sortTasks([
      task("a", { status: "done", priority: "urgent" }),
      task("b", { status: "pending", priority: "normal" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("girdiyi degistirmez", () => {
    const input = [task("a", { priority: "normal" }), task("b", { priority: "urgent" })];
    const copy = [...input];
    sortTasks(input);
    expect(input).toEqual(copy);
  });

  it("bos listede bos doner", () => {
    expect(sortTasks([])).toEqual([]);
  });
});

describe("activeTask", () => {
  it("duraklatilmis isi de aktif sayar", () => {
    // Operator ona geri donecek; ana sayfada gorunmesi gerekir.
    const found = activeTask([task("a"), task("b", { status: "paused" })]);
    expect(found?.id).toBe("b");
  });

  it("hicbiri baslamadiysa null doner", () => {
    expect(activeTask([task("a"), task("b")])).toBeNull();
  });

  it("gorev yoksa null doner", () => {
    expect(activeTask([])).toBeNull();
  });
});

describe("taskCounts", () => {
  it("gorev yokken bos isaretler", () => {
    const counts = taskCounts([]);
    expect(counts.isEmpty).toBe(true);
    // Gorev yokluğu, "hepsi bitti" ile karistirilmamali.
    expect(counts.allDone).toBe(false);
  });

  it("tum gorevler bittiginde allDone verir", () => {
    const counts = taskCounts([
      task("a", { status: "done" }),
      task("b", { status: "done" }),
    ]);
    expect(counts.allDone).toBe(true);
    expect(counts.done).toBe(2);
    expect(counts.pending).toBe(0);
  });

  it("karisik durumlari ayri ayri sayar", () => {
    const counts = taskCounts([
      task("a", { status: "done" }),
      task("b", { status: "active" }),
      task("c", { status: "paused" }),
      task("d", { status: "pending" }),
    ]);
    expect(counts).toMatchObject({
      total: 4,
      done: 1,
      active: 2,
      pending: 1,
      allDone: false,
    });
  });
});

describe("remainingMinutes", () => {
  it("kalan adedi cevrim suresiyle carpar", () => {
    // 60 parca x 60 sn = 60 dk
    expect(
      remainingMinutes(task("t1", { completedQuantity: 40, cycleSeconds: 60 })),
    ).toBeCloseTo(60, 6);
  });

  it("cevrim suresi bilinmiyorsa null doner", () => {
    // Sifir dakika göstermek "bitmek uzere" anlamina gelirdi.
    expect(remainingMinutes(task("t1", { cycleSeconds: 0 }))).toBeNull();
  });

  it("is bittiginde sifir doner", () => {
    expect(
      remainingMinutes(task("t1", { completedQuantity: 100 })),
    ).toBe(0);
  });
});
