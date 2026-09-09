import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../live/events";
import type {
  ConnectionStatus,
  LiveDataProvider,
  LiveEventListener,
  StatusListener,
} from "../live/providers";
import { sampleConfigs } from "./fixtures";
import { ConnectorLiveProvider, countRecords, toConnectionStatus } from "./stream";

/** Testlerin denetlediği sahte sağlayıcı. */
class FakeProvider implements LiveDataProvider {
  readonly id = "fake";
  readonly name = "Sahte";
  readonly description = "Test";
  readonly isAvailable = true;
  status: ConnectionStatus = "idle";
  connectCalls = 0;
  disconnectCalls = 0;
  private listeners = new Set<LiveEventListener>();

  readonly isLive: boolean;

  constructor(isLive = false) {
    this.isLive = isLive;
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.status = "connected";
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.status = "disconnected";
  }

  subscribe(cb: LiveEventListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onStatus(_cb: StatusListener): () => void {
    return () => undefined;
  }

  emit(events: LiveEvent[]): void {
    for (const listener of this.listeners) {
      listener(events);
    }
  }
}

const CONFIG = sampleConfigs()[0];

describe("toConnectionStatus", () => {
  it("yeniden denemeyi canli ekran icin 'baglaniyor' sayar", () => {
    // Iki katmanin durum kumeleri birebir ayni degildir ve olmamalidir.
    expect(toConnectionStatus("retrying")).toBe("connecting");
    expect(toConnectionStatus("connecting")).toBe("connecting");
  });

  it("diger durumlari birebir cevirir", () => {
    expect(toConnectionStatus("connected")).toBe("connected");
    expect(toConnectionStatus("failed")).toBe("error");
    expect(toConnectionStatus("disconnected")).toBe("disconnected");
    expect(toConnectionStatus("idle")).toBe("idle");
  });
});

describe("ConnectorLiveProvider", () => {
  it("baglanti adini ve protokolu gosterir", () => {
    const provider = new ConnectorLiveProvider(CONFIG, new FakeProvider());
    expect(provider.name).toBe("Hat 1 PLC (OPC UA)");
    expect(provider.id).toBe("connector:conn-opcua");
  });

  it("benzetim verisini canli ilan etmez", () => {
    // Urunun en tehlikeli yalani bu olurdu.
    const provider = new ConnectorLiveProvider(CONFIG, new FakeProvider(false));
    expect(provider.isLive).toBe(false);
    expect(provider.description).toContain("benzetim");
  });

  it("ic saglayici canliysa canli sayilir", () => {
    const provider = new ConnectorLiveProvider(CONFIG, new FakeProvider(true));
    expect(provider.isLive).toBe(true);
    expect(provider.description).toContain("canlı");
  });

  it("durumu ic saglayicidan okur", async () => {
    const inner = new FakeProvider();
    const provider = new ConnectorLiveProvider(CONFIG, inner);
    expect(provider.status).toBe("idle");
    await provider.connect();
    expect(provider.status).toBe("connected");
    expect(inner.connectCalls).toBe(1);
  });

  it("baglantiyi kapatmayi ic saglayiciya iletir", async () => {
    const inner = new FakeProvider();
    const provider = new ConnectorLiveProvider(CONFIG, inner);
    await provider.disconnect();
    expect(inner.disconnectCalls).toBe(1);
  });

  it("olaylari degistirmeden gecirir", () => {
    const inner = new FakeProvider();
    const provider = new ConnectorLiveProvider(CONFIG, inner);
    const seen: LiveEvent[][] = [];
    provider.subscribe((events) => seen.push(events));

    const batch: LiveEvent[] = [{ type: "tick", atMinutes: 10 }];
    inner.emit(batch);
    expect(seen).toEqual([batch]);
  });

  it("baglayici katmanini da olaylardan haberdar eder", () => {
    const inner = new FakeProvider();
    const seenByConnector: LiveEvent[][] = [];
    const provider = new ConnectorLiveProvider(CONFIG, inner, (events) =>
      seenByConnector.push(events),
    );
    provider.subscribe(() => undefined);

    inner.emit([{ type: "tick", atMinutes: 1 }]);
    expect(seenByConnector).toHaveLength(1);
  });

  it("abonelikten cikinca olay gelmez", () => {
    const inner = new FakeProvider();
    const provider = new ConnectorLiveProvider(CONFIG, inner);
    let calls = 0;
    const unsubscribe = provider.subscribe(() => {
      calls += 1;
    });
    inner.emit([{ type: "tick", atMinutes: 1 }]);
    unsubscribe();
    inner.emit([{ type: "tick", atMinutes: 2 }]);
    expect(calls).toBe(1);
  });
});

describe("countRecords", () => {
  it("saat vurusunu kayit saymaz", () => {
    // Bos vurusu veri saymak, hic veri gelmeyen bir baglantiyi saglikli
    // gosterirdi.
    expect(countRecords([{ type: "tick", atMinutes: 1 }])).toBe(0);
  });

  it("gercek olaylari sayar", () => {
    const events: LiveEvent[] = [
      { type: "tick", atMinutes: 1 },
      { type: "part_completed", atMinutes: 1, stationId: "a", quantity: 1 },
      { type: "station_idled", atMinutes: 2, stationId: "a" },
    ];
    expect(countRecords(events)).toBe(2);
  });

  it("bos pakette sifir doner", () => {
    expect(countRecords([])).toBe(0);
  });
});
