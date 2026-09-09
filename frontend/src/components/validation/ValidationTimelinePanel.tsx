/**
 * Doğrulama geçmişi ve trend çizgisi.
 *
 * Tek bir ölçüm "model %94 tutuyor" der; üç ölçüm "model her seferinde biraz
 * daha iyi tutuyor" der. Grafiğin ekseni 0-100 arasında **sabittir**: kendine
 * göre ölçeklenen bir eksen, iki puanlık bir oynamayı dramatik bir sıçrama gibi
 * gösterir.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, History } from "lucide-react";
import {
  CONFIDENCE_LABEL,
  accuracyTrend,
  type ValidationSnapshot,
} from "../../lib/validation";
import { Card } from "../ui/Primitives";
import { showPercent } from "./validationStyles";

const DATE_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
});

interface ValidationTimelinePanelProps {
  history: ValidationSnapshot[];
}

export function ValidationTimelinePanel({
  history,
}: ValidationTimelinePanelProps) {
  const trend = accuracyTrend(history);

  const points = history
    .filter((item) => item.overallAccuracy !== null)
    .map((item) => ({
      label: DATE_FORMAT.format(new Date(item.measuredAt)),
      accuracy: Math.round((item.overallAccuracy ?? 0) * 100),
      confidence:
        item.confidenceScore === null
          ? null
          : Math.round(item.confidenceScore * 100),
    }));

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Doğrulama geçmişi
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Bu tarayıcıda kaydedilen ölçümler listelenir.
          </p>
        </div>
        {trend.delta !== null && (
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
            {trend.direction === "up" && (
              <ArrowUpRight className="h-3 w-3 text-emerald-500" />
            )}
            {trend.direction === "down" && (
              <ArrowDownRight className="h-3 w-3 text-red-500" />
            )}
            {trend.direction === "flat" && (
              <ArrowRight className="h-3 w-3 text-slate-400" />
            )}
            {trend.direction === "flat"
              ? "Değişim yok"
              : `${showPercent(Math.abs(trend.delta), 1)} ${
                  trend.direction === "up" ? "artış" : "düşüş"
                }`}
          </span>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          Henüz kaydedilmiş ölçüm yok. Bir doğrulamayı kaydettiğinizde burada
          tarih sırasıyla görünür ve ikinci ölçümden sonra trend çizgisi çıkar.
        </p>
      ) : (
        <>
          <div className="mt-3 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 6, right: 12, bottom: 4, left: -12 }}
              >
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  tickLine={false}
                  tickFormatter={(value: number) => `%${value}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0F172A",
                    border: "1px solid #1F2937",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "#E2E8F0",
                  }}
                  formatter={(value: unknown, name: unknown) => [
                    `%${Number(value)}`,
                    name === "accuracy" ? "Doğruluk" : "Güven",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="confidence"
                  stroke="#10B981"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-3 space-y-1.5">
            {[...history].reverse().map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1.5 last:border-0"
              >
                <span className="text-xs text-slate-600">
                  {DATE_FORMAT.format(new Date(item.measuredAt))} ·{" "}
                  {item.measuredStationCount}/{item.stationCount} istasyon
                </span>
                <span className="text-xs font-semibold text-slate-900">
                  {showPercent(item.overallAccuracy)}
                  <span className="ml-2 font-normal text-slate-500">
                    {item.confidenceLevel === null
                      ? "—"
                      : CONFIDENCE_LABEL[item.confidenceLevel]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
