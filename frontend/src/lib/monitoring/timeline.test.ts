/**
 * Üretim zaman çizelgesi.
 *
 * Duruş ve alarm tek akıştadır: "makine neden durdu?" sorusunun yanıtı çoğu
 * zaman duruşun hemen öncesindeki alarmdır ve iki ayrı liste bu eşleştirmeyi
 * operatörün kafasına bırakırdı.
 */

import { describe, expect, it } from "vitest";
import {
  describeEntry,
  entrySeverity,
  filterByType,
  forMachine,
  groupByHour,
  openEntries,
  sortEntries,
  summarize,
  totalDurationMs,
} from "./timeline";
import type { TimelineEntry } from "./types";

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "downtime",
    atMs: 1_000,
    endMs: 61_000,
    machineId: "TORNA_01",
    durationMs: 60_000,
    reason: "Bildirilmedi",
    severity: null,
    state: null,
    open: false,
    ...overrides,
  };
}

describe("sıralama", () => {
  it("yeniden eskiye sıralar", () => {
    const sorted = sortEntries([entry({ atMs: 1_000 }), entry({ atMs: 9_000 })]);
    expect(sorted[0].atMs).toBe(9_000);
  });

  it("özgün liste değişmez", () => {
    const original = [entry({ atMs: 1_000 }), entry({ atMs: 9_000 })];
    sortEntries(original);
    expect(original[0].atMs).toBe(1_000);
  });

  it("boş listede boş döner", () => {
    expect(sortEntries([])).toEqual([]);
  });
});

describe("süzme", () => {
  it("türe göre süzer", () => {
    const rows = [entry(), entry({ type: "alarm" })];
    expect(filterByType(rows, "alarm")).toHaveLength(1);
  });

  it("hepsi seçilince süzmez", () => {
    const rows = [entry(), entry({ type: "alarm" })];
    expect(filterByType(rows, "all")).toHaveLength(2);
  });

  it("açık satırları süzer", () => {
    const rows = [entry({ open: true }), entry()];
    expect(openEntries(rows)).toHaveLength(1);
  });

  it("makineye göre süzer", () => {
    const rows = [entry(), entry({ machineId: "FREZE_01" })];
    expect(forMachine(rows, "FREZE_01")).toHaveLength(1);
  });

  it("makinesi bilinmeyen satır eşleşmez", () => {
    expect(forMachine([entry({ machineId: null })], "TORNA_01")).toHaveLength(0);
  });
});

describe("toplam süre", () => {
  it("ölçülen süreleri toplar", () => {
    expect(totalDurationMs([entry(), entry({ durationMs: 30_000 })])).toBe(90_000);
  });

  it("ölçülmemiş süre toplama girmez", () => {
    expect(totalDurationMs([entry(), entry({ durationMs: null })])).toBe(60_000);
  });

  it("hiç ölçüm yoksa null", () => {
    expect(totalDurationMs([entry({ durationMs: null })])).toBeNull();
  });

  it("boş listede null", () => {
    expect(totalDurationMs([])).toBeNull();
  });
});

describe("saate göre gruplama", () => {
  const SAAT = 3_600_000;

  it("aynı saatteki satırlar tek grupta", () => {
    const rows = [entry({ atMs: SAAT + 1_000 }), entry({ atMs: SAAT + 2_000 })];
    expect(groupByHour(rows)).toHaveLength(1);
  });

  it("farklı saatler ayrı grupta", () => {
    const rows = [entry({ atMs: SAAT }), entry({ atMs: 2 * SAAT })];
    expect(groupByHour(rows)).toHaveLength(2);
  });

  it("gruplar yeniden eskiye sıralı", () => {
    const rows = [entry({ atMs: SAAT }), entry({ atMs: 3 * SAAT })];
    expect(groupByHour(rows)[0].hourStartMs).toBe(3 * SAAT);
  });

  it("grup içi de yeniden eskiye", () => {
    const rows = [entry({ atMs: SAAT + 1_000 }), entry({ atMs: SAAT + 9_000 })];
    expect(groupByHour(rows)[0].entries[0].atMs).toBe(SAAT + 9_000);
  });

  it("grup etiketi saat gösterir", () => {
    expect(groupByHour([entry({ atMs: SAAT })])[0].label).toMatch(/^\d{2}:\d{2}$/);
  });

  it("boş listede grup yok", () => {
    expect(groupByHour([])).toEqual([]);
  });
});

