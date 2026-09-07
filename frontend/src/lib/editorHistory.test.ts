import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  push,
  redo,
  undo,
} from "./editorHistory";

describe("createHistory", () => {
  it("bos bir gecmisle baslar", () => {
    const history = createHistory("a");
    expect(history).toEqual({ past: [], present: "a", future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe("push", () => {
  it("simdiki durumu gecmise tasir", () => {
    const history = push(createHistory("a"), "b");
    expect(history.past).toEqual(["a"]);
    expect(history.present).toBe("b");
  });

  it("yeni bir degisiklik ileri dali temizler", () => {
    // Kullanici geri alip sonra FARKLI bir sey yaptiysa, ileri alinacak eski
    // dal artik gecerli degildir; korunsaydi "yeniden yap" kullanicinin hic
    // yazmadigi bir duruma goturuudu.
    const branched = redo(undo(push(push(createHistory("a"), "b"), "c")));
    const afterUndo = undo(branched);
    expect(canRedo(afterUndo)).toBe(true);

    const rewritten = push(afterUndo, "z");
    expect(rewritten.future).toEqual([]);
    expect(canRedo(rewritten)).toBe(false);
  });

  it("gecmisi MAX_HISTORY adimda kirpar", () => {
    let history = createHistory(0);
    for (let step = 1; step <= MAX_HISTORY + 10; step += 1) {
      history = push(history, step);
    }
    expect(history.past).toHaveLength(MAX_HISTORY);
    // En eski adimlar dusurulur, en yenileri korunur.
    expect(history.past[history.past.length - 1]).toBe(MAX_HISTORY + 9);
  });
});

describe("undo", () => {
  it("bir adim geri alir", () => {
    const history = undo(push(createHistory("a"), "b"));
    expect(history.present).toBe("a");
    expect(history.future).toEqual(["b"]);
  });

  it("gecmis bossa durumu degistirmez", () => {
    const history = createHistory("a");
    expect(undo(history)).toBe(history);
  });

  it("art arda cagrildiginda basa kadar gider", () => {
    const history = push(push(push(createHistory("a"), "b"), "c"), "d");
    expect(undo(undo(undo(history))).present).toBe("a");
  });
});

describe("redo", () => {
  it("geri alinan adimi geri getirir", () => {
    const history = redo(undo(push(createHistory("a"), "b")));
    expect(history.present).toBe("b");
    expect(canRedo(history)).toBe(false);
  });

  it("gelecek bossa durumu degistirmez", () => {
    const history = push(createHistory("a"), "b");
    expect(redo(history)).toBe(history);
  });

  it("undo/redo dizisi ayni duruma doner", () => {
    const history = push(push(createHistory("a"), "b"), "c");
    const roundTrip = redo(redo(undo(undo(history))));
    expect(roundTrip.present).toBe("c");
    expect(roundTrip.past).toEqual(["a", "b"]);
  });
});
