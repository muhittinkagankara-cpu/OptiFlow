import { describe, expect, it } from "vitest";
import {
  FEED_LABEL,
  MACHINE_STATE_LABEL,
  METRIC_LABEL,
  describeStream,
  feedStatus,
  parseDevicePage,
  parseMachineState,
  parseMappingWarning,
  parseMetric,
  parseProblem,
  parseQuality,
  parseReading,
  parseSnapshot,
  parseStream,
  unmeasuredFields,
  type MachineSnapshot,
  type StreamStatus,
} from "./devices";

function stream(overrides: Partial<StreamStatus> = {}): StreamStatus {
  return {
    connectionId: "c1",
    kind: "opcua",
    running: false,
    hasData: false,
    firstDataAtMs: null,
    lastDataAtMs: null,
    payloads: 0,
    eventsPublished: 0,
    problems: 0,
    consecutiveFailures: 0,
    lastError: null,
    intervalMs: null,
    monitoredItems: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return {
    machineId: "TORNA_01",
    productionCount: null,
    scrapCount: null,
    queueLength: null,
    state: "unknown",
    downtimeMinutes: null,
    throughputPerHour: null,
    cycleTimeSeconds: null,
    oee: null,
    lastSeenMs: null,
    sampleCount: 0,
    notes: {},
    ...overrides,
  };
}

describe("etiketler", () => {
  it("her olcumun etiketi var", () => {
    expect(METRIC_LABEL.production_count).toBe("Üretim adedi");
    expect(METRIC_LABEL.unknown).toBe("Tanınmayan ölçüm");
  });

  it("her makine durumunun etiketi var", () => {
    expect(MACHINE_STATE_LABEL.running).toBe("Çalışıyor");
    expect(MACHINE_STATE_LABEL.unknown).toBe("Bilinmiyor");
  });

  it("dort besleme durumu tanimli", () => {
    expect(Object.keys(FEED_LABEL)).toEqual([
      "real",
      "waiting",
      "simulated",
      "unverified",
    ]);
  });

  it("besleme etiketleri sozlesmedeki adlar", () => {
    expect(FEED_LABEL.real).toBe("Gerçek Veri");
    expect(FEED_LABEL.waiting).toBe("Veri Bekleniyor");
    expect(FEED_LABEL.simulated).toBe("Benzetim");
    expect(FEED_LABEL.unverified).toBe("Doğrulanmadı");
  });
});

describe("parseMetric", () => {
  it("bilinen olcumu korur", () => {
    expect(parseMetric("queue_length")).toBe("queue_length");
  });

  it("bilinmeyen olcum unknown olur", () => {
    expect(parseMetric("sicaklik")).toBe("unknown");
  });

  it("eksik olcum unknown olur", () => {
    expect(parseMetric(undefined)).toBe("unknown");
  });
});

describe("parseMachineState", () => {
  it("bilinen durumu korur", () => {
    expect(parseMachineState("running")).toBe("running");
  });

  it("bilinmeyen durum bilinmiyor olur", () => {
    // Duran bir makineyi calisiyor gostermek en pahali hatadir.
    expect(parseMachineState("acik")).toBe("unknown");
  });

  it("eksik durum bilinmiyor olur", () => {
    expect(parseMachineState(null)).toBe("unknown");
  });
});

describe("parseQuality", () => {
  it("bilinen kaliteyi korur", () => {
    expect(parseQuality("bad")).toBe("bad");
  });

  it("bilinmeyen kalite belirsiz olur", () => {
    // "iyi" varsaymak, bozuk bir olcumu gecerli kilardi.
    expect(parseQuality("mukemmel")).toBe("uncertain");
  });
});

describe("parseReading", () => {
  const raw = {
    connection_id: "plc-1",
    machine_id: "TORNA_01",
    metric: "production_count",
    value: 1240,
    at_ms: 5_000,
    source: "opcua",
    quality: "good",
    unit: "adet",
    origin: "ns=2;i=2",
    usable: true,
  };

  it("alanlari okur", () => {
    const reading = parseReading(raw);
    expect(reading.machineId).toBe("TORNA_01");
    expect(reading.value).toBe(1240);
    expect(reading.unit).toBe("adet");
  });

  it("metin deger korunur", () => {
    expect(parseReading({ ...raw, value: "running" }).value).toBe("running");
  });

  it("nesne deger null olur", () => {
    expect(parseReading({ ...raw, value: { a: 1 } }).value).toBeNull();
  });

  it("bos gövde cokmeden okunur", () => {
    const reading = parseReading({});
    expect(reading.metric).toBe("unknown");
    expect(reading.usable).toBe(false);
  });

  it("kullanilabilirlik sunucudan gelir", () => {
    expect(parseReading({ ...raw, usable: false }).usable).toBe(false);
  });
});

describe("parseSnapshot", () => {
  it("olculen alanlari okur", () => {
    const item = parseSnapshot({ machine_id: "T", production_count: 5, queue_length: 2 });
    expect(item.productionCount).toBe(5);
    expect(item.queueLength).toBe(2);
  });

  it("olculmeyen alan null kalir", () => {
    const item = parseSnapshot({ machine_id: "T" });
    expect(item.productionCount).toBeNull();
    expect(item.throughputPerHour).toBeNull();
  });

  it("olculmus sifir korunur", () => {
    expect(parseSnapshot({ production_count: 0 }).productionCount).toBe(0);
  });

  it("notlar okunur", () => {
    const item = parseSnapshot({ notes: { production_count: "hiç gelmedi" } });
    expect(item.notes.production_count).toBe("hiç gelmedi");
  });

  it("metin olmayan not atilir", () => {
    expect(parseSnapshot({ notes: { a: 5 } }).notes).toEqual({});
  });

  it("ornek sayisi okunur", () => {
    expect(parseSnapshot({ sample_count: 3 }).sampleCount).toBe(3);
  });
});

describe("parseProblem ve parseMappingWarning", () => {
  it("tanilama okunur", () => {
    const problem = parseProblem({ connection_id: "c", reason: "bozuk", at_ms: 1 });
    expect(problem.reason).toBe("bozuk");
  });

  it("eksik adres null kalir", () => {
    expect(parseProblem({}).origin).toBeNull();
  });

  it("esleme uyarisi okunur", () => {
    const warning = parseMappingWarning({
      machine_id: "X",
      reason: "yok",
      sample_count: 4,
    });
    expect(warning.machineId).toBe("X");
    expect(warning.sampleCount).toBe(4);
  });
});

describe("parseStream", () => {
  it("akis durumu okunur", () => {
    const item = parseStream({
      connection_id: "c1",
      kind: "mqtt",
      running: true,
      has_data: true,
      first_data_at_ms: 100,
      payloads: 3,
    });
    expect(item.running).toBe(true);
    expect(item.hasData).toBe(true);
    expect(item.payloads).toBe(3);
  });

  it("veri gelmediyse ilk veri ani null", () => {
    expect(parseStream({}).firstDataAtMs).toBeNull();
  });

  it("izlenen oge sayisi opsiyonel", () => {
    expect(parseStream({}).monitoredItems).toBeNull();
  });
});

describe("parseDevicePage", () => {
  it("bos gövde cokmeden okunur", () => {
    const page = parseDevicePage({});
    expect(page.events).toEqual([]);
    expect(page.machines).toEqual([]);
    expect(page.summary.deviceEvents).toBe(0);
  });

  it("olculmemis uretim toplami null", () => {
    // Hic olcum yoksa toplam sifir degil, bilinmiyordur.
    expect(parseDevicePage({}).summary.productionCount).toBeNull();
  });

  it("olaylar cozulur", () => {
    const page = parseDevicePage({ events: [{ machine_id: "A" }, { machine_id: "B" }] });
    expect(page.events).toHaveLength(2);
  });

  it("makineler cozulur", () => {
    const page = parseDevicePage({ machines: [{ machine_id: "A", production_count: 3 }] });
    expect(page.machines[0].productionCount).toBe(3);
  });

  it("ozet cozulur", () => {
    const page = parseDevicePage({
      summary: { device_events: 4, machines: 2, production_count: 10 },
    });
    expect(page.summary.deviceEvents).toBe(4);
    expect(page.summary.productionCount).toBe(10);
  });

  it("akislar cozulur", () => {
    const page = parseDevicePage({ streams: [{ connection_id: "c1", running: true }] });
    expect(page.streams[0].running).toBe(true);
  });
});

describe("feedStatus", () => {
  it("veri akiyorsa gercek veri", () => {
    const verdict = feedStatus({
      streams: [stream({ running: true, hasData: true })],
      simulatedProvider: false,
      anyVerifiedConnection: true,
    });
    expect(verdict.status).toBe("real");
    expect(verdict.label).toBe("Gerçek Veri");
  });

  it("ekran benzetim cizerken gercek akis onu gercek yapmaz", () => {
    /*
     * Tarayicida gorulen hata: demo senaryosuyla cizilen canli ekranin
     * tepesinde "Gercek Veri" yaziyordu. Koprude veri akmasi, ekrandaki
     * sayilarin cihazdan geldigi anlamina gelmez.
     */
    const verdict = feedStatus({
      streams: [stream({ running: true, hasData: true })],
      simulatedProvider: true,
      anyVerifiedConnection: true,
    });
    expect(verdict.status).toBe("simulated");
  });

  it("benzetim ekraninda gercek verinin baska yerde aktigi soylenir", () => {
    const verdict = feedStatus({
      streams: [stream({ running: true, hasData: true })],
      simulatedProvider: true,
      anyVerifiedConnection: true,
    });
    expect(verdict.reason).toContain("kaynağı değiştirin");
  });

  it("akis acik ama veri yoksa beklemede", () => {
    const verdict = feedStatus({
      streams: [stream({ running: true })],
      simulatedProvider: false,
      anyVerifiedConnection: true,
    });
    expect(verdict.status).toBe("waiting");
    expect(verdict.reason).toContain("Eşleme tablosunu");
  });

  it("akis yoksa ve benzetim acikca yaziliyorsa benzetim", () => {
    const verdict = feedStatus({
      streams: [],
      simulatedProvider: true,
      anyVerifiedConnection: false,
    });
    expect(verdict.status).toBe("simulated");
    expect(verdict.reason).toContain("cihazdan değil");
  });

  it("hicbir sey yoksa dogrulanmadi", () => {
    const verdict = feedStatus({
      streams: [],
      simulatedProvider: false,
      anyVerifiedConnection: false,
    });
    expect(verdict.status).toBe("unverified");
    expect(verdict.reason).toContain("doğrulanmadı");
  });

  it("baglanti dogrulandi ama akis yoksa nedeni yazilir", () => {
    const verdict = feedStatus({
      streams: [],
      simulatedProvider: false,
      anyVerifiedConnection: true,
    });
    expect(verdict.status).toBe("unverified");
    expect(verdict.reason).toContain("akışı başlatılmadı");
  });

  it("kapali akis gercek veri saymaz", () => {
    const verdict = feedStatus({
      streams: [stream({ running: false, hasData: false })],
      simulatedProvider: false,
      anyVerifiedConnection: true,
    });
    expect(verdict.status).toBe("unverified");
  });

  it("veri gelen kaynak sayisi yazilir", () => {
    const verdict = feedStatus({
      streams: [
        stream({ hasData: true }),
        stream({ connectionId: "c2", hasData: true }),
      ],
      simulatedProvider: false,
      anyVerifiedConnection: true,
    });
    expect(verdict.reason).toContain("2 kaynaktan");
  });
});

describe("unmeasuredFields", () => {
  it("hicbir olcum yoksa hepsi listelenir", () => {
    expect(unmeasuredFields(snapshot())).toHaveLength(4);
  });

  it("olculen alan listelenmez", () => {
    const fields = unmeasuredFields(snapshot({ productionCount: 5 }));
    expect(fields).not.toContain("Üretim adedi");
  });

  it("olculmus sifir olculmus sayilir", () => {
    expect(unmeasuredFields(snapshot({ queueLength: 0 }))).not.toContain(
      "Kuyruk uzunluğu",
    );
  });

  it("hepsi olculduyse bos doner", () => {
    const full = snapshot({
      productionCount: 1,
      queueLength: 0,
      downtimeMinutes: 2,
      throughputPerHour: 30,
    });
    expect(unmeasuredFields(full)).toEqual([]);
  });
});

describe("describeStream", () => {
  it("kapali akis bildirilir", () => {
    expect(describeStream(stream())).toBe("Akış kapalı.");
  });

  it("acik ama veri yoksa beklendigi yazilir", () => {
    expect(describeStream(stream({ running: true }))).toContain("henüz ölçüm gelmedi");
  });

  it("hata varsa yazilir", () => {
    const text = describeStream(stream({ running: true, lastError: "kapalı" }));
    expect(text).toContain("kapalı");
  });

  it("veri geliyorsa sayisi yazilir", () => {
    const text = describeStream(
      stream({ running: true, hasData: true, eventsPublished: 12 }),
    );
    expect(text).toBe("12 ölçüm alındı.");
  });
});
