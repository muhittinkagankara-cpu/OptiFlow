import { describe, expect, it } from "vitest";
import { defaultSettings } from "./fields";
import { sampleConfigs, sampleMappings, sampleSources } from "./fixtures";
import {
  BASE_LATENCY_MS,
  ConnectorStore,
  EVENT_LIMIT,
  connectorReducer,
  createConfig,
  emptyState,
  initialState,
  runtimeOf,
  simulateTest,
  type ConnectorAction,
} from "./manager";
import { BASE_DELAY_MS, MAX_ATTEMPTS } from "./retry";
import type { ConnectorConfig, ConnectorState, SourceNode } from "./types";

const NOW = 1_700_000_000_000;

function opcuaConfig(overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return { ...sampleConfigs()[0], ...overrides };
}

function stateWith(config: ConnectorConfig, sources: SourceNode[] = []): ConnectorState {
  return connectorReducer(emptyState(), {
    type: "add",
    atMs: NOW,
    config,
    sources,
  });
}

/** Eylemleri sırayla uygular; okunurluğu artırmak için. */
function run(state: ConnectorState, actions: ConnectorAction[]): ConnectorState {
  return actions.reduce(connectorReducer, state);
}

describe("createConfig", () => {
  it("ayarlari bos kurar", () => {
    const config = createConfig("mqtt", "c1");
    expect(config.settings).toEqual(defaultSettings("mqtt"));
    expect(config.autoReconnect).toBe(true);
  });

  it("ayni turden ikinci baglantiya numara verir", () => {
    expect(createConfig("mqtt", "c1", 0).name).toBe("MQTT");
    expect(createConfig("mqtt", "c2", 1).name).toBe("MQTT 2");
  });
});

describe("initialState", () => {
  it("her baglanti icin calisma zamani kurar", () => {
    const state = initialState(sampleConfigs());
    expect(Object.keys(state.runtimes)).toHaveLength(5);
    expect(state.runtimes["conn-mqtt"].status).toBe("idle");
  });

  it("verilen calisma zamanlarini korur", () => {
    const state = initialState(sampleConfigs(), [], [], {
      "conn-mqtt": { ...runtimeOf(emptyState(), "conn-mqtt"), status: "connected" },
    });
    expect(state.runtimes["conn-mqtt"].status).toBe("connected");
  });
});

describe("add", () => {
  it("baglantiyi ve calisma zamanini ekler", () => {
    const state = stateWith(opcuaConfig());
    expect(state.configs).toHaveLength(1);
    expect(state.runtimes["conn-opcua"].status).toBe("idle");
  });

  it("gunluge kayit dusurur", () => {
    const state = stateWith(opcuaConfig());
    expect(state.events[0].kind).toBe("config");
    expect(state.events[0].text).toContain("eklendi");
  });

  it("dugumleri birlikte alir", () => {
    const state = stateWith(opcuaConfig(), sampleSources().slice(0, 2));
    expect(state.sources).toHaveLength(2);
  });

  it("ayni kimlikle ikinci ekleme yok sayilir", () => {
    // Iki kayit ayni baglantiyi iki kez sayar ve saglik panosunu sisirirdi.
    const first = stateWith(opcuaConfig());
    const second = connectorReducer(first, {
      type: "add",
      atMs: NOW,
      config: opcuaConfig(),
    });
    expect(second).toBe(first);
  });
});

describe("remove", () => {
  const base = run(stateWith(opcuaConfig(), sampleSources()), [
    { type: "set_mappings", atMs: NOW, mappings: sampleMappings() },
  ]);

  it("baglantiyi, calisma zamanini ve dugumleri siler", () => {
    const state = connectorReducer(base, {
      type: "remove",
      atMs: NOW,
      configId: "conn-opcua",
    });
    expect(state.configs).toHaveLength(0);
    expect(state.runtimes["conn-opcua"]).toBeUndefined();
    expect(state.sources.some((item) => item.connectorId === "conn-opcua")).toBe(
      false,
    );
  });

  it("silinen dugumlerin eslemelerini de goturur", () => {
    // Var olmayan dugume bagli esleme, dogrulama ekranini kalici hatayla
    // doldururdu.
    const state = connectorReducer(base, {
      type: "remove",
      atMs: NOW,
      configId: "conn-opcua",
    });
    expect(
      state.mappings.some((item) => item.sourceId.startsWith("src-opcua")),
    ).toBe(false);
    expect(state.mappings.length).toBeGreaterThan(0);
  });

  it("taninmayan baglanti durumu degistirmez", () => {
    expect(connectorReducer(base, { type: "remove", atMs: NOW, configId: "yok" })).toBe(
      base,
    );
  });
});

