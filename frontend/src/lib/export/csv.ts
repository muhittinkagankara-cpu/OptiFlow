/**
 * Dışa aktarılan dosyanın tarayıcıda indirilmesi.
 *
 * CSV'nin **içeriği sunucuda** üretilir: ham telemetri tarayıcıya indirilip
 * orada birleştirilseydi, elli bin satır belleğe alınır ve müşterinin
 * makinesinde beklenmedik bir yavaşlama olurdu. Burada yapılan tek şey,
 * gelen metni bir dosyaya çevirmektir.
 *
 * BOM neden var
 * -------------
 * Excel, UTF-8 bir CSV'yi BOM olmadan Windows-1254 sanar ve Türkçe harfleri
 * bozar (`Ölçüm` → `Ã–lÃ§Ã¼m`). Üç baytlık BOM bunu çözer ve başka hiçbir
 * araca zarar vermez.
 */

/** UTF-8 bayt sırası işareti; Excel'in Türkçe harfleri doğru okuması için. */
export const BOM = "﻿";

/** Desteklenen dışa aktarma türleri; sunucudaki listeyle aynı. */
export type ExportKind = "telemetry" | "alarms" | "oee";

export const EXPORT_KIND_LABEL: Record<ExportKind, string> = {
  telemetry: "Telemetri",
  alarms: "Alarm geçmişi",
  oee: "OEE geçmişi",
};

export const EXPORT_KIND_ORDER: ExportKind[] = ["telemetry", "alarms", "oee"];

/** Sunucudan gelen dışa aktarma sonucu. */
export interface ExportResult {
  fileName: string;
  content: string;
  rowCount: number;
  /** Sınıra dayanıldıysa dosya eksiktir ve bu söylenir. */
  truncated: boolean;
  source: string;
  bytes: number;
}

/**
 * Tanınmayan tür `null` döner; varsayılana düşülmez.
 *
 * Kullanıcının alarm istediği yerde telemetri indirmesi olurdu.
 */
export function parseKind(value: unknown): ExportKind | null {
  return EXPORT_KIND_ORDER.includes(value as ExportKind)
    ? (value as ExportKind)
    : null;
}

/**
 * Dosya adını güvenli hâle getirir.
 *
 * Windows'ta dosya adında bulunamayan karakterler tire olur. Boş bir ad
 * "indirme.csv" olur: adsız bir dosya, kullanıcının indirdiğinin ne olduğunu
 * bilinemez kılardı.
 */
export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return cleaned.length > 0 ? cleaned : "indirme.csv";
}

/**
 * CSV metnini indirilebilir bir Blob'a çevirir.
 *
 * BOM eklenir; Excel Türkçe harfleri ancak böyle doğru okur.
 */
export function csvBlob(content: string): Blob {
  return new Blob([BOM + content], { type: "text/csv;charset=utf-8" });
}

/**
 * Dışa aktarmanın açıklama satırı.
 *
 * Satır sayısı **her zaman** yazılır: boş bir dosya indiren kullanıcı, verinin
 * mi yoksa dışa aktarmanın mı boş olduğunu bilmelidir. Kesilme de ayrıca
 * söylenir; eksik bir dosyayı tam sanmak, müşterinin yanlış bir analiz
 * yapması demektir.
 */
export function exportCaption(result: ExportResult): string {
  const parts = [`${result.rowCount.toLocaleString("tr-TR")} satır`];
  if (result.rowCount === 0) {
    parts.push("kayıt yok, yalnızca başlık satırı indirildi");
  }
  if (result.truncated) {
    parts.push("dosya sınıra dayandı; kayıtların tamamı değil");
  }
  return parts.join(" · ");
}
