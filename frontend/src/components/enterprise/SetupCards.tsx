/**
 * Dashboard'a eklenen kurulum kartları.
 *
 * İki kart var ve ikisi de aynı kontrol listesinden beslenir:
 *
 * - **İlk 30 dakika rehberi**: sabit kart, adımları ve birikimli süreyi gösterir.
 * - **Kurulum kontrol listesi**: her madde tıklanabilir, ilgili ekrana götürür.
 *
 * Madde metinleri, tamamlanma bilgisi ve süreler `lib/onboarding-enterprise`
 * içinde hesaplanır. Kart yalnızca çizer ve tıklamayı yukarı iletir.
 */

import { ArrowRight, Check, Clock, Sparkles } from "lucide-react";
import {
  buildGuide,
  completedCount,
  guideSummary,
  lastCompleted,
  nextItem,
  progressRatio,
  type ChecklistItem,
  type ReadinessReport,
} from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { BAND_STYLE, STEP_ICON, showMinutes } from "./enterpriseStyles";

interface SetupCardProps {
  items: ChecklistItem[];
  report: ReadinessReport;
  onNavigate: (view: string) => void;
}

/* -------------------------------------------------------------------------- */

/**
 * İlk 30 dakika rehberi.
 *
 * Tamamlanan adımlar işaretlenir ve birikimli süre yazılır. Süreler
 * **tahmindir** ve kartta böyle yazar — ölçülmüş bir süre değildir.
 */
export function First30MinutesGuide({ items, onNavigate }: SetupCardProps) {
  const guide = buildGuide(items);
  const done = completedCount(items);

  return (
    <Card className="optiflow-glass p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-brand-600" />
            İlk 30 dakikada tamamlayın
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{guideSummary(items)}</p>
        </div>
        <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {done}/{items.length}
        </span>
      </div>

      <ol className="mt-3 flex flex-wrap gap-1.5">
        {guide.map((step) => {
          const Icon = STEP_ICON[step.id];
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onNavigate(step.view)}
                title={step.hint}
                className={`optiflow-lift inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-200 ${
                  step.done
                    ? `${BAND_STYLE.green.chip} optiflow-enter`
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
                }`}
              >
                {step.done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                )}
                {step.label}
                <span className="text-[10px] font-normal opacity-70">
                  {showMinutes(step.cumulativeMinutes)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-[11px] text-slate-500">
        Süreler adım başına tahmindir; ölçülmüş süre değildir.
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/** Dashboard'daki kurulum kartı: puan, eksik adımlar ve devam düğmesi. */
export function SetupChecklistCard({ items, report, onNavigate }: SetupCardProps) {
  const ratio = progressRatio(items) ?? 0;
  const next = nextItem(items);
  const last = lastCompleted(items);
  const style = BAND_STYLE[report.band];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Kurulum durumu</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Hazırlık puanı {Math.round(report.total)} / 100
          </p>
        </div>
        {next !== null && (
          <Button
            size="sm"
            variant="primary"
            icon={ArrowRight}
            onClick={() => onNavigate(next.view)}
          >
            Devam et
          </Button>
        )}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${style.bar}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate(item.view)}
              className="optiflow-lift flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition-colors duration-200 hover:border-brand-400"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                  item.done
                    ? "border-emerald-300 bg-emerald-500 text-white"
                    : "border-slate-300 bg-white"
                }`}
              >
                {item.done && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-xs font-medium ${
                    item.done ? "text-slate-500 line-through" : "text-slate-900"
                  }`}
                >
                  {item.label}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                  {item.hint}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                <Clock className="h-3 w-3" />
                {showMinutes(item.minutes)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {last !== null && (
        <p className="mt-2 text-[11px] text-slate-500">
          Son tamamlanan: {last.label}
        </p>
      )}
    </Card>
  );
}
