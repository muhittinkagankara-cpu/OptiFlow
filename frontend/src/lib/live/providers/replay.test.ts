import { describe, expect, it, vi } from "vitest";
import { ReplayProvider, recordScenario } from "./ReplayProvider";
import { LiveFactoryStore } from "../store";
import { START, seeds, state, stationOf } from "../fixtures";
import type { LiveEvent } from "../events";

function tapeOf(cycles = 2) {
  return recordScenario("normal", seeds(), START, cycles);
}

/** Sağlayıcıyı bir store'a bağlar; sıfırlama isteğini de bağlar. */
function wire(provider: ReplayProvider) {
  const store = new LiveFactoryStore(state());
  provider.subscribe(store.dispatch);
  provider.onReset(() => store.reset(state()));
  return store;
}

describe("recordScenario", () => {
  it("kareleri artan zamanla siralar", () => {
    const tape = tapeOf(1);
    expect(tape.length).toBeGreaterThan(0);
    for (let i = 1; i < tape.length; i += 1) {
      expect(tape[i].atMs).toBeGreaterThan(tape[i - 1].atMs);
    }
  });

  it("tur sayisi arttikca bant uzar", () => {
    expect(tapeOf(2).length).toBe(tapeOf(1).length * 2);
  });

  it("istasyon yoksa bos bant uretir", () => {
    expect(recordScenario("normal", [], START, 3)).toEqual([]);
  });

  it("deterministiktir", () => {
    expect(tapeOf(1)).toEqual(tapeOf(1));
  });
});

