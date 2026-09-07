/**
 * Yüklenen dosyanın satırlara çevrilmesi.
 *
 * Bu modül saf değildir (dosya okur) ve bu yüzden ayrı durur; eşleştirme ve
 * model kurma mantığı saf kalır ve dosya sistemine dokunmadan sınanabilir.
 *
 * Biçim desteği
 * -------------
 * * **.csv / .txt** — burada elle çözümlenir. Ayraç (virgül / noktalı virgül /
 *   sekme) dosyadan çıkarılır; Türkçe Excel varsayılan olarak noktalı virgül
 *   yazar ve virgüle sabitlenmiş bir çözümleyici o dosyaları tek kolon olarak
 *   okurdu.
 * * **.xlsx** — `read-excel-file` ile, **dinamik içe aktarmayla**. Kütüphane
 *   yalnızca kullanıcı gerçekten bir dosya bıraktığında indirilir; ana paket
 *   büyümez.
 * * **.xls** — desteklenmez. Eski ikili BIFF biçimini okuyan tek yaygın npm
 *   paketi (`xlsx`/SheetJS), düzeltmesi yayımlanmamış iki yüksek önem
 *   dereceli güvenlik açığı taşıyor (prototype pollution ve ReDoS). Güvenilmez
 *   bir dosyayı tarayıcıda çözümleyen bir akışta bu kabul edilemezdi; kullanıcı
 *   ".xlsx olarak kaydedin" diye açıkça yönlendirilir.
 */

import type { CellValue, ImportedSheet, ParsedFile } from "./types";

/** Kabul edilen uzantılar; dosya seçicideki `accept` değeri de bundan üretilir. */
export const ACCEPTED_EXTENSIONS = [".xlsx", ".csv", ".txt"] as const;

/** Kullanıcıya gösterilen kabul listesi. */
export const ACCEPT_ATTRIBUTE =
  ".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

/** En büyük kabul edilen dosya boyutu (bayt). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** İçe aktarma sırasında oluşan, kullanıcıya gösterilebilir hata. */
export class ImportError extends Error {
  /** Kullanıcının ne yapması gerektiğini söyleyen ek cümle. */
  readonly hint: string;

  constructor(message: string, hint = "") {
    super(message);
    this.name = "ImportError";
    this.hint = hint;
  }
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

/** Dosya boyutunu okunabilir biçime çevirir. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ayracı satır örneklerinden çıkarır.
 *
 * En çok kolon üreten aday seçilir. Türkçe Excel noktalı virgül, İngilizce
 * Excel virgül, dışa aktarılmış raporlar sekme kullanır; birine sabitlenmek
 * diğer iki grubu tek kolonluk bir tabloya indirirdi.
 */
export function detectDelimiter(sample: string): string {
  const candidates = [";", ",", "\t", "|"];
  const lines = sample.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 5);
  if (lines.length === 0) {
    return ",";
  }

