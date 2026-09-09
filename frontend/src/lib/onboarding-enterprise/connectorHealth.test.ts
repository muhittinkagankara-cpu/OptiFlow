import { describe, expect, it } from "vitest";
import {
  initialState,
  sampleConfigs,
  sampleRuntimes,
  type ConnectorConfig,
  type ConnectorRuntime,
} from "../connectors";
import {
  BAD_LATENCY_MS,
  FRESH_WINDOW_MS,
  GOOD_LATENCY_MS,
  HEALTH_BANDS,
  HEALTH_WEIGHTS,
  STALE_WINDOW_MS,
  healthBand,
  healthCardOf,
  healthCards,
  overallHealth,
  worstCard,
} from "./connectorHealth";

const NOW = 1_700_000_000_000;
const CONFIG: ConnectorConfig = sampleConfigs()[0];

function runtime(overrides: Partial<ConnectorRuntime> = {}): ConnectorRuntime {
  return {
    configId: CONFIG.id,
    status: "connected",
    attempt: 0,
    nextRetryAtMs: null,
    lastSyncAtMs: NOW - 5_000,
    lastLatencyMs: 40,
    latencySamplesMs: [38, 42, 40],
    syncErrors: 0,
    recordsReceived: 100,
    detail: null,
    ...overrides,
  };
}