describe("update_settings", () => {
  it("ayarlari degistirir", () => {
    const state = connectorReducer(stateWith(opcuaConfig()), {
      type: "update_settings",
      atMs: NOW,
      configId: "conn-opcua",
      settings: { ...opcuaConfig().settings, endpoint: "opc.tcp://10.0.0.5:4840" },
    });
    expect(state.configs[0].settings.endpoint).toBe("opc.tcp://10.0.0.5:4840");
  });

  it("adi ve otomatik baglanmayi gunceller", () => {
    const state = connectorReducer(stateWith(opcuaConfig()), {
      type: "update_settings",
      atMs: NOW,
      configId: "conn-opcua",
      settings: opcuaConfig().settings,
      name: "Hat 2 PLC",
      autoReconnect: false,
    });
    expect(state.configs[0].name).toBe("Hat 2 PLC");
    expect(state.configs[0].autoReconnect).toBe(false);
  });

  it("parolayi gunluge yazmaz", () => {
    // Baglanti hatasinin ekran goruntusu kolayca paylasilir.
    const state = connectorReducer(stateWith(opcuaConfig()), {
      type: "update_settings",
      atMs: NOW,
      configId: "conn-opcua",
      settings: { ...opcuaConfig().settings, password: "cok-gizli" },
    });
    expect(state.events[0].text).not.toContain("cok-gizli");
    expect(state.events[0].text).toContain("••••••");
  });
});

describe("baglanti yasam dongusu", () => {
  const added = stateWith(opcuaConfig());

  it("connect durumu baglaniyora tasir", () => {
    const state = connectorReducer(added, {
      type: "connect",
      atMs: NOW,
      configId: "conn-opcua",
    });
    expect(runtimeOf(state, "conn-opcua").status).toBe("connecting");
  });

  it("connected gecikme ornegini saklar", () => {
    const state = run(added, [
      { type: "connect", atMs: NOW, configId: "conn-opcua" },
      { type: "connected", atMs: NOW + 40, configId: "conn-opcua", latencyMs: 42 },
    ]);
    const runtime = runtimeOf(state, "conn-opcua");
    expect(runtime.status).toBe("connected");
    expect(runtime.lastLatencyMs).toBe(42);
    expect(runtime.latencySamplesMs).toEqual([42]);
    expect(runtime.attempt).toBe(0);
  });

  it("basarisiz baglanti yeniden denemeye gecer", () => {
    const state = connectorReducer(added, {
      type: "connect_failed",
      atMs: NOW,
      configId: "conn-opcua",
      reason: "ECONNREFUSED",
    });
    const runtime = runtimeOf(state, "conn-opcua");
    expect(runtime.status).toBe("retrying");
    expect(runtime.attempt).toBe(1);
    expect(runtime.nextRetryAtMs).toBe(NOW + BASE_DELAY_MS);
    expect(runtime.detail).toBe("ECONNREFUSED");
  });

  it("art arda basarisizlikta vazgecer", () => {
    let state = added;
    for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
      state = connectorReducer(state, {
        type: "connect_failed",
        atMs: NOW,
        configId: "conn-opcua",
        reason: "timeout",
      });
    }
    const runtime = runtimeOf(state, "conn-opcua");
    expect(runtime.status).toBe("failed");
    expect(state.events[0].level).toBe("critical");
    expect(state.events[0].text).toContain("vazgeçildi");
  });

  it("otomatik baglanma kapaliyken hemen basarisiz olur", () => {
    const manual = stateWith(opcuaConfig({ autoReconnect: false }));
    const state = connectorReducer(manual, {
      type: "connect_failed",
      atMs: NOW,
      configId: "conn-opcua",
      reason: "auth",
    });
    expect(runtimeOf(state, "conn-opcua").status).toBe("failed");
  });

  it("kopma olayini gunluge yazar", () => {
    const state = run(added, [
      { type: "connected", atMs: NOW, configId: "conn-opcua", latencyMs: 40 },
      { type: "disconnect", atMs: NOW + 5, configId: "conn-opcua" },
    ]);
    expect(runtimeOf(state, "conn-opcua").status).toBe("disconnected");
    expect(state.events[0].kind).toBe("disconnected");
    expect(state.events[0].level).toBe("warning");
  });

  it("basarili baglanti deneme sayacini sifirlar", () => {
    const state = run(added, [
      { type: "connect_failed", atMs: NOW, configId: "conn-opcua", reason: "x" },
      { type: "connect_failed", atMs: NOW, configId: "conn-opcua", reason: "x" },
      { type: "connected", atMs: NOW, configId: "conn-opcua", latencyMs: 30 },
    ]);
    expect(runtimeOf(state, "conn-opcua").attempt).toBe(0);
    expect(runtimeOf(state, "conn-opcua").nextRetryAtMs).toBeNull();
  });
});

