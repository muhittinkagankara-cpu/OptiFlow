import { describe, expect, it } from "vitest";
import {
  CumulativeCounters,
  DEVICE_EVENT_KIND,
  describeBridgeEvent,
  latencyOf,
  matchStation,
  toLiveEventStream,
  toLiveEvents,
  unmappedMachines,
} from "./mapping";
import type { BridgeEvent } from "./types";

const START = 1_700_000_000_000;
const OPTIONS = { knownStationIds: ["torna", "kaynak"], startedAtMs: START };

function event(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    sequence: 1,
    connectionId: "hat-1",
    kind: DEVICE_EVENT_KIND,
    level: "info",
    message: "olcum",
    atMs: START + 60_000,
    data: { station_id: "torna" },
    ...overrides,
  };
}

describe("toLiveEvents", () => {
  it("cihaz olayi olmayan kayit cevrilmez", () => {
    // Baglantinin yasam dongusu uretim verisi degildir.
    expect(toLiveEvents(event({ kind: "probe" }), OPTIONS)).toEqual([]);
  });

  it("istasyon kimligi yoksa cevrilmez", () => {
    // Eksik alani tahmin etmek, olmamis bir uretimi ekrana yazardi.
    expect(toLiveEvents(event({ data: { produced: 3 } }), OPTIONS)).toEqual([]);
  });

  it("bilinmeyen istasyon cevrilmez", () => {
    const item = event({ data: { station_id: "yok", produced: 3 } });
    expect(toLiveEvents(item, OPTIONS)).toEqual([]);
  });

  it("olcum yoksa bos doner", () => {
    expect(toLiveEvents(event(), OPTIONS)).toEqual([]);
  });

  it("uretim olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", produced: 3 } });
    expect(toLiveEvents(item, OPTIONS)).toEqual([
      { type: "part_completed", atMinutes: 1, stationId: "torna", quantity: 3 },
    ]);
  });

  it("sifir uretim olay uretmez", () => {
    const item = event({ data: { station_id: "torna", produced: 0 } });
    expect(toLiveEvents(item, OPTIONS)).toEqual([]);
  });

  it("fire olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", scrapped: 2 } });
    expect(toLiveEvents(item, OPTIONS)[0].type).toBe("part_scrapped");
  });

  it("kuyruk olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", queue: 5 } });
    expect(toLiveEvents(item, OPTIONS)[0]).toEqual({
      type: "queue_changed",
      atMinutes: 1,
      stationId: "torna",
      queue: 5,
    });
  });

  it("sifir kuyruk da anlamlidir", () => {
    // Kuyrugun bosalmasi olculmus bir bilgidir.
    const item = event({ data: { station_id: "torna", queue: 0 } });
    expect(toLiveEvents(item, OPTIONS)).toHaveLength(1);
  });

  it("oee olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", oee: 0.82 } });
    expect(toLiveEvents(item, OPTIONS)[0]).toEqual({
      type: "oee_sampled",
      atMinutes: 1,
      stationId: "torna",
      oee: 0.82,
    });
  });

  it("aralik disi oee cevrilmez", () => {
    const item = event({ data: { station_id: "torna", oee: 1.4 } });
    expect(toLiveEvents(item, OPTIONS)).toEqual([]);
  });

  it("ariza olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", fault: "Kalıp sıkıştı" } });
    expect(toLiveEvents(item, OPTIONS)[0]).toEqual({
      type: "machine_fault",
      atMinutes: 1,
      stationId: "torna",
      reason: "Kalıp sıkıştı",
    });
  });

  it("tamir olayi cevrilir", () => {
    const item = event({ data: { station_id: "torna", repaired: true } });
    expect(toLiveEvents(item, OPTIONS)[0].type).toBe("machine_repaired");
  });

  it("tek olaydan birden cok canli olay cikabilir", () => {
    const item = event({
      data: { station_id: "torna", produced: 2, scrapped: 1, oee: 0.9 },
    });
    expect(toLiveEvents(item, OPTIONS)).toHaveLength(3);
  });

  it("dakika baslangica gore hesaplanir", () => {
    const item = event({
      atMs: START + 5 * 60_000,
      data: { station_id: "torna", produced: 1 },
    });
    expect(toLiveEvents(item, OPTIONS)[0].atMinutes).toBe(5);
  });

  it("gecmis zamanli olay negatif dakika uretmez", () => {
    const item = event({
      atMs: START - 60_000,
      data: { station_id: "torna", produced: 1 },
    });
    expect(toLiveEvents(item, OPTIONS)[0].atMinutes).toBe(0);
  });

  it("sayi olmayan alan yok sayilir", () => {
    const item = event({ data: { station_id: "torna", produced: "3" } });
    expect(toLiveEvents(item, OPTIONS)).toEqual([]);
  });

  it("bos istasyon listesinde hicbir sey cevrilmez", () => {
    const item = event({ data: { station_id: "torna", produced: 1 } });
    expect(toLiveEvents(item, { knownStationIds: [], startedAtMs: START })).toEqual([]);
  });
});