describe("HEALTH_WEIGHTS", () => {
  it("toplami yuz eder", () => {
    const total = Object.values(HEALTH_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it("durum en agir bilesendir", () => {
    // Bagli olmayan bir kaynak, gecikmesi ne olursa olsun saglikli sayilamaz.
    expect(HEALTH_WEIGHTS.status).toBeGreaterThan(HEALTH_WEIGHTS.latency);
    expect(HEALTH_WEIGHTS.status).toBeGreaterThan(HEALTH_WEIGHTS.freshness);
  });
});

describe("healthBand", () => {
  it("esiklere gore band verir", () => {
    expect(healthBand(HEALTH_BANDS.green)).toBe("green");
    expect(healthBand(HEALTH_BANDS.blue)).toBe("blue");
    expect(healthBand(HEALTH_BANDS.orange)).toBe("orange");
    expect(healthBand(HEALTH_BANDS.orange - 1)).toBe("red");
  });

  it("olcumsuz kaynak kirmizidir", () => {
    expect(healthBand(null)).toBe("red");
  });
});

describe("healthCardOf — ölçüm yokken", () => {
  const card = healthCardOf(
    CONFIG,
    runtime({
      status: "idle",
      lastSyncAtMs: null,
      lastLatencyMs: null,
      latencySamplesMs: [],
    }),
    NOW,
  );

  it("skor sifir degil bos doner", () => {
    // Sifir "olctuk, kotu cikti" demektir; hic baglanilmamis kaynak farklidir.
    expect(card.score).toBeNull();
    expect(card.pingMs).toBeNull();
    expect(card.lastDataAtMs).toBeNull();
  });

  it("nedenini yazar", () => {
    expect(card.detail).toContain("hiç bağlanılmadı");
  });

  it("bandi kirmizidir", () => {
    expect(card.band).toBe("red");
  });
});

describe("healthCardOf — sağlıklı bağlantı", () => {
  const card = healthCardOf(CONFIG, runtime(), NOW);

  it("yuksek skor uretir", () => {
    expect(card.score).toBeGreaterThanOrEqual(HEALTH_BANDS.green);
    expect(card.band).toBe("green");
  });

  it("ping ve son veri anini tasir", () => {
    expect(card.pingMs).toBe(40);
    expect(card.lastDataAtMs).toBe(NOW - 5_000);
  });

  it("aciklamasi benzetim oldugunu yazar", () => {
    // Gercek baglanti ile benzetim asla karistirilmamali.
    expect(card.detail).toContain("benzetim");
  });

  it("gercek baglanti olarak isaretlenmez", () => {
    expect(card.isRealConnection).toBe(false);
  });

  it("baglanti adini ve protokolunu tasir", () => {
    expect(card.name).toBe(CONFIG.name);
    expect(card.kind).toBe("OPC UA");
  });
});

describe("healthCardOf — bozulan koşullar", () => {
  it("kopuk baglanti skoru dusurur", () => {
    const connected = healthCardOf(CONFIG, runtime(), NOW).score ?? 0;
    const dropped = healthCardOf(CONFIG, runtime({ status: "disconnected" }), NOW).score ?? 0;
    expect(dropped).toBeLessThan(connected);
    expect(dropped).toBeLessThan(HEALTH_BANDS.green);
  });

  it("yeniden deneme durumu kismi puan alir", () => {
    const retrying = healthCardOf(CONFIG, runtime({ status: "retrying", attempt: 1 }), NOW);
    const failed = healthCardOf(CONFIG, runtime({ status: "failed", attempt: 5 }), NOW);
    expect(retrying.score ?? 0).toBeGreaterThan(failed.score ?? 0);
  });

  it("yuksek gecikme puani dusurur", () => {
    const fast = healthCardOf(CONFIG, runtime({ lastLatencyMs: GOOD_LATENCY_MS }), NOW).score ?? 0;
    const slow = healthCardOf(CONFIG, runtime({ lastLatencyMs: BAD_LATENCY_MS }), NOW).score ?? 0;
    expect(slow).toBeLessThan(fast);
  });

  it("tavan gecikmede gecikme puani sifirlanir", () => {
    const card = healthCardOf(CONFIG, runtime({ lastLatencyMs: BAD_LATENCY_MS * 2 }), NOW);
    expect(card.detail).toContain("gecikme yüksek");
  });

  it("eski veri tazelik puanini dusurur", () => {
    const fresh = healthCardOf(CONFIG, runtime({ lastSyncAtMs: NOW - FRESH_WINDOW_MS }), NOW).score ?? 0;
    const stale = healthCardOf(CONFIG, runtime({ lastSyncAtMs: NOW - STALE_WINDOW_MS }), NOW).score ?? 0;
    expect(stale).toBeLessThan(fresh);
  });

  it("yeniden denemeler kararlilik puanini dusurur", () => {
    const stable = healthCardOf(CONFIG, runtime(), NOW).score ?? 0;
    const unstable = healthCardOf(CONFIG, runtime({ attempt: 3, syncErrors: 4 }), NOW).score ?? 0;
    expect(unstable).toBeLessThan(stable);
  });

  it("deneme sayisini kartta gosterir", () => {
    expect(healthCardOf(CONFIG, runtime({ attempt: 2 }), NOW).retryCount).toBe(2);
  });

  it("skoru dusuren nedenleri yazar", () => {
    const card = healthCardOf(
      CONFIG,
      runtime({ status: "retrying", attempt: 2, lastLatencyMs: 900, lastSyncAtMs: NOW - STALE_WINDOW_MS }),
      NOW,
    );
    expect(card.detail).toContain("yeniden deneniyor");
    expect(card.detail).toContain("gecikme yüksek");
    expect(card.detail).toContain("son veri eski");
  });

  it("skor sifirin altina inmez", () => {
    const card = healthCardOf(
      CONFIG,
      runtime({ status: "failed", attempt: 9, syncErrors: 20, lastLatencyMs: 5_000, lastSyncAtMs: NOW - STALE_WINDOW_MS * 5 }),
      NOW,
    );
    expect(card.score).toBeGreaterThanOrEqual(0);
  });

  it("gelecek zaman damgasi tazeligi bozmaz", () => {
    const card = healthCardOf(CONFIG, runtime({ lastSyncAtMs: NOW + 10_000 }), NOW);
    expect(card.score).toBeGreaterThanOrEqual(HEALTH_BANDS.green);
  });
});

describe("healthCards", () => {
  const state = initialState(sampleConfigs(), [], [], sampleRuntimes(NOW));
  const cards = healthCards(state, NOW);

  it("her baglanti icin kart uretir", () => {
    expect(cards).toHaveLength(sampleConfigs().length);
  });

  it("hic baglanilmamis kaynagin skoru bostur", () => {
    const erp = cards.find((card) => card.configId === "conn-erp");
    expect(erp?.score).toBeNull();
  });

  it("bagli kaynagin skoru vardir", () => {
    const opcua = cards.find((card) => card.configId === "conn-opcua");
    expect(opcua?.score).not.toBeNull();
  });

  it("calisma zamani kaydi olmayan baglanti da kart alir", () => {
    const withoutRuntimes = { ...state, runtimes: {} };
    expect(healthCards(withoutRuntimes, NOW)).toHaveLength(sampleConfigs().length);
  });

  it("hicbiri gercek baglanti degildir", () => {
    expect(cards.every((card) => !card.isRealConnection)).toBe(true);
  });
});

describe("overallHealth", () => {
  const cards = healthCards(initialState(sampleConfigs(), [], [], sampleRuntimes(NOW)), NOW);

  it("olculen kaynaklarin ortalamasini alir", () => {
    const health = overallHealth(cards);
    expect(health.score).not.toBeNull();
    expect(health.measured).toBeGreaterThan(0);
  });

  it("olcumsuz kaynaklari ortalamaya katmaz ama sayar", () => {
    // Uc olcumsuz kaynagi sifir saymak, saglikli baglantiyi da kotu gosterirdi.
    const health = overallHealth(cards);
    expect(health.unmeasured).toBeGreaterThan(0);
    expect(health.measured + health.unmeasured).toBe(cards.length);
  });

  it("hic olcum yoksa skor bos doner", () => {
    const health = overallHealth([
      { ...cards[0], score: null },
    ]);
    expect(health.score).toBeNull();
    expect(health.band).toBe("red");
  });

  it("bos listede de coker degil", () => {
    expect(overallHealth([]).score).toBeNull();
  });
});

describe("worstCard", () => {
  const cards = healthCards(initialState(sampleConfigs(), [], [], sampleRuntimes(NOW)), NOW);

  it("en dusuk skorlu kaynagi verir", () => {
    const worst = worstCard(cards);
    expect(worst).not.toBeNull();
  });

  it("olcumsuz kaynak once gelir", () => {
    const worst = worstCard(cards);
    expect(worst?.score).toBeNull();
  });

  it("hepsi saglikliysa bos doner", () => {
    const healthy = cards.map((card) => ({ ...card, score: 95, band: "green" as const }));
    expect(worstCard(healthy)).toBeNull();
  });
});
