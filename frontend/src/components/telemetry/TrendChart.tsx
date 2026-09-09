/**
 * Trend çizgisi.
 *
 * Bileşen yalnızca çizer: ölçek, nokta ve parça hesabı `lib/telemetry/chart`
 * içindedir. Ölçümü olmayan kova için nokta üretilmediğinden çizgi orada
 * **kesilir** — veri boşluğu görünür kalır ve sıfıra inen sahte bir çizgi
 * oluşmaz.
 */

import { memo } from "react";
import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  axisLabel,
  formatValue,
  pointsOf,
  scaleOf,
  segmentsOf,
  seriesPaths,
  type TrendSeries,
} from "../../lib/telemetry";

interface TrendChartProps {
  series: TrendSeries;
}

function TrendChartInner({ series }: TrendChartProps) {
  const paths = seriesPaths(series);
  const scale = scaleOf(series.buckets);
  /*
   * Tek noktalı parçalar nokta olarak çizilir.
   *
   * Bir SVG yolu yalnızca `M` içeriyorsa hiçbir şey çizmez: tarayıcıda
   * görüldüğü üzere, bütün ölçümleri tek bir kovaya düşen bir seri boş bir
   * grafik gibi görünüyordu. Yalnız kalan ölçüm de görünür olmalıdır.
   */
  const isolated = segmentsOf(pointsOf(series.buckets))
    .filter((segment) => segment.points.length === 1)
    .map((segment) => segment.points[0]);
  const first = series.buckets[0];
  const last = series.buckets[series.buckets.length - 1];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-44 w-full min-w-[280px]"
        role="img"
        aria-label={`${series.device} · ${series.tag} · ${series.windowLabel}`}
        preserveAspectRatio="none"
      >
        {/* Yatay kılavuz çizgileri: üç seviye, değerin nerede olduğunu gösterir. */}
        {[0, 0.5, 1].map((ratio) => {
          const y =
            CHART_PADDING.top +
            (CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom) * ratio;
          return (
            <line
              key={ratio}
              x1={CHART_PADDING.left}
              x2={CHART_WIDTH - CHART_PADDING.right}
              y1={y}
              y2={y}
              className="stroke-slate-200"
              strokeWidth={1}
            />
          );
        })}

        {isolated.map((point) => (
          <circle
            key={`nokta-${point.index}`}
            cx={point.x}
            cy={point.y}
            r={3}
            className="fill-brand-500"
          />
        ))}

        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            className="stroke-brand-500"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{first ? axisLabel(first.startMs, series.window) : "—"}</span>
        <span>
          {formatValue(scale.min)} – {formatValue(scale.max)}
        </span>
        <span>{last ? axisLabel(last.endMs, series.window) : "—"}</span>
      </div>
    </div>
  );
}

export const TrendChart = memo(TrendChartInner);
