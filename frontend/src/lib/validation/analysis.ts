/**
 * Sebep analizi — sapmanın cümleye çevrilmesi.
 *
 * Buradaki metinlerin tamamı **ölçülmüş sayılardan** kurulur. Hiçbir cümle
 * girilmemiş bir veriye dayanmaz, hiçbir cümle sebep uydurmaz: "Torna
 * istasyonunda gerçek çevrim süresi modeldekinden %18 uzun" doğrudan iki
 * ölçümün farkıdır; "operatör eğitimi yetersiz" gibi bir yorum ise veriden
 * çıkarılamaz ve bu yüzden yazılmaz.
 *
 * Tavsiye kısmı ayrı bir alanda durur (`advice`) çünkü bulgu ile öneri farklı
 * güvenilirlikte iki şeydir: bulgu ölçümdür, öneri modelin nasıl düzeltileceğine
 * dair mühendislik kararıdır. Karıştırılırsa kullanıcı öneriyi de ölçüm sanır.
 */

import { NOT_MEASURED, percent } from "../reports/shared";
import { BAND_THRESHOLDS } from "./accuracy";
import {
  CONFIDENCE_LABEL,
  METRIC_LABEL,
  METRIC_ORDER,
  type ConfidenceScore,
  type FindingTone,
  type MetricComparison,
  type StationValidation,
  type ValidationFinding,
  type ValidationMetric,
  type ValidationSummary,
} from "./types";

/**
 * Türkçe ondalık gösterim.
 *
 * Rapor katmanındaki `decimal()` sayıyı `toFixed` ile basar ve nokta döndürür
 * ("2.40"). Burada üretilen şey bir tablo hücresi değil, kullanıcıya okunan bir
 * **cümledir**; cümlenin içinde "2.40 dakika" yazmak Türkçede yanlıştır ve
 * aynı ekrandaki yüzdeler zaten virgüllüdür (`percent`). Ortak yardımcıyı
 * değiştirmek mevcut yönetici ve teknik raporların çıktısını da değiştirirdi;
 * bu yüzden ayrım burada, tek satırda tutulur.
 */
export function trDecimal(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return value.toFixed(digits).replace(".", ",");
}

/**
 * Bu sapmanın altındaki farklar bulgu üretmez.
 *
 * Ölçüm gürültüsü ve yuvarlama bu bandın içinde kalır; %3'lük bir farkı
 * "bulgu" diye listelemek, gerçek sapmaları listenin altına iterdi.
 */
export const MIN_REPORTABLE_ERROR = 0.05;

/** Ekranda ve raporda gösterilen en fazla bulgu sayısı. */
export const MAX_FINDINGS = 6;

/**
 * Müşteriye gösterilen tek cümlelik sonuç.
 *
 * Doğruluk hesaplanamadıysa cümle **kurulmaz**: "%0 uyumlu" demek, ölçüm
 * yapılmadığını değil modelin tamamen yanlış olduğunu söylerdi.
 */
export function accuracyHeadline(summary: ValidationSummary): string | null {
  if (summary.overallAccuracy === null) {
    return null;
  }
  return `Simülasyon sonuçları gerçek üretimle ${percent(summary.overallAccuracy)} uyumlu.`;
}

/** Güven rozetinin altına yazılan açıklama. */
export function confidenceHeadline(confidence: ConfidenceScore): string | null {
  if (confidence.score === null || confidence.level === null) {
    return null;
  }
  return `${CONFIDENCE_LABEL[confidence.level]} · ${percent(confidence.score)} güven skoru`;
}

/**
 * Sapmaları büyükten küçüğe bulgulara çevirir.
 *
 * Her istasyonun her ölçütü tek tek bakılır; eşiğin altındaki farklar elenir ve
 * kalanlar büyüklüğe göre sıralanır. Sıralamanın büyüklüğe göre olması
 * bilinçlidir — kullanıcı listenin başındaki iki maddeyi okur, oraya en çok
 * parayı etkileyen sapma gelmelidir.
 */
export function buildFindings(
  summary: ValidationSummary,
  limit: number = MAX_FINDINGS,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const station of summary.stations) {
    for (const metric of METRIC_ORDER) {
      const comparison = station.metrics[metric];
      if (comparison.errorRatio === null || comparison.accuracy === null) {
        continue;
      }
      const magnitude = Math.abs(comparison.errorRatio);
      if (magnitude < MIN_REPORTABLE_ERROR) {
        continue;
      }

      findings.push({
        id: `${station.stationId}-${metric}`,
        stationId: station.stationId,
        stationName: station.stationName,
        metric,
        magnitude,
        tone: toneOf(comparison.accuracy),
        text: describe(station, metric, comparison),
        advice: adviseOn(metric, comparison),
      });
    }
  }

  return findings.sort((a, b) => b.magnitude - a.magnitude).slice(0, limit);
}

/**
 * Hiç bulgu çıkmadığında yazılacak cümle.
 *
 * Boş bir liste iki farklı şey anlamına gelebilir: ölçüm yok ya da model
 * tutuyor. İkisini ayırmak, kullanıcının ekrana bakıp yanlış sonuç çıkarmasını
 * engeller.
 */
