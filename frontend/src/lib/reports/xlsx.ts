/**
 * `SheetSpec[]` → .xlsx çıktısı.
 *
 * `pdf.ts` gibi bu da yan etkili bir incelik: hangi sekmede hangi sütunun
 * bulunacağı `excel.ts` içinde, saf ve sınanmış biçimde kararlaştırılır;
 * burada yalnızca dosya yazılır.
 *
 * Yazıcı olarak `write-excel-file` seçildi. SheetJS (`xlsx`) daha yaygın ama
 * düzeltmesi olmayan iki yüksek önemli güvenlik uyarısı taşıyor; ayrıca
 * projede Excel **okuma** tarafı zaten aynı yazarın `read-excel-file`
 * paketiyle yapılıyor, dolayısıyla iki kütüphane arasında biçim uyumu da
 * korunmuş oluyor.
 *
 * Kütüphane yalnızca dışa aktarma anında yüklenir (`import()`); rapor almayan
 * bir kullanıcı bunun bedelini ödemez.
 */

import type { SheetSpec, SheetValue } from "./types";

/**
 * Bir hücrenin `write-excel-file` biçimine çevrilmiş hâli.
 *
 * `null` **boş hücredir**: eksik veriyi sıfır yazmak toplamları bozar, tire
 * yazmak sütunu metne çevirip ortalama almayı imkânsız kılar.
 */
interface OutCell {
  value?: string | number;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: "bold";
  align?: "left" | "right";
}

/** Bir sekmeyi hücre ızgarasına çevirir. Saf; testler doğrudan çağırır. */
export function sheetToRows(sheet: SheetSpec): (OutCell | null)[][] {
  const rows: (OutCell | null)[][] = [];

  if (sheet.emptyNote !== undefined) {
    rows.push([{ value: sheet.emptyNote, type: String }]);
    rows.push([]);
  }

  rows.push(
    sheet.columns.map((column) => ({
      value: column,
      type: String,
      fontWeight: "bold" as const,
    })),
  );

  for (const row of sheet.rows) {
    rows.push(row.map(toCell));
  }

  return rows;
}

function toCell(value: SheetValue): OutCell | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    // Sonsuz ve NaN bir ölçüm değildir; boş hücre olarak geçer.
    return Number.isFinite(value)
      ? { value, type: Number, align: "right" }
      : null;
  }
  return { value, type: String };
}

/** Çalışma kitabını üretir ve indirir. */
export async function downloadWorkbook(
  sheets: SheetSpec[],
  fileName: string,
): Promise<void> {
  /*
   * Paketin kök girişi yok; `/browser`, `/node` ve `/universal` ayrı ayrı
   * dışa aktarılıyor. Tarayıcı girişi doğrudan seçilir — `universal` her iki
   * ortamı da paketleyip gereksiz Node kodunu bundle'a taşırdı.
   */
  const { default: writeXlsxFile } = await import("write-excel-file/browser");

  /*
   * Tarayıcı girişi `{ toBlob, toFile }` döndürür; dosya adı `toFile`'a
   * verilir. Node girişindeki `fileName` seçeneği burada yoktur — ikisini
   * karıştırmak sessizce hiçbir şey indirmeyen bir çağrı üretirdi.
   */
  await writeXlsxFile(
    sheets.map((sheet) => ({
      // Kütüphane sekme adını `sheet` alanında bekliyor, `name` değil.
      sheet: sheet.name,
      data: sheetToRows(sheet),
      // Sütun genişlikleri: ilk sütun ad taşır, geri kalanı sayı.
      columns: sheet.columns.map((column, index) => ({
        width: index === 0 ? 28 : Math.max(12, Math.min(34, column.length + 4)),
      })),
    })),
  ).toFile(`${fileName}.xlsx`);
}
