import { describe, expect, it } from "vitest";
import {
  sampleConfigs,
  sampleMappings,
  sampleRuntimes,
  sampleSources,
} from "./fixtures";
import { initialState } from "./manager";
import {
  LATENCY_WINDOW,
  SLOW_LATENCY_MS,
  averageLatency,
  healthSnapshot,
  idleRuntime,
  isOnline,
  latencySeries,
  latencyTone,
  needsAttention,
  pushLatency,
  relativeTime,
  statusTone,
} from "./status";
import type { ConnectorState, ConnectorStatus } from "./types";

const NOW = 1_700_000_000_000;

function stateWithRuntimes(): ConnectorState {
  return initialState(
    sampleConfigs(),
    sampleSources(),
    sampleMappings(),
    sampleRuntimes(NOW),
  );
}

describe("statusTone", () => {
  it("bagliyi yesil, hatayi kirmizi gosterir", () => {
    expect(statusTone("connected")).toBe("good");
    expect(statusTone("failed")).toBe("bad");
    expect(statusTone("disconnected")).toBe("bad");
  });

  it("gecici durumlar turuncudur", () => {
    // "Yeniden deniyor" mudahale degil, bekleme ister.
    expect(statusTone("retrying")).toBe("warning");
    expect(statusTone("connecting")).toBe("warning");
  });

  it("hic baglanmamis notrdur", () => {
    expect(statusTone("idle")).toBe("neutral");
  });

  it("her durumun bir tonu vardir", () => {
    const all: ConnectorStatus[] = [
      "idle",
      "connecting",
      "connected",
      "retrying",
      "failed",
      "disconnected",
    ];
    expect(all.every((status) => statusTone(status) !== undefined)).toBe(true);
  });
});

describe("isOnline / needsAttention", () => {
  it("yalnizca bagli olan veri akitir", () => {
    expect(isOnline("connected")).toBe(true);
    expect(isOnline("connecting")).toBe(false);
    expect(isOnline("retrying")).toBe(false);
  });

  it("mudahale gerektiren durumlari ayirir", () => {
    expect(needsAttention("failed")).toBe(true);
    expect(needsAttention("disconnected")).toBe(true);
    // Yeniden deneme kendiliginden duzelebilir; mudahale istemez.
    expect(needsAttention("retrying")).toBe(false);
    expect(needsAttention("connected")).toBe(false);
  });
});

describe("pushLatency", () => {
  it("olcumu ekler", () => {
    expect(pushLatency([10, 20], 30)).toEqual([10, 20, 30]);
  });

  it("pencereyi asmaz", () => {
    const many = Array.from({ length: LATENCY_WINDOW + 5 }, (_, i) => i);
    const next = pushLatency(many, 999);
    expect(next).toHaveLength(LATENCY_WINDOW);
    expect(next[next.length - 1]).toBe(999);
  });

  it("gecersiz olcumu almaz", () => {
    // Negatif ya da NaN gecikme bir olcum degildir.
    expect(pushLatency([10], -5)).toEqual([10]);
    expect(pushLatency([10], Number.NaN)).toEqual([10]);
  });

  it("girdiyi degistirmez", () => {
    const original = [1, 2];
    pushLatency(original, 3);
    expect(original).toEqual([1, 2]);
  });
});

describe("averageLatency", () => {
  it("ortalamayi hesaplar", () => {
    expect(averageLatency([10, 20, 30])).toBe(20);
  });

  it("olcum yoksa sifir degil bos doner", () => {
    // Sifir milisaniye, mukemmel bir baglanti anlamina gelirdi.
    expect(averageLatency([])).toBeNull();
  });
});

