import { describe, expect, it } from "vitest";
import { parseCsv } from "../import";
import { sampleMachines } from "./fixtures";
import {
  EMPTY_FILTER,
  MAINTENANCE_INTERVAL_DAYS,
  countsByKind,
  daysSinceMaintenance,
  emptyMachine,
  filterMachines,
  isMaintenanceDue,
  kindFromText,
  machineAge,
  machineTemplateCsv,
  normalize,
  overdueMaintenance,
  parseMachineRows,
  removeMachine,
  setStatus,
  statusCounts,
  upsertMachine,
  validateMachines,
} from "./inventory";
import type { Machine } from "./types";

const NOW = new Date("2026-09-07T10:00:00");

function machine(overrides: Partial<Machine> = {}): Machine {
  return { ...sampleMachines()[0], ...overrides };
}

describe("emptyMachine", () => {
  it("bos alanlari null birakir", () => {
    const created = emptyMachine("m1", "fab-1");
    expect(created.serialNumber).toBeNull();
    expect(created.installedYear).toBeNull();
    expect(created.lastMaintenanceAt).toBeNull();
    expect(created.status).toBe("active");
  });
});

describe("upsertMachine / removeMachine / setStatus", () => {
  it("yeni makineyi ekler", () => {
    expect(upsertMachine([], machine({ id: "yeni" }))).toHaveLength(1);
  });

  it("ayni kimlikli makineyi gunceller, ikilemez", () => {
    const list = upsertMachine([machine({ id: "m1", name: "Eski" })], machine({ id: "m1", name: "Yeni" }));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Yeni");
  });

  it("girdiyi degistirmez", () => {
    const original = [machine({ id: "m1" })];
    upsertMachine(original, machine({ id: "m2" }));
    expect(original).toHaveLength(1);
  });

  it("makineyi siler", () => {
    expect(removeMachine([machine({ id: "m1" })], "m1")).toEqual([]);
  });

  it("taninmayan kimlik listeyi bozmaz", () => {
    expect(removeMachine([machine({ id: "m1" })], "yok")).toHaveLength(1);
  });

  it("durumu degistirir", () => {
    const list = setStatus([machine({ id: "m1", status: "active" })], "m1", "fault");
    expect(list[0].status).toBe("fault");
  });

  it("olmayan makinenin durumu degismez", () => {
    const list = setStatus([machine({ id: "m1", status: "active" })], "yok", "fault");
    expect(list[0].status).toBe("active");
  });
});

describe("filterMachines", () => {
  const machines = sampleMachines();

  it("bos suzgec hepsini gecirir", () => {
    expect(filterMachines(machines, EMPTY_FILTER)).toHaveLength(machines.length);
  });

  it("duruma gore suzer", () => {
    const active = filterMachines(machines, { ...EMPTY_FILTER, status: "active" });
    expect(active.every((item) => item.status === "active")).toBe(true);
    expect(active.length).toBeGreaterThan(0);
  });

  it("bakimdaki ve arizali makineleri ayirir", () => {
    expect(filterMachines(machines, { ...EMPTY_FILTER, status: "maintenance" })).toHaveLength(1);
    expect(filterMachines(machines, { ...EMPTY_FILTER, status: "fault" })).toHaveLength(1);
  });

  it("ture gore suzer", () => {
    expect(filterMachines(machines, { ...EMPTY_FILTER, kind: "press" })).toHaveLength(1);
  });

  it("adda arar", () => {
    expect(filterMachines(machines, { ...EMPTY_FILTER, query: "torna" })).toHaveLength(1);
  });

  it("seri numarasinda arar", () => {
    expect(filterMachines(machines, { ...EMPTY_FILTER, query: "SN-1002" })).toHaveLength(1);
  });

  it("operatorde arar ve Turkce harfe duyarsizdir", () => {
    // Sahada "Şahin" yerine "sahin" yazmak en sik yapilan seydir.
    const list = [machine({ id: "m9", operator: "Şahin Öz" })];
    expect(filterMachines(list, { ...EMPTY_FILTER, query: "sahin" })).toHaveLength(1);
  });

  it("eslesme yoksa bos doner", () => {
    expect(filterMachines(machines, { ...EMPTY_FILTER, query: "yok-boyle" })).toEqual([]);
  });

  it("durum ve tur birlikte uygulanir", () => {
    const result = filterMachines(machines, {
      ...EMPTY_FILTER,
      status: "active",
      kind: "lathe",
    });
    expect(result).toHaveLength(1);
  });
});

