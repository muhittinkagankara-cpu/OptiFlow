/**
 * Sağ paneldeki canlı göstergeler.
 *
 * Altı kart: throughput, OEE, kuyruk, ortalama çevrim, açık alarm ve son
 * güncelleme. Her birinin altında son on beş dakikanın sparkline'ı var.
 *
 * Ölçülemeyen gösterge "—" gösterir, sıfır değil. Vardiyanın ilk saniyesinde
 * "0 parça/dk" yazmak, hattın durduğunu söylemek olurdu; oysa henüz ölçecek
 * bir şey yoktur.
 */

import { memo } from "react";
import {
  Activity,
  BellRing,
  Clock,
  Gauge,
  Layers,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  formatClock,
  trendDirection,
  type LiveTotals,
  type TrendSample,
} from "../../lib/live";
import { formatDecimal } from "../../lib/resultsFormatting";
import { Sparkline } from "./Sparkline";
import type { LiveTrends } from "./useLiveTrends";

/* Sparkline renkleri; kart tonlarıyla eşleşir. */
const COLOR = {
  brand: "#3B82F6",
  emerald: "#22C55E",
  amber: "#F59E0B",
  violet: "#A78BFA",
  red: "#EF4444",
} as const;

interface LiveKpiPanelProps {
  totals: LiveTotals;
  trends: LiveTrends;
  clockMinutes: number;
  /** Sayaç çevirme animasyonunun anahtarı; her olay paketinde değişir. */
  eventCount: number;
}

function LiveKpiPanelInner({
  totals,
  trends,
  clockMinutes,
  eventCount,
}: LiveKpiPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <KpiCard
        icon={Activity}
        label="Throughput"
        value={
          totals.throughputPerMinute === null
            ? "—"
            : `${formatDecimal(totals.throughputPerMinute, 1)}`
        }
        unit={totals.throughputPerMinute === null ? "ölçüm yok" : "parça/dk"}
        series={trends.throughput}
        color={COLOR.brand}
        flipKey={eventCount}
      />
      <KpiCard
        icon={Gauge}
        label="OEE"
        value={totals.oee === null ? "—" : `%${Math.round(totals.oee * 100)}`}
        unit={totals.oee === null ? "istasyon yok" : "hat ortalaması"}
        series={trends.oee}
        color={COLOR.emerald}
        flipKey={eventCount}
      />
      <KpiCard
        icon={Layers}
        label="Kuyruk"
        value={String(totals.totalQueue)}
        unit="bekleyen parça"
        series={trends.queue}
        color={COLOR.amber}
        flipKey={eventCount}
      />
      <KpiCard
        icon={Timer}
        label="Ort. çevrim"
        value={
          totals.avgCycleSeconds === null
            ? "—"
            : `${Math.round(totals.avgCycleSeconds)}`
        }
        unit={totals.avgCycleSeconds === null ? "ölçüm yok" : "saniye"}
        series={trends.cycle}
        color={COLOR.violet}
        flipKey={eventCount}
      />
      <KpiCard
        icon={BellRing}
        label="Açık alarm"
        value={String(totals.openAlarms)}
        unit={`${totals.onlineMachines}/${totals.totalMachines} makine çevrimiçi`}
        series={trends.alarms}
        color={COLOR.red}
        flipKey={eventCount}
      />
      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
          <Clock className="h-3 w-3" />
          Son güncelleme
        </p>
        <p
          key={eventCount}
          className="optiflow-count-flip mt-0.5 text-xl font-bold text-slate-900 tabular-nums"
        >
          {formatClock(clockMinutes)}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {totals.runningStations} istasyon üretimde
        </p>
      </div>
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  series: TrendSample[];
  color: string;
  flipKey: number;
}

const KpiCard = memo(function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  series,
  color,
  flipKey,
}: KpiCardProps) {
  const direction = trendDirection(series);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        {/* `key` her pakette değişir; React düğümü yeniler ve çevirme
            animasyonu yeniden çalışır. */}
        <span
          key={flipKey}
          className="optiflow-count-flip inline-block text-xl font-bold text-slate-900 tabular-nums"
        >
          {value}
        </span>
        {/* Yön oku renk değil, karakterle de anlaşılır. */}
        {direction !== null && direction !== "flat" && (
          <span className="text-[10px] font-semibold text-slate-500">
            {direction === "up" ? "▲" : "▼"}
          </span>
        )}
      </div>
      <p className="text-[10px] text-slate-500">{unit}</p>
      <Sparkline series={series} color={color} />
    </div>
  );
});

export const LiveKpiPanel = memo(LiveKpiPanelInner);
