/**
 * Canlı akış yüklerinin çözümlenmesi.
 *
 * İki davranış korunur: eksik veri **uydurulmaz** (sayı `null` olur, sıfıra
 * düşmez) ve tanınmayan bir olay türü sessizce yok sayılır — sunucuya eklenen
 * yeni bir tür, güncellenmemiş bir arayüzü çökertmemelidir.
 */

import { describe, expect, it } from "vitest";
import {
  numberOr,
  numberOrNull,
  parseDeviceRow,
  parseDeviceRows,
  parseDispatcher,
  parseEventKind,
  parseFrame,
  parseHealth,
  parseProtocol,
  parseQuality,
  parseQueue,
  parseSourceState,
  parseStreamStats,
  stringOr,
  stringOrNull,
} from "./parse";

describe("sayı çözümleme", () => {
  it("sayıyı korur", () => {
    expect(numberOrNull(12.5)).toBe(12.5);
  });

  it("ölçülmüş sıfırı korur", () => {
    expect(numberOrNull(0)).toBe(0);
  });

  it("NaN ölçülmemiş sayılır", () => {
    expect(numberOrNull(Number.NaN)).toBeNull();
  });

  it("sonsuz ölçülmemiş sayılır", () => {
    expect(numberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("metin ölçüm sayılmaz", () => {
    expect(numberOrNull("12")).toBeNull();
  });

  it("yedek değer yalnızca eksikte kullanılır", () => {
    expect(numberOr(undefined, 5)).toBe(5);
    expect(numberOr(0, 5)).toBe(0);
  });
});

describe("metin çözümleme", () => {
  it("metni korur", () => {
    expect(stringOrNull("plc")).toBe("plc");
  });

  it("boş metin null olur", () => {
    expect(stringOrNull("")).toBeNull();
  });

  it("yedek metin kullanılır", () => {
    expect(stringOr(null, "bilinmiyor")).toBe("bilinmiyor");
  });
});

describe("protokol", () => {
  it("bilinen protokolü korur", () => {
    expect(parseProtocol("opcua")).toBe("opcua");
  });

  it("tanınmayan protokol bilinmeyen olur", () => {
    expect(parseProtocol("modbus")).toBe("unknown");
  });

  it("eksik protokol bilinmeyen olur", () => {
    expect(parseProtocol(undefined)).toBe("unknown");
  });
});

describe("kalite", () => {
  it("bilinen kaliteyi korur", () => {
    expect(parseQuality("bad")).toBe("bad");
  });

  it("tanınmayan kalite belirsiz olur", () => {
    expect(parseQuality("mukemmel")).toBe("uncertain");
  });

  it("eksik kalite belirsiz olur", () => {
    expect(parseQuality(null)).toBe("uncertain");
  });
});

describe("akış sağlığı", () => {
  it("bilinen durumu korur", () => {
    expect(parseHealth("running")).toBe("running");
  });

  it("tanınmayan durum durduruldu olur", () => {
    expect(parseHealth("yeni")).toBe("stopped");
  });
});

describe("olay türü", () => {
  it("dört tür tanınır", () => {
    for (const kind of ["device_data", "alarm", "oee_update", "production_update"]) {
      expect(parseEventKind(kind)).toBe(kind);
    }
  });

  it("tanınmayan tür null olur", () => {
    expect(parseEventKind("probe")).toBeNull();
  });

  it("eksik tür null olur", () => {
    expect(parseEventKind(undefined)).toBeNull();
  });
});

const SUNUCU_SATIRI = {
  connector_id: "plc-1",
  machine_id: "TORNA_01",
  field: "production_count",
  value: 162,
  timestamp: 1_000,
  source_protocol: "opcua",
  quality: "good",
  sequence: 7,
  origin: "ns=2;i=2",
  unit: "adet",
  usable: true,
};

describe("cihaz ölçümü çözümleme", () => {
  it("alanları taşır", () => {
    const row = parseDeviceRow(SUNUCU_SATIRI);
    expect(row.connectorId).toBe("plc-1");
    expect(row.machineId).toBe("TORNA_01");
    expect(row.field).toBe("production_count");
    expect(row.value).toBe(162);
  });

  it("sıra numarasını taşır", () => {
    expect(parseDeviceRow(SUNUCU_SATIRI).sequence).toBe(7);
  });

  it("protokolü çözer", () => {
    expect(parseDeviceRow(SUNUCU_SATIRI).protocol).toBe("opcua");
  });

  it("ham adresi taşır", () => {
    expect(parseDeviceRow(SUNUCU_SATIRI).origin).toBe("ns=2;i=2");
  });

  it("birimi taşır", () => {
    expect(parseDeviceRow(SUNUCU_SATIRI).unit).toBe("adet");
  });

  it("boş gövdede çökmez", () => {
    expect(parseDeviceRow(null).machineId).toBe("bilinmiyor");
  });

  it("bozuk kalite kullanılamaz sayılır", () => {
    const row = parseDeviceRow({ ...SUNUCU_SATIRI, quality: "bad", usable: undefined });
    expect(row.usable).toBe(false);
  });

  it("değersiz ölçüm kullanılamaz sayılır", () => {
    const row = parseDeviceRow({ ...SUNUCU_SATIRI, value: null, usable: undefined });
    expect(row.usable).toBe(false);
  });

  it("sunucunun kullanılabilirlik bildirimi öncelikli", () => {
    const row = parseDeviceRow({ ...SUNUCU_SATIRI, usable: false });
    expect(row.usable).toBe(false);
  });

  it("liste çözümlenir", () => {
    const rows = parseDeviceRows({ events: [SUNUCU_SATIRI, SUNUCU_SATIRI] });
    expect(rows).toHaveLength(2);
  });

  it("liste yoksa boş döner", () => {
    expect(parseDeviceRows({})).toEqual([]);
  });
});

describe("SSE karesi", () => {
  it("cihaz olayı çözülür", () => {
    const frame = parseFrame({
      kind: "device_data",
      connection_id: "plc-1",
      data: SUNUCU_SATIRI,
      at_ms: 5_000,
    });
    expect(frame?.kind).toBe("device_data");
    expect(frame?.data.sequence).toBe(7);
  });

  it("hat geneli olayda kaynak runtime olur", () => {
    const frame = parseFrame({ kind: "oee_update", data: {} });
    expect(frame?.connectionId).toBe("runtime");
  });

  it("tanınmayan tür null döner", () => {
    expect(parseFrame({ kind: "probe", data: {} })).toBeNull();
  });

  it("boş gövde null döner", () => {
    expect(parseFrame(null)).toBeNull();
  });
});

describe("kuyruk istatistikleri", () => {
  it("alanları çözer", () => {
    const queue = parseQueue({
      depth: 12,
      capacity: 1_000,
      dropped: 3,
      peak_depth: 40,
      fill_ratio: 0.012,
      full: false,
      under_pressure: false,
    });
    expect(queue.depth).toBe(12);
    expect(queue.dropped).toBe(3);
  });

  it("eksik gövdede sıfırlarla döner", () => {
    expect(parseQueue(null).depth).toBe(0);
  });

  it("baskı bayrağı çözülür", () => {
    expect(parseQueue({ under_pressure: true }).underPressure).toBe(true);
  });
});

describe("dağıtıcı istatistikleri", () => {
  it("sayaçları çözer", () => {
    const stats = parseDispatcher({ processed: 10, duplicates: 2, unusable: 1 });
    expect(stats.processed).toBe(10);
    expect(stats.duplicates).toBe(2);
  });

  it("ölçülmemiş olay hızı null kalır", () => {
    expect(parseDispatcher({}).eventsPerSecond).toBeNull();
  });

  it("ölçülmemiş gecikme null kalır", () => {
    expect(parseDispatcher({}).avgLatencyMs).toBeNull();
  });

  it("ölçülmemiş kayıp oranı null kalır", () => {
    expect(parseDispatcher({}).lossRatio).toBeNull();
  });

  it("alıcılar çözülür", () => {
    const stats = parseDispatcher({
      sinks: [{ name: "snapshot", delivered: 5, errors: 0 }],
    });
    expect(stats.sinks[0].name).toBe("snapshot");
    expect(stats.sinks[0].delivered).toBe(5);
  });

  it("alıcı hatası taşınır", () => {
    const stats = parseDispatcher({
      sinks: [{ name: "snapshot", last_error: "disk dolu" }],
    });
    expect(stats.sinks[0].lastError).toBe("disk dolu");
  });
});

describe("akış özeti", () => {
  it("alanları çözer", () => {
    const stats = parseStreamStats({
      streams: 3,
      running: 2,
      health: "running",
      poll_rate_hz: 1.5,
      dispatcher: { processed: 10 },
    });
    expect(stats.streams).toBe(3);
    expect(stats.pollRateHz).toBe(1.5);
    expect(stats.health).toBe("running");
  });

  it("yoklayıcı yoksa sıklık null kalır", () => {
    expect(parseStreamStats({}).pollRateHz).toBeNull();
  });

  it("boş gövdede çökmez", () => {
    expect(parseStreamStats(null).streams).toBe(0);
  });
});

describe("akış kaynağı durumu", () => {
  it("yeni anahtar kullanılır", () => {
    expect(parseSourceState({ connector_id: "plc-1" }).connectorId).toBe("plc-1");
  });

  it("eski anahtar da tanınır", () => {
    expect(parseSourceState({ connection_id: "plc-1" }).connectorId).toBe("plc-1");
  });

  it("veri gelmemişse zaman null kalır", () => {
    expect(parseSourceState({}).firstDataAtMs).toBeNull();
  });

  it("çalışma bayrağı çözülür", () => {
    expect(parseSourceState({ running: true }).running).toBe(true);
  });
});
