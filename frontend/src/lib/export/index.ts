/**
 * Veri dışa aktarma katmanı.
 *
 *     /api/runtime/export/<tür> → parse → Blob → indirme
 *
 * CSV'nin içeriği sunucuda üretilir; burada yapılan tek şey onu dosyaya
 * çevirmektir. Yalnızca gerçek kayıtlar aktarılır — benzetim çıktısı bu
 * yoldan çıkmaz.
 */

export {
  BOM,
  EXPORT_KIND_LABEL,
  EXPORT_KIND_ORDER,
  csvBlob,
  exportCaption,
  parseKind,
  safeFileName,
  type ExportKind,
  type ExportResult,
} from "./csv";
export { parseExport } from "./parse";
