/**
 * Raporların paylaştığı biçimlendirme ve künye kuralları.
 *
 * İki rapor da (yönetici ve teknik) aynı kapağı, aynı tarih biçimini ve aynı
 * "ölçülmedi" davranışını kullanır. Her birinde ayrı yazılsaydı, biri "—"
 * gösterirken öteki "%0" gösterebilirdi.
 *
 * Ölçülemeyen değer hiçbir zaman sıfır olarak yazılmaz. Bir raporun en tehlikeli
 * hatası budur: yöneticinin eline "OEE %0" yazan bir PDF geçtiğinde, hattın
 * durduğunu sanır — oysa yalnızca ölçüm yapılmamıştır.
 */

import { formatMoney } from "../financeFormatting";
import { formatDecimal } from "../resultsFormatting";
import type { ReportContext, ReportCover } from "./types";

/** Ölçülemeyen değerlerin evrensel gösterimi. */
export const NOT_MEASURED = "—";

const DATE_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "4 Eylül 2026, 14:32" biçiminde okunur tarih. */
export function formatReportDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

/** Dosya adında kullanılabilecek "2026-09-04" biçimi. */
export function fileDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Fabrika adını dosya adına uygun hâle getirir.
 *
 * Türkçe harfler ASCII karşılıklarına çevrilir: indirilen dosya farklı
 * işletim sistemleri ve e-posta sunucuları arasında dolaşacak ve bazıları
 * UTF-8 dosya adlarını bozar.
 */
export function slugify(value: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
    ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  };
  const ascii = [...value]
    .map((char) => map[char] ?? char)
    .join("")
    .toLowerCase();

  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "fabrika" : slug;
}

/** Yüzde; ölçülemeyen değerde "—". */
export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return `%${(value * 100).toFixed(digits).replace(".", ",")}`;
}

/** Para; ölçülemeyen değerde "—". */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return formatMoney(value);
}

/** Ondalık sayı; ölçülemeyen değerde "—". */
export function decimal(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return formatDecimal(value, digits);
}

/** Fabrika adı; kaydedilmemiş modelde okunur bir yer tutucu. */
export function factoryLabel(context: ReportContext): string {
  return context.factoryName ?? "Kaydedilmemiş model";
}

/**
 * İki raporun da paylaştığı kapak.
 *
 * Künye satırları raporun **kapsamını** anlatır: hangi koşum, kaç istasyon,
 * kaç tekrar, ne kadarlık pencere. Bir yönetici raporu tarihsiz ya da
 * kapsamsız olduğunda, aylar sonra hangi koşuma ait olduğu anlaşılamaz.
 */
export function buildCover(
  context: ReportContext,
  title: string,
  subtitle: string,
): ReportCover {
  const results = context.result?.results ?? null;
  const facts: { label: string; value: string }[] = [
    {
      label: "İstasyon sayısı",
      value:
        context.config === null
          ? NOT_MEASURED
          : String(context.config.stations.length),
    },
    {
      label: "Tekrar sayısı",
      value: results === null ? NOT_MEASURED : String(results.num_replications),
    },
    {
      label: "Koşum kimliği",
      value: context.result?.simulation_id ?? NOT_MEASURED,
    },
    {
      label: "Finans penceresi",
      value:
        context.report === null
          ? "Maliyet oranları girilmedi"
          : `${context.report.window_minutes.toLocaleString("tr-TR")} dakika`,
    },
  ];

  return {
    title,
    subtitle,
    factoryName: factoryLabel(context),
    generatedAtLabel: formatReportDate(context.generatedAt),
    orgName: context.orgName,
    facts,
  };
}
