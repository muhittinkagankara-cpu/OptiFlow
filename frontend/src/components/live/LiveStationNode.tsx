/**
 * Canlı diyagramdaki istasyon kutusu.
 *
 * Editördeki `StationNode` ile ayrı tutulması bilinçlidir: o kutu **modeli**
 * gösterir (kaç makine, hangi dağılım), bu kutu **anı** gösterir (çalışıyor mu,
 * kuyruk ne, OEE kaç). Tek bir bileşene sığdırılsaydı, editörde anlamı olmayan
 * canlı alanlar için her yerde `undefined` kontrolü yapılırdı.
 *
 * `React.memo` ile sarılıdır ve yalnızca kendi verisi değiştiğinde yeniden
 * çizilir. Yirmi istasyonlu bir hatta saniyede birkaç olay geldiğinde,
 * memolanmamış düğümler her olayda yirmi kez yeniden render edilirdi.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { STATUS_LABEL, type MachineStatus } from "../../lib/live";
import { stationIconFor } from "../../lib/stationIcons";
import { STATUS_STYLE } from "./liveStyles";

export interface LiveNodeData {
  stationName: string;
  status: MachineStatus;
  queue: number;
  oee: number;
  completed: number;
  /** Hattın en uzun kuyruğu bu istasyondaysa turuncu halka çizilir. */
  isBottleneck: boolean;
  operatorName: string | null;
}

function LiveStationNodeInner({ data }: NodeProps<LiveNodeData>) {
  const style = STATUS_STYLE[data.status];
  const TypeIcon = stationIconFor(data.stationName);

  return (
    <div
      className={`w-52 overflow-hidden rounded-xl border-2 shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition-colors duration-300 ${style.box} ${
        data.isBottleneck ? "optiflow-node-glow" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-100 !bg-slate-400"
      />

      <div className="flex items-start gap-2 px-2.5 py-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 ${style.text}`}
        >
          <TypeIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {data.stationName}
          </p>
          {/* Renk tek başına konuşmaz: durum yazıyla da verilir. */}
          <p className="flex items-center gap-1 text-[10px] font-medium text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {STATUS_LABEL[data.status]}
            {data.isBottleneck && " · darboğaz"}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-px border-t border-black/10 bg-black/10 text-center">
        {/* Ölçülmemiş OEE "—" gösterilir: "%0" yazmak, ölçüm yapılmadığı hâlde
            istasyonun hiç verimli çalışmadığını bildirmek olurdu. */}
        <Cell
          label="OEE"
          value={data.oee > 0 ? `%${Math.round(data.oee * 100)}` : "—"}
        />
        <Cell label="Kuyruk" value={String(data.queue)} />
        <Cell label="Üretim" value={String(data.completed)} />
      </dl>

      <div className={`h-1 w-full ${style.strip}`} />

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-100 !bg-brand-500"
      />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50/60 px-1 py-1">
      <dt className="text-[9px] tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="text-xs font-semibold text-slate-900 tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export const LiveStationNode = memo(LiveStationNodeInner);