export function emptyFindingMessage(summary: ValidationSummary): string {
  if (summary.measuredPointCount === 0) {
    return "Henüz gerçek veri girilmedi. Bir vardiyanın ölçümlerini girdiğinizde model bu değerlerle karşılaştırılır.";
  }
  return `Girilen ölçümlerin hepsi modelin ${percent(MIN_REPORTABLE_ERROR)} bandı içinde; raporlanacak bir sapma yok.`;
}

/* -------------------------------------------------------------------------- */

/**
 * Bulgu cümlesi.
 *
 * Yön (uzun/kısa, yüksek/düşük) ölçütün anlamına göre yazılır: bekleme
 * süresinde "yüksek" kötü, üretimde "yüksek" iyidir. Tek bir şablonla
 * yazılsaydı, iyi haberi kötü haber gibi okutan cümleler çıkardı.
 */
function describe(
  station: StationValidation,
  metric: ValidationMetric,
  comparison: MetricComparison,
): string {
  const gap = percent(Math.abs(comparison.errorRatio ?? 0));
  // errorRatio > 0 ⇒ gerçek, modelden büyük.
  const realIsHigher = (comparison.errorRatio ?? 0) > 0;
  const name = station.stationName;

  switch (metric) {
    case "cycleTime":
      return realIsHigher
        ? `${name} istasyonunda çevrim süresi modeldekinden ${gap} daha uzun (${valuePair(comparison, 2, "dk")}).`
        : `${name} istasyonunda çevrim süresi modeldekinden ${gap} daha kısa (${valuePair(comparison, 2, "dk")}).`;

    case "throughput":
      return realIsHigher
        ? `${name} istasyonunda gerçek üretim modelin öngördüğünden ${gap} yüksek (${valuePair(comparison, 2, "parça/dk")}).`
        : `${name} istasyonunda gerçek üretim modelin öngördüğünden ${gap} düşük (${valuePair(comparison, 2, "parça/dk")}).`;

    case "queue":
      return realIsHigher
        ? `${name} istasyonunda bekleme süresi modele göre ${gap} yüksek (${valuePair(comparison, 1, "dk")}).`
        : `${name} istasyonunda bekleme süresi modele göre ${gap} düşük (${valuePair(comparison, 1, "dk")}).`;

    case "scrap":
      return realIsHigher
        ? `${name} istasyonunda fire oranı tahmin edilenden ${gap} yüksek (${ratioPair(comparison)}).`
        : `${name} istasyonunda fire oranı tahmin edilenden ${gap} düşük (${ratioPair(comparison)}).`;
  }
}

/** Bulguya bağlı öneri. */
function adviseOn(
  metric: ValidationMetric,
  comparison: MetricComparison,
): string {
  const realIsHigher = (comparison.errorRatio ?? 0) > 0;

  switch (metric) {
    case "cycleTime":
      return realIsHigher
        ? `Modeldeki servis süresini ${trDecimal(comparison.real, 2)} dakikaya güncelleyin; şu hâliyle model kapasiteyi olduğundan yüksek gösteriyor.`
        : `Modeldeki servis süresini ${trDecimal(comparison.real, 2)} dakikaya güncelleyin; model bu istasyonu olduğundan yavaş varsayıyor.`;

    case "throughput":
      return realIsHigher
        ? "Modelin varış hızını ve tampon kapasitelerini gözden geçirin: saha modelden daha çok parça geçiriyor."
        : "Duruş, mola ve setup sürelerinin modele girilip girilmediğini kontrol edin; model bunları görmediğinde çıktıyı fazla tahmin eder.";

    case "queue":
      return realIsHigher
        ? "İstasyon önündeki tampon kapasitesini ve arıza oranını modele girin; gerçek kuyruk modelden uzun."
        : "Modeldeki tampon ve arıza varsayımları sahadan katı görünüyor; bu değerleri ölçümle güncelleyin.";

    case "scrap":
      return realIsHigher
        ? `Modeldeki fire oranını ${percent(comparison.real, 1)} seviyesine çekin; kalite kaybı modelde eksik görünüyor.`
        : `Modeldeki fire oranını ${percent(comparison.real, 1)} seviyesine çekin; model gereğinden fazla hurda varsayıyor.`;
  }
}

/** Doğruluğa göre bulgunun tonu; bantlar doğruluk motorundan gelir. */
function toneOf(accuracy: number): FindingTone {
  if (accuracy >= BAND_THRESHOLDS.good) {
    return "good";
  }
  return accuracy >= BAND_THRESHOLDS.warning ? "warning" : "bad";
}

/** "model 2,00 dk · saha 2,36 dk" biçiminde çift değer. */
function valuePair(
  comparison: MetricComparison,
  digits: number,
  unit: string,
): string {
  return `model ${trDecimal(comparison.simulated, digits)} ${unit} · saha ${trDecimal(comparison.real, digits)} ${unit}`;
}

function ratioPair(comparison: MetricComparison): string {
  return `model ${percent(comparison.simulated, 1)} · saha ${percent(comparison.real, 1)}`;
}

/** Rapor ve ekranda kullanılan ölçüt başlıkları. */
export function metricTitle(metric: ValidationMetric): string {
  return METRIC_LABEL[metric];
}
