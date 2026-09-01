/**
 * Canvas'taki iş istasyonu kutusu.
 *
 * Renk kodlaması, son simülasyondan gelen metriklere göre değişir ve kullanıcıya
 * tek bakışta bilgi verir:
 *   gri     — henüz simülasyon çalışmadı
 *   yeşil   — rahat çalışıyor (kullanım < %80)
 *   sarı    — yoğun (kullanım >= %80), küçük dalgalanmalarda kuyruk büyür
 *   kırmızı — sistem darboğazı, hattın çıktısını bu istasyon belirliyor
 *
 * Renk tek başına bilgi taşımaz: her durumun yanında yazılı bir etiket de
 * bulunur. Renk körü kullanıcılar için renk-yalnız gösterim erişilemez olurdu.
 */

import { Handle, Position, type NodeProps } from "reactflow";
import type { StationNodeData } from "../../../lib/configBuilder";
import { meanServiceTime } from "../../../lib/configDefaults";
import { StationIcon } from "../../shared/icons";

/** Yoğun sayılma eşiği; bu değerin üzerinde kuyruk hızla büyümeye başlar. */
const BUSY_UTILIZATION = 0.8;

interface StatusStyle {
  container: string;
  icon: string;
  label: string | null;
  labelClass: string;
}

function resolveStatus(data: StationNodeData, selected: boolean): StatusStyle {
  const ring = selected ? "ring-2 ring-brand-500 ring-offset-2" : "";
  const metrics = data.metrics;

  if (!metrics) {
    return {
      container: `border-slate-300 bg-white ${ring}`,
      icon: "bg-slate-100 text-slate-500",
      label: null,
      labelClass: "",
    };
  }
  if (metrics.is_bottleneck) {
    return {
      container: `border-red-400 bg-red-50 ${ring}`,
      icon: "bg-red-100 text-red-700",
      label: "Darboğaz",
      labelClass: "bg-red-100 text-red-800",
    };
  }
  if (metrics.utilization >= BUSY_UTILIZATION) {
    return {
      container: `border-amber-400 bg-amber-50 ${ring}`,
      icon: "bg-amber-100 text-amber-700",
      label: "Yoğun",
      labelClass: "bg-amber-100 text-amber-800",
    };
  }
  return {
    container: `border-emerald-300 bg-emerald-50 ${ring}`,
    icon: "bg-emerald-100 text-emerald-700",
    label: "Rahat",
    labelClass: "bg-emerald-100 text-emerald-800",
  };
}

export function StationNode({ data, selected }: NodeProps<StationNodeData>) {
  const { station, metrics } = data;
  const status = resolveStatus(data, selected);
  const mean = meanServiceTime(station);

  return (
    <div
      className={`w-56 rounded-xl border-2 shadow-sm transition-colors ${status.container}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status.icon}`}
        >
          <StationIcon className="h-4.5 w-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {station.name || "Adsız istasyon"}
          </p>
          <p className="text-xs text-slate-500">
            {station.num_servers} makine
            {mean > 0 && ` · ${mean.toFixed(1)} dk`}
          </p>
        </div>
      </div>

      {(status.label || station.scrap_rate > 0 || station.failure_rate != null) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-black/5 px-3 py-1.5">
          {status.label && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status.labelClass}`}
            >
              {status.label}
              {metrics && ` %${Math.round(metrics.utilization * 100)}`}
            </span>
          )}
          {station.scrap_rate > 0 && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              %{Math.round(station.scrap_rate * 100)} fire
            </span>
          )}
          {station.failure_rate != null && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              arıza
            </span>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-brand-500"
      />
    </div>
  );
}