describe("normalize", () => {
  it("Turkce harfleri sadelestirir", () => {
    expect(normalize("Şahin ÖZ")).toBe("sahin oz");
    expect(normalize("İĞLİK")).toBe("iglik");
  });
});

describe("statusCounts / countsByKind", () => {
  it("durumlari sayar", () => {
    const counts = statusCounts(sampleMachines());
    expect(counts.total).toBe(4);
    expect(counts.active).toBe(2);
    expect(counts.maintenance).toBe(1);
    expect(counts.fault).toBe(1);
  });

  it("bos listede sifirlar doner", () => {
    expect(statusCounts([])).toEqual({ active: 0, maintenance: 0, fault: 0, total: 0 });
  });

  it("tur basina sayar", () => {
    const counts = countsByKind(sampleMachines());
    expect(counts.cnc).toBe(1);
    expect(counts.robot).toBe(0);
  });
});

describe("machineAge", () => {
  it("yasi hesaplar", () => {
    expect(machineAge(machine({ installedYear: 2019 }), NOW)).toBe(7);
  });

  it("kurulum yili yoksa sifir degil bos doner", () => {
    expect(machineAge(machine({ installedYear: null }), NOW)).toBeNull();
  });

  it("gelecek yil girildiyse yas hesaplanmaz", () => {
    expect(machineAge(machine({ installedYear: 2030 }), NOW)).toBeNull();
  });

  it("bu yil kurulan makine sifir yasindadir", () => {
    expect(machineAge(machine({ installedYear: 2026 }), NOW)).toBe(0);
  });
});

describe("daysSinceMaintenance", () => {
  it("gecen gunu hesaplar", () => {
    const machine30 = machine({ lastMaintenanceAt: "2026-08-08T10:00:00" });
    expect(daysSinceMaintenance(machine30, NOW)).toBe(30);
  });

  it("bakim kaydi yoksa bos doner", () => {
    expect(daysSinceMaintenance(machine({ lastMaintenanceAt: null }), NOW)).toBeNull();
  });

  it("gelecekteki tarih negatife dusmez", () => {
    expect(
      daysSinceMaintenance(machine({ lastMaintenanceAt: "2027-01-01T00:00:00" }), NOW),
    ).toBe(0);
  });

  it("gecersiz tarih bos doner", () => {
    expect(daysSinceMaintenance(machine({ lastMaintenanceAt: "abc" }), NOW)).toBeNull();
  });
});

