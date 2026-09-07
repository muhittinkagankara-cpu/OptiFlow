/**
 * Ekran 6 — Vardiya özeti.
 *
 * Dört kart ve altında kısa bir mesaj. Mesajın metni `buildShiftSummary`
 * tarafından seçilir, burada değil: fire oranı yüksek bir vardiyayı kutlamanın
 * yanlış olduğu bir karardır ve kararların sınanabilir bir yerde durması
 * gerekir.
 */

import { CheckCircle2, Layers, Package, PartyPopper, Timer, TrendingUp } from "lucide-react";
import { buildShiftSummary, scrapSummary, collectScrap, type OperatorTask } from "../../lib/operator";
import { ScreenHeader, StatTile } from "./operatorUi";

const TONE_CARD: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-900",
  neutral: "border-slate-200 bg-slate-100 text-slate-800",
};

export function ShiftSummaryScreen({
  tasks,
  onBack,
}: {
  tasks: OperatorTask[];
  onBack: () => void;
}) {
  const summary = buildShiftSummary(tasks);
  const scrap = scrapSummary(collectScrap(tasks), summary.produced);

  return (
    <div className="optiflow-screen">
      <ScreenHeader title="Vardiya özeti" onBack={onBack} />

      <div className="space-y-4 px-4 py-4">
        <section className="grid grid-cols-2 gap-3">
          <StatTile
            label="Üretilen adet"
            value={summary.produced}
            hint={`${summary.completedCount}/${summary.taskCount} görev tamamlandı`}
            icon={Package}
          />
          <StatTile
            label="Hurda"
            value={summary.scrapped}
            hint={
              scrap.rate === null
                ? "Henüz parça işlenmedi"
                : `%${(scrap.rate * 100).toFixed(1).replace(".", ",")} fire`
            }
            tone={scrap.tone === "neutral" ? "neutral" : scrap.tone}
            icon={Layers}
          />
          <StatTile
            label="Verim"
            /* Hiç parça işlenmemişken "%0 verim" demek, ölçüm yapılmadığı hâlde
               kötü bir sonuç bildirmek olurdu. */
            value={
              summary.yieldRate === null
                ? "—"
                : `%${Math.round(summary.yieldRate * 100)}`
            }
            hint={summary.yieldRate === null ? "Ölçülecek üretim yok" : "Sağlam / işlenen"}
            tone={summary.yieldRate === null ? "neutral" : scrap.tone === "neutral" ? "neutral" : scrap.tone}
            icon={TrendingUp}
          />
          <StatTile
            label="Süre"
            value={`${Math.round(summary.workedMinutes)} dk`}
            hint="İşlerde geçen toplam süre"
            icon={Timer}
          />
        </section>

        {/* Hurda dağılımı — yalnızca girilmiş nedenler listelenir. */}
        {scrap.byReason.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Hurda nedenleri
            </h2>
            <ul className="mt-2.5 space-y-2">
              {scrap.byReason.map((item) => (
                <li key={item.reason}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-slate-600">{item.label}</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {item.quantity} adet · %{Math.round(item.share * 100)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="optiflow-progress-fill h-full rounded-full bg-amber-500"
                      style={{ width: `${Math.round(item.share * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Kapanış mesajı */}
        <section
          className={`rounded-2xl border p-4 text-center ${TONE_CARD[summary.tone]}`}
        >
          <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/60">
            {summary.allDone && summary.tone !== "bad" ? (
              <PartyPopper className="optiflow-check-pop h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </span>
          <p className="text-base font-semibold">{summary.headline}</p>
          <p className="mt-1 text-xs opacity-90">{summary.detail}</p>
        </section>
      </div>
    </div>
  );
}
