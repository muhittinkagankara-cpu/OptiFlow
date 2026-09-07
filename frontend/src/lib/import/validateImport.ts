/**
 * İçe aktarmanın doğrulanması.
 *
 * Amaç, kullanıcıyı bir sonraki adıma geçmeden **önce** uyarmaktır. Modeli
 * kurup sonra backend'in 422 döndürmesini beklemek, kullanıcıyı anlamadığı bir
 * hata mesajıyla baş başa bırakırdı.
 *
 * Hata ile uyarı ayrımı önemlidir: `error` ilerlemeyi durdurur (zorunlu alan
 * eksik, aynı kolon iki alana verilmiş), `warning` yalnızca bilgilendirir
 * (bazı satırlarda çevrim süresi okunamadı — o satırlar atlanacak). Her ikisi
 * de aynı ciddiyette gösterilseydi, kullanıcı gerçek engeli gürültü içinde
 * kaybederdi.
 */

import { cellToText, parseNumeric } from "./detectColumns";
import type {
  CellValue,
  ColumnMapping,
  DetectedColumn,
  ImportIssue,
} from "./types";
import { FIELDS, fieldById } from "./types";

export interface ValidationResult {
  issues: ImportIssue[];
  /** Modeli kurmaya engel bir sorun var mı? */
  hasBlockingError: boolean;
  /** Modele girecek geçerli satır sayısı. */
  usableRowCount: number;
}

/**
 * Eşleştirmeyi ve veriyi denetler.
 *
 * @param mapping Kullanıcının onayladığı alan → kolon eşleştirmesi.
 * @param columns Sayfadan çıkarılmış kolonlar.
 * @param rows Başlık hariç veri satırları.
 */
