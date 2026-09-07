/**
 * Tablo sayfa taşmalarının çözümü.
 *
 * Sorun
 * -----
 * İstasyon tablosunun on bir sütunu var. A4 dikeyde bunların hepsi yan yana
 * sığmaz: pdfmake sütunları sıkıştırır, başlıklar üst üste biner ve tablo
 * okunamaz hâle gelir. Yatay sayfaya geçmek tek çözüm değildir — yirmi
 * istasyonlu bir modelde yatay sayfa da yetmez.
 *
 * Çözüm
 * -----
 * Tablo, sütun sayısına göre **dikey olarak** parçalanır: her parça anahtar
 * sütunu (istasyon adı) tekrar taşır, böylece her tablo tek başına okunabilir.
 * Anahtar sütun tekrarlanmasaydı ikinci parçadaki sayıların hangi istasyona
 * ait olduğu anlaşılamazdı.
 *
 * Satır taşması ayrı bir konudur ve çizicide çözülür: pdfmake tabloyu
 * kendiliğinden sayfalara böler, `headerRows` ile başlık her sayfada tekrarlanır
 * ve `dontBreakRows` bir satırın ortadan ikiye bölünmesini engeller.
 */

import type { ColumnWidth, ReportBlock } from "./types";

/**
 * A4 dikey sayfada okunabilir kalan en fazla sütun sayısı.
 *
 * Ölçülerek seçildi: 40 mm kenar boşluğuyla 130 mm'lik gövdede 8 punto yazıyla
 * altı sütun rahat, yedinci sütunda başlıklar sarmaya başlıyor.
 */
export const MAX_COLUMNS_PORTRAIT = 6;

export interface SplitTableInput {
  caption?: string;
  columns: string[];
  rows: string[][];
  widths?: ColumnWidth[];
  numericColumns?: number[];
}

/**
 * Geniş bir tabloyu sayfaya sığan parçalara böler.
 *
 * İlk sütun her parçada tekrarlanır. Tablo zaten sığıyorsa tek parça döner ve
 * hiçbir şey değişmez — bölme yalnızca gerektiğinde devreye girer.
 *
 * Boş tablo (satırı olmayan) da bir parça olarak döner: başlıkları göstermek,
 * "bu tabloda hiç veri yok" bilgisini taşır.
 */
export function splitWideTable(
  input: SplitTableInput,
  maxColumns: number = MAX_COLUMNS_PORTRAIT,
): Extract<ReportBlock, { kind: "table" }>[] {
  const total = input.columns.length;

  if (total <= maxColumns || total <= 1) {
    return [{ kind: "table", ...input }];
  }

  // Anahtar sütun her parçada yer kapladığı için parça başına taşınabilecek
  // veri sütunu sayısı bir eksiktir.
  const perChunk = Math.max(1, maxColumns - 1);
  const dataIndexes = input.columns.map((_, index) => index).slice(1);

  const chunks: Extract<ReportBlock, { kind: "table" }>[] = [];
  for (let start = 0; start < dataIndexes.length; start += perChunk) {
    const picked = [0, ...dataIndexes.slice(start, start + perChunk)];
    const partNumber = chunks.length + 1;

    chunks.push({
      kind: "table",
      caption:
        input.caption === undefined
          ? undefined
          : `${input.caption} (${partNumber}/${Math.ceil(dataIndexes.length / perChunk)})`,
      columns: picked.map((index) => input.columns[index]),
      rows: input.rows.map((row) => picked.map((index) => row[index] ?? "")),
      widths: input.widths
        ? picked.map((index) => input.widths![index] ?? "auto")
        : undefined,
      numericColumns:
        input.numericColumns === undefined
          ? undefined
          : picked
              .map((original, position) =>
                input.numericColumns!.includes(original) ? position : -1,
              )
              .filter((position) => position >= 0),
    });
  }

  return chunks;
}
