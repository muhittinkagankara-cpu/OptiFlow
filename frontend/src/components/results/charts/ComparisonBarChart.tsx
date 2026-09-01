/**
 * İki senaryonun yan yana karşılaştırması — gruplu çubuk grafik.
 *
 * Metrikler farklı birimlerde olduğu için (birim, dakika, parça) ham değerler
 * aynı eksende gösterilemez: 3.700 birimlik üretimin yanında 18 dakikalık akış
 * süresi görünmez olurdu. Bu yüzden her metrik, referans senaryoya göre
 * **yüzde değişim** olarak çizilir; ortak eksen böylece anlamlı hâle gelir.
 *
 * İstatistiksel olarak anlamsız farklar gri boyanır. Rengin taşıdığı mesaj
 * "iyi/kötü" değil, "bu farka güvenebilir misiniz" sorusudur.
 */

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PairwiseDifference } from "../../../types/simulationTypes";
import {
  differenceVerdict,
  metricShortLabel,
  verdictColor,
  verdictLabel,
} from "../../../lib/resultsFormatting";

interface ComparisonBarChartProps {
  differences: PairwiseDifference[];
}

interface ChartRow {
  name: string;
  changePct: number;
  color: string;
  verdict: string;
}

export function ComparisonBarChart({ differences }: ComparisonBarChartProps) {
  if (differences.length === 0) {
    return null;
  }

  const data: ChartRow[] = differences.map((difference) => {
    const verdict = differenceVerdict(difference);
    return {
      name: metricShortLabel(difference.metric, difference.label),
      changePct: Number(difference.difference_pct.toFixed(2)),
      color: verdictColor(verdict),
      verdict: verdictLabel(verdict),
    };
  });

  const largest = Math.max(...data.map((row) => Math.abs(row.changePct)), 1);
  const bound = Math.ceil(largest * 1.35);

  return (
    // Taşma dizginlenmezse sayfa yatay kayar; gerekçe UtilizationBarChart'ta.
    <div
      className="overflow-hidden"
      style={{ height: Math.max(160, data.length * 52 + 40) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
        >
          <XAxis
            type="number"
            domain={[-bound, bound]}
            tickFormatter={(value: number) => `%${value}`}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={{ stroke: "#e2e8f0" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 12, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <RechartsTooltip
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value: unknown, _name: unknown, entry: unknown) => {
              const change = Number(value);
              const row = (entry as { payload?: ChartRow } | undefined)?.payload;
              return [
                `%${change > 0 ? "+" : ""}${change} — ${row?.verdict ?? ""}`,
                "Değişim",
              ];
            }}
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          {/* Sıfır çizgisi: referans senaryonun konumu. */}
          <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} />
          <Bar dataKey="changePct" radius={3} barSize={24}>
            {data.map((row) => (
              <Cell key={row.name} fill={row.color} />
            ))}
            <LabelList
              dataKey="changePct"
              position="right"
              formatter={(value: unknown) => {
                const change = Number(value);
                return `%${change > 0 ? "+" : ""}${change}`;
              }}
              style={{ fontSize: 11, fill: "#475569" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
