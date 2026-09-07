import { describe, expect, it, vi } from "vitest";
import { DemoLiveProvider } from "./DemoLiveProvider";
import { ReplayProvider, recordScenario } from "./ReplayProvider";
import { MESProvider, OPCUAProvider, WebSocketProvider } from "./skeletons";
import { providerCatalog } from "./index";
import { asReplayControls, type LiveDataProvider } from "./types";
import { LiveFactoryStore } from "../store";
import { START, seeds, state, stationOf } from "../fixtures";

function demo(): DemoLiveProvider {
  return new DemoLiveProvider(seeds(), "normal", START);
}

describe("LiveDataProvider — yaşam döngüsü", () => {
  it("baslangicta bagli degildir", () => {
    expect(demo().status).toBe("idle");
  });

  it("connect durumu 'connected' yapar, disconnect 'disconnected'", async () => {
    vi.useFakeTimers();
    try {
      const provider = demo();
      await provider.connect();
      expect(provider.status).toBe("connected");

      await provider.disconnect();
      expect(provider.status).toBe("disconnected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("durum degisimlerini abonelere bildirir", async () => {
    vi.useFakeTimers();
    try {
      const provider = demo();
      const seen: string[] = [];
      provider.onStatus((status) => seen.push(status));

      await provider.connect();
      await provider.disconnect();

      expect(seen).toEqual(["connecting", "connected", "disconnected"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ikinci connect cagrisi ikinci bir akis acmaz", async () => {
    // Acilsaydi olaylar cift islenir ve sayaclar sessizce iki katina cikardi.
    vi.useFakeTimers();
    try {
      const provider = demo();
      const store = new LiveFactoryStore(state());
      provider.subscribe(store.dispatch);

      await provider.connect();
      await provider.connect();
      vi.advanceTimersByTime(6_000);
      const doubled = stationOf(store.getState(), "s1").completed;

      await provider.disconnect();

      const single = new DemoLiveProvider(seeds(), "normal", START);
      const reference = new LiveFactoryStore(state());
      single.subscribe(reference.dispatch);
      await single.connect();
      vi.advanceTimersByTime(6_000);
      await single.disconnect();

      expect(doubled).toBe(stationOf(reference.getState(), "s1").completed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("yeniden baglanma temiz calisir", async () => {
    vi.useFakeTimers();
    try {
      const provider = demo();
      const store = new LiveFactoryStore(state());
      provider.subscribe(store.dispatch);

      await provider.connect();
      vi.advanceTimersByTime(4_000);
      await provider.disconnect();
      const afterFirst = store.getState().eventCount;

      // Kopukken hicbir olay gelmemeli.
      vi.advanceTimersByTime(20_000);
      expect(store.getState().eventCount).toBe(afterFirst);

      await provider.connect();
      expect(provider.status).toBe("connected");
      vi.advanceTimersByTime(6_000);
      expect(store.getState().eventCount).toBeGreaterThan(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bagli degilken disconnect sessizce gecer", async () => {
    const provider = demo();
    await expect(provider.disconnect()).resolves.toBeUndefined();
    expect(provider.status).toBe("idle");
  });

  it("abonelik iptal edilince olay tasimaz", async () => {
    vi.useFakeTimers();
    try {
      const provider = demo();
      const listener = vi.fn();
      const unsubscribe = provider.subscribe(listener);
      unsubscribe();

      await provider.connect();
      vi.advanceTimersByTime(6_000);

      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("istasyon yokken hicbir sey yayimlamaz", async () => {
    vi.useFakeTimers();
    try {
      const provider = new DemoLiveProvider([], "normal", START);
      const listener = vi.fn();
      provider.subscribe(listener);
      await provider.connect();
      vi.advanceTimersByTime(20_000);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Yer tutucu sağlayıcılar", () => {
  const skeletons: LiveDataProvider[] = [
    new WebSocketProvider(),
    new MESProvider(),
    new OPCUAProvider(),
  ];

  it("kullanilamaz olarak isaretlenir", () => {
    for (const provider of skeletons) {
      expect(provider.isAvailable).toBe(false);
    }
  });

  it("connect acikca hata verir ve durumu 'error' yapar", async () => {
    // Sessizce hicbir sey yapmak, bos ekrani "fabrika duruyor" diye okuturdu.
    for (const provider of skeletons) {
      await expect(provider.connect()).rejects.toThrowError(
        /bu sürümde bağlanmıyor/,
      );
      expect(provider.status).toBe("error");
    }
  });

  it("oynatma denetimi sunmaz", () => {
    for (const provider of skeletons) {
      expect(asReplayControls(provider)).toBeNull();
    }
  });
});

describe("Sağlayıcı kataloğu", () => {
  it("bes kaynagi listeler, ikisi bugun kullanilabilir", () => {
    const catalog = providerCatalog();
    expect(catalog.map((item) => item.id)).toEqual([
      "demo",
      "replay",
      "websocket",
      "mes",
      "opcua",
    ]);
    expect(catalog.filter((item) => item.isAvailable)).toHaveLength(2);
  });
});

describe("asReplayControls", () => {
  it("demo saglayicida null doner", () => {
    expect(asReplayControls(demo())).toBeNull();
  });

  it("kayittan oynatmada denetimleri verir", () => {
    const provider = new ReplayProvider(recordScenario("normal", seeds(), START, 1));
    const controls = asReplayControls(provider);
    expect(controls).not.toBeNull();
    expect(controls?.speed).toBe(1);
  });
});
