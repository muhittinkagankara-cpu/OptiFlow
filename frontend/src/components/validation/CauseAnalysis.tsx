/**
 * Sebep analizi listesi.
 *
 * Cümlelerin tamamı `lib/validation/analysis.ts` içinde üretilir; burada
 * yalnızca sıralı liste çizilir. Metin bileşende kurulsaydı, "hangi cümle hangi
 * ölçümden çıkıyor" sorusu ancak ekranı açıp bakarak yanıtlanabilirdi.
 */

import { Lightbulb } from "lucide-react";
import { METRIC_LABEL, type ValidationFinding } from "../../lib/validation";
import { Badge, Card } from "../ui/Primitives";
import { FINDING_TONE, showPercent } from "./validationStyles";

interface CauseAnalysisProps {
  findings: ValidationFinding[];
  /** Bulgu yokken yazılacak cümle; nedenini de söyler. */
  emptyMessage: string;
}

export function CauseAnalysis({ findings, emptyMessage }: CauseAnalysisProps) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">Sebep analizi</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Her madde ölçülmüş iki sayının farkıdır; sebep yorumu eklenmez.
      </p>

      {findings.length === 0 ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {findings.map((finding, index) => (
            <li
              key={finding.id}
              className="optiflow-enter rounded-xl border border-slate-200 p-3"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={FINDING_TONE[finding.tone]}>
                  {showPercent(finding.magnitude)} sapma
                </Badge>
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {finding.stationName} · {METRIC_LABEL[finding.metric]}
                </span>
              </div>

              <p className="mt-1.5 text-sm text-slate-900">{finding.text}</p>

              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                {finding.advice}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