describe("healthSnapshot", () => {
  const state = stateWithRuntimes();

  it("durumlari kovalara ayirir", () => {
    const health = healthSnapshot(state);
    expect(health.connected).toBe(2);
    expect(health.retrying).toBe(1);
    expect(health.disconnected).toBe(1);
    expect(health.failed).toBe(0);
    expect(health.total).toBe(5);
  });

  it("hic baglanmamisi hicbir kovaya koymaz ama toplamda sayar", () => {
    const health = healthSnapshot(state);
    expect(
      health.connected + health.retrying + health.disconnected + health.failed,
    ).toBeLessThan(health.total);
  });

  it("senkron hatalarini toplar", () => {
    expect(healthSnapshot(state).syncErrors).toBe(4);
  });

  it("kayitlari toplar", () => {
    expect(healthSnapshot(state).totalRecords).toBe(1_284 + 4_910 + 612 + 96);
  });

  it("ortalama gecikmeyi yalnizca bagli olanlardan alir", () => {
    // Yeniden deneyen baglantinin eski gecikmesi, hattin saglikli oldugu
    // izlenimini verirdi.
    const health = healthSnapshot(state);
    expect(health.avgLatencyMs).not.toBeNull();
    expect(health.avgLatencyMs ?? 0).toBeLessThan(60);
  });

  it("en son veri anini bulur", () => {
    expect(healthSnapshot(state).lastUpdateAtMs).toBe(NOW - 1_500);
  });

  it("bos kurulumda sifirlari ve bos ortalamayi doner", () => {
    const empty = healthSnapshot(initialState([], [], []));
    expect(empty.total).toBe(0);
    expect(empty.connected).toBe(0);
    expect(empty.avgLatencyMs).toBeNull();
    expect(empty.lastUpdateAtMs).toBeNull();
  });

  it("calisma zamani kaydi olmayan baglanti idle sayilir", () => {
    const withoutRuntimes: ConnectorState = {
      ...initialState(sampleConfigs(), [], []),
      runtimes: {},
    };
    const health = healthSnapshot(withoutRuntimes);
    expect(health.total).toBe(5);
    expect(health.connected).toBe(0);
  });
});

describe("latencySeries", () => {
  it("mini grafik icin noktalari verir", () => {
    const series = latencySeries(stateWithRuntimes(), "conn-opcua");
    expect(series).toHaveLength(6);
    expect(series[0]).toEqual({ index: 0, latencyMs: 38 });
  });

  it("taninmayan baglantida bos doner", () => {
    expect(latencySeries(stateWithRuntimes(), "yok")).toEqual([]);
  });

  it("olcumu olmayan baglantida bos doner", () => {
    expect(latencySeries(stateWithRuntimes(), "conn-erp")).toEqual([]);
  });
});

describe("latencyTone", () => {
  it("hizli baglanti yesildir", () => {
    expect(latencyTone(SLOW_LATENCY_MS - 1)).toBe("good");
  });

  it("yavas baglanti turuncudur", () => {
    expect(latencyTone(SLOW_LATENCY_MS + 1)).toBe("warning");
  });

  it("olculmemis gecikme notrdur", () => {
    expect(latencyTone(null)).toBe("neutral");
  });
});

describe("relativeTime", () => {
  it("hic olculmemis zamani tire yazar", () => {
    expect(relativeTime(null, NOW)).toBe("—");
  });

  it("cok yakin zamani 'az once' yazar", () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe("az önce");
  });

  it("gelecek zamani da 'az once' sayar", () => {
    // Sunucu ve tarayici saatinin kaymasi olagandir; "-4 sn önce" bozuk görünür.
    expect(relativeTime(NOW + 4_000, NOW)).toBe("az önce");
  });

  it("saniye, dakika, saat ve gun yazar", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("30 sn önce");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 dk önce");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 sa önce");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2 gün önce");
  });
});

describe("idleRuntime", () => {
  it("bos bir calisma zamani kurar", () => {
    const runtime = idleRuntime("conn-x");
    expect(runtime.status).toBe("idle");
    expect(runtime.lastSyncAtMs).toBeNull();
    expect(runtime.lastLatencyMs).toBeNull();
    expect(runtime.latencySamplesMs).toEqual([]);
    expect(runtime.recordsReceived).toBe(0);
  });
});