describe("veri akisi", () => {
  const connected = run(stateWith(opcuaConfig()), [
    { type: "connected", atMs: NOW, configId: "conn-opcua", latencyMs: 40 },
  ]);

  it("gelen kayitlari toplar", () => {
    const state = run(connected, [
      { type: "data", atMs: NOW + 1_000, configId: "conn-opcua", records: 12, latencyMs: 38 },
      { type: "data", atMs: NOW + 2_000, configId: "conn-opcua", records: 8, latencyMs: 41 },
    ]);
    const runtime = runtimeOf(state, "conn-opcua");
    expect(runtime.recordsReceived).toBe(20);
    expect(runtime.lastSyncAtMs).toBe(NOW + 2_000);
    expect(runtime.latencySamplesMs).toHaveLength(3);
  });

  it("veri gelen baglantiyi bagli sayar", () => {
    // Kopmus gorunurken veri islemek, panoyu kendi verisiyle celiskiye dusururdu.
    const state = run(connected, [
      { type: "disconnect", atMs: NOW + 10, configId: "conn-opcua" },
      { type: "data", atMs: NOW + 20, configId: "conn-opcua", records: 3, latencyMs: 30 },
    ]);
    expect(runtimeOf(state, "conn-opcua").status).toBe("connected");
  });

  it("senkron hatasi sayaci artirir ama durumu dusurmez", () => {
    const state = connectorReducer(connected, {
      type: "sync_failed",
      atMs: NOW + 100,
      configId: "conn-opcua",
      reason: "404",
    });
    const runtime = runtimeOf(state, "conn-opcua");
    expect(runtime.syncErrors).toBe(1);
    expect(runtime.status).toBe("connected");
    expect(runtime.detail).toBe("404");
  });

  it("senkron olayini gunluge yazar", () => {
    const state = connectorReducer(connected, {
      type: "sync",
      atMs: NOW + 50,
      configId: "conn-opcua",
      records: 5,
      latencyMs: 44,
    });
    expect(state.events[0].kind).toBe("sync");
    expect(state.events[0].text).toContain("5 kayıt");
  });
});

describe("test eylemi", () => {
  it("basarili testi gunluge yazar ve gecikmeyi saklar", () => {
    const state = connectorReducer(stateWith(opcuaConfig()), {
      type: "test",
      atMs: NOW,
      configId: "conn-opcua",
      ok: true,
      detail: "OPC UA yanıt verdi (40 ms, benzetim).",
      latencyMs: 40,
    });
    expect(state.events[0].kind).toBe("test");
    expect(state.events[0].level).toBe("info");
    expect(runtimeOf(state, "conn-opcua").lastLatencyMs).toBe(40);
  });

  it("basarisiz test gecikme ornegi eklemez", () => {
    const state = connectorReducer(stateWith(opcuaConfig()), {
      type: "test",
      atMs: NOW,
      configId: "conn-opcua",
      ok: false,
      detail: "Endpoint boş.",
      latencyMs: null,
    });
    expect(runtimeOf(state, "conn-opcua").latencySamplesMs).toEqual([]);
    expect(state.events[0].level).toBe("warning");
  });
});

describe("tick", () => {
  it("zamani gelen denemeyi baslatir", () => {
    const failed = connectorReducer(stateWith(opcuaConfig()), {
      type: "connect_failed",
      atMs: NOW,
      configId: "conn-opcua",
      reason: "timeout",
    });
    const state = connectorReducer(failed, {
      type: "tick",
      atMs: NOW + BASE_DELAY_MS,
    });
    expect(runtimeOf(state, "conn-opcua").status).toBe("connecting");
    expect(state.events[0].kind).toBe("retrying");
  });

  it("zamani gelmemis denemeye dokunmaz", () => {
    const failed = connectorReducer(stateWith(opcuaConfig()), {
      type: "connect_failed",
      atMs: NOW,
      configId: "conn-opcua",
      reason: "timeout",
    });
    const state = connectorReducer(failed, { type: "tick", atMs: NOW + 10 });
    expect(state).toBe(failed);
  });

  it("bekleyen baglanti yoksa durumu degistirmez", () => {
    const idle = stateWith(opcuaConfig());
    expect(connectorReducer(idle, { type: "tick", atMs: NOW + 10_000 })).toBe(idle);
  });
});