describe("toLiveEventStream", () => {
  it("listeyi toplu cevirir", () => {
    const items = [
      event({ data: { station_id: "torna", produced: 1 } }),
      event({ data: { station_id: "kaynak", produced: 2 } }),
    ];
    expect(toLiveEventStream(items, OPTIONS)).toHaveLength(2);
  });

  it("cevrilemeyenler atlanir", () => {
    const items = [event({ kind: "probe" }), event({ data: { station_id: "torna", produced: 1 } })];
    expect(toLiveEventStream(items, OPTIONS)).toHaveLength(1);
  });

  it("bos listede bos doner", () => {
    expect(toLiveEventStream([], OPTIONS)).toEqual([]);
  });
});

describe("describeBridgeEvent", () => {
  it("kanit varsa mesaja eklenir", () => {
    const item = event({ message: "Hat 1: yanıt verdi", data: { evidence: "HTTP 200" } });
    expect(describeBridgeEvent(item)).toBe("Hat 1: yanıt verdi — HTTP 200");
  });

  it("kanit yoksa yalnizca mesaj doner", () => {
    expect(describeBridgeEvent(event({ message: "Hat 1: kapalı" }))).toBe("Hat 1: kapalı");
  });

  it("bos kanit eklenmez", () => {
    const item = event({ message: "m", data: { evidence: "" } });
    expect(describeBridgeEvent(item)).toBe("m");
  });
});

