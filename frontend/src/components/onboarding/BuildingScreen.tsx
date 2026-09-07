/**
 * Ekran 3 — "Fabrika kuruluyor".
 *
 * Bu ekran gerçek bir sunucu işini beklemez; şablon yerel bir JSON'dır ve
 * anında hazırdır. Yine de bir kurulum anı gösterilir: kullanıcı sektörü
 * seçtikten sonra doğrudan yirmi kutuluk bir şemaya düşerse ne olduğunu
 * anlamadan karmaşayla karşılaşır. Bu iki-üç saniye, ne kurulduğunu anlatarak
 * geçer.
 *
 * Adım adları yapılan işi tarif eder ve hiçbiri olmayan bir iş iddia etmez
 * ("sunucuya bağlanılıyor" gibi bir satır yoktur). İlerlemenin kendisi
 * `requestAnimationFrame` ile ölçülen gerçek zamandan gelir; sabit aralıklı
 * bir sayaçla ilerleseydi, yavaş bir cihazda çubuk atlayarak hareket ederdi.
 *
 * Hareket azaltılmış tercihinde çubuk yine ilerler (ilerleme bir durumdur,
 * süs değildir) ama üzerindeki parıltı durur.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  BUILD_DURATION_MS,
  BUILD_STEPS,
  completedStepCount,
} from "../../lib/onboarding";

interface BuildingScreenProps {
  /** Seçilen sektörün adı; başlıkta gösterilir. */
  sectorTitle: string;
  /** Canlandırma bitince çağrılır. */
  onDone: () => void;
}

export function BuildingScreen({ sectorTitle, onDone }: BuildingScreenProps) {
  const [progress, setProgress] = useState(0);

  // `onDone` referansı ebeveyn her çizdiğinde değişebilir; canlandırma
  // efektinin bağımlılığı olsaydı her çizimde baştan başlardı. Bu yüzden bir
  // ref'te tutulur — ve ref, render gövdesinde değil kendi efektinde
  // güncellenir: render sırasında ref yazmak React'in eşzamanlı çizim
  // varsayımlarını bozar.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let frame = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const ratio = Math.min(1, (now - started) / BUILD_DURATION_MS);
      setProgress(ratio);
      if (ratio < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        // Son adımın "Hazır" olarak okunabilmesi için kısa bir bekleme.
        frame = window.setTimeout(() => onDoneRef.current(), 380);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(frame);
    };
  }, []);

  const completed = completedStepCount(progress);
  const percent = Math.round(progress * 100);

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-12">
      <div className="optiflow-aurora" />

      <div className="optiflow-glass optiflow-enter relative w-full max-w-md rounded-2xl border border-slate-200 p-7 sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/15 text-brand-700">
            {progress < 1 ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Check className="h-6 w-6" />
            )}
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">
            {progress < 1 ? "Fabrikanız kuruluyor" : "Fabrikanız hazır"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{sectorTitle} şablonu</p>
        </div>

        {/* İlerleme çubuğu */}
        <div
          className="relative mt-7 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Kurulum ilerlemesi"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
            style={{ width: `${percent}%` }}
          >
            {progress < 1 && (
              <span className="optiflow-progress-shimmer absolute inset-0" />
            )}
          </div>
        </div>

        {/* Adımlar */}
        <ol className="mt-6 space-y-2.5">
          {BUILD_STEPS.map((step, index) => {
            const isDone = index < completed;
            const isActive = index === completed;

            return (
              <li key={step.id} className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                    isDone
                      ? "bg-emerald-500 text-white"
                      : isActive
                        ? "bg-brand-600/20 text-brand-700"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" />
                  ) : isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-current" />
                  )}
                </span>
                {/* Durum yalnızca renkle değil, yazının ağırlığıyla da
                    okunur; renk körü bir kullanıcı da nerede olunduğunu görür. */}
                <span
                  className={`text-sm transition-colors duration-200 ${
                    isDone || isActive
                      ? "font-medium text-slate-800"
                      : "text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
