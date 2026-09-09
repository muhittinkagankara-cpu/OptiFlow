import { describe, expect, it } from "vitest";
import { BridgeLiveProvider } from "./provider";
import { DEVICE_EVENT_KIND } from "./mapping";
import type { BridgeEvent } from "./types";
import type { RuntimeBridgeClient } from "./client";
import { parseRuntimeLiveState } from "./live";

const START = 1_700_000_000_000;

/** Akışı açmadan olay besleyebilmek için sahte istemci. */
function fakeClient(machines: unknown[] = []): {
  client: RuntimeBridgeClient;
  push: (event: BridgeEvent) => void;
  fail: (message: string) => void;
  streamCalls: () => number;
} {
  let onEvent: ((event: BridgeEvent) => void) | null = null;
  let onError: ((message: string) => void) | null = null;
  let calls = 0;

  const client = {
    live: async () => ({
      data: parseRuntimeLiveState({ machines }),
      error: null,
    }),
    stream: async (
      handler: (event: BridgeEvent) => void,
      errorHandler: (message: string) => void,
    ) => {
      calls += 1;
      onEvent = handler;
      onError = errorHandler;
      return () => undefined;
    },
  } as unknown as RuntimeBridgeClient;

  return {
    client,
    push: (event) => onEvent?.(event),
    fail: (message) => onError?.(message),
    streamCalls: () => calls,
  };
}

function deviceEvent(data: Record<string, unknown>, kind = DEVICE_EVENT_KIND): BridgeEvent {
  return {
    sequence: 1,
    connectionId: "plc-1",
    kind,
    level: "info",
    message: "ölçüm",
    atMs: START + 60_000,
    data,
  };
}

async function provider(
  options: Record<string, unknown> = {},
  machines: unknown[] = [],
) {
  const fake = fakeClient(machines);
  const instance = new BridgeLiveProvider({
    client: fake.client,
    stationIds: ["torna", "kaynak"],
    startedAtMs: START,
    ...options,
  });
  await instance.connect();
  /*
   * Akış açılışı asenkrondur ve önce snapshot çekilir; birkaç mikro görev
   * turu beklenir ki hem ilk yükleme hem akış hazır olsun.
   */
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
  return { instance, fake };
}

describe("sözleşme", () => {
  it("canli veri saglayicisi arayuzunu karsilar", async () => {
    const { instance } = await provider();
    expect(typeof instance.connect).toBe("function");
    expect(typeof instance.disconnect).toBe("function");
    expect(typeof instance.subscribe).toBe("function");
    expect(typeof instance.onStatus).toBe("function");
  });

  it("kimlik ve ad tasir", async () => {
    const { instance } = await provider();
    expect(instance.id).toBe("bridge");
    expect(instance.name).toContain("köprü");
  });

  it("aciklama cihaz dogrulanmadan veri gelmeyecegini yazar", async () => {
    const { instance } = await provider();
    expect(instance.description).toContain("doğrulanmadıysa");
  });

  it("baglanti durumu izlenir", async () => {
    const { instance } = await provider();
    expect(instance.status).toBe("connected");
  });
});

