/**
 * Makine envanteri — saf liste işlemleri, süzgeçler ve türetmeler.
 *
 * Envanterin değeri bakım takibindedir: bir makinenin yaşı ve son bakım tarihi
 * bilinmiyorsa liste yalnızca bir isim koleksiyonudur. Bu yüzden buradaki
 * türetmeler (yaş, bakım gecikmesi) eksik veriyle çalışmayı bilir ve
 * **tahmin üretmez**: bilinmeyen yaş `null` döner, sıfır değil.
 *
 * Zaman dışarıdan verilir; hiçbir işlev saat okumaz.
 */

import { cellToText, dataRows, findHeaderRow, parseNumeric } from "../import";
import type { CellValue } from "../import";
import {
  MACHINE_KINDS,
  MACHINE_KIND_LABEL,
  type Machine,
  type MachineKind,
  type MachineStatus,
} from "./types";

/**
 * Bakım aralığı (gün).
 *
 * Altı ay, orta yoğunluktaki bir tezgâh için yaygın bir periyodik bakım
 * aralığıdır. Müşteriye göre değişir; sabitin tek yerde durması, değiştirmeyi
 * tek satırlık bir iş yapar.
 */
export const MAINTENANCE_INTERVAL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Boş bir makine kaydı; form bunu doldurur. */
export function emptyMachine(id: string, factoryId: string | null): Machine {
  return {
    id,
    factoryId,
    name: "",
    kind: "cnc",
    serialNumber: null,
    status: "active",
    installedYear: null,
    lastMaintenanceAt: null,
    operator: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Liste işlemleri                                                             */
/* -------------------------------------------------------------------------- */

/** Makineyi ekler; aynı kimlik varsa günceller. */
export function upsertMachine(machines: Machine[], machine: Machine): Machine[] {
  const exists = machines.some((item) => item.id === machine.id);
  return exists
    ? machines.map((item) => (item.id === machine.id ? machine : item))
    : [...machines, machine];
}

export function removeMachine(machines: Machine[], id: string): Machine[] {
  return machines.filter((item) => item.id !== id);
}

/** Durumu değiştirir; makine yoksa liste olduğu gibi döner. */
export function setStatus(
  machines: Machine[],
  id: string,
  status: MachineStatus,
): Machine[] {
  return machines.map((item) => (item.id === id ? { ...item, status } : item));
}

/* -------------------------------------------------------------------------- */
/* Süzgeç ve sayım                                                             */
/* -------------------------------------------------------------------------- */

export interface MachineFilter {
  status: MachineStatus | "all";
  kind: MachineKind | "all";
  /** Ad, seri numarası ve operatörde aranır. */
  query: string;
}

export const EMPTY_FILTER: MachineFilter = {
  status: "all",
  kind: "all",
  query: "",
};

/**
 * Süzgeci uygular.
 *
 * Arama Türkçe harflere duyarsızdır: "Şahin" yazan bir operatörü "sahin" ile
 * aramak, sahada en sık yapılan şeydir.
 */
export function filterMachines(
  machines: Machine[],
  filter: MachineFilter,
): Machine[] {
  const query = normalize(filter.query);

  return machines.filter((machine) => {
    if (filter.status !== "all" && machine.status !== filter.status) {
      return false;
    }
    if (filter.kind !== "all" && machine.kind !== filter.kind) {
      return false;
    }
    if (query === "") {
      return true;
    }
    const haystack = normalize(
      [machine.name, machine.serialNumber ?? "", machine.operator ?? ""].join(" "),
    );
    return haystack.includes(query);
  });
}

/** Türkçe harfleri sadeleştirilmiş, küçük harfli metin. */
export function normalize(value: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
    ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  };
  return [...value]
    .map((char) => map[char] ?? char)
    .join("")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

export interface StatusCounts {
  active: number;
  maintenance: number;
  fault: number;
  total: number;
}

export function statusCounts(machines: Machine[]): StatusCounts {
  return {
    active: machines.filter((item) => item.status === "active").length,
    maintenance: machines.filter((item) => item.status === "maintenance").length,
    fault: machines.filter((item) => item.status === "fault").length,
    total: machines.length,
  };
}

/** Tür başına makine sayısı; kart başlıkları bunu gösterir. */
export function countsByKind(machines: Machine[]): Record<MachineKind, number> {
  const counts = {} as Record<MachineKind, number>;
  for (const kind of MACHINE_KINDS) {
    counts[kind] = machines.filter((item) => item.kind === kind).length;
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Türetmeler                                                                  */
/* -------------------------------------------------------------------------- */

/** Makinenin yaşı (yıl); kurulum yılı bilinmiyorsa `null`. */
export function machineAge(machine: Machine, now: Date): number | null {
  if (machine.installedYear === null || !Number.isFinite(machine.installedYear)) {
    return null;
  }
  const age = now.getFullYear() - machine.installedYear;
  // Gelecek bir yıl girilmişse yaş hesaplanamaz; sıfır yazmak yanlış olurdu.
  return age >= 0 ? age : null;
}

/** Son bakımdan bu yana geçen gün; bakım yapılmadıysa `null`. */
export function daysSinceMaintenance(
  machine: Machine,
  now: Date,
): number | null {
  if (machine.lastMaintenanceAt === null) {
    return null;
  }
  const last = new Date(machine.lastMaintenanceAt).getTime();
  if (!Number.isFinite(last)) {
    return null;
  }
  const diff = now.getTime() - last;
  return diff < 0 ? 0 : Math.floor(diff / DAY_MS);
}

/**
 * Bakım gecikmiş mi?
 *
 * Hiç bakım yapılmamış bir makine **gecikmiş sayılır**: kaydı olmayan bakım,
 * yapılmamış bakımdır ve envanterin ilk işi bunu göstermektir.
 */
export function isMaintenanceDue(
  machine: Machine,
  now: Date,
  intervalDays: number = MAINTENANCE_INTERVAL_DAYS,
): boolean {
  const days = daysSinceMaintenance(machine, now);
  return days === null ? true : days >= intervalDays;
}

/** Bakımı gecikmiş makineler; en uzun süre geçenden başlayarak. */
export function overdueMaintenance(
  machines: Machine[],
  now: Date,
  intervalDays: number = MAINTENANCE_INTERVAL_DAYS,
): Machine[] {
  return machines
    .filter((machine) => isMaintenanceDue(machine, now, intervalDays))
    .sort((a, b) => {
      const daysA = daysSinceMaintenance(a, now);
      const daysB = daysSinceMaintenance(b, now);
      // Kaydı olmayanlar en öne gelir.
      if (daysA === null && daysB === null) {
        return 0;
      }
      if (daysA === null) {
        return -1;
      }
      if (daysB === null) {
        return 1;
      }
      return daysB - daysA;
    });
}

/* -------------------------------------------------------------------------- */
/* Doğrulama                                                                   */
/* -------------------------------------------------------------------------- */

export interface MachineIssue {
  machineId: string;
  field: "name" | "serialNumber" | "installedYear" | "operator";
  text: string;
}

/**
 * Envanterin eksiklerini listeler.
 *
 * Ad zorunludur; geri kalanı eksik olabilir ama eksikliği görünür olur. Bir
 * envanterin sessizce yarım kalması, altı ay sonra "bu makineyi kim
 * kullanıyordu?" sorusuyla geri döner.
 */
export function validateMachines(machines: Machine[], now: Date): MachineIssue[] {
  const issues: MachineIssue[] = [];

  for (const machine of machines) {
    if (machine.name.trim() === "") {
      issues.push({
        machineId: machine.id,
        field: "name",
        text: "Makine adı boş.",
      });
    }
    if (machine.serialNumber === null || machine.serialNumber.trim() === "") {
      issues.push({
        machineId: machine.id,
        field: "serialNumber",
        text: `${machine.name || "İsimsiz makine"}: seri numarası girilmedi.`,
      });
    }
    const age = machineAge(machine, now);
    if (machine.installedYear !== null && age === null) {
      issues.push({
        machineId: machine.id,
        field: "installedYear",
        text: `${machine.name || "İsimsiz makine"}: kurulum yılı gelecekte görünüyor.`,
      });
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Dosyadan içe aktarma                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Kolon başlığı adayları.
 *
 * İçe aktarma katmanının (`lib/import`) Türkçe ondalık ve başlık tespiti burada
 * yeniden yazılmaz; yalnızca hangi kolonun hangi alana gittiği kararı verilir.
 */
const COLUMN_ALIASES: { field: keyof Machine | "kindText"; parts: string[] }[] = [
  { field: "name", parts: ["makine", "ad", "tezgah", "name"] },
  { field: "serialNumber", parts: ["seri", "serial"] },
  { field: "kindText", parts: ["tur", "tip", "kind", "type"] },
  { field: "installedYear", parts: ["yil", "kurulum", "year"] },
  { field: "operator", parts: ["operator", "calisan", "sorumlu"] },
];

/** Metni makine türüne çevirir; tanınmazsa "other". */
export function kindFromText(value: string): MachineKind {
  const text = normalize(value);
  for (const kind of MACHINE_KINDS) {
    if (
      text.includes(normalize(MACHINE_KIND_LABEL[kind])) ||
      text.includes(kind)
    ) {
      return kind;
    }
  }
  return "other";
}

export interface ParsedMachines {
  machines: Machine[];
  /** Okunamayan satır sayısı; arayüz bunu sessizce yutmaz. */
  skipped: number;
  /** Dosyada bulunan alanlar. */
  fields: string[];
}

/**
 * Tablo satırlarını makinelere çevirir.
 *
 * Ad kolonu bulunamazsa hiçbir satır okunmaz: adı olmayan makinelerden oluşan
 * bir envanter, kullanıcıya hiçbir şey söylemez.
 */
export function parseMachineRows(
  rows: CellValue[][],
  factoryId: string | null,
  idPrefix = "mch",
): ParsedMachines {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    return { machines: [], skipped: 0, fields: [] };
  }

  const header = rows[headerIndex];
  const columns: Partial<Record<string, number>> = {};
  header.forEach((cell, index) => {
    const text = normalize(cellToText(cell));
    if (text === "") {
      return;
    }
    for (const alias of COLUMN_ALIASES) {
      if (columns[alias.field] !== undefined) {
        continue;
      }
      if (alias.parts.some((part) => text.includes(part))) {
        columns[alias.field] = index;
        return;
      }
    }
  });

  const nameIndex = columns.name;
  if (nameIndex === undefined) {
    return { machines: [], skipped: 0, fields: [] };
  }

  const machines: Machine[] = [];
  let skipped = 0;

  dataRows(rows).forEach((row, index) => {
    const name = cellToText(row[nameIndex]).trim();
    if (name === "") {
      skipped += 1;
      return;
    }

    const read = (field: string): string => {
      const column = columns[field];
      return column === undefined ? "" : cellToText(row[column]).trim();
    };

    const yearColumn = columns.installedYear;
    const year =
      yearColumn === undefined ? null : parseNumeric(row[yearColumn] ?? null);

    machines.push({
      id: `${idPrefix}-${index}`,
      factoryId,
      name,
      kind: kindFromText(read("kindText")),
      serialNumber: read("serialNumber") === "" ? null : read("serialNumber"),
      status: "active",
      installedYear: year !== null && Number.isFinite(year) ? Math.round(year) : null,
      lastMaintenanceAt: null,
      operator: read("operator") === "" ? null : read("operator"),
    });
  });

  return {
    machines,
    skipped,
    fields: Object.keys(columns),
  };
}

/** İçe aktarma şablonu; kullanıcı hangi kolonların beklendiğini görür. */
export function machineTemplateCsv(): string {
  return [
    "Makine adı;Seri no;Tür;Kurulum yılı;Operatör",
    "CNC-01;SN-1001;CNC;2019;Ahmet Yılmaz",
    "Pres-01;SN-1002;Pres;2016;",
  ].join("\n");
}
