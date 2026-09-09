/**
 * Operatör panosundaki "Üretim Durumu" kartı.
 *
 * Vardiya başında bakılacak beş sayı: OEE, açık alarm, çalışan makine, bloke
 * makine ve bugünkü duruş. Hiçbiri uydurulmaz — ölçülemeyen değer "—" olarak
 * çıkar ve **nedeni** hemen altında yazar.
 *
 * Neden neden yazılıyor
 * ---------------------
 * "—" tek başına bir arıza gibi okunur. "Planlanan üretim süresi tanımlı
 * değil" ise ne yapılması gerektiğini söyler; operatör de vardiya süresini
 * girip sayıyı görebilir.
 */

import { memo } from "react";
import { Activity, Ban, Bell, Gauge, TimerOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  EMPTY as EMPTY_VALUE,
  formatMinutes,
  formatPercent,
  summarizeProduction,
  type ProductionStatus,
} from "../../lib/monitoring";
import { Badge, Card, SectionTitle } from "../ui/Primitives";

interface StatusTile {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  /** Ölçülemediyse yazılacak neden; ölçüldüyse `null`. */
  reason: string | null;
}

function tiles(status: ProductionStatus): StatusTile[] {
  return [
    {
      key: "oee",
      label: "OEE",
      value: formatPercent(status.oeePercent),
      icon: Gauge,
      reason: status.oeePercent === null ? (status.oeeReasons.oee ?? null) : null,
    },
    {
      key: "alarms",
      label: "Açık alarm",
      value: String(status.activeAlarms),
      icon: Bell,
      reason: null,
    },
    {
      key: "running",
      label: "Çalışan makine",
      value: `${status.runningMachines}/${status.totalMachines}`,
      icon: Activity,
      reason: null,
    },
    {
      key: "blocked",
      label: "Bloke makine",
      value: String(status.blockedMachines),
      icon: Ban,
      reason: null,
    },
    {
      key: "downtime",
      label: "Bugünkü duruş",
      value: formatMinutes(status.downtimeMinutes),
      icon: TimerOff,
      reason:
        status.downtimeMinutes === null ? (status.reasons.downtime ?? null) : null,
    },
  ];
}

interface ProductionStatusPanelProps {
  status: ProductionStatus | null;
}

function ProductionStatusPanelInner({ status }: ProductionStatusPanelProps) {
  if (status === null) {
    return (
      <Card>
        <SectionTitle title="Üretim Durumu" />
        <p className="text-xs text-slate-500">
          Sunucudan henüz yanıt alınmadı. Ölçüm gelmeden hiçbir sayı gösterilmez.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle
        title="Üretim Durumu"
        description={summarizeProduction(status)}
        action={
          status.openDowntime > 0 ? (
            <Badge tone="bad">{status.openDowntime} duruş sürüyor</Badge>
          ) : undefined
        }
      />

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles(status).map((tile) => (
          <div
            key={tile.key}
            className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2"
          >
            <dt className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              <tile.icon className="h-3 w-3" />
              {tile.label}
            </dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {tile.value}
            </dd>
            {tile.value === EMPTY_VALUE && tile.reason !== null && (
              <p className="mt-1 text-[10px] leading-snug text-slate-500">
                {tile.reason}
              </p>
            )}
          </div>
        ))}
      </dl>
    </Card>
  );
}

export const ProductionStatusPanel = memo(ProductionStatusPanelInner);