describe("cihaz olayları", () => {
  it("kumulatif sayacin ilk okumasi olay uretmez", () => {
    // Taban bilinmeden uretim hesaplanamaz; sayacin tamami uretim sayilsaydi
    // ekranda hic olmamis parcalar gorunurdu (tarayicida yasandi).
    return provider().then(({ instance, fake }) => {
      const received: unknown[] = [];
      instance.subscribe((events) => received.push(...events));
      fake.push(deviceEvent({ machine_id: "torna", metric: "production_count", value: 4 }));
      expect(received).toHaveLength(0);
    });
  });

  it("ikinci okuma artisi canli olaya cevrilir", async () => {
    const { instance, fake } = await provider();
    const received: { type: string; quantity?: number }[] = [];
    instance.subscribe((events) => received.push(...(events as never[])));
    fake.push(deviceEvent({ machine_id: "torna", metric: "production_count", value: 100 }));
    fake.push(deviceEvent({ machine_id: "torna", metric: "production_count", value: 103 }));
    expect(received).toHaveLength(1);
    expect(received[0].quantity).toBe(3);
  });

  it("cihaz olayi geri cagriya iletilir", async () => {
    const seen: BridgeEvent[] = [];
    const { fake } = await provider({ onDeviceEvent: (event: BridgeEvent) => seen.push(event) });
    fake.push(deviceEvent({ machine_id: "torna", metric: "queue_length", value: 2 }));
    expect(seen).toHaveLength(1);
  });

  it("ilk olcum gelene kadar veri yok sayilir", async () => {
    const { instance } = await provider();
    expect(instance.hasDeviceData).toBe(false);
    expect(instance.lastDeviceEventAtMs).toBeNull();
  });

  it("olcum gelince veri isaretlenir", async () => {
    const { instance, fake } = await provider();
    fake.push(deviceEvent({ machine_id: "torna", metric: "queue_length", value: 1 }));
    expect(instance.hasDeviceData).toBe(true);
    expect(instance.lastDeviceEventAtMs).toBe(START + 60_000);
  });

  it("cevrilen olay sayilir", async () => {
    const { instance, fake } = await provider();
    fake.push(deviceEvent({ machine_id: "torna", metric: "queue_length", value: 2 }));
    expect(instance.translationCounts.translated).toBe(1);
  });

  it("eslesmeyen makine cevrilemedi olarak sayilir", async () => {
    // Sessizce atilsaydi "veri geliyor ama ekran degismiyor" yanitsiz kalirdi.
    const { instance, fake } = await provider();
    fake.push(deviceEvent({ machine_id: "pres", metric: "production_count", value: 1 }));
    expect(instance.translationCounts.untranslated).toBe(1);
    expect(instance.translationCounts.translated).toBe(0);
  });

  it("olcum geldi ama cevrilemedi de veri sayilir", async () => {
    // Cihazdan veri akiyor; sorun eslemede. Ekran bunu ayirt edebilmeli.
    const { instance, fake } = await provider();
    fake.push(deviceEvent({ machine_id: "pres", metric: "production_count", value: 1 }));
    expect(instance.hasDeviceData).toBe(true);
  });
});

describe("sağlık ve tanılama olayları", () => {
  it("saglik olayi ayri geri cagriya gider", async () => {
    const health: BridgeEvent[] = [];
    const { fake } = await provider({ onHealthEvent: (event: BridgeEvent) => health.push(event) });
    fake.push(deviceEvent({}, "probe"));
    expect(health).toHaveLength(1);
  });

  it("saglik olayi canli akisa girmez", async () => {
    const { instance, fake } = await provider();
    const received: unknown[] = [];
    instance.subscribe((events) => received.push(...events));
    fake.push(deviceEvent({}, "retry"));
    expect(received).toHaveLength(0);
  });

  it("tanilama olayi ayri geri cagriya gider", async () => {
    const diagnostics: BridgeEvent[] = [];
    const { fake } = await provider({
      onDiagnostic: (event: BridgeEvent) => diagnostics.push(event),
    });
    fake.push(deviceEvent({ reason: "bozuk" }, "diagnostic"));
    expect(diagnostics).toHaveLength(1);
  });

  it("tanilama olayi cihaz verisi sayilmaz", async () => {
    const { instance, fake } = await provider();
    fake.push(deviceEvent({ reason: "bozuk" }, "diagnostic"));
    expect(instance.hasDeviceData).toBe(false);
  });

  it("akis olaylari da saglik sayilir", async () => {
    const health: BridgeEvent[] = [];
    const { fake } = await provider({ onHealthEvent: (event: BridgeEvent) => health.push(event) });
    fake.push(deviceEvent({}, "stream_started"));
    fake.push(deviceEvent({}, "stream_stopped"));
    expect(health).toHaveLength(2);
  });

  it("tum olaylar ham geri cagriya gider", async () => {
    const all: BridgeEvent[] = [];
    const { fake } = await provider({ onBridgeEvent: (event: BridgeEvent) => all.push(event) });
    fake.push(deviceEvent({}, "probe"));
    fake.push(deviceEvent({ machine_id: "torna", metric: "oee", value: 0.9 }));
    expect(all).toHaveLength(2);
  });
});

