/**
 * Hazırlık puanı kartı — halka, kategori çubukları ve sıradaki adım.
 *
 * Hiçbir puan burada hesaplanmaz; kart yalnızca `buildReadiness` çıktısını
 * çizer. Kategori satırlarının açıklamaları da oradan gelir — "makine envanteri
 * boş" cümlesini bileşende yazmak, aynı cümlenin puanla ayrışmasına yol açardı.
 */

import {
  BAND_LABEL,
  type ReadinessReport,
} from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { BAND_STYLE, STEP_ICON } from "./enterpriseStyles";

const SIZE = 116;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ReadinessCardProps {
  report: ReadinessReport;
  /** Sıradaki adıma götüren düğme; verilmezse düğme çizilmez. */
  onContinue?: (view: string) => void;
  /** Adım kimliğinden ekran kimliğine eşleme. */
  viewOf?: (stepId: string) => string;
  compact?: boolean;
}

export function ReadinessCard({
  report,
  onContinue,
  viewOf,
  compact = false,
}: ReadinessCardProps) {
  const style = BAND_STYLE[report.band];
  const filled = Math.min(1, Math.max(0, report.total / 100));

  return (
    <Card className="optiflow-glass p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
            aria-label={`Hazırlık puanı ${Math.round(report.total)}`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-slate-200"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className={`${style.ring} transition-all duration-700 ease-out motion-reduce:transition-none`}
              style={{ stroke: "currentColor" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tracking-tight text-slate-900">
              {Math.round(report.total)}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              / 100
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}
          >
            {BAND_LABEL[report.band]}
          </span>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
            Kurulum hazırlık puanı
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Puanın çoğu ürünün gerçekten ürettiği sonuçlardan gelir: simülasyon,
            doğrulama ve rapor.
          </p>

          {report.nextStep !== null && onContinue !== undefined && (
            <Button
              className="mt-3"
              size="sm"
              variant="primary"
              onClick={() =>
                onContinue(viewOf?.(report.nextStep as string) ?? "dashboard")
              }
            >
              Devam et
            </Button>
          )}
        </div>
      </div>

      {!compact && (
        <ul className="mt-5 space-y-2.5">
          {report.categories.map((category) => {
            const ratio = category.weight === 0 ? 0 : category.earned / category.weight;
            const Icon = STEP_ICON[category.id];
            const bar = category.complete
              ? BAND_STYLE.green.bar
              : ratio > 0
                ? BAND_STYLE.orange.bar
                : BAND_STYLE.red.bar;

            return (
              <li key={category.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                    {category.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {category.earned} / {category.weight}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${bar}`}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{category.detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
