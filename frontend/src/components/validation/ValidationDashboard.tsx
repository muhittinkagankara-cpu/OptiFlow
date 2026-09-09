/**
 * Doğrulama özeti — dört kart, güven halkası ve ölçüt çubukları.
 *
 * Bileşen hiçbir hesap yapmaz: gösterdiği her sayı `lib/validation` içinde
 * hesaplanmış ve sınanmıştır. Buradaki tek karar, hangi sayının ne kadar büyük
 * görüneceğidir.
 */

import { Award, Target, TrendingDown, TriangleAlert } from "lucide-react";
import {
  METRIC_LABEL,
  METRIC_ORDER,
  type ConfidenceScore,
  type ValidationSummary,
} from "../../lib/validation";
import { NOT_MEASURED } from "../../lib/reports";
import { Card } from "../ui/Primitives";
import { ConfidenceRing } from "./ConfidenceRing";
import {
  showPercent,
  showSignedPercent,
  styleOfBand,
} from "./validationStyles";
import { bandOf } from "../../lib/validation";

interface ValidationDashboardProps {
  summary: ValidationSummary;
  confidence: ConfidenceScore;
  headline: string | null;
}

export function ValidationDashboard({
  summary,
  confidence,
  headline,
}: ValidationDashboardProps) {
  const cards = [
    {
      icon: Target,
      label: "Genel doğruluk",
      value: showPercent(summary.overallAccuracy),
      hint: `${summary.measuredPointCount} ölçüm noktası · ${summary.measuredStationCount}/${summary.stationCount} istasyon`,
      band: bandOf(summary.overallAccuracy),
      ratio: summary.overallAccuracy,
    },
    {
      icon: Award,
      label: "En doğru istasyon",
      value: summary.bestStation?.stationName ?? NOT_MEASURED,
      hint:
        summary.bestStation === null
          ? "En az iki istasyon ölçülmeli"
          : showPercent(summary.bestStation.accuracy),
      band: summary.bestStation?.band ?? null,
      ratio: summary.bestStation?.accuracy ?? null,
    },
    {
      icon: TrendingDown,
      label: "En sapan istasyon",
      value: summary.worstStation?.stationName ?? NOT_MEASURED,
      hint:
        summary.worstStation === null
          ? "En az iki istasyon ölçülmeli"
          : showPercent(summary.worstStation.accuracy),
      band: summary.worstStation?.band ?? null,
      ratio: summary.worstStation?.accuracy ?? null,
    },
    {
      icon: TriangleAlert,
      label: "En büyük sapma",
      value:
        summary.biggestGap === null
          ? NOT_MEASURED
          : showSignedPercent(summary.biggestGap.errorRatio),
      hint:
        summary.biggestGap === null
          ? "Ölçüm girildiğinde burada görünür"
          : `${summary.biggestGap.stationName} · ${METRIC_LABEL[summary.biggestGap.metric]}`,
      band: summary.biggestGap === null ? null : ("bad" as const),
      // Bu kartta çubuk doğruluğu değil **sapmanın büyüklüğünü** gösterir;
      // kart zaten sapmayı anlatıyor, dolu çubuk büyük sapma demektir.
      ratio:
        summary.biggestGap === null
          ? null
          : Math.min(1, Math.abs(summary.biggestGap.errorRatio)),
    },
  ];

  return (
    <div className="space-y-4">
      {headline !== null && (
        <Card className="optiflow-glass p-4">
          <p className="text-sm font-semibold text-slate-900">{headline}</p>
          <p className="mt-1 text-xs text-slate-500">
            Bu oran yalnızca girilen ölçümlerden hesaplanır; ölçülmeyen alanlar
            hesaba girmez.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const style = styleOfBand(card.band);
          return (
            <Card key={card.label} className="p-4" index={index}>
              <div className="flex items-center gap-2">
                <card.icon className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </span>
              </div>
              <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-900">
                {card.value}
              </p>
              <p className="mt-1 truncate text-xs text-slate-500">{card.hint}</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${style.bar}`}
                  style={{
                    width: `${Math.round((card.ratio ?? 0) * 100)}%`,
                  }}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="flex items-center justify-center p-5">
          <ConfidenceRing score={confidence.score} level={confidence.level} />
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Ölçüt bazında doğruluk
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Her ölçüt, o ölçütü girilen istasyonların ortalamasıdır.
          </p>

          <ul className="mt-4 space-y-3">
            {METRIC_ORDER.map((metric) => {
              const accuracy = summary.metricAccuracy[metric];
              const style = styleOfBand(bandOf(accuracy));
              return (
                <li key={metric}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      {METRIC_LABEL[metric]}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        accuracy === null ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {showPercent(accuracy)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${style.bar}`}
                      style={{ width: `${Math.round((accuracy ?? 0) * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {confidence.reasons.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-slate-200 pt-3">
              {confidence.reasons.map((reason) => (
                <p key={reason.factor} className="text-xs text-slate-500">
                  {reason.text}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
