/**
 * Gerçek üretim verisinin dosyadan okunması.
 *
 * Saha verisi çoğu zaman elle tutulan bir tabloda durur; onu ekrana tek tek
 * yazdırmak, doğrulamayı kimsenin yapmayacağı bir işe çevirir. Bu yüzden CSV ve
 * Excel dosyaları doğrudan okunur.
 *
 * Çözümleme işinin tamamı **mevcut içe aktarma katmanından** gelir
 * (`lib/import`): ayraç bulma, Türkçe ondalık ("3,5"), başlık satırı tespiti ve
 * Excel okuma orada zaten çözülmüştür. Burada yalnızca "hangi kolon hangi
 * ölçüt" eşlemesi ve istasyon adlarının modele bağlanması yapılır.
 *
 * Eşleşmeyen istasyon **atılmaz**, ayrıca döndürülür: kullanıcı dosyasında yazan
 * bir satırın sessizce yok sayılmasını fark edemez ve doğruluğun neden eksik
 * veriyle hesaplandığını anlayamaz.
 */

import {
  cellToText,
  dataRows,
  findHeaderRow,
  parseCsv,
  parseNumeric,
  type CellValue,
} from "../import";
import type { RealStationMeasurement } from "./types";

/** Dosyadan okunabilen alanlar. */
export type RealField =
  | "stationName"
  | "cycleTimeMinutes"
  | "producedUnits"
  | "waitMinutes"
  | "scrapUnits"
  | "operatorCount"
  | "machineCount";

/**
 * Kolon başlığı adayları.
 *
 * Küçük harfe indirgenmiş ve Türkçe harfleri sadeleştirilmiş başlıkta bu
 * parçalardan biri **geçiyorsa** kolon o alana bağlanır. Tam eşleşme aranmaz;
 * saha dosyalarında başlıklar "Gerçek Çevrim Süresi (dk)" gibi uzun yazılır.
 *
 * Sıra önemlidir: bir başlık birden çok listeye uyarsa ilk sıradaki alan
 * kazanır. "Fire adedi" hem fire hem adet içerir; fire listesi önce gelir.
 */
export const FIELD_ALIASES: { field: RealField; parts: string[] }[] = [
  { field: "stationName", parts: ["istasyon", "station", "makina adi", "islem"] },
  {
    field: "cycleTimeMinutes",
    parts: ["cevrim", "cycle", "islem suresi", "birim sure"],
  },
  /*
   * "ret" gibi kısa parçalar kullanılamaz: "üretim" sözcüğünün içinde geçtiği
   * için üretim kolonunu fire sanıp iki kolonu birbirine karıştırıyordu.
   * Takma adlar, başka bir başlığın içinde tesadüfen geçmeyecek kadar uzun
   * olmalıdır.
   */
  { field: "scrapUnits", parts: ["fire", "hurda", "scrap", "reddedilen"] },
  {
    field: "waitMinutes",
    parts: ["bekleme", "kuyruk", "wait", "queue"],
  },
  {
    field: "producedUnits",
    parts: ["uretim", "uretilen", "adet", "produced", "output", "miktar"],
  },
  { field: "operatorCount", parts: ["operator", "calisan", "kisi"] },
  { field: "machineCount", parts: ["makine", "tezgah", "machine"] },
];

/**
 * Karşılaştırma için sadeleştirilmiş ad.
 *
 * Türkçe harfler ASCII karşılığına indirgenir ve harf/rakam dışındaki her şey
 * atılır: "Torna-1", "torna 1" ve "TORNA1" aynı istasyondur. Bu sadeleştirme
 * yapılmasaydı, dosyadan gelen adların büyük kısmı modele bağlanmazdı.
 */
export function normalizeName(value: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
    ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u", â: "a", î: "i", û: "u",
  };
  return [...value]
    .map((char) => map[char] ?? char)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Başlık satırındaki kolonların hangi alana denk geldiği. */
export function detectFields(header: CellValue[]): Partial<Record<RealField, number>> {
  const found: Partial<Record<RealField, number>> = {};

  header.forEach((cell, index) => {
    const text = normalizeName(cellToText(cell));
    if (text === "") {
      return;
    }
    for (const { field, parts } of FIELD_ALIASES) {
      if (found[field] !== undefined) {
        continue;
      }
      if (parts.some((part) => text.includes(normalizeName(part)))) {
        found[field] = index;
        return;
      }
    }
  });

  return found;
}

export interface ParsedRealData {
  measurements: RealStationMeasurement[];
  /** Dosyada olup modelde karşılığı bulunmayan istasyon adları. */
  unmatched: string[];
  /** Dosyada bulunan alanlar; hangi kolonun okunduğunu arayüz gösterir. */
  fields: RealField[];
}

/**
 * Satırları ölçümlere çevirir.
 *
 * İstasyon adı kolonu bulunamazsa hiçbir satır okunmaz: hangi satırın hangi
 * istasyona ait olduğu bilinmeden girilen sayılar, rastgele eşleştirilmiş bir
 * doğruluk üretirdi.
 */
export function rowsToMeasurements(
  rows: CellValue[][],
  stations: { id: string; name: string }[],
): ParsedRealData {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    return { measurements: [], unmatched: [], fields: [] };
  }

  const fields = detectFields(rows[headerIndex]);
  const nameIndex = fields.stationName;
  if (nameIndex === undefined) {
    return { measurements: [], unmatched: [], fields: [] };
  }

  const byName = new Map(
    stations.map((station) => [normalizeName(station.name), station.id]),
  );

  const measurements: RealStationMeasurement[] = [];
  const unmatched: string[] = [];

  for (const row of dataRows(rows)) {
    const name = cellToText(row[nameIndex]).trim();
    if (name === "") {
      continue;
    }

    const stationId = byName.get(normalizeName(name)) ?? null;
    if (stationId === null) {
      unmatched.push(name);
    }

    const read = (field: RealField): number | null => {
      const index = fields[field];
      return index === undefined ? null : parseNumeric(row[index] ?? null);
    };

    measurements.push({
      stationId,
      stationName: name,
      cycleTimeMinutes: read("cycleTimeMinutes"),
      producedUnits: read("producedUnits"),
      waitMinutes: read("waitMinutes"),
      scrapUnits: read("scrapUnits"),
      operatorCount: read("operatorCount"),
      machineCount: read("machineCount"),
    });
  }

  return {
    measurements,
    unmatched,
    fields: Object.keys(fields) as RealField[],
  };
}

/** CSV metnini doğrudan ölçümlere çevirir. */
export function parseRealDataCsv(
  text: string,
  stations: { id: string; name: string }[],
): ParsedRealData {
  return rowsToMeasurements(parseCsv(text), stations);
}

/**
 * Örnek CSV şablonu.
 *
 * Kullanıcıya boş bir dosya yükleme alanı göstermek, dosyanın hangi kolonları
 * taşıması gerektiğini tahmin ettirir. Şablon indirildiğinde bu soru kalmaz.
 */
export function csvTemplate(stations: { name: string }[]): string {
  const header = [
    "İstasyon",
    "Gerçek çevrim süresi (dk)",
    "Gerçek üretim (adet)",
    "Gerçek bekleme (dk)",
    "Fire (adet)",
    "Operatör sayısı",
    "Makine sayısı",
  ].join(";");

  const rows = stations.map((station) => `${station.name};;;;;;`);
  return [header, ...rows].join("\n");
}
