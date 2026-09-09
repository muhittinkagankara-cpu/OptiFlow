/**
 * Geçmiş trendlerin türleri.
 *
 * Bu katmanın tek veri kaynağı sunucudaki `telemetry` tablosudur; benzetim
 * kullanılmaz. Ekranda görülen her nokta, bir cihazdan gerçekten okunmuş bir
 * ölçümdür.
 *
 * Boş kova neden `null`
 * ---------------------
 * Bir kovada hiç ölçüm yoksa ortalaması `null` kalır. Sıfır yazılsaydı,
 * cihazın kapalı olduğu saatler grafikte "üretim sıfıra düştü" gibi görünür
 * ve gerçek bir duruşla veri boşluğu ayırt edilemezdi.
 */

/** Trend penceresi kimliği; sunucudaki değerlerle birebir aynı. */
export type TrendWindowId = "1h" | "24h" | "7d";

export const TREND_WINDOW_LABEL: Record<TrendWindowId, string> = {
  "1h": "Son 1 saat",
  "24h": "Son 24 saat",
  "7d": "Son 7 gün",
};

/** Ekrandaki sıralama; kısa pencereden uzuna. */
export const TREND_WINDOW_ORDER: TrendWindowId[] = ["1h", "24h", "7d"];

/** Bir zaman kovasının özeti. */
export interface TrendBucket {
  startMs: number;
  endMs: number;
  /** Kovaya düşen ölçüm sayısı; sıfır ise kova boştur. */
  count: number;
  /** Ölçüm yoksa `null`; sıfır yazılmaz. */
  average: number | null;
  min: number | null;
  max: number | null;
  /** Kovadaki son değer; sayaçlar için ortalamadan anlamlıdır. */
  last: number | null;
}

/** Serinin özeti; veri yoksa alanlar `null` ve `reason` doludur. */
export interface TrendSummary {
  average: number | null;
  min: number | null;
  max: number | null;
  /** Kaç kovada veri var? */
  filledBuckets: number;
  /** Dolu kovaların oranı; kesintili akış burada görülür. */
  coverage: number | null;
  /** Veri yoksa nedeni; varsa `null`. */
  reason: string | null;
}

/** Bir cihaz-etiket çiftinin zaman serisi. */
export interface TrendSeries {
  device: string;
  tag: string;
  window: TrendWindowId;
  windowLabel: string;
  buckets: TrendBucket[];
  totalPoints: number;
  hasData: boolean;
  summary: TrendSummary;
  /** Kalitesi ya da değeri yüzünden hesaba girmeyen ölçüm sayısı. */
  excluded: number;
  startMs: number;
  endMs: number;
  /**
   * Verinin kaynağı. Sunucu `telemetry` yazar; başka bir değer gelirse
   * arayüz bunu olduğu gibi gösterir ve **benzetim değil** diye varsaymaz.
   */
  origin: string;
}

/** Seçim listesindeki bir cihaz-etiket çifti. */
export interface TelemetryTag {
  device: string;
  tag: string;
}

/** Boş bir seri; henüz veri yüklenmemişken gösterilir. */
export function emptySeries(
  device: string,
  tag: string,
  window: TrendWindowId,
): TrendSeries {
  return {
    device,
    tag,
    window,
    windowLabel: TREND_WINDOW_LABEL[window],
    buckets: [],
    totalPoints: 0,
    hasData: false,
    summary: {
      average: null,
      min: null,
      max: null,
      filledBuckets: 0,
      coverage: null,
      reason: "Veri henüz yüklenmedi",
    },
    excluded: 0,
    startMs: 0,
    endMs: 0,
    origin: "telemetry",
  };
}
