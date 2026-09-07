/**
 * KPI'nın altındaki son on beş dakikalık mini grafik.
 *
 * Eksen, ızgara ve ipucu yoktur: sparkline bir **şekil** gösterir, değer
 * okutmaz. Değerin kendisi hemen üstündeki sayıda yazılıdır; grafiğe ikinci
 * kez sayı koymak küçük bir alanda gürültü olurdu.
 *
 * Ölçüm yoksa grafik hiç çizilmez — düz bir sıfır çizgisi, ölçülmüş bir sıfır
 * gibi okunurdu.
 */

import { memo } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { trendRange, type TrendSample } from "../../lib/live";

interface SparklineProps {
  series: TrendSample[];
  /** Çizgi rengi; KPI kartının tonuyla eşleşir. */
  color: string;
}

function SparklineInner({ series, color }: SparklineProps) {
  const range = trendRange(series);

  if (range === null || series.length < 2) {
    return (
      <div className="flex h-8 items-center text-[10px] text-slate-500">
        Ölçüm bekleniyor
      </div>
    );
  }

  /*
   * Alan grafiğinin tabanı, penceredeki en küçük değerin biraz altına
   * çekilir. Sıfırdan başlasaydı, %78 ile %80 arasında gezinen bir OEE
   * bomboş düz bir çizgi olarak görünür ve eğilim hiç okunamazdı.
   */
  const padding = Math.max((range.max - range.min) * 0.15, 0.0001);
  const gradientId = `spark-${color.replace("#", "")}`;

  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis
            hide
            domain={[range.min - padding, range.max + padding]}
            type="number"
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            // Ölçülemeyen anlarda çizgi kesilir; sıfıra düşmez.
            connectNulls={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export const Sparkline = memo(SparklineInner);
