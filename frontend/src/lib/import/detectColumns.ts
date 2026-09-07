/**
 * Sayfadaki kolonların çıkarılması.
 *
 * Excel'den gelen veri düzensizdir: başlık satırı boş hücreler içerebilir,
 * bir kolon sayı gibi görünüp metin taşıyabilir, Türkçe dosyalarda ondalık
 * ayracı virgül olabilir. Bu modül o düzensizliği tek bir yerde ehlileştirir;
 * eşleştirme ve model kurma adımları temiz bir kolon listesi görür.
 */

import type { CellValue, ColumnKind, DetectedColumn } from "./types";

/** Kolon türü kararı için bakılacak en fazla satır. */
const SAMPLE_DEPTH = 50;

/** Kullanıcıya gösterilecek örnek değer sayısı. */
const SAMPLE_SHOWN = 3;

/**
 * Bir hücreyi okunabilir metne çevirir.
 *
 * `Date` özel olarak ele alınır: `String(new Date())` uzun ve okunamaz bir
 * ifade üretir, oysa kullanıcı hücrede kısa bir tarih görmüştür.
 */
export function cellToText(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toLocaleDateString("tr-TR");
  }
  if (typeof value === "boolean") {
    return value ? "evet" : "hayır";
  }
  return String(value).trim();
}

/**
 * Bir hücreyi sayıya çevirir; çevrilemiyorsa `null`.
 *
 * Türkçe Excel dosyalarında ondalık ayracı **virgüldür** ("3,5") ve binlik
 * ayracı noktadır ("1.200"). İkisi de doğrudan `Number()` ile okunduğunda
 * yanlış sonuç verir: "3,5" `NaN` olur, "1.200" ise 1.2 olur. Bu yüzden ayraç
 * ayrımı burada, tek bir yerde yapılır.
 *
 * Kural: son ayraç ondalık kabul edilir, öncekiler binlik sayılıp atılır.
 * "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "1.200" → 1200
 */
export function parseNumeric(value: CellValue): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value instanceof Date) {
    return null;
  }

  let text = String(value).trim();
  if (text === "") {
    return null;
  }

  // Yüzde işareti ve birim ekleri temizlenir: "%5", "12 dk", "3 adet".
  const isPercent = text.includes("%");
  text = text.replace(/%/g, "").replace(/[^\d.,+-]/g, "").trim();
  if (text === "") {
    return null;
  }

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    // İkisi de var: sonda olan ondalık ayracıdır.
    if (lastComma > lastDot) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Yalnızca virgül var. Sağında tam üç hane varsa binlik ayracı olma
    // ihtimali yüksektir ("1,200"); değilse ondalıktır ("3,5").
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = text.length - lastDot - 1;
    if (decimals === 3 && text.indexOf(".") === lastDot) {
      // "1.200" — binlik ayracı.
      text = text.replace(/\./g, "");
    }
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return isPercent ? parsed / 100 : parsed;
}

/**
 * Başlık satırının hangi satır olduğunu bulur.
 *
 * Dosyaların başında sıklıkla boş satırlar ya da bir rapor başlığı bulunur.
 * İlk satırı körü körüne başlık kabul etmek, o dosyalarda tüm kolonların
 * "Kolon 1, Kolon 2..." olarak adlandırılmasına ve hiçbir eşleşmenin
 * bulunamamasına yol açardı.
 *
 * Kural iki aşamalıdır ve sırası önemlidir:
 *
 * 1. **Tümüyle metin olan satırlar** arasından en çok dolu olanı seçilir.
 *    Başlıklar etikettir; veri satırları neredeyse her zaman en az bir sayı
 *    taşır. Bu ayrım, yalnızca "en çok dolu satır" kuralının kaçırdığı iki
 *    durumu birden çözer: başında rapor başlığı olan dosyalarda asıl başlık
 *    satırı daha dolu olduğu için kazanır; bir başlığı boş bırakılmış
 *    dosyalarda ise altındaki veri satırı sayı içerdiği için elenir.
 * 2. Hiç saf metin satırı yoksa (ör. başlıklardan biri "2026" gibi bir sayı),
 *    en çok dolu satıra düşülür.
 *
 * Beraberlikte her zaman üstteki kazanır.
 */
export function findHeaderRow(rows: CellValue[][]): number {
  const limit = Math.min(rows.length, 10);

  let textOnlyBest = -1;
  let textOnlyCount = 0;
  let anyBest = -1;
  let anyCount = 0;

  for (let index = 0; index < limit; index += 1) {
    const filled = rows[index].filter((cell) => cellToText(cell) !== "");
    if (filled.length === 0) {
      continue;
    }

    if (filled.length > anyCount) {
      anyBest = index;
      anyCount = filled.length;
    }

    const isTextOnly = filled.every((cell) => parseNumeric(cell) === null);
    if (isTextOnly && filled.length > textOnlyCount) {
      textOnlyBest = index;
      textOnlyCount = filled.length;
    }
  }

  return textOnlyBest >= 0 ? textOnlyBest : anyBest;
}

/** Bir kolonun değerlerinden türünü çıkarır. */
function kindOf(values: CellValue[]): ColumnKind {
  const filled = values.filter((value) => cellToText(value) !== "");
  if (filled.length === 0) {
    return "empty";
  }
  const numeric = filled.filter((value) => parseNumeric(value) !== null).length;
  // Çoğunluk sayıysa kolon sayısaldır. Tam oybirliği aranmaz: gerçek
  // dosyalarda tek bir "yok" ya da "-" hücresi sık görülür ve o yüzden bütün
  // kolonu metin saymak, sayısal alanların hiç eşleşmemesine yol açardı.
  return numeric / filled.length >= 0.6 ? "number" : "text";
}

/**
 * Sayfayı kolonlara ayırır.
 *
 * Başlık satırı bulunamazsa (tümüyle boş sayfa) boş dizi döner; çağıran taraf
 * bunu "boş sayfa" hatası olarak gösterir.
 */
export function detectColumns(rows: CellValue[][]): DetectedColumn[] {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    return [];
  }

  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);

  const columns: DetectedColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    const values = body.map((row) => row[index] ?? null);
    const filledCount = values.filter((value) => cellToText(value) !== "").length;
    const headerText = cellToText(header[index] ?? null);

    columns.push({
      index,
      // Başlığı boş olan kolon atılmaz: içinde veri olabilir ve kullanıcı onu
      // elle eşleştirebilmelidir.
      header: headerText || `Kolon ${index + 1}`,
      kind: kindOf(values),
      samples: values
        .filter((value) => cellToText(value) !== "")
        .slice(0, SAMPLE_SHOWN)
        .map(cellToText),
      filledCount,
    });
  }

  // Tümüyle boş kolonlar listeye girmez: eşleştirme ekranını gereksiz
  // uzatırlar ve hiçbir alana aday değildirler.
  return columns.filter(
    (column) => column.filledCount > 0 || !column.header.startsWith("Kolon "),
  );
}

/** Başlık satırından sonraki veri satırları. */
export function dataRows(rows: CellValue[][]): CellValue[][] {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    return [];
  }
  return rows
    .slice(headerIndex + 1, headerIndex + 1 + SAMPLE_DEPTH * 40)
    .filter((row) => row.some((cell) => cellToText(cell) !== ""));
}
