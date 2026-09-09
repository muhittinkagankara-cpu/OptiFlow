/**
 * Dışa aktarma yanıtının çözümlenmesi.
 *
 * Satır sayısı ve kesilme bayrağı korunur: eksik bir dosyayı tam sanmak,
 * müşterinin yanlış bir analiz yapması demektir.
 */

import { numberOr, record, stringOr } from "../monitoring/parse";
import type { ExportResult } from "./csv";

/** `/api/runtime/export/<tür>` yanıtı. */
export function parseExport(value: unknown): ExportResult {
  const row = record(value);
  return {
    fileName: stringOr(row.file_name, "indirme.csv"),
    content: stringOr(row.content, ""),
    rowCount: numberOr(row.row_count, 0),
    truncated: row.truncated === true,
    source: stringOr(row.source, "bilinmiyor"),
    bytes: numberOr(row.bytes, 0),
  };
}
