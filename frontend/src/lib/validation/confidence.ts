/**
 * Güven motoru — "%94 uyumlu" cümlesine ne kadar güvenilebileceği.
 *
 * Doğruluk ile güven farklı iki şeydir ve karıştırılmaları en tehlikeli
 * hatadır: tek bir istasyonda, yirmi dakikalık bir ölçümle bulunan %98'lik bir
 * uyum, sekiz saat boyunca altı istasyonda ölçülmüş %88'den daha zayıf bir
 * iddiadır. Doğruluk modelin ne kadar tuttuğunu, güven ise bu ölçümün ne kadar
 * temsil ettiğini söyler.
 *
 * Skor dört bileşenin ağırlıklı ortalamasıdır ve her bileşenin neden düştüğü
 * `reasons` içinde cümleyle yazılır. Kullanıcı "düşük güven" rozetini gördüğünde
 * ne yapması gerektiğini de görür: daha çok alan doldur, daha uzun ölç, daha
 * çok istasyon ölç.
 */

import { METRIC_ORDER, type ConfidenceLevel, type ConfidenceReason, type ConfidenceScore, type ValidationSummary } from "./types";

/** Bileşenlerin skordaki ağırlıkları. */
export const CONFIDENCE_WEIGHTS = {
  /** Doldurulan alanların, doldurulabilecek alanlara oranı. */
  coverage: 0.3,
  /** Ölçülen sapmanın küçüklüğü (genel doğruluk). */
  deviation: 0.4,
  /** Kaç istasyonda ölçüm yapıldığı. */
  scale: 0.15,
  /** Ölçüm penceresinin uzunluğu. */
  duration: 0.15,
} as const;

/** Bu kadar istasyonda ölçüm, ölçek bileşenini tam sayar. */
export const FULL_SCALE_STATIONS = 5;

/** Bu kadar dakikalık pencere, süre bileşenini tam sayar (bir vardiya). */
export const FULL_WINDOW_MINUTES = 480;

/**
 * Bu sürenin altındaki ölçüm penceresi tek başına anlamlı sayılmaz.
 *
 * Bir saatten kısa bir gözlem, hattın ısınma ve mola dalgalanmasını içermez;
 * sıfır vermek yerine küçük bir taban puan verilir, çünkü kısa da olsa gerçek
 * bir ölçümdür.
 */
export const MIN_WINDOW_MINUTES = 60;

/** Bu tabanın altındaki bileşenler kullanıcıya gerekçe olarak yazılır. */
export const REASON_THRESHOLD = 0.8;

/** Skorun güven seviyesine çevrildiği eşikler. */
export const CONFIDENCE_BANDS = {
  high: 0.8,
  medium: 0.6,
} as const;

/** Skoru seviyeye çevirir. */
export function levelOf(score: number | null): ConfidenceLevel | null {
  if (score === null) {
    return null;
  }
  if (score >= CONFIDENCE_BANDS.high) {
    return "high";
  }
  return score >= CONFIDENCE_BANDS.medium ? "medium" : "low";
}

/**
 * Güven skorunu üretir.
 *
 * Hiç ölçüm yoksa skor `null`'dır — sıfır değil. Sıfır "hesapladık, güven yok"
 * demektir; burada henüz hesaplanacak bir şey yoktur ve arayüz kullanıcıyı veri
 * girmeye çağırır.
 */
export function buildConfidence(summary: ValidationSummary): ConfidenceScore {
  if (summary.measuredPointCount === 0 || summary.overallAccuracy === null) {
    return {
      score: null,
      level: null,
      parts: { coverage: null, deviation: null, scale: null, duration: null },
      reasons: [
        {
          factor: "coverage",
          text: "Henüz hiçbir gerçek ölçüm girilmedi; doğruluk hesaplanamıyor.",
        },
      ],
    };
  }

  const fillableFields = Math.max(
    summary.stationCount * METRIC_ORDER.length,
    1,
  );
  const coverage = clamp(summary.measuredPointCount / fillableFields);
  const deviation = clamp(summary.overallAccuracy);
  const scale = clamp(summary.measuredStationCount / FULL_SCALE_STATIONS);
  const duration = windowScore(summary.shiftMinutes);

  const score = clamp(
    coverage * CONFIDENCE_WEIGHTS.coverage +
      deviation * CONFIDENCE_WEIGHTS.deviation +
      scale * CONFIDENCE_WEIGHTS.scale +
      duration * CONFIDENCE_WEIGHTS.duration,
  );

  return {
    score,
    level: levelOf(score),
    parts: { coverage, deviation, scale, duration },
    reasons: buildReasons(summary, { coverage, deviation, scale, duration }),
  };
}

/**
 * Ölçüm penceresinin puanı.
 *
 * Vardiya süresi girilmemişse pencere bilinmiyordur; bu bir ölçüm eksikliğidir
 * ve puanı düşürür, ama ölçümün tamamını geçersiz kılmaz.
 */
function windowScore(shiftMinutes: number | null): number {
  if (shiftMinutes === null || shiftMinutes <= 0) {
    return 0;
  }
  if (shiftMinutes < MIN_WINDOW_MINUTES) {
    // Kısa ölçüm: penceresiyle orantılı, ama tam puanın yarısını geçemez.
    return clamp((shiftMinutes / MIN_WINDOW_MINUTES) * 0.5);
  }
  return clamp(shiftMinutes / FULL_WINDOW_MINUTES);
}

/**
 * Skoru düşüren nedenler.
 *
 * Yalnızca gerçekten düşük olan bileşenler yazılır ve her cümle o bileşenin
 * sayısını taşır; "veri yetersiz" gibi kapalı bir uyarı, kullanıcıya ne
 * yapacağını söylemez.
 */
function buildReasons(
  summary: ValidationSummary,
  parts: { coverage: number; deviation: number; scale: number; duration: number },
): ConfidenceReason[] {
  const reasons: ConfidenceReason[] = [];
  const fillable = summary.stationCount * METRIC_ORDER.length;

  if (parts.coverage < REASON_THRESHOLD) {
    reasons.push({
      factor: "coverage",
      text: `${fillable} alandan ${summary.measuredPointCount} tanesi dolduruldu; eksik alanlar hesaba girmiyor.`,
    });
  }

  if (parts.scale < REASON_THRESHOLD) {
    reasons.push({
      factor: "scale",
      text: `${summary.stationCount} istasyonun ${summary.measuredStationCount} tanesinde ölçüm var; hat geneline yayılmadıkça sonuç tüm fabrikayı temsil etmez.`,
    });
  }

  if (parts.duration < REASON_THRESHOLD) {
    reasons.push({
      factor: "duration",
      text:
        summary.shiftMinutes === null || summary.shiftMinutes <= 0
          ? "Ölçüm penceresi girilmedi; üretim adedi hıza çevrilemediği için üretim karşılaştırması yapılmadı."
          : `Ölçüm ${formatMinutes(summary.shiftMinutes)} sürdü; tam vardiya (${formatMinutes(FULL_WINDOW_MINUTES)}) boyunca ölçmek dalgalanmayı da kapsar.`,
    });
  }

  if (parts.deviation < REASON_THRESHOLD) {
    reasons.push({
      factor: "deviation",
      text: "Ölçülen sapma yüksek; model sahayı bu hâliyle tutturmuyor, güven skoru bunu yansıtıyor.",
    });
  }

  return reasons;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} dakika`;
  }
  const hours = minutes / 60;
  const text = Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(1).replace(".", ",");
  return `${text} saat`;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