  let best = ",";
  let bestScore = 0;
  for (const candidate of candidates) {
    const counts = lines.map((line) => splitCsvLine(line, candidate).length);
    const min = Math.min(...counts);
    // Tutarlılık aranır: her satırda aynı sayıda kolon üreten ayraç doğrudur.
    const consistent = counts.every((count) => count === counts[0]);
    const score = min * (consistent ? 2 : 1);
    if (min > 1 && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Tek bir CSV satırını alanlara böler.
 *
 * Tırnak içindeki ayraçlar korunur ve iki tırnak ("") kaçış olarak okunur —
 * RFC 4180'in gerçek dosyalarda karşılaşılan kısmı budur. Basit bir `split`
 * kullanılsaydı, içinde virgül geçen istasyon adları ("Kesim, 2. hat") satırı
 * bozardı.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/** CSV metnini satırlara çevirir. */
export function parseCsv(text: string): CellValue[][] {
  // BOM, ilk başlığın başına görünmez bir karakter ekler ve eşleştirmeyi
  // sessizce bozar.
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);

  return clean
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => splitCsvLine(line, delimiter) as CellValue[]);
}

/* -------------------------------------------------------------------------- */
/* Dosya okuma                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Dosyayı çözümler.
 *
 * @throws ImportError Desteklenmeyen biçim, çok büyük dosya ya da okunamayan
 *   içerik. Hiçbir durumda ham bir kütüphane hatası yukarı sızmaz; arayüz her
 *   zaman Türkçe ve eyleme dönük bir mesaj gösterir.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size === 0) {
    throw new ImportError(
      "Dosya boş görünüyor.",
      "İçinde veri olan bir dosya seçin.",
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `Dosya çok büyük (${formatFileSize(file.size)}).`,
      `En fazla ${formatFileSize(MAX_FILE_BYTES)} boyutunda dosya yükleyebilirsiniz.`,
    );
  }

  const extension = extensionOf(file.name);

  if (extension === ".xls") {
    throw new ImportError(
      "Eski .xls biçimi desteklenmiyor.",
      "Dosyayı Excel'de açıp “Farklı Kaydet → .xlsx” ile kaydedin, sonra tekrar yükleyin.",
    );
  }

  if (extension === ".csv" || extension === ".txt") {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new ImportError(
        "Dosyada okunabilir satır bulunamadı.",
        "Dosyanın ilk satırında kolon başlıkları olmalı.",
      );
    }
    return {
      fileName: file.name,
      fileSize: file.size,
      sheets: [{ name: "CSV", rows }],
    };
  }

  if (extension === ".xlsx") {
    return parseXlsx(file);
  }

  throw new ImportError(
    `"${extension || "bilinmeyen"}" uzantısı desteklenmiyor.`,
    "Desteklenen biçimler: .xlsx, .csv",
  );
}

/**
 * `.xlsx` dosyasını çözümler.
 *
 * Kütüphane dinamik olarak yüklenir: kullanıcıların çoğu bu ekrana hiç
 * gelmiyor ve çözümleyiciyi ana pakete koymak herkesin ilk yüklemesini
 * yavaşlatırdı.
 */
async function parseXlsx(file: File): Promise<ParsedFile> {
  // Varsayılan dışa aktarım tüm sayfaları adlarıyla birlikte tek çağrıda
  // döndürür; sayfa adlarını ayrıca sorup her biri için ikinci bir okuma
  // yapmak dosyayı gereksiz yere iki kez çözümlemek olurdu.
  let readXlsxFile: typeof import("read-excel-file/browser").default;
  try {
    const module = await import("read-excel-file/browser");
    readXlsxFile = module.default;
  } catch {
    throw new ImportError(
      "Excel çözümleyicisi yüklenemedi.",
      "İnternet bağlantınızı kontrol edip sayfayı yenileyin.",
    );
  }

  let raw: { sheet: string; data: unknown[][] }[];
  try {
    raw = (await readXlsxFile(file)) as unknown as {
      sheet: string;
      data: unknown[][];
    }[];
  } catch {
    // Kütüphanenin kendi hatası yukarı sızmaz: "InvalidSpreadsheetError" gibi
    // bir metin, kullanıcıya ne yapması gerektiğini söylemez.
    throw new ImportError(
      "Dosya okunamadı; bozuk ya da parola korumalı olabilir.",
      "Dosyayı Excel'de açıp yeniden .xlsx olarak kaydetmeyi deneyin.",
    );
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ImportError(
      "Dosyada sayfa bulunamadı.",
      "Boş bir çalışma kitabı yüklemiş olabilirsiniz.",
    );
  }

  const sheets: ImportedSheet[] = raw.map((entry, index) => ({
    name: entry.sheet || `Sayfa ${index + 1}`,
    rows: (entry.data ?? []) as CellValue[][],
  }));

  return { fileName: file.name, fileSize: file.size, sheets };
}