describe("hata yolu", () => {
  it("akis hatasi durumu hataya cevirir", async () => {
    const { instance, fake } = await provider();
    fake.fail("Akış koptu.");
    expect(instance.status).toBe("error");
  });

  it("kapatma sonrasi durum degisir", async () => {
    const { instance } = await provider();
    await instance.disconnect();
    expect(instance.status).toBe("disconnected");
  });
});

describe("ilk yükleme (snapshot)", () => {
  it("baslangicta makine goruntusu alinmamis sayilir", async () => {
    const { instance } = await provider();
    expect(instance.seededMachineCount).toBe(0);
  });

  it("modeldeki makineler yansitilir", async () => {
    const { instance } = await provider({}, [
      { machine_id: "torna", status: "running", queue_length: 3 },
    ]);
    expect(instance.seededMachineCount).toBe(1);
  });

  it("modelde olmayan makine yansitilmaz", async () => {
    const { instance } = await provider({}, [{ machine_id: "pres", queue_length: 3 }]);
    expect(instance.seededMachineCount).toBe(0);
  });

  it("kuyruk degeri canli olaya cevrilir", async () => {
    const received: { type: string }[] = [];
    const fake = fakeClient([{ machine_id: "torna", queue_length: 4 }]);
    const instance = new BridgeLiveProvider({
      client: fake.client,
      stationIds: ["torna", "kaynak"],
      startedAtMs: START,
    });
    instance.subscribe((events) => received.push(...events));
    await instance.connect();
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
    expect(received.some((event) => event.type === "queue_changed")).toBe(true);
  });

  it("durus goruntusu ariza olayina cevrilir", async () => {
    const received: { type: string }[] = [];
    const fake = fakeClient([{ machine_id: "torna", status: "down" }]);
    const instance = new BridgeLiveProvider({
      client: fake.client,
      stationIds: ["torna"],
      startedAtMs: START,
    });
    instance.subscribe((events) => received.push(...events));
    await instance.connect();
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
    expect(received.some((event) => event.type === "machine_fault")).toBe(true);
  });

  it("uretim sayaci yansitilmaz", async () => {
    /*
     * Cihaz sayaci kumulatiftir; canli ekranin sayaci "baglandigimdan beri"
     * demektir. Ikisini toplamak, hic uretilmemis binlerce parca gosterirdi.
     */
    const received: { type: string }[] = [];
    const fake = fakeClient([{ machine_id: "torna", production_count: 1240 }]);
    const instance = new BridgeLiveProvider({
      client: fake.client,
      stationIds: ["torna"],
      startedAtMs: START,
    });
    instance.subscribe((events) => received.push(...events));
    await instance.connect();
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }
    expect(received.some((event) => event.type === "part_completed")).toBe(false);
  });
});

describe("yeniden bağlanma", () => {
  it("baslangicta yeniden baglanma yok", async () => {
    const { instance } = await provider();
    expect(instance.reconnectCount).toBe(0);
  });

  it("kopmada durum hata olur", async () => {
    const { instance, fake } = await provider();
    fake.fail("Akış koptu.");
    expect(instance.status).toBe("error");
  });

  it("kapatma bekleyen yeniden baglanmayi iptal eder", async () => {
    // Kapatilmis bir ekran arkada yeniden baglanmaya calismamali.
    const { instance, fake } = await provider();
    fake.fail("Akış koptu.");
    await instance.disconnect();
    expect(instance.status).toBe("disconnected");
  });
});
