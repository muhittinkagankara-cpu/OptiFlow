/**
 * Finansal etki panelinin biçimlendirmesi.
 *
 * Saf işlevler; bileşenden ayrı tutulmaları test edilebilmeleri içindir.
 * Buradaki hatalar sessizdir: yanlış biçimlenmiş bir para değeri ekranda hata
 * göstermez, yalnızca kullanıcıya yanlış büyüklükte bir sayı okutur.
 */

import type { MetricProvenance } from "../types/simulationTypes";
import type { Tone } from "./resultsFormatting";

/**
 * Para birimi.
 *
 * Sabit tutulur çünkü hedef kullanıcı Türkiye'deki KOBİ'lerdir ve maliyet
 * oranları TL cinsinden girilir. Çoklu para birimi, oranların hangi birimde
 * girildiğinin de saklanmasını gerektirir; o ayrı bir karardır ve burada
 * varsayılmaz.
 */
export const CURRENCY = "₺";

/**
 * Parasal değeri okunabilir biçime çevirir.
 *
 * Kuruş gösterilmez: kayıp rakamları kestirim içerir ve iki ondalık basamak,
 * sahip olunmayan bir kesinliği ima ederdi.
 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${CURRENCY}${Math.round(value).toLocaleString("tr-TR")}`;
}

/** Kaynak etiketinin kullanıcıya gösterilecek karşılığı. */
export function provenanceLabel(provenance: MetricProvenance): string {
  switch (provenance) {
    case "observed":
      return "Ölçüldü";
    case "calculated":
      return "Hesaplandı";
    case "estimated":
      return "Tahmin";
  }
}

/**
 * Kaynak etiketinin açıklaması.
 *
 * Etiketin tek başına yeterli olmadığı yer burasıdır: "Tahmin" yazısı, bir
 * üretim müdürüne neden diğerlerinden daha az güvenilmesi gerektiğini
 * söylemez.
 */
export function provenanceHint(provenance: MetricProvenance): string {
  switch (provenance) {
    case "observed":
      return "Simülasyonun doğrudan saydığı bir büyüklük.";
    case "calculated":
      return "Sayılmış bir büyüklüğün, girdiğiniz maliyet oranıyla çarpımı.";
    case "estimated":
      return "Bir modelden türetilmiş kestirim; sayım değildir, varsayım içerir.";
  }
}

/** Kaynak etiketinin rengi. Tahmin, sayımdan görsel olarak da ayrılır. */
export function provenanceTone(provenance: MetricProvenance): Tone {
  switch (provenance) {
    case "observed":
      return "good";
    case "calculated":
      return "neutral";
    case "estimated":
      return "warning";
  }
}

/**
 * Güven oranının kullanıcıya gösterilecek karşılığı.
 *
 * Yüzde tek başına anlamsızdır ("%70 güven" neye göre?); sözel karşılığı
 * kullanıcıya ne yapması gerektiğini söyler.
 */
export function confidenceLabel(confidence: number): string {
  if (!Number.isFinite(confidence)) {
    return "—";
  }
  if (confidence >= 0.85) {
    return "Yüksek";
  }
  if (confidence >= 0.5) {
    return "Orta";
  }
  return "Düşük";
}

export function confidenceTone(confidence: number): Tone {
  if (!Number.isFinite(confidence)) {
    return "neutral";
  }
  if (confidence >= 0.85) {
    return "good";
  }
  if (confidence >= 0.5) {
    return "warning";
  }
  return "bad";
}

/** Eksik oranın kullanıcıya gösterilecek adı. */
export const RATE_LABELS: Record<string, string> = {
  selling_price: "Satış fiyatı",
  contribution_margin: "Birim katkı payı",
  labor_cost_per_hour: "Saatlik işçilik maliyeti",
  machine_cost_per_hour: "Saatlik makine maliyeti",
  scrap_cost_per_unit: "Birim fire maliyeti",
  overtime_cost_per_hour: "Saatlik fazla mesai maliyeti",
  production_minutes_per_day: "Günlük üretim süresi",
};

export function rateLabel(name: string): string {
  return RATE_LABELS[name] ?? name;
}

/**
 * Bir kalemin toplam içindeki payı (0-100).
 *
 * Toplam sıfırken sıfır döner: sıfıra bölmek `NaN` üretir ve ekranda
 * "%NaN" yazardı.
 */
export function shareOfTotal(amount: number, total: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return (amount / total) * 100;
}
