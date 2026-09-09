/**
 * Fabrika devreye alma listesi.
 *
 * Listede **kutu işaretlenmez**: her adımın durumu ürünün gerçek hâlinden
 * türer. Elle işaretlenebilen bir liste, kurulumu yapan kişinin iyi niyetini
 * ölçer; ürünün hazır olup olmadığını değil. İlk fabrika kurulumunda yanlış
 * işaretlenmiş tek bir kutu, sahada saatlerce süren bir arıza aramasına yol
 * açabilir.
 *
 * Her adımın yanında **nedeni** yazar; tamamlanmamış adımlarda ne yapılması
 * gerektiği de yazar.
 */

import { memo } from "react";
import { CircleCheck, CircleDashed, CircleHelp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  COMMISSION_STATE_LABEL,
  describeCommission,
  formatRatio,
  type CommissionReport,
  type CommissionState,
} from "../../lib/ops";
import { Badge, Card, ProgressBar, SectionTitle } from "../ui/Primitives";
import type { BadgeTone } from "../ui/Primitives";

const STATE_ICON: Record<CommissionState, LucideIcon> = {
  done: CircleCheck,
  pending: CircleDashed,
  unknown: CircleHelp,
};

const STATE_TONE: Record<CommissionState, BadgeTone> = {
  done: "good",
  pending: "warning",
  unknown: "neutral",
};

const STATE_COLOR: Record<CommissionState, string> = {
  done: "text-emerald-600",
  pending: "text-amber-600",
  unknown: "text-slate-400",
};

interface CommissionChecklistProps {
  report: CommissionReport;
}

function CommissionChecklistInner({ report }: CommissionChecklistProps) {
  return (
    <Card>
      <SectionTitle
        title="Devreye Alma Listesi"
        description={describeCommission(report)}
        action={
          <Badge tone={report.ready ? "good" : "warning"}>
            {report.ratio === null ? "Ölçülemedi" : formatRatio(report.ratio, 0)}
          </Badge>
        }
      />

      {report.ratio !== null && (
        <div className="mb-3">
          <ProgressBar
            value={report.ratio}
            tone={report.ready ? "good" : "warning"}
          />
        </div>
      )}

      <ul className="space-y-1">
        {report.steps.map((step) => {
          const Icon = STATE_ICON[step.state];
          return (
            <li
              key={step.id}
              className="flex items-start gap-2 rounded-md border border-slate-200 bg-white/60 px-2.5 py-2"
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${STATE_COLOR[step.state]}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-900">{step.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                  {step.reason}
                </p>
                {step.action !== null && (
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                    → {step.action}
                  </p>
                )}
              </div>
              <Badge tone={STATE_TONE[step.state]}>
                {COMMISSION_STATE_LABEL[step.state]}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export const CommissionChecklist = memo(CommissionChecklistInner);