describe("latencyOf", () => {
  it("olculen gecikmeyi verir", () => {
    expect(latencyOf(event({ data: { latency_ms: 12.5 } }))).toBe(12.5);
  });

  it("olculmemis gecikme null doner", () => {
    expect(latencyOf(event({ data: {} }))).toBeNull();
  });

  it("sayi olmayan gecikme null doner", () => {
    expect(latencyOf(event({ data: { latency_ms: "12" } }))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Ölçüm tabanlı cihaz olayları (SALES-10 boru hattı)                           */
/* -------------------------------------------------------------------------- */

function metricEvent(data: Record<string, unknown>, atMs = START + 60_000): BridgeEvent {
  return {
    sequence: 1,
    connectionId: "plc-1",
    kind: DEVICE_EVENT_KIND,
    level: "info",
    message: "ölçüm",
    atMs,
    data,
  };
}

describe("matchStation", () => {
  it("birebir eslesme bulunur", () => {
    expect(matchStation("torna", ["torna", "kaynak"])).toBe("torna");
  });

  it("buyuk kucuk harf duyarsizdir", () => {
    // PLC "TORNA_01" yazar, modelde "torna_01" durur.
    expect(matchStation("TORNA_01", ["torna_01"])).toBe("torna_01");
  });

  it("bosluklar kirpilir", () => {
    expect(matchStation("  torna ", ["torna"])).toBe("torna");
  });

  it("eslesmeyen makine null doner", () => {
    expect(matchStation("pres", ["torna"])).toBeNull();
  });
});

describe("olcum tabanli cevrim", () => {
  it("takipci olmadan kumulatif sayac cevrilmez", () => {
    /*
     * Tarayicida gorulen hata: mutlak sayac her olcumde yeniden toplaniyor ve
     * ekran, gercekte 162 parca uretilmisken 4968 gosteriyordu.
     */
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 3 }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("ilk okuma artis uretmez", () => {
    // Taban bilinmeden kac parca uretildigi bilinemez.
    const counters = new CumulativeCounters();
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 1240 }),
      { ...OPTIONS, counters },
    );
    expect(events).toEqual([]);
  });

  it("ikinci okuma artisi uretir", () => {
    const counters = new CumulativeCounters();
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 1240 }),
      { ...OPTIONS, counters },
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 1243 }),
      { ...OPTIONS, counters },
    );
    expect(events).toEqual([
      { type: "part_completed", atMinutes: 1, stationId: "torna", quantity: 3 },
    ]);
  });

  it("degismeyen sayac olay uretmez", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    const item = metricEvent({ machine_id: "torna", metric: "production_count", value: 10 });
    toLiveEvents(item, options);
    expect(toLiveEvents(item, options)).toEqual([]);
  });

  it("sayac sifirlanirsa olay uretilmez", () => {
    // Vardiya degisimi ya da PLC yeniden baslatma; sahte bir uretim
    // patlamasi gosterilmez.
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 900 }),
      options,
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 5 }),
      options,
    );
    expect(events).toEqual([]);
  });

  it("sifirlamadan sonra yeni taban kullanilir", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    let events: ReturnType<typeof toLiveEvents> = [];
    for (const value of [900, 5, 8]) {
      events = toLiveEvents(
        metricEvent({ machine_id: "torna", metric: "production_count", value }),
        options,
      );
    }
    expect(events).toEqual([
      { type: "part_completed", atMinutes: 1, stationId: "torna", quantity: 3 },
    ]);
  });

  it("istasyonlar ayri sayilir", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 100 }),
      options,
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "kaynak", metric: "production_count", value: 50 }),
      options,
    );
    expect(events).toEqual([]);
    expect(counters.trackedCount).toBe(2);
  });

  it("fire de artis olarak cevrilir", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "scrap_count", value: 4 }),
      options,
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "scrap_count", value: 6 }),
      options,
    );
    expect(events[0]).toEqual({
      type: "part_scrapped",
      atMinutes: 1,
      stationId: "torna",
      quantity: 2,
    });
  });

  it("uretim ve fire sayaclari birbirine karismaz", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 100 }),
      options,
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "scrap_count", value: 100 }),
      options,
    );
    expect(events).toEqual([]);
  });

  it("kuyruk queue_changed uretir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "queue_length", value: 4 }),
      OPTIONS,
    );
    expect(events[0]).toEqual({
      type: "queue_changed",
      atMinutes: 1,
      stationId: "torna",
      queue: 4,
    });
  });

  it("sifir kuyruk da anlamlidir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "queue_length", value: 0 }),
      OPTIONS,
    );
    expect(events).toHaveLength(1);
  });

  it("oee oee_sampled uretir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "oee", value: 0.82 }),
      OPTIONS,
    );
    expect(events[0]).toEqual({
      type: "oee_sampled",
      atMinutes: 1,
      stationId: "torna",
      oee: 0.82,
    });
  });

  it("aralik disi oee cevrilmez", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "oee", value: 3 }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("durus machine_fault uretir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "machine_status", value: "down" }),
      OPTIONS,
    );
    expect(events[0].type).toBe("machine_fault");
  });

  it("calisma machine_repaired uretir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "machine_status", value: "running" }),
      OPTIONS,
    );
    expect(events[0].type).toBe("machine_repaired");
  });

  it("ayar setup_started uretir", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "machine_status", value: "setup" }),
      OPTIONS,
    );
    expect(events[0].type).toBe("setup_started");
  });

  it("bilinmeyen durum olay uretmez", () => {
    // "Bilinmiyor" icin olay uretmek, ekranda olmayan bir degisiklik gosterirdi.
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "machine_status", value: "unknown" }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("modelde olmayan makine cevrilmez", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "pres", metric: "production_count", value: 5 }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("taninmayan olcum cevrilmez", () => {
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "cycle_time_seconds", value: 12 }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("makine kimligi yoksa cevrilmez", () => {
    const events = toLiveEvents(
      metricEvent({ metric: "production_count", value: 5 }),
      OPTIONS,
    );
    expect(events).toEqual([]);
  });

  it("sifir uretim olay uretmez", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 0 }),
      options,
    );
    const events = toLiveEvents(
      metricEvent({ machine_id: "torna", metric: "production_count", value: 0 }),
      options,
    );
    expect(events).toEqual([]);
  });

  it("eski bicim hala calisir", () => {
    // Iki bicim de desteklenir; eski sozlesme bozulmadi.
    const events = toLiveEvents(
      metricEvent({ station_id: "torna", produced: 2 }),
      OPTIONS,
    );
    expect(events[0].type).toBe("part_completed");
  });
});

