/**
 * Demo şeridi — her ekranın en üstünde durur.
 *
 * Üç işi var ve üçü de vazgeçilmez:
 *
 * 1. **Uyarmak.** Rakamların gerçek bir koşumdan gelmediğini söyler. Bunu
 *    söylemeyen bir demo, müşterinin ekrandaki kaybı kendi fabrikasının kaybı
 *    sanmasına yol açar.
 * 2. **Anlatmak.** Kaçıncı dakikada olunduğunu ve o dakikada ne olduğunu
 *    yazar; sunum yapan kişi ekranı anlatmak zorunda kalmaz.
 * 3. **Çıkarmak.** "Kendi fabrikanızı oluştur" ve "Demodan çık" tek tıktır.
 *
 * Beşinci dakikada şerit büyür ve önce/sonra karşılaştırmasını taşır. Bu
 * karşılaştırma bir ekrana değil şeride konur çünkü demo hangi ekranda
 * bitirilirse bitirilsin görünmesi gerekir.
 */

import { memo } from "react";
import { ArrowRight, ChevronRight, LogOut, Play, UserPlus } from "lucide-react";
import {
  PHASES,
  PHASE_COUNT,
  demoProgress,
  type DemoComparisonRow,
  type DemoPhase,
} from "../../lib/demo";

interface DemoBannerProps {
  phase: DemoPhase;
  elapsedMs: number;
  comparison: DemoComparisonRow[] | null;
  onAdvance: () => void;
  onSignUp: () => void;
  onExit: () => void;
}

function DemoBannerInner({
  phase,
  elapsedMs,
  comparison,
  onAdvance,
  onSignUp,
  onExit,
}: DemoBannerProps) {
  const info = PHASES[phase];
  const progress = Math.round(demoProgress(elapsedMs) * 100);

  return (
    <div className="shrink-0 border-b border-brand-300/50 bg-brand-600/12">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-bold text-white">
          <Play className="h-3 w-3" />
          Demo Modu
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold text-brand-700 tabular-nums">
            {phase}/{PHASE_COUNT}
          </span>
          <span className="truncate text-xs text-slate-700">
            <span className="font-semibold text-slate-900">{info.label}</span>
            {" — "}
            {info.detail}
          </span>
        </div>

        {/* İlerleme çubuğu; yüzde ayrıca yazılı olduğu için renk tek başına
            bilgi taşımaz. */}
        <div className="hidden w-28 shrink-0 items-center gap-2 sm:flex">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="optiflow-progress-fill h-full rounded-full bg-brand-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 tabular-nums">%{progress}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onAdvance}
            title="Beklemeden sonraki dakikaya geç"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none"
          >
            Sonraki adım
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onSignUp}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none"
          >
            <UserPlus className="h-3 w-3" />
            Kendi fabrikanızı oluştur
          </button>
          <button
            type="button"
            onClick={onExit}
            title="Demodan çık"
            aria-label="Demodan çık"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
          >
            <LogOut className="h-3 w-3" />
            Çık
          </button>
        </div>
      </div>

      {comparison !== null && (
        <div className="border-t border-brand-300/40 px-4 py-2">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase">
            Öneri uygulandıktan sonra
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {comparison.map((row) => (
              <li key={row.label} className="flex items-baseline gap-1.5 text-xs">
                <span className="text-slate-500">{row.label}</span>
                <span className="text-slate-500 line-through">{row.before}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                <span
                  className={`font-semibold ${
                    row.improved ? "text-emerald-700" : "text-slate-900"
                  }`}
                >
                  {row.after}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const DemoBanner = memo(DemoBannerInner);
