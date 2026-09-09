/**
 * Pilot kurulum kontrol listesi paneli.
 *
 * Hiçbir kutu tıklanamaz. Her adımın durumu sistemin gerçek hâlinden türer;
 * elle işaretlenebilen bir liste, kurulumu yapan kişinin iyi niyetini ölçer,
 * ürünün hazır olup olmadığını değil.
 *
 * "Ölçülemedi" ile "Bekliyor" ayrı renklerde ve ayrı kelimelerle görünür:
 * birincisinde eksik olan ölçüm, ikincisinde iştir ve ikisi farklı kişiyi
 * ilgilendirir.
 */

import { memo } from "react";
import { CircleCheck, CircleDashed, CircleHelp } from "lucide-react";
import {
  deploymentCaption,
  stepTone,
  type ChecklistStep,
  type DeploymentReport,
} from "../../lib/commissioning";
import { Badge, Card, ProgressBar, SectionTitle } from "../ui/Primitives";

const STEP_ICON = {
  done: CircleCheck,
  pending: CircleDashed,
  unknown: CircleHelp,
} as const;

interface DeploymentChecklistPanelProps {
  report: DeploymentReport;
}

function DeploymentChecklistPanelInner({ report }: DeploymentChecklistPanelProps) {
  return (
    <Card className="p-4">
      <SectionTitle
        title="Kurulum Kontrol Listesi"
        description={deploymentCaption(report)}
        action={
          <Badge tone={report.ready ? "good" : "warning"}>
            {report.ready ? "Tamamlandı" : `${report.done}/${report.total}`}
          </Badge>
        }
      />

      {report.ratio !== null && (
        <div className="mb-3">
          <ProgressBar value={report.ratio} tone={report.ready ? "good" : "warning"} />
        </div>
      )}

      {report.steps.length === 0 ? (
        <p className="text-xs text-slate-500">
          Kontrol listesi henüz okunmadı; sunucudan yanıt bekleniyor.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {report.steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index + 1} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function StepRow({ step, index }: { step: ChecklistStep; index: number }) {
  const Icon = STEP_ICON[step.state];
  const tone = stepTone(step.state);
  return (
    <li className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          tone === "good"
            ? "text-emerald-600"
            : tone === "warning"
              ? "text-amber-600"
              : "text-slate-400"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-900">
          {index}. {step.label}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">{step.reason}</p>
        {step.action !== null && (
          <p className="mt-0.5 text-[11px] text-amber-800">Yapılacak: {step.action}</p>
        )}
      </div>
      <Badge tone={tone}>{step.state === "done" ? "Tamam" : step.state === "pending" ? "Bekliyor" : "Ölçülemedi"}</Badge>
    </li>
  );
}

export const DeploymentChecklistPanel = memo(DeploymentChecklistPanelInner);
