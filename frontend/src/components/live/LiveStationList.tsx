/**
 * Dar ekranda diyagramın yerini alan istasyon listesi.
 *
 * React Flow 375 piksellik bir ekranda okunamaz: kutular üst üste biner,
 * yakınlaştırma tek elle yapılamaz. Diyagramı küçültmek yerine **başka bir
 * gösterim** kullanmak bilinçlidir — aynı veriler, telefona uygun bir biçimde.
 * Yerleşim bilgisi (hangi istasyon nerede) telefonda zaten kullanılamıyor;
 * asıl taşınması gereken durum, kuyruk ve OEE.
 */

import { memo } from "react";
import {
  STATUS_LABEL,
  bottleneckStationId,
  type StationLiveState,
} from "../../lib/live";
import { STATUS_STYLE } from "./liveStyles";

function LiveStationListInner({
  stations,
  onSelectStation,
}: {
  stations: StationLiveState[];
  onSelectStation: (stationId: string) => void;
}) {
  const bottleneckId = bottleneckStationId(stations);

  return (
    <ul className="space-y-2 px-3 py-3">
      {stations.map((station) => {
        const style = STATUS_STYLE[station.status];
        const isBottleneck = station.stationId === bottleneckId;
        return (
          <li key={station.stationId}>
            <button
              type="button"
              onClick={() => onSelectStation(station.stationId)}
              className={`w-full overflow-hidden rounded-xl border text-left transition-colors duration-200 focus:outline-none ${style.box} ${
                isBottleneck ? "optiflow-node-glow" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {station.stationName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {STATUS_LABEL[station.status]}
                    {isBottleneck && " · darboğaz"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {station.completed}
                  </p>
                  <p className="text-[10px] text-slate-500">üretim</p>
                </div>
              </div>

              <div className="flex items-center gap-3 border-t border-black/10 px-3 py-1.5 text-[10px] text-slate-500 tabular-nums">
                <span>Kuyruk {station.queue}</span>
                <span>OEE %{Math.round(station.oee * 100)}</span>
                <span>
                  {station.onlineMachines}/{station.machineCount} makine
                </span>
              </div>

              <div className={`h-1 w-full ${style.strip}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const LiveStationList = memo(LiveStationListInner);
