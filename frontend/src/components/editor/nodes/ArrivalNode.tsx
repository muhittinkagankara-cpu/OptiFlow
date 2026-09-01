/**
 * Canvas'taki başlangıç (varış) kutusu — parçaların sisteme girdiği nokta.
 *
 * İstasyonlardan görsel olarak açıkça ayrılır: yeşil renk, farklı biçim ve
 * yalnızca çıkış bağlantı noktası. Girişi olmaması bilinçlidir; parçalar bu
 * kutuya geri dönemez ve kullanıcı yanlışlıkla oraya bağlantı çizemez.
 */

import { Handle, Position, type NodeProps } from "reactflow";
import type { ArrivalNodeData } from "../../../lib/configBuilder";
import { EntryIcon } from "../../shared/icons";

export function ArrivalNode({ data, selected }: NodeProps<ArrivalNodeData>) {
  const mean = Number(data.distribution.params.mean);
  const perHour = Number.isFinite(mean) && mean > 0 ? 60 / mean : null;

  return (
    <div
      className={`w-48 rounded-xl border-2 border-emerald-400 bg-emerald-50 shadow-sm ${
        selected ? "ring-2 ring-emerald-500 ring-offset-2" : ""
      }`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <EntryIcon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-900">İş Girişi</p>
          <p className="text-xs text-emerald-700">
            {Number.isFinite(mean) && mean > 0
              ? `${mean.toFixed(1)} dk'da bir`
              : "Ayarlanmadı"}
          </p>
        </div>
      </div>

      {perHour !== null && (
        <div className="border-t border-emerald-200/70 px-3 py-1.5">
          <span className="text-[10px] font-medium text-emerald-800">
            saatte ~{perHour.toFixed(0)} parça
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500"
      />
    </div>
  );
}
