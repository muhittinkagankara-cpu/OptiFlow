/**
 * Sağlık panosu — beş kart ve gecikme grafiği.
 *
 * Sayıların tamamı `healthSnapshot` içinde hesaplanır; pano yalnızca çizer.
 * Bağlantı kartlarıyla aynı sayıyı göstermesinin tek güvencesi budur.
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
import {
  Activity,
  CircleAlert,
  PlugZap,
  RefreshCw,
  Timer,
} from "lucide-react";
import {
  latencySeries,
  relativeTime,
  type ConnectorState,
  type HealthSnapshot,
} from "../../lib/connectors";
import { Card } from "../ui/Primitives";
import { TONE_CLASS, showCount, showLatency } from "./connectorStyles";

interface HealthDashboardProps {
  health: HealthSnapshot;
  state: ConnectorState;
  nowMs: number;
}

export function HealthDashboard({ health, state, nowMs }: HealthDashboardProps) {
  const cards = [
    {
      icon: PlugZap,
      label: "Bağlı",
      value: `${health.connected}/${health.total}`,
      hint: `${showCount(health.totalRecords)} kayıt alındı`,
      tone: health.connected > 0 ? ("good" as const) : ("neutral" as const),
    },
    {
      icon: CircleAlert,
      label: "Kopuk",
      value: String(health.disconnected + health.failed),
      hint:
        health.failed > 0
          ? `${health.failed} bağlantı vazgeçti`
          : "Müdahale gerektiren yok",
      tone:
        health.disconnected + health.failed > 0
          ? ("bad" as const)
          : ("neutral" as const),
    },
    {
      icon: RefreshCw,
      label: "Yeniden deniyor",
      value: String(health.retrying),
      hint: health.retrying > 0 ? "Kendiliğinden düzelebilir" : "Bekleyen yok",
      tone: health.retrying > 0 ? ("warning" as const) : ("neutral" as const),
    },
    {
      icon: Activity,
      label: "Senkron hatası",
      value: String(health.syncErrors),
      hint: "Oturum boyunca toplam",
      tone: health.syncErrors > 0 ? ("warning" as const) : ("neutral" as const),
    },
    {
      icon: Timer,
      label: "Gecikme",
      value: showLatency(health.avgLatencyMs),
      hint: `Son veri: ${relativeTime(health.lastUpdateAtMs, nowMs)}`,
      tone: health.avgLatencyMs === null ? ("neutral" as const) : ("good" as const),
    },
  ];

  /* Grafik, en çok örneği olan bağlı bağlantıyı gösterir. */
  const busiest = state.configs
    .map((config) => ({
      config,
      series: latencySeries(state, config.id),
    }))
    .sort((a, b) => b.series.length - a.series.length)[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card, index) => {
          const tone = TONE_CLASS[card.tone];
          return (
            <Card key={card.label} className="p-4" index={index}>
              <div className="flex items-center gap-2">
                <card.icon className={`h-3.5 w-3.5 ${tone.text}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {card.value}
              </p>
              <p className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Gecikme eğrisi</h3>
          <span className="text-[11px] text-slate-500">
            {busiest === undefined || busiest.series.length === 0
              ? "Ölçüm yok"
              : `${busiest.config.name} · son ${busiest.series.length} okuma`}
          </span>
        </div>

        {busiest === undefined || busiest.series.length === 0 ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            Henüz gecikme ölçümü yok. Bir bağlantıyı test edin ya da veri akışını
            başlatın; ölçümler burada birikir.
          </p>
        ) : (
          <div className="mt-3 h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={busiest.series}
                margin={{ top: 6, right: 10, bottom: 0, left: -18 }}
              >
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis dataKey="index" hide />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  tickLine={false}
                  width={44}
                  tickFormatter={(value: number) => `${value}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0F172A",
                    border: "1px solid #1F2937",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "#E2E8F0",
                  }}
                  formatter={(value: unknown) => [`${Number(value)} ms`, "Gecikme"]}
                  labelFormatter={() => ""}
                />
                <Line
                  type="monotone"
                  dataKey="latencyMs"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