export function validateImport(
  mapping: ColumnMapping,
  columns: DetectedColumn[],
  rows: CellValue[][],
): ValidationResult {
  const issues: ImportIssue[] = [];

  if (columns.length === 0) {
    issues.push({
      severity: "error",
      fieldId: null,
      message: "Bu sayfada okunabilir bir kolon bulunamadı. Sayfa boş olabilir.",
    });
    return { issues, hasBlockingError: true, usableRowCount: 0 };
  }

  if (rows.length === 0) {
    issues.push({
      severity: "error",
      fieldId: null,
      message: "Bu sayfada başlık dışında veri satırı yok.",
    });
    return { issues, hasBlockingError: true, usableRowCount: 0 };
  }

  /* -- Zorunlu alanlar -------------------------------------------------- */
  for (const field of FIELDS) {
    if (!field.required) {
      continue;
    }
    const columnIndex = mapping[field.id];
    if (columnIndex === null || columnIndex === undefined) {
      issues.push({
        severity: "error",
        fieldId: field.id,
        message: `"${field.label}" alanı eşleştirilmedi. Model bu alan olmadan kurulamaz.`,
      });
    }
  }

  /* -- Çakışan eşleşme --------------------------------------------------- */
  // Aynı kolonun iki alana verilmesi sessizce kabul edilseydi, iki alan aynı
  // sayıyı okur ve kullanıcı bunu ancak modeldeki tuhaf değerlerden anlardı.
  const byColumn = new Map<number, string[]>();
  for (const field of FIELDS) {
    const columnIndex = mapping[field.id];
    if (columnIndex === null || columnIndex === undefined) {
      continue;
    }
    const existing = byColumn.get(columnIndex) ?? [];
    existing.push(field.label);
    byColumn.set(columnIndex, existing);
  }

  for (const [columnIndex, labels] of byColumn) {
    if (labels.length > 1) {
      const column = columns.find((item) => item.index === columnIndex);
      issues.push({
        severity: "error",
        fieldId: null,
        message: `"${column?.header ?? `Kolon ${columnIndex + 1}`}" kolonu birden çok alana atandı: ${labels.join(", ")}. Her kolon yalnızca bir alana verilebilir.`,
      });
    }
  }

  /* -- Bilinmeyen kolon referansı ---------------------------------------- */
  const validIndexes = new Set(columns.map((column) => column.index));
  for (const field of FIELDS) {
    const columnIndex = mapping[field.id];
    if (
      columnIndex !== null &&
      columnIndex !== undefined &&
      !validIndexes.has(columnIndex)
    ) {
      issues.push({
        severity: "error",
        fieldId: field.id,
        message: `"${field.label}" alanı bu sayfada bulunmayan bir kolona atanmış.`,
      });
    }
  }

  /* -- Satır kalitesi ---------------------------------------------------- */
  const stationIndex = mapping.station;
  const cycleIndex = mapping.cycleTime;

  let usableRowCount = 0;
  let missingName = 0;
  let missingCycle = 0;

  if (
    stationIndex !== null &&
    stationIndex !== undefined &&
    cycleIndex !== null &&
    cycleIndex !== undefined
  ) {
    for (const row of rows) {
      const name = cellToText(row[stationIndex] ?? null);
      const cycle = parseNumeric(row[cycleIndex] ?? null);

      if (name === "") {
        missingName += 1;
        continue;
      }
      if (cycle === null || cycle <= 0) {
        missingCycle += 1;
        continue;
      }
      usableRowCount += 1;
    }

    if (missingName > 0) {
      issues.push({
        severity: "warning",
        fieldId: "station",
        message: `${missingName} satırda istasyon adı boş; bu satırlar atlanacak.`,
      });
    }
    if (missingCycle > 0) {
      issues.push({
        severity: "warning",
        fieldId: "cycleTime",
        message: `${missingCycle} satırda çevrim süresi okunamadı ya da sıfır; bu satırlar atlanacak.`,
      });
    }
    if (usableRowCount === 0) {
      issues.push({
        severity: "error",
        fieldId: null,
        message:
          "Hiçbir satır modele dönüştürülemedi. İstasyon adı ve çevrim süresi kolonlarının doğru eşleştiğinden emin olun.",
      });
    }
  }

  /* -- Yinelenen istasyon adı -------------------------------------------- */
  if (stationIndex !== null && stationIndex !== undefined) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const row of rows) {
      const name = cellToText(row[stationIndex] ?? null);
      if (name === "") continue;
      if (seen.has(name)) {
        duplicates.add(name);
      }
      seen.add(name);
    }
    if (duplicates.size > 0) {
      issues.push({
        severity: "warning",
        fieldId: "station",
        message: `Aynı istasyon adı birden çok satırda geçiyor (${[...duplicates].slice(0, 3).join(", ")}). Her satır ayrı bir istasyon olarak kurulacak.`,
      });
    }
  }

  /* -- Envanter alanları için bilgi -------------------------------------- */
  const inventoryMapped = FIELDS.filter(
    (field) =>
      field.usage === "inventory" &&
      mapping[field.id] !== null &&
      mapping[field.id] !== undefined,
  );
  if (inventoryMapped.length > 0) {
    issues.push({
      severity: "warning",
      fieldId: null,
      message: `${inventoryMapped.map((field) => field.label).join(", ")} envanter alanıdır ve fabrika modeline girmez; eşleştirmeniz kayıt için tutulur.`,
    });
  }

  return {
    issues,
    hasBlockingError: issues.some((issue) => issue.severity === "error"),
    usableRowCount,
  };
}

/** Eşleştirilmemiş zorunlu ve isteğe bağlı model alanları. */
export function missingModelFields(mapping: ColumnMapping): typeof FIELDS {
  return FIELDS.filter(
    (field) =>
      field.usage === "model" &&
      (mapping[field.id] === null || mapping[field.id] === undefined),
  );
}

/** Bir alanın etiketini güvenle döndürür (bilinmeyen kimlikte fırlatır). */
export function labelOf(fieldId: Parameters<typeof fieldById>[0]): string {
  return fieldById(fieldId).label;
}
