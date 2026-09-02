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
 *
 * Soldaki simge istasyon adından otomatik seçilir (kesim, dikiş, kalite,
 * paketleme, boyama); kullanıcı elle ikon seçmez. Simge yalnızca tanımayı
 * kolaylaştırır, hiçbir bilgiyi tek başına taşımaz.
 */

import { Handle, Position, type NodeProps } from "reactflow";
import type { StationNodeData } from "../../../lib/configBuilder";
import { meanServiceTime } from "../../../lib/configDefaults";
import { stationIconFor } from "../../../lib/stationIcons";

/** Yoğun sayılma eşiği; bu değerin üzerinde kuyruk hızla büyümeye başlar. */
const BUSY_UTILIZATION = 0.8;

interface StatusStyle {
  container: string;
  icon: string;
  label: string | null;
  labelClass: string;
  /** Kutunun altındaki ince durum şeridi; renk kodlamasını tekrarlar. */
  strip: string;
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
      strip: "bg-slate-300",
    };
  }
  if (metrics.is_bottleneck) {
    return {
      container: `border-red-400 bg-red-50 ${ring}`,
      icon: "bg-red-100 text-red-700",
      label: "Darboğaz",
      labelClass: "bg-red-100 text-red-800",
      strip: "bg-red-500",
    };
  }
  if (metrics.utilization >= BUSY_UTILIZATION) {
    return {
      container: `border-amber-400 bg-amber-50 ${ring}`,
      icon: "bg-amber-100 text-amber-700",
      label: "Yoğun",
      labelClass: "bg-amber-100 text-amber-800",
      strip: "bg-amber-500",
    };
  }
  return {
    container: `border-emerald-300 bg-emerald-50 ${ring}`,
    icon: "bg-emerald-100 text-emerald-700",
    label: "Rahat",
    labelClass: "bg-emerald-100 text-emerald-800",
    strip: "bg-emerald-500",
  };
}

export function StationNode({ data, selected }: NodeProps<StationNodeData>) {
  const { station, metrics } = data;
  const status = resolveStatus(data, selected);
  const mean = meanServiceTime(station);
  const isAnimation = data.presentation === "animation";
  const TypeIcon = stationIconFor(station.name);

  // Yükselme efekti kutuyu yukarı kaydırdığı için gölge de büyür; ikisi
  // birlikte "kaldırılabilir bir nesne" hissini verir. Editörde kapalıdır:
  // orada fareyle üzerine gelmek sürüklemenin ön adımıdır ve kutunun yer
  // değiştirmesi taşıma geri bildirimiyle karışırdı.
  const depth = isAnimation
    ? "shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,0,0,0.12)]"
    : "shadow-sm transition-colors";

  // Darboğaz, animasyonda yavaş bir nabızla belirtilir. Kutu zaten kırmızı ve
  // "Darboğaz" etiketli olduğu için nabız hiçbir bilgiyi tek başına taşımaz;
  // yalnızca gözü doğru yere çeker. Hareketi azaltılmış tercihinde susar.
  const glow =
    isAnimation && metrics?.is_bottleneck ? "optiflow-bottleneck-glow" : "";

  return (
    <div
      className={`w-56 overflow-hidden rounded-xl border-2 ${depth} ${glow} ${status.container}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* İkon, istasyon adındaki anahtar kelimeden otomatik seçilir;
            kullanıcı ayrıca bir seçim yapmaz. Eşleşme yoksa genel fabrika
            simgesine düşülür, yani ikon hiçbir zaman kaybolmaz. */}
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status.icon}`}
        >
          <TypeIcon className="h-4.5 w-4.5" />
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

      {/* Durum şeridi rengi yeniden icat etmez; kutunun kendi renk
          kodlamasını kalın bir çizgide tekrarlar. Kutu küçüldüğünde ya da
          etiket satırı gizlendiğinde bile durum okunabilir kalır. */}
      {isAnimation && <div className={`h-1 w-full ${status.strip}`} />}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-brand-500"
      />
    </div>
  );
}