describe("dugum ve esleme eylemleri", () => {
  it("dugumleri baglanti bazinda degistirir", () => {
    const state = run(initialState(sampleConfigs(), sampleSources()), [
      {
        type: "set_sources",
        atMs: NOW,
        configId: "conn-opcua",
        sources: [sampleSources()[0]],
      },
    ]);
    expect(
      state.sources.filter((item) => item.connectorId === "conn-opcua"),
    ).toHaveLength(1);
    // Diger baglantilarin dugumleri korunur.
    expect(
      state.sources.filter((item) => item.connectorId === "conn-mqtt").length,
    ).toBeGreaterThan(0);
  });

  it("kaybolan dugumun eslemesini temizler", () => {
    const state = run(
      initialState(sampleConfigs(), sampleSources(), sampleMappings()),
      [
        {
          type: "set_sources",
          atMs: NOW,
          configId: "conn-opcua",
          sources: [sampleSources()[0]],
        },
      ],
    );
    expect(state.mappings.some((item) => item.sourceId === "src-opcua-cycle")).toBe(
      false,
    );
    expect(state.mappings.some((item) => item.sourceId === "src-opcua-queue")).toBe(
      true,
    );
  });

  it("eslemeleri toptan degistirir", () => {
    const state = connectorReducer(initialState(sampleConfigs()), {
      type: "set_mappings",
      atMs: NOW,
      mappings: sampleMappings(),
    });
    expect(state.mappings).toHaveLength(sampleMappings().length);
  });
});

describe("olay gunlugu", () => {
  it("en yeni olay basta durur", () => {
    const state = run(stateWith(opcuaConfig()), [
      { type: "connect", atMs: NOW + 1, configId: "conn-opcua" },
      { type: "connected", atMs: NOW + 2, configId: "conn-opcua", latencyMs: 40 },
    ]);
    expect(state.events[0].kind).toBe("connected");
    expect(state.events[state.events.length - 1].text).toContain("eklendi");
  });

  it("siniri asmaz", () => {
    let state = stateWith(opcuaConfig());
    for (let index = 0; index < EVENT_LIMIT + 20; index += 1) {
      state = connectorReducer(state, {
        type: "sync",
        atMs: NOW + index,
        configId: "conn-opcua",
        records: 1,
        latencyMs: 30,
      });
    }
    expect(state.events).toHaveLength(EVENT_LIMIT);
  });

  it("olay kimlikleri benzersizdir", () => {
    let state = stateWith(opcuaConfig());
    for (let index = 0; index < 20; index += 1) {
      state = connectorReducer(state, {
        type: "sync",
        atMs: NOW,
        configId: "conn-opcua",
        records: 1,
        latencyMs: 30,
      });
    }
    expect(new Set(state.events.map((item) => item.id)).size).toBe(
      state.events.length,
    );
  });

  it("taninmayan baglantinin eylemi gunluge girmez", () => {
    const state = stateWith(opcuaConfig());
    const next = connectorReducer(state, {
      type: "connected",
      atMs: NOW,
      configId: "yok",
      latencyMs: 10,
    });
    expect(next).toBe(state);
  });
});

describe("simulateTest", () => {
  it("eksik ayarda basarisiz olur ve nedenini soyler", () => {
    // Test hep "basarili" donseydi, kullanici ayni hatalarla ilk gercek
    // baglantida karsilasirdi.
    const result = simulateTest({
      ...createConfig("mqtt", "c1"),
    });
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.detail).toContain("Broker");
  });

  it("dogru ayarda gecikme doner", () => {
    const result = simulateTest(opcuaConfig(), () => 0.5);
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(Math.round(BASE_LATENCY_MS.opcua));
    expect(result.detail).toContain("benzetim");
  });

  it("protokole gore farkli gecikme uretir", () => {
    const rest = sampleConfigs().find((item) => item.kind === "rest");
    const opcua = simulateTest(opcuaConfig(), () => 0.5).latencyMs ?? 0;
    const restLatency = simulateTest(rest!, () => 0.5).latencyMs ?? 0;
    expect(restLatency).toBeGreaterThan(opcua);
  });

  it("rastgelelik disaridan verilir; ayni tohum ayni sonucu verir", () => {
    const first = simulateTest(opcuaConfig(), () => 0.25);
    const second = simulateTest(opcuaConfig(), () => 0.25);
    expect(first).toEqual(second);
  });

  it("yalnizca uyari varsa test gecer", () => {
    const rest = sampleConfigs().find((item) => item.kind === "rest");
    const insecure = {
      ...rest!,
      settings: { ...rest!.settings, baseUrl: "http://mes.local" },
    };
    expect(simulateTest(insecure, () => 0.5).ok).toBe(true);
  });
});

describe("ConnectorStore", () => {
  it("durum degisince aboneleri uyarir", () => {
    const store = new ConnectorStore(emptyState());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.dispatch({ type: "add", atMs: NOW, config: opcuaConfig() });
    expect(calls).toBe(1);
    expect(store.getState().configs).toHaveLength(1);

    unsubscribe();
    store.dispatch({ type: "connect", atMs: NOW, configId: "conn-opcua" });
    expect(calls).toBe(1);
  });

  it("durum degismediyse uyarmaz", () => {
    const store = new ConnectorStore(initialState([opcuaConfig()]));
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: "connected", atMs: NOW, configId: "yok", latencyMs: 5 });
    expect(calls).toBe(0);
  });
});
