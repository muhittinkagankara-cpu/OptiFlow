/**
 * Canlı ölçüm tamponu.
 *
 * Korunan üç davranış: yineleme elenir (bağlantı koptuğunda akış yeniden
 * açılır ve son olaylar tekrar gelir), liste sınırlıdır ve en yeni satır
 * başta durur.
 */

import { describe, expect, it } from "vitest";
import {
  BUFFER_LIMIT,
  EMPTY_BUFFER,
  FLASH_WINDOW_MS,
  forConnector,
  forMachine,
  isFresh,
  latestByField,
  pushRows,
  summarize,
  usableRows,
} from "./buffer";
import type { DeviceDataRow } from "./types";

function row(overrides: Partial<DeviceDataRow> = {}): DeviceDataRow {
  return {
    connectorId: "plc-1",
    machineId: "TORNA_01",
    field: "production_count",
    value: 100,
    timestampMs: 1_000,
    protocol: "opcua",
    quality: "good",
    sequence: 1,
    origin: "ns=2;i=2",
    unit: null,
    usable: true,
    ...overrides,
  };
}

describe("tampona ekleme", () => {
  it("yeni satır eklenir", () => {
    const state = pushRows(EMPTY_BUFFER, [row()]);
    expect(state.rows).toHaveLength(1);
  });

  it("kabul sayacı artar", () => {
    const state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 }), row({ sequence: 2 })]);
    expect(state.accepted).toBe(2);
  });

  it("en yeni satır başta durur", () => {
    const state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 }), row({ sequence: 2 })]);
    expect(state.rows[0].sequence).toBe(2);
  });

  it("sonraki paket öne eklenir", () => {
    let state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 })]);
    state = pushRows(state, [row({ sequence: 2 })]);
    expect(state.rows[0].sequence).toBe(2);
  });

  it("aynı satır ikinci kez eklenmez", () => {
    let state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 })]);
    state = pushRows(state, [row({ sequence: 1 })]);
    expect(state.rows).toHaveLength(1);
  });

  it("yineleme sayılır", () => {
    let state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 })]);
    state = pushRows(state, [row({ sequence: 1 }), row({ sequence: 1 })]);
    expect(state.duplicates).toBe(2);
  });

  it("aynı pakette yineleme de elenir", () => {
    const state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 }), row({ sequence: 1 })]);
    expect(state.rows).toHaveLength(1);
  });

  it("farklı bağlantıda aynı sıra çakışmaz", () => {
    const state = pushRows(EMPTY_BUFFER, [
      row({ sequence: 1, connectorId: "a" }),
      row({ sequence: 1, connectorId: "b" }),
    ]);
    expect(state.rows).toHaveLength(2);
  });

  it("hepsi yinelenmişse durum değişmez", () => {
    const first = pushRows(EMPTY_BUFFER, [row({ sequence: 1 })]);
    const second = pushRows(first, [row({ sequence: 1 })]);
    expect(second.rows).toBe(first.rows);
  });

  it("boş paket durumu değiştirmez", () => {
    const state = pushRows(EMPTY_BUFFER, []);
    expect(state).toBe(EMPTY_BUFFER);
  });

  it("özgün durum değiştirilmez", () => {
    pushRows(EMPTY_BUFFER, [row()]);
    expect(EMPTY_BUFFER.rows).toHaveLength(0);
  });

  it("liste sınırlanır", () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row({ sequence: index + 1 }),
    );
    const state = pushRows(EMPTY_BUFFER, rows, 5);
    expect(state.rows).toHaveLength(5);
  });

  it("sınır aşılınca en eski düşer", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({ sequence: index + 1 }),
    );
    const state = pushRows(EMPTY_BUFFER, rows, 3);
    expect(state.rows.map((item) => item.sequence)).toEqual([10, 9, 8]);
  });

  it("varsayılan sınır iki yüz satır", () => {
    expect(BUFFER_LIMIT).toBe(200);
  });
});

describe("tazelik", () => {
  it("yeni satır taze sayılır", () => {
    expect(isFresh(row({ timestampMs: 1_000 }), 1_500)).toBe(true);
  });

  it("eski satır taze değildir", () => {
    expect(isFresh(row({ timestampMs: 1_000 }), 1_000 + FLASH_WINDOW_MS + 1)).toBe(
      false,
    );
  });

  it("tam sınırda taze sayılır", () => {
    expect(isFresh(row({ timestampMs: 1_000 }), 1_000 + FLASH_WINDOW_MS)).toBe(true);
  });

  it("gelecekteki damga taze sayılmaz", () => {
    /* Cihaz saati ileriyse satır sürekli yanıp sönerdi. */
    expect(isFresh(row({ timestampMs: 5_000 }), 1_000)).toBe(false);
  });
});

describe("süzme", () => {
  it("makineye göre süzer", () => {
    const rows = [row(), row({ machineId: "FREZE_01" })];
    expect(forMachine(rows, "FREZE_01")).toHaveLength(1);
  });

  it("bağlantıya göre süzer", () => {
    const rows = [row(), row({ connectorId: "mq" })];
    expect(forConnector(rows, "mq")).toHaveLength(1);
  });

  it("kullanılabilir satırlar süzülür", () => {
    const rows = [row(), row({ usable: false })];
    expect(usableRows(rows)).toHaveLength(1);
  });

  it("boş listede boş döner", () => {
    expect(usableRows([])).toEqual([]);
  });
});

describe("alan başına son değer", () => {
  it("en yeni değer seçilir", () => {
    const rows = [
      row({ sequence: 2, timestampMs: 2_000, value: 200 }),
      row({ sequence: 1, timestampMs: 1_000, value: 100 }),
    ];
    expect(latestByField(rows)[0].value).toBe(200);
  });

  it("farklı alanlar ayrı satır olur", () => {
    const rows = [row(), row({ field: "queue_length" })];
    expect(latestByField(rows)).toHaveLength(2);
  });

  it("farklı makineler ayrı satır olur", () => {
    const rows = [row(), row({ machineId: "FREZE_01" })];
    expect(latestByField(rows)).toHaveLength(2);
  });

  it("makine ve alana göre sıralanır", () => {
    const rows = [
      row({ machineId: "Z", field: "a" }),
      row({ machineId: "A", field: "b" }),
    ];
    expect(latestByField(rows)[0].machineId).toBe("A");
  });

  it("boş listede boş döner", () => {
    expect(latestByField([])).toEqual([]);
  });
});

describe("özet", () => {
  it("satır sayısı", () => {
    const state = pushRows(EMPTY_BUFFER, [row({ sequence: 1 }), row({ sequence: 2 })]);
    expect(summarize(state).total).toBe(2);
  });

  it("makine sayısı", () => {
    const state = pushRows(EMPTY_BUFFER, [
      row({ sequence: 1 }),
      row({ sequence: 2, machineId: "FREZE_01" }),
    ]);
    expect(summarize(state).machines).toBe(2);
  });

  it("bağlantı sayısı", () => {
    const state = pushRows(EMPTY_BUFFER, [
      row({ sequence: 1 }),
      row({ sequence: 2, connectorId: "mq" }),
    ]);
    expect(summarize(state).connectors).toBe(2);
  });

  it("kullanılamayan satır sayılır", () => {
    const state = pushRows(EMPTY_BUFFER, [
      row({ sequence: 1 }),
      row({ sequence: 2, usable: false }),
    ]);
    expect(summarize(state).unusable).toBe(1);
  });

  it("boş tamponda hepsi sıfır", () => {
    expect(summarize(EMPTY_BUFFER).total).toBe(0);
  });
});
