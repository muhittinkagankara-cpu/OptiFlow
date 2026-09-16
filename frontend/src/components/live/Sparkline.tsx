/**
 * KPI'nın altındaki son on beş dakikalık mini grafik.
 *
 * ## Sprint 2I-D — gradient kalktı, ölçek geldi
 *
 * Grafik önce bir **alan** grafiğiydi ve alanı dikey bir `linearGradient` ile
 * doluyordu. İki kural birden çiğneniyordu: MASTER §6.3 grafiklerde gradient
 * yasaklar, aynı madde **etiketsiz sparkline**ı da yasaklar. Gradient dolgu
 * kaldırıldı; geriye tek bir düz çizgi kaldı.
 *
 * Etiketsizlik, altına iki küçük yazı eklenerek kapatıldı: solda pencerenin
 * uzunluğu, sağda penceredeki en küçük ve en büyük değer. Böylece çizginin
 * dikey ölçeği okunur hâle gelir — bugüne kadar aynı şekil, %78-%80 arasında
 * gezinen bir OEE için de 0-100 arasında gezinen bir kuyruk için de aynı
 * görünüyordu.
 *
 * Sınırlar `trendRange()` ile okunur; burada yeni bir büyüklük hesaplanmaz.
 * Biçimlendirme çağırandan gelir, çünkü birimi yalnızca kart bilir (yüzde,
 * parça, saniye). Ölçüm yoksa grafik hiç çizilmez — düz bir sıfır çizgisi,
 * ölçülmüş bir sıfır gibi okunurdu.
 */

import { memo } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { TREND_WINDOW_MINUTES, trendRange, type TrendSample } from "../../lib/live";

interface SparklineProps {
  series: TrendSample[];
  /** Çizgi rengi; KPI kartının tonuyla eşleşir. */
  color: string;
  /**
   * Ölçek etiketinin biçimlendiricisi.
   *
   * Birimi yalnızca kart bilir: aynı 0,74 sayısı OEE'de "%74", kuyrukta
   * "0,7 parça" demektir. Varsayılan tek ondalıktır.
   */
  format?: (value: number) => string;
}

const DEFAULT_FORMAT = (value: number) => value.toFixed(1);

function SparklineInner({ series, color, format = DEFAULT_FORMAT }: SparklineProps) {
  const range = trendRange(series);

  if (range === null || series.length < 2) {
    return (
      <div className="flex h-8 items-center text-[10px] text-[var(--of-cc-ink-label)]">
        Ölçüm bekleniyor
      </div>
    );
  }

  /*
   * Çizginin tabanı, penceredeki en küçük değerin biraz altına çekilir.
   * Sıfırdan başlasaydı, %78 ile %80 arasında gezinen bir OEE bomboş düz bir
   * çizgi olarak görünür ve eğilim hiç okunamazdı.
   */
  const padding = Math.max((range.max - range.min) * 0.15, 0.0001);
  const flat = range.max - range.min < Number.EPSILON;

  return (
    <div>
      <div className="h-8 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis
              hide
              domain={[range.min - padding, range.max + padding]}
              type="number"
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.5}
              isAnimationActive={false}
              // Ölçülemeyen anlarda çizgi kesilir; sıfıra düşmez.
              connectNulls={false}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Ölçek: sol tarafta pencere, sağda dikey sınırlar (MASTER §6.3).
          Pencere boyunca değer hiç değişmediyse tek sayı yazılır; "8 – 8"
          bir aralık varmış gibi okunurdu. */}
      <p className="mt-1 flex items-baseline justify-between gap-2 text-[10px] leading-3 text-[var(--of-cc-ink-label)] tabular-nums">
        <span>{TREND_WINDOW_MINUTES} dk</span>
        <span>
          {flat
            ? format(range.max)
            : `${format(range.min)} – ${format(range.max)}`}
        </span>
      </p>
    </div>
  );
}

export const Sparkline = memo(SparklineInner);
