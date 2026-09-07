/**
 * Satırlardan `SimulationConfig` kurulması.
 *
 * Her geçerli satır bir istasyon olur ve istasyonlar dosyadaki sırayla
 * birbirine bağlanır. Sıra bilinçli olarak korunur: bir üretim hattının
 * Excel'deki satır sırası neredeyse her zaman akış sırasıdır ve bunu
 * değiştirmek kullanıcının kurduğu mantığı bozar.
 *
 * Burada **hiçbir simülasyon matematiği yoktur**: değerler okunur, birimlere
 * çevrilir ve şemaya yazılır. Kapasite, darboğaz ve çıktı hesabı backend'in
 * işidir; bu modül yalnızca ona verilecek girdiyi hazırlar.
 *
 * Eksik değerler uydurulmaz — kullanıcının "Eksik Bilgiler" adımında açıkça
 * onayladığı varsayılanlar kullanılır (`ImportDefaults`).
 */

import { INFINITE_CAPACITY } from "../../types/simulationTypes";
import type {
  Connection,
  Distribution,
  SimulationConfig,
  Station,
} from "../../types/simulationTypes";
import { DEFAULT_DEPTH } from "../../types/simulationTypes";
import { cellToText, parseNumeric } from "./detectColumns";
import type { CellValue, ColumnMapping, ImportDefaults } from "./types";

/** Varsayılan varsayımlar; eksik alan formunun başlangıç değerleri. */
export const DEFAULT_IMPORT_DEFAULTS: ImportDefaults = {
  machines: 1,
  scrapRate: 0,
  bufferCapacity: INFINITE_CAPACITY,
  distributionType: "normal",
  interarrivalMinutes: 5,
};

export interface BuildResult {
  config: SimulationConfig;
  /** Modele giren satır sayısı. */
  importedCount: number;
  /** Atlanan satırların sıra numaraları (0 tabanlı, veri satırı içinde). */
  skippedRows: number[];
}

/**
 * Bir metinden kimlik üretir.
 *
 * Backend istasyon kimliklerini serbest metin kabul eder ama okunabilir ve
 * benzersiz olmaları gerekir. Türkçe harfler ASCII'ye çevrilir; aksi hâlde
 * kimlikler "ç" gibi karakterler taşır ve kayıtlarda okunması güçleşir.
 */
function slugify(text: string, fallback: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
  };
  const slug = text
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => map[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}

/** Kimliği benzersiz kılar: aynı ad iki kez geçerse sonuna sayı eklenir. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}_${counter}`)) {
    counter += 1;
  }
  const id = `${base}_${counter}`;
  taken.add(id);
  return id;
}

/**
 * Hurda oranını 0-1 aralığına çeker.
 *
 * Gerçek dosyalarda bu kolon üç biçimde gelir: oran (0.03), yüzde (3) ya da
 * yüzde işaretli metin ("%3" — bu zaten `parseNumeric` tarafından bölünmüştür).
 * 1'den büyük her değer yüzde kabul edilir: %300 hurda oranı üreten bir
 * dosyadansa, 3 yazıp %3 demek isteyen bir kullanıcı çok daha olasıdır.
 */
export function normalizeScrapRate(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const rate = value > 1 ? value / 100 : value;
  // Şema 0-1 arası bekler; üstünü kırpmak, geçersiz bir modelin backend'e
  // gidip anlaşılmaz bir 422 ile dönmesinden iyidir.
  return Math.min(1, rate);
}

/** Sayı okur; geçersizse verilen varsayılana düşer. */
function numberOr(value: CellValue | undefined, fallback: number): number {
  const parsed = parseNumeric(value ?? null);
  return parsed === null ? fallback : parsed;
}

/**
 * Ortalama süreden dağılım nesnesi kurar.
 *
 * Dağılım tipini kullanıcı seçer (eksik alan formunda). Excel yalnızca bir
 * ortalama taşır; değişkenlik bilgisi dosyada yoktur ve uydurulamaz. Bu yüzden
 * normal dağılımda standart sapma ortalamanın onda biri alınır ve bu varsayım
 * arayüzde açıkça yazılır; üçgen dağılımda ±%25 bir aralık kurulur.
 */
export function distributionFor(
  type: ImportDefaults["distributionType"],
  mean: number,
): Distribution {
  switch (type) {
    case "constant":
      return { type: "constant", params: { value: mean } };
    case "exponential":
      return { type: "exponential", params: { mean } };
    case "triangular":
      return {
        type: "triangular",
        params: { min: mean * 0.75, mode: mean, max: mean * 1.25 },
      };
    case "normal":
    default:
      return { type: "normal", params: { mean, std: mean * 0.1 } };
  }
}

/**
 * Satırlardan bir fabrika modeli kurar.
 *
 * @param rows Başlık hariç veri satırları.
 * @param mapping Alan → kolon eşleştirmesi.
 * @param defaults Kullanıcının onayladığı varsayılanlar.
 */
