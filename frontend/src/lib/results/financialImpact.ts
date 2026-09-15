/**
 * Sonuç sayfasının finansal etki özeti (Sprint 2H-B).
 *
 * Bu dosya **hesap yapmaz**. Backend `/api/finance/impact/{id}` ucunda kayıp
 * kalemlerini zaten üretiyor; burada yapılan iş, o raporu karar yüzeyinde
 * okunacak birkaç cümleye çevirmektir. Yeni bir formül, yeni bir oran, yeni
 * bir zaman tabanı yoktur.
 *
 * ## Tek kritik kural: `amount === 0` "kayıp yok" demek değildir
 *
 * Gerekli maliyet oranı verilmeyen kalem backend'den `is_available: false` ve
 * `amount: 0.0` ile döner. Toplama bu sıfırı katıp "₺0" yazmak, hiç oran
 * girmemiş bir kullanıcıya "kaybınız yok" demek olurdu — ürünün yapabileceği
 * en pahalı hata. Bu yüzden **her toplam yalnızca `is_available` kalemlerden**
 * kurulur ve eksik olanlar ayrıca sayılıp söylenir.
 *
 * ## "Aylık" sözcüğü neden yok
 *
 * Backend aylık bir büyüklük üretmiyor. Elindeki iki zaman tabanı şudur:
 * ölçüm penceresi (`window_minutes`) ve — yalnızca günlük üretim süresi
 * girilmişse — `daily_loss`. Command Center ayrıca aylığa ölçekliyor; Sonuç
 * ekranı ölçülene sadık kalır ve desteklenmeyen bir zaman tabanını
 * adlandırmaz.
 */

import type {
  FinancialReport,
  LossComponent,
  MetricProvenance,
} from "../../types/simulationTypes";
import { formatMoney, rateLabel } from "../financeFormatting";

/** Karar yüzeyinde gösterilecek finansal özet. */
export interface FinancialSummary {
  /** Hesaplanabilmiş kalem var mı? */
  hasAmounts: boolean;
  /** Ana cümle. */
  headline: string;
  /** Baskın kayıp kalemi; hesaplanabilmiş kalem yoksa `null`. */
  primarySource: {
    label: string;
    amount: string;
    provenance: MetricProvenance;
  } | null;
  /** Eksik maliyet oranları olduğunda tek satırlık açıklama; yoksa `null`. */
  missingNote: string | null;
  /** Hesaplanabilmiş kalem sayısı. */
  availableCount: number;
  /** Oranı verilmediği için hesaplanamayan kalem sayısı. */
  unavailableCount: number;
}

/** Yalnızca gerekli oranı verilmiş kalemler. */
export function availableComponents(report: FinancialReport): LossComponent[] {
  return report.impact.components.filter((item) => item.is_available);
}

/** Oranı verilmediği için hesaplanamayan kalemler. */
export function unavailableComponents(report: FinancialReport): LossComponent[] {
  return report.impact.components.filter((item) => !item.is_available);
}

/**
 * Hesaplanabilmiş kalemlerin toplamı.
 *
 * `impact.total_loss` alanı da aynı sonucu verir (eksik kalemlerin tutarı
 * zaten 0'dır), ama toplam burada **açıkça** available kalemlerden kurulur:
 * bir gün backend eksik kaleme sıfırdan başka bir şey yazarsa bu satır
 * sessizce yanlış toplamaz.
 */
export function availableTotal(report: FinancialReport): number {
  return availableComponents(report).reduce((sum, item) => sum + item.amount, 0);
}

/** En büyük hesaplanabilmiş kalem; hiç yoksa `null`. */
export function primaryLossComponent(
  report: FinancialReport,
): LossComponent | null {
  const ranked = [...availableComponents(report)].sort(
    (a, b) => b.amount - a.amount,
  );
  return ranked.length === 0 ? null : ranked[0];
}

/** Eksik oranları tek cümleye çevirir; eksik yoksa `null`. */
function missingLine(report: FinancialReport): string | null {
  const missing = report.impact.missing_inputs;
  if (missing.length === 0) {
    return null;
  }
  const names = missing.map(rateLabel).join(", ");
  return `${missing.length} kayıp kalemi hesaplanamadı — eksik girdi: ${names}.`;
}

/**
 * Finansal özeti kurar.
 *
 * Rapor yoksa `null` döner ve çağıran hiçbir şey çizmez: henüz hesaplanmamış
 * bir şey için karar yüzeyinde yer ayırmak, olmayan bir ölçümü varmış gibi
 * göstermenin yumuşak biçimidir. Hesap girişi zaten aşağıdaki panelde durur.
 */
export function financialSummary(
  report: FinancialReport | null,
): FinancialSummary | null {
  if (report === null) {
    return null;
  }

  const available = availableComponents(report);
  const unavailable = unavailableComponents(report);
  const missingNote = missingLine(report);

  if (available.length === 0) {
    return {
      hasAmounts: false,
      // Tutar uydurulmaz; sıfır da yazılmaz.
      headline: "Finansal etki hesaplanamadı.",
      primarySource: null,
      missingNote,
      availableCount: 0,
      unavailableCount: unavailable.length,
    };
  }

  const total = availableTotal(report);
  const daily = report.daily_loss;
  const hasDaily = typeof daily === "number" && Number.isFinite(daily);

  /* Zaman tabanı ölçülene sadık kalır: günlük üretim süresi verildiyse günlük
     projeksiyon, verilmediyse ölçüm penceresinin kendisi. */
  const headline = hasDaily
    ? `Günde yaklaşık ${formatMoney(daily as number)} kayıp ölçüldü.`
    : `${Math.round(report.window_minutes)} dakikalık pencerede ${formatMoney(total)} kayıp ölçüldü.`;

  const primary = primaryLossComponent(report);

  return {
    hasAmounts: true,
    headline,
    primarySource:
      primary === null
        ? null
        : {
            label: primary.label,
            amount: formatMoney(primary.amount),
            provenance: primary.provenance,
          },
    missingNote,
    availableCount: available.length,
    unavailableCount: unavailable.length,
  };
}