describe("unmappedMachines", () => {
  it("eslesmeyen makineler listelenir", () => {
    const events = [
      metricEvent({ machine_id: "pres", metric: "production_count", value: 1 }),
      metricEvent({ machine_id: "torna", metric: "production_count", value: 1 }),
    ];
    expect(unmappedMachines(events, OPTIONS.knownStationIds)).toEqual(["pres"]);
  });

  it("ayni makine bir kez listelenir", () => {
    const events = [
      metricEvent({ machine_id: "pres", metric: "production_count", value: 1 }),
      metricEvent({ machine_id: "pres", metric: "queue_length", value: 1 }),
    ];
    expect(unmappedMachines(events, OPTIONS.knownStationIds)).toEqual(["pres"]);
  });

  it("cihaz olayi olmayan kayit sayilmaz", () => {
    const probe: BridgeEvent = {
      sequence: 2,
      connectionId: "plc-1",
      kind: "probe",
      level: "info",
      message: "x",
      atMs: START,
      data: { machine_id: "pres" },
    };
    expect(unmappedMachines([probe], OPTIONS.knownStationIds)).toEqual([]);
  });

  it("hepsi eslesiyorsa bos doner", () => {
    const events = [
      metricEvent({ machine_id: "torna", metric: "production_count", value: 1 }),
    ];
    expect(unmappedMachines(events, OPTIONS.knownStationIds)).toEqual([]);
  });
});

describe("kaynak başına sayaç", () => {
  it("iki kaynak birbirinin sayacini bozmaz", () => {
    /*
     * Tarayicida gorulen hata: ayni istasyona OPC UA (1100) ve MQTT (200)
     * yazinca tek anahtarli takipci her geciste yuzlerce parcalik sahte
     * artis uretiyordu.
     */
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };

    const opcua = (value: number): BridgeEvent => ({
      ...metricEvent({ machine_id: "torna", metric: "production_count", value }),
      connectionId: "plc-1",
    });
    const mqtt = (value: number): BridgeEvent => ({
      ...metricEvent({ machine_id: "torna", metric: "production_count", value }),
      connectionId: "broker-1",
    });

    toLiveEvents(opcua(1100), options);
    toLiveEvents(mqtt(200), options);
    const fromOpcua = toLiveEvents(opcua(1107), options);
    const fromMqtt = toLiveEvents(mqtt(202), options);

    expect(fromOpcua).toEqual([
      { type: "part_completed", atMinutes: 1, stationId: "torna", quantity: 7 },
    ]);
    expect(fromMqtt).toEqual([
      { type: "part_completed", atMinutes: 1, stationId: "torna", quantity: 2 },
    ]);
  });

  it("her kaynak ayri taban tutar", () => {
    const counters = new CumulativeCounters();
    const options = { ...OPTIONS, counters };
    toLiveEvents(
      { ...metricEvent({ machine_id: "torna", metric: "production_count", value: 10 }), connectionId: "a" },
      options,
    );
    toLiveEvents(
      { ...metricEvent({ machine_id: "torna", metric: "production_count", value: 10 }), connectionId: "b" },
      options,
    );
    expect(counters.trackedCount).toBe(2);
  });
});