export function buildFactoryFromRows(
  rows: CellValue[][],
  mapping: ColumnMapping,
  defaults: ImportDefaults = DEFAULT_IMPORT_DEFAULTS,
): BuildResult {
  const stationIndex = mapping.station;
  const cycleIndex = mapping.cycleTime;

  const stations: Station[] = [];
  const skippedRows: number[] = [];
  const takenIds = new Set<string>();

  if (
    stationIndex === null ||
    stationIndex === undefined ||
    cycleIndex === null ||
    cycleIndex === undefined
  ) {
    // Zorunlu alanlar yoksa boş bir model döner; doğrulama katmanı bu duruma
    // zaten engel olur ve buraya gelinmemesi gerekir.
    return { config: emptyConfig(defaults), importedCount: 0, skippedRows: [] };
  }

  rows.forEach((row, rowIndex) => {
    const name = cellToText(row[stationIndex] ?? null);
    const cycle = parseNumeric(row[cycleIndex] ?? null);

    if (name === "" || cycle === null || cycle <= 0) {
      skippedRows.push(rowIndex);
      return;
    }

    // Makine sayısı: önce "Makine", yoksa "Operatör" kolonu. İkisi de yoksa
    // kullanıcının onayladığı varsayılan. Operatörün yedek olarak
    // kullanılması bilinçlidir — modelde ikisi de aynı alanı (paralel sunucu
    // sayısı) besler ve bir hattın kaç kişiyle çalıştığı, kaç makinesi
    // olduğu kadar iyi bir tahmindir.
    const machineValue =
      mapping.machines !== null && mapping.machines !== undefined
        ? numberOr(row[mapping.machines], defaults.machines)
        : mapping.operators !== null && mapping.operators !== undefined
          ? numberOr(row[mapping.operators], defaults.machines)
          : defaults.machines;

    const servers = Math.max(1, Math.round(machineValue));

    const scrapValue =
      mapping.scrap !== null && mapping.scrap !== undefined
        ? normalizeScrapRate(parseNumeric(row[mapping.scrap] ?? null))
        : null;

    const bufferValue =
      mapping.buffer !== null && mapping.buffer !== undefined
        ? parseNumeric(row[mapping.buffer] ?? null)
        : null;

    stations.push({
      id: uniqueId(slugify(name, `istasyon_${rowIndex + 1}`), takenIds),
      name,
      num_servers: servers,
      service_time_distribution: distributionFor(defaults.distributionType, cycle),
      // Negatif ya da okunamayan tampon değeri varsayılana düşer; -1 sınırsız
      // demektir ve şemanın kabul ettiği tek negatif değerdir.
      buffer_capacity_before:
        bufferValue === null || bufferValue < 0
          ? defaults.bufferCapacity
          : Math.round(bufferValue),
      scrap_rate: scrapValue ?? defaults.scrapRate,
    });
  });

  const connections: Connection[] = [];
  for (let index = 0; index < stations.length - 1; index += 1) {
    connections.push({
      from_station_id: stations[index].id,
      to_station_id: stations[index + 1].id,
      routing_probability: 1,
    });
  }

  const config: SimulationConfig = {
    stations,
    connections,
    arrival_process: {
      distribution: {
        type: "exponential",
        params: { mean: Math.max(0.01, defaults.interarrivalMinutes) },
      },
      entry_station_id: stations[0]?.id ?? "",
    },
    simulation_duration_minutes: DEFAULT_DEPTH.simulation_duration_minutes,
    warmup_period_minutes: DEFAULT_DEPTH.warmup_period_minutes,
    num_replications: DEFAULT_DEPTH.num_replications,
    random_seed: 42,
  };

  return { config, importedCount: stations.length, skippedRows };
}

function emptyConfig(defaults: ImportDefaults): SimulationConfig {
  return {
    stations: [],
    connections: [],
    arrival_process: {
      distribution: {
        type: "exponential",
        params: { mean: Math.max(0.01, defaults.interarrivalMinutes) },
      },
      entry_station_id: "",
    },
    simulation_duration_minutes: DEFAULT_DEPTH.simulation_duration_minutes,
    warmup_period_minutes: DEFAULT_DEPTH.warmup_period_minutes,
    num_replications: DEFAULT_DEPTH.num_replications,
    random_seed: 42,
  };
}

/**
 * Dosyadaki en yavaş istasyona göre önerilen giriş aralığı.
 *
 * Eksik alan formunun başlangıç değeridir ve **bir tahmin değil, bir
 * başlangıç noktasıdır**: hat, en dar halkasının hızından daha sık beslenirse
 * kuyruklar sonsuza büyür. Bu yüzden en yavaş istasyonun çevrim süresi taban
 * alınır ve kullanıcı bunu değiştirebilir.
 */
export function suggestInterarrival(
  rows: CellValue[][],
  mapping: ColumnMapping,
  machinesFallback: number,
): number {
  const cycleIndex = mapping.cycleTime;
  if (cycleIndex === null || cycleIndex === undefined) {
    return DEFAULT_IMPORT_DEFAULTS.interarrivalMinutes;
  }

  let slowest = 0;
  for (const row of rows) {
    const cycle = parseNumeric(row[cycleIndex] ?? null);
    if (cycle === null || cycle <= 0) {
      continue;
    }
    const machines =
      mapping.machines !== null && mapping.machines !== undefined
        ? Math.max(1, Math.round(numberOr(row[mapping.machines], machinesFallback)))
        : machinesFallback;
    const perPart = cycle / Math.max(1, machines);
    if (perPart > slowest) {
      slowest = perPart;
    }
  }

  if (slowest <= 0) {
    return DEFAULT_IMPORT_DEFAULTS.interarrivalMinutes;
  }
  // En yavaş istasyonun biraz üstünde bir aralık: hat yaklaşık %80 yüklenir.
  return Math.round((slowest / 0.8) * 100) / 100;
}

/**
 * Dosya adından fabrika adı üretir.
 *
 * Uzantı atılır, alt çizgi ve tire boşluğa çevrilir:
 * "uretim_hatti_2026.xlsx" → "Uretim hatti 2026". Kullanıcı bunu kaydetmeden
 * önce düzenleyebilir; boş bir addan kaçınmak için son çare bir yer tutucu
 * döner — adsız bir fabrika listede ayırt edilemez.
 */
export function factoryNameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") {
    return "İçe aktarılan fabrika";
  }
  return cleaned.charAt(0).toLocaleUpperCase("tr-TR") + cleaned.slice(1);
}