describe("satır açıklaması", () => {
  it("kapanan duruşu süresiyle anlatır", () => {
    expect(describeEntry(entry())).toBe("TORNA_01 durdu, 1 dk sürdü");
  });

  it("süren duruşu böyle anlatır", () => {
    const text = describeEntry(entry({ open: true, endMs: null }));
    expect(text).toContain("duruşta");
  });

  it("makinesi bilinmeyen satırı da anlatır", () => {
    expect(describeEntry(entry({ machineId: null }))).toContain("bilinmeyen makine");
  });

  it("alarmı nedeniyle anlatır", () => {
    const text = describeEntry(
      entry({ type: "alarm", open: true, reason: "Kuyruk 15 parça." }),
    );
    expect(text).toContain("Kuyruk 15 parça.");
  });

  it("kapanan alarmı işaretler", () => {
    const text = describeEntry(entry({ type: "alarm", reason: "Duruş" }));
    expect(text).toContain("kapandı");
  });

  it("ölçülmemiş süreyi tire gösterir", () => {
    const text = describeEntry(entry({ durationMs: null }));
    expect(text).toContain("—");
  });
});

describe("satır ağırlığı", () => {
  it("süren duruş kritik", () => {
    expect(entrySeverity(entry({ open: true }))).toBe("critical");
  });

  it("kapanan duruş bilgi", () => {
    expect(entrySeverity(entry())).toBe("info");
  });

  it("alarm kendi ağırlığını taşır", () => {
    expect(entrySeverity(entry({ type: "alarm", severity: "critical" }))).toBe(
      "critical",
    );
  });

  it("ağırlığı bilinmeyen alarm uyarı olur", () => {
    expect(entrySeverity(entry({ type: "alarm", severity: null }))).toBe("warning");
  });
});

describe("özet", () => {
  it("toplam satır sayar", () => {
    expect(summarize([entry(), entry({ type: "alarm" })]).total).toBe(2);
  });

  it("duruş ve alarmı ayırır", () => {
    const result = summarize([entry(), entry({ type: "alarm" })]);
    expect(result.downtimeCount).toBe(1);
    expect(result.alarmCount).toBe(1);
  });

  it("açık satırları sayar", () => {
    expect(summarize([entry({ open: true }), entry()]).openCount).toBe(1);
  });

  it("duruş toplamını hesaplar", () => {
    expect(summarize([entry(), entry()]).downtimeTotalMs).toBe(120_000);
  });

  it("ölçülmemiş duruş toplamı null", () => {
    expect(summarize([entry({ durationMs: null })]).downtimeTotalMs).toBeNull();
  });

  it("boş listede toplam null", () => {
    expect(summarize([]).downtimeTotalMs).toBeNull();
  });
});

describe("makine adının tekrarı", () => {
  it("alarm metni makine adıyla başlıyorsa ön ek eklenmez", () => {
    const text = describeEntry(
      entry({
        type: "alarm",
        open: true,
        machineId: "FREZE_01",
        reason: "FREZE_01 kuyruğu 18 parça (eşik 10).",
      }),
    );
    expect(text).toBe("FREZE_01 kuyruğu 18 parça (eşik 10).");
  });

  it("metin başka bir şeyle başlıyorsa makine adı yazılır", () => {
    const text = describeEntry(
      entry({
        type: "alarm",
        open: true,
        machineId: "FREZE_01",
        reason: "Bağlantı koptu.",
      }),
    );
    expect(text).toBe("FREZE_01: Bağlantı koptu.");
  });
});