describe("isMaintenanceDue / overdueMaintenance", () => {
  it("kaydi olmayan bakim gecikmis sayilir", () => {
    // Kaydi olmayan bakim, yapilmamis bakimdir.
    expect(isMaintenanceDue(machine({ lastMaintenanceAt: null }), NOW)).toBe(true);
  });

  it("yeni bakim gecikmis degildir", () => {
    expect(
      isMaintenanceDue(machine({ lastMaintenanceAt: "2026-09-01T10:00:00" }), NOW),
    ).toBe(false);
  });

  it("aralik dolunca gecikmis olur", () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - MAINTENANCE_INTERVAL_DAYS);
    expect(
      isMaintenanceDue(machine({ lastMaintenanceAt: old.toISOString() }), NOW),
    ).toBe(true);
  });

  it("gecikmisleri kaydi olmayanlar onde olacak sekilde siralar", () => {
    const list = [
      machine({ id: "a", lastMaintenanceAt: "2026-01-01T00:00:00" }),
      machine({ id: "b", lastMaintenanceAt: null }),
    ];
    expect(overdueMaintenance(list, NOW).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("bakimi guncel makineler listeye girmez", () => {
    const list = [machine({ id: "a", lastMaintenanceAt: "2026-09-05T00:00:00" })];
    expect(overdueMaintenance(list, NOW)).toEqual([]);
  });
});

describe("validateMachines", () => {
  it("adi bos makineyi isaretler", () => {
    const issues = validateMachines([machine({ name: "  " })], NOW);
    expect(issues.some((issue) => issue.field === "name")).toBe(true);
  });

  it("seri numarasi eksigini isaretler", () => {
    const issues = validateMachines([machine({ serialNumber: null })], NOW);
    expect(issues.some((issue) => issue.field === "serialNumber")).toBe(true);
  });

  it("gelecek kurulum yilini isaretler", () => {
    const issues = validateMachines([machine({ installedYear: 2030 })], NOW);
    expect(issues.some((issue) => issue.field === "installedYear")).toBe(true);
  });

  it("eksiksiz makinede bulgu uretmez", () => {
    expect(
      validateMachines([machine({ name: "CNC", serialNumber: "SN-1", installedYear: 2020 })], NOW),
    ).toEqual([]);
  });

  it("ornek envanterde eksik seri numarasini bulur", () => {
    const issues = validateMachines(sampleMachines(), NOW);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("kindFromText", () => {
  it("Turkce ve Ingilizce adlari tanir", () => {
    expect(kindFromText("CNC")).toBe("cnc");
    expect(kindFromText("Pres")).toBe("press");
    expect(kindFromText("torna tezgahi")).toBe("lathe");
    expect(kindFromText("Kaynak")).toBe("welding");
    expect(kindFromText("robot kolu")).toBe("robot");
  });

  it("taninmayan turu 'other' yapar", () => {
    expect(kindFromText("vinç")).toBe("other");
    expect(kindFromText("")).toBe("other");
  });
});

describe("parseMachineRows", () => {
  it("sablonu geri okur", () => {
    const parsed = parseMachineRows(parseCsv(machineTemplateCsv()), "fab-1");
    expect(parsed.machines).toHaveLength(2);
    expect(parsed.machines[0].name).toBe("CNC-01");
    expect(parsed.machines[0].kind).toBe("cnc");
    expect(parsed.machines[0].installedYear).toBe(2019);
  });

  it("operator kolonunu okur, bos hucreyi null birakir", () => {
    const parsed = parseMachineRows(parseCsv(machineTemplateCsv()), "fab-1");
    expect(parsed.machines[0].operator).toBe("Ahmet Yılmaz");
    expect(parsed.machines[1].operator).toBeNull();
  });

  it("ad kolonu yoksa hicbir satir okunmaz", () => {
    // Adi olmayan makinelerden olusan envanter kullaniciya hicbir sey soylemez.
    const csv = ["Seri no;Yıl", "SN-1;2020"].join("\n");
    expect(parseMachineRows(parseCsv(csv), null).machines).toEqual([]);
  });

  it("adsiz satirlari atlar ve sayar", () => {
    const csv = ["Makine adı;Seri no", "CNC-01;SN-1", ";SN-2"].join("\n");
    const parsed = parseMachineRows(parseCsv(csv), null);
    expect(parsed.machines).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
  });

  it("fabrika kimligini kayitlara yazar", () => {
    const parsed = parseMachineRows(parseCsv(machineTemplateCsv()), "fab-9");
    expect(parsed.machines.every((item) => item.factoryId === "fab-9")).toBe(true);
  });

  it("bos dosyada cokmeden bos doner", () => {
    expect(parseMachineRows(parseCsv(""), null).machines).toEqual([]);
  });

  it("okunan alanlari bildirir", () => {
    const parsed = parseMachineRows(parseCsv(machineTemplateCsv()), null);
    expect(parsed.fields).toContain("serialNumber");
  });
});
