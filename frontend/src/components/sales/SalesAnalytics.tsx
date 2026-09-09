/**
 * Satış analitiği — huni ve aylık kazanılan gelir.
 *
 * İki grafik de `lib/sales/analytics` çıktısını çizer; bu dosyada hiçbir oran
 * hesaplanmaz. Huninin "geçmiş kayıt" tanımı orada, sınanmış hâlde durur.
 *
 * Ölçülemeyen dönüşüm oranı "%0" değil "—" gösterilir: kaynak durakta hiç
 * kayıt yokken sıfır yazmak, "hiç dönüşmedi" demek olurdu.
 */

import { memo, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import {
  averageWonMonthly,
  conversionFunnel,
  monthlyWonRevenue,
  type Lead,
} from "../../lib/sales";
import { formatMoney } from "../../lib/financeFormatting";
import { Card } from "../ui/Primitives";
import { CHART_COLOR } from "./salesStyles";

const FUNNEL_COLORS = [CHART_COLOR.brand, CHART_COLOR.violet, CHART_COLOR.emerald];

function SalesAnalyticsInner({ leads, now }: { leads: Lead[]; now: Date }) {
  const funnel = useMemo(() => conversionFunnel(leads), [leads]);
  const months = useMemo(() => monthlyWonRevenue(leads, now, 6), [leads, now]);
  const average = useMemo(() => averageWonMonthly(leads), [leads]);

  const funnelData = funnel.map((step) => ({
    label: step.label,
    // Grafiğin çizdiği şey oran değil **adet**: "5 firmadan 3'ü" bir yüzdeden
    // daha somut ve küçük sayılarda yanıltmaz.
    count: step.toCount,
    of: step.fromCount,
    rate: step.rate,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* --- Huni --- */}
      <Card className="p-5" index={0}>
        <h3 className="text-sm font-semibold text-slate-900">Dönüşüm hunisi</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Her adım, o duraktan <strong>geçmiş</strong> kayıtları sayar; kazanılan
          bir firma demo sayısına da dâhildir.
        </p>

        <div className="mt-4 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={funnelData}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
            >
              <CartesianGrid stroke="#1F2937" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.12)" }}
                contentStyle={tooltipStyle}
                formatter={(value: unknown) => [`${Number(value)} firma`, "Ulaşan"]}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {funnelData.map((entry, index) => (
                  <Cell key={entry.label} fill={FUNNEL_COLORS[index % 3]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <ul className="mt-3 space-y-1.5">
          {funnel.map((step) => (
            <li
              key={step.label}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="text-slate-500">{step.label}</span>
              <span className="tabular-nums">
                <span className="text-slate-500">
                  {step.toCount}/{step.fromCount}
                </span>
                <span className="ml-2 font-semibold text-slate-900">
                  {step.rate === null ? "—" : `%${Math.round(step.rate * 100)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* --- Aylık gelir --- */}
      <Card className="p-5" index={1}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Aylık kazanılan gelir
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Anlaşmanın kapandığı aya yazılır; tutar aylık abonelik bedelidir.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Ortalama:{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {/* Hiç kazanılmamışsa ortalama yoktur; sıfır göstermek
                  "ortalama sıfır lira" demek olurdu. */}
              {average === null ? "—" : formatMoney(Math.round(average))}
            </span>
          </p>
        </div>

        <div className="mt-4 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={months}
              margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
            >
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                tickFormatter={(value: unknown) =>
                  `${Math.round(Number(value) / 1000)}k`
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.12)" }}
                contentStyle={tooltipStyle}
                formatter={(value: unknown) => [
                  formatMoney(Number(value)),
                  "Aylık gelir",
                ]}
              />
              <Bar
                dataKey="monthlyRevenue"
                fill={CHART_COLOR.emerald}
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <TrendingUp className="h-3.5 w-3.5" />
          Son {months.length} ayda{" "}
          {months.reduce((sum, item) => sum + item.wonCount, 0)} anlaşma
          kazanıldı.
        </p>
      </Card>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid #1F2937",
  borderRadius: 12,
  color: "#F9FAFB",
  fontSize: 12,
};

export const SalesAnalytics = memo(SalesAnalyticsInner);
