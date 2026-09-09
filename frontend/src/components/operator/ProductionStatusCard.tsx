/**
 * Operatör ana sayfasındaki "Üretim Durumu" paneli.
 *
 * Vardiya başında bakılacak beş sayı: OEE, açık alarm, çalışan makine, bloke
 * makine ve bugünkü duruş. Hepsi gerçek runtime verisinden gelir; hiçbiri
 * uydurulmaz.
 *
 * Ölçülemeyen değer "—" olarak çıkar ve **nedeni** hemen altında yazar. "—"
 * tek başına bir arıza gibi okunur; "Planlanan üretim süresi tanımlı değil"
 * ise ne yapılması gerektiğini söyler.
 *
 * Neden ayrı bir bileşen
 * ----------------------
 * Operatör ekranı dokunmatik bir telefonda açılır ve kendi bileşen sözlüğünü
 * kullanır (`StatTile`). Masaüstü panelini buraya koymak, 375 piksellik bir
 * ekranda okunamayacak kadar küçük kutular üretirdi.
 */

import { memo } from "react";
import { Activity, Ban, Bell, Gauge, TimerOff } from "lucide-react";
import {
  EMPTY,
  formatMinutes,
  formatPercent,
  type ProductionStatus,
} from "../../lib/monitoring";
import { StatTile } from "./operatorUi";

interface ProductionStatusCardProps {
  status: ProductionStatus | null;
}

function ProductionStatusCardInner({ status }: ProductionStatusCardProps) {
  if (status === null) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Üretim durumu
        </h2>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-5 text-center">
          <Gauge className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          <p className="text-sm font-medium text-slate-800">Veri okunmadı.</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Hat verisi gelmeden hiçbir sayı gösterilmez.
          </p>
        </div>
      </section>
    );
  }

  const oee = formatPercent(status.oeePercent);
  const downtime = formatMinutes(status.downtimeMinutes);

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Üretim durumu
      </h2>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="OEE"
          value={oee}
          icon={Gauge}
          tone={status.oeePercent === null ? "neutral" : "good"}
          hint={
            oee === EMPTY
              ? (status.oeeReasons.oee ?? "OEE ölçülmedi.")
              : undefined
          }
        />
        <StatTile
          label="Açık alarm"
          value={status.activeAlarms}
          icon={Bell}
          tone={status.activeAlarms > 0 ? "bad" : "good"}
        />
        <StatTile
          label="Çalışan makine"
          value={`${status.runningMachines}/${status.totalMachines}`}
          icon={Activity}
          tone={status.runningMachines > 0 ? "good" : "neutral"}
        />
        <StatTile
          label="Bloke makine"
          value={status.blockedMachines}
          icon={Ban}
          tone={status.blockedMachines > 0 ? "warning" : "neutral"}
        />
        <div className="col-span-2">
          <StatTile
            label="Bugünkü duruş"
            value={downtime}
            icon={TimerOff}
            tone={status.openDowntime > 0 ? "bad" : "neutral"}
            hint={
              downtime === EMPTY
                ? (status.reasons.downtime ?? "Duruş süresi ölçülmedi.")
                : status.openDowntime > 0
                  ? `${status.openDowntime} duruş sürüyor`
                  : undefined
            }
          />
        </div>
      </div>
    </section>
  );
}

export const ProductionStatusCard = memo(ProductionStatusCardInner);