describe("ReplayProvider — oynatma", () => {
  it("bos bantta sure sifirdir ve oynatma baslamaz", () => {
    const provider = new ReplayProvider([]);
    expect(provider.durationMs).toBe(0);
    provider.play();
    expect(provider.isPlaying).toBe(false);
  });

  it("connect oynatmayi baslatir", async () => {
    vi.useFakeTimers();
    try {
      const provider = new ReplayProvider(tapeOf(1));
      await provider.connect();
      expect(provider.isPlaying).toBe(true);
      await provider.disconnect();
      expect(provider.isPlaying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gercek zamanli ilerler ve olaylari yayar", async () => {
    vi.useFakeTimers();
    try {
      const provider = new ReplayProvider(tapeOf(1));
      const store = wire(provider);
      await provider.connect();

      vi.advanceTimersByTime(3_000);

      expect(provider.positionMs).toBe(3_000);
      expect(store.getState().eventCount).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hiz carpani ilerlemeyi olceklendirir", async () => {
    vi.useFakeTimers();
    try {
      const fast = new ReplayProvider(tapeOf(2));
      await fast.connect();
      fast.setSpeed(4);
      vi.advanceTimersByTime(1_000);
      expect(fast.positionMs).toBe(4_000);
      await fast.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("duraklatinca ilerlemez, devam edince kaldigi yerden surer", async () => {
    vi.useFakeTimers();
    try {
      const provider = new ReplayProvider(tapeOf(2));
      await provider.connect();

      vi.advanceTimersByTime(2_000);
      provider.pause();
      const frozen = provider.positionMs;

      vi.advanceTimersByTime(5_000);
      expect(provider.positionMs).toBe(frozen);

      provider.play();
      vi.advanceTimersByTime(1_000);
      expect(provider.positionMs).toBe(frozen + 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kaydin sonunda kendiliginden durur", async () => {
    vi.useFakeTimers();
    try {
      const provider = new ReplayProvider(tapeOf(1));
      await provider.connect();
      provider.setSpeed(8);

      vi.advanceTimersByTime(provider.durationMs + 5_000);

      expect(provider.isPlaying).toBe(false);
      expect(provider.positionMs).toBe(provider.durationMs);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sondayken oynat basa sarar", async () => {
    vi.useFakeTimers();
    try {
      const provider = new ReplayProvider(tapeOf(1));
      wire(provider);
      await provider.connect();
      provider.setSpeed(8);
      vi.advanceTimersByTime(provider.durationMs + 2_000);

      provider.play();
      expect(provider.positionMs).toBe(0);
      expect(provider.isPlaying).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ReplayProvider — zaman kaydırıcı", () => {
  it("ileri atlayinca aradaki olaylarin hepsi uygulanir", () => {
    const provider = new ReplayProvider(tapeOf(2));
    const store = wire(provider);

    provider.seek(provider.durationMs);

    // Bant sonunda uretilen adet, bandin tamamini pesispese uygulamakla ayni
    // olmali: atlamak olay atlamamalidir.
    const reference = new LiveFactoryStore(state());
    reference.dispatch(tapeOf(2).flatMap((frame) => frame.events));

    expect(stationOf(store.getState(), "s1").completed).toBe(
      stationOf(reference.getState(), "s1").completed,
    );
  });

  it("geri atlayinca durum sifirlanip yeniden kurulur", () => {
    const provider = new ReplayProvider(tapeOf(2));
    const store = wire(provider);

    provider.seek(provider.durationMs);
    const atEnd = stationOf(store.getState(), "s1").completed;

    provider.seek(0);
    // Sifirinci anda henuz hicbir kare uygulanmamis olmali.
    expect(stationOf(store.getState(), "s1").completed).toBe(0);
    expect(atEnd).toBeGreaterThan(0);
  });

  it("ayni ana iki kez atlamak ayni durumu verir", () => {
    const provider = new ReplayProvider(tapeOf(2));
    const store = wire(provider);
    const middle = Math.floor(provider.durationMs / 2);

    provider.seek(middle);
    const first = stationOf(store.getState(), "s1").completed;

    provider.seek(provider.durationMs);
    provider.seek(middle);

    expect(stationOf(store.getState(), "s1").completed).toBe(first);
  });

  it("sinirlarin disina atlamayi kirpar", () => {
    const provider = new ReplayProvider(tapeOf(1));
    wire(provider);

    provider.seek(-5_000);
    expect(provider.positionMs).toBe(0);

    provider.seek(provider.durationMs * 10);
    expect(provider.positionMs).toBe(provider.durationMs);
  });

  it("atlamadan once sifirlama duyurusu yapar", () => {
    const provider = new ReplayProvider(tapeOf(1));
    const onReset = vi.fn();
    provider.onReset(onReset);

    provider.seek(1_000);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("ilerleme abonelerini bilgilendirir ve abonelik iptal edilebilir", () => {
    const provider = new ReplayProvider(tapeOf(1));
    const onProgress = vi.fn();
    const unsubscribe = provider.onProgress(onProgress);

    provider.seek(500);
    expect(onProgress).toHaveBeenCalled();

    unsubscribe();
    onProgress.mockClear();
    provider.seek(900);
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("ReplayProvider — yük", () => {
  it("bin olaylik bant tek turda tutarli sonuc verir", () => {
    // Yuk altinda olay sirasi bozulursa sayaclar referanstan sapar.
    const heavy: { atMs: number; events: LiveEvent[] }[] = Array.from(
      { length: 1000 },
      (_, i) => ({
        atMs: (i + 1) * 10,
        events: [
          {
            type: "part_completed",
            atMinutes: START + i,
            stationId: "s1",
            quantity: 1,
          },
        ],
      }),
    );

    const provider = new ReplayProvider(heavy);
    const store = wire(provider);
    provider.seek(provider.durationMs);

    expect(stationOf(store.getState(), "s1").completed).toBe(1000);
    // Akis ust siniri korunmali: bin olay yuz satira sigar.
    expect(store.getState().feed).toHaveLength(100);
  });

  it("8x hizda biriken kareleri tek yayinda gonderir", async () => {
    vi.useFakeTimers();
    try {
      // 10 ms araliklarla 200 kare = 2 saniyelik bant; tek tik (100 ms) 8x
      // hizda 800 ms ilerler, yani 80 kare birikir.
      const dense: { atMs: number; events: LiveEvent[] }[] = Array.from(
        { length: 200 },
        (_, i) => ({
          atMs: (i + 1) * 10,
          events: [{ type: "tick", atMinutes: START + i }],
        }),
      );
      const provider = new ReplayProvider(dense);
      const listener = vi.fn();
      provider.subscribe(listener);

      await provider.connect();
      provider.setSpeed(8);
      vi.advanceTimersByTime(100);

      // Seksen kare birikir ama yalnizca bir yayin olur: her kareyi ayri
      // yayimlamak seksen render turu demek olurdu.
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveLength(80);
      expect(provider.positionMs).toBe(800);
      await provider.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
