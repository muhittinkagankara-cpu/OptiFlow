/**
 * Sihirbaz kabuğu: adım göstergesi, gövde ve gezinme düğmeleri.
 *
 * Akış üç adımdır: sektör seçimi → süreç editörü → onay. Ortadaki adım ayrı bir
 * form değil, ürünün asıl editörüdür (Sayfa 5). Daha önce burada modeli form
 * alanlarıyla düzenleten bir ara ekran vardı; kullanıcı aynı işi iki farklı
 * arayüzde yapabiliyordu ve şablonu seçtikten sonra istasyonlarını göremeden
 * rakam giriyordu. Şablonun kutuları doğrudan canvas'ta açıldığında kullanıcı
 * ne kurduğunu görerek düzenler.
 *
 * Adım göstergesi kullanıcıya "nerede olduğunu ve daha ne kadar kaldığını"
 * söyler; belirsizlik, üç adımlık bir akışta bile vazgeçme sebebidir. Tamamlanan
 * adımlar tıklanabilir olur ki kullanıcı geri dönüp kontrol edebilsin, ama
 * ileri atlamaya izin verilmez — veri girilmemiş bir adımı atlamak, sonraki
 * ekranda anlamsız bir boşlukla karşılaşmak demektir.
 */

import { useState } from "react";
import type { SimulationConfig, SimulationRunResponse } from "../../types/simulationTypes";
import { ApiError, runSimulation } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import { createBlankConfig } from "../../lib/configDefaults";
import { ProcessEditor } from "../editor/ProcessEditor";
import { ArrowLeftIcon, CheckIcon } from "../shared/icons";
import { WizardProvider, useWizard, type WizardStepNumber } from "./WizardContext";
import { WizardStep3_Confirmation } from "./WizardStep3_Confirmation";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import type { Factory } from "../../types/simulationTypes";
import type { RunHistoryEntry } from "../../lib/runHistory";

const STEP_TITLES: Record<WizardStepNumber, string> = {
  1: "Sektör",
  2: "Süreç Şeması",
  3: "Onay",
};

interface OnboardingWizardProps {
  /** Simülasyon tamamlandığında sonucu üst katmana verir. */
  onSimulationComplete: (result: SimulationRunResponse, config: SimulationConfig) => void;
  /** Hero ekranındaki "Son Çalıştığınız Fabrikalar" kartlarını besler. */
  factories: Factory[];
  runHistory: RunHistoryEntry[];
  onOpenFactory: (factoryId: string) => void;
  /** Excel içe aktarma akışını açar. */
  onImportExcel: () => void;
}

export function OnboardingWizard(props: OnboardingWizardProps) {
  return (
    <WizardProvider>
      <WizardShell {...props} />
    </WizardProvider>
  );
}

function WizardShell({
  onSimulationComplete,
  factories,
  runHistory,
  onOpenFactory,
  onImportExcel,
}: OnboardingWizardProps) {
  const { step, config, flow, selectTemplate, updateConfig, setFlow, goNext, goBack, goToStep } =
    useWizard();
  const [isRunning, setIsRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handleRun = async () => {
    if (!config) {
      return;
    }
    setErrors([]);
    setIsRunning(true);
    try {
      // Ayrıntı düzeyi editörde seçilir ve config'e işlenmiştir; burada
      // sabit bir varsayılana zorlamak, kullanıcının bir adım önce yaptığı
      // seçimi sessizce geçersiz kılardı.
      const result = await runSimulation(config);
      onSimulationComplete(result, config);
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsRunning(false);
    }
  };

  /**
   * 1. adım artık üç ekranlı kurulum akışıdır (hero → sektör → kuruluyor).
   *
   * Adım göstergesi burada **gösterilmez**: akışın kendi ilerlemesi var ve iki
   * ayrı ilerleme göstergesi aynı anda kullanıcıya nerede olduğunu değil, kaç
   * farklı yerde olduğunu sorardı. Gösterge 2. adımdan itibaren belirir.
   */
  if (step === 1) {
    return (
      <OnboardingFlow
        factories={factories}
        runHistory={runHistory}
        onOpenFactory={onOpenFactory}
        onImportExcel={onImportExcel}
        onReady={(sectorId, templateConfig) => {
          selectTemplate(sectorId, templateConfig);
          goNext();
        }}
      />
    );
  }

  /**
   * Süreç editörü tam genişlikte açılır; şema dar bir sütuna sığmaz.
   *
   * Adım göstergesi üstte kalır: kullanıcı editöre "düştüğünü" değil,
   * kurulumun ortasında olduğunu görmelidir.
   */
  if (step === 2) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4 sm:px-6">
          <StepIndicator current={step} onSelect={goToStep} />
        </div>

        <div className="min-h-0 flex-1">
          <ProcessEditor
            // Boş şablonda config yoktur; editör yine de bir başlangıç
            // noktasına ihtiyaç duyar.
            initialConfig={config ?? createBlankConfig()}
            initialFlow={flow}
            onBack={goBack}
            onContinue={(nextConfig, nextFlow) => {
              updateConfig(nextConfig);
              setFlow(nextFlow);
              goNext();
            }}
            onSimulationComplete={onSimulationComplete}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <StepIndicator current={step} onSelect={goToStep} />

      <div className="mt-8">
        {step === 3 && (
          <WizardStep3_Confirmation
            onEdit={goBack}
            onRun={handleRun}
            isRunning={isRunning}
            errors={errors}
          />
        )}
      </div>

      {/* 3. adımda ana eylemler kartın içinde olduğu için alt gezinme çubuğu
          yalnızca "Geri" düğmesini gösterir; iki ayrı ileri düğmesi kullanıcıyı
          hangisine basacağı konusunda tereddütte bırakırdı. */}
      <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6">
        <button
          type="button"
          onClick={goBack}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:pointer-events-none disabled:opacity-40"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Geri
        </button>
      </div>
    </div>
  );
}

interface StepIndicatorProps {
  current: WizardStepNumber;
  onSelect: (step: WizardStepNumber) => void;
}

function StepIndicator({ current, onSelect }: StepIndicatorProps) {
  const steps: WizardStepNumber[] = [1, 2, 3];

  return (
    <nav aria-label="Kurulum adımları">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isComplete = step < current;
          const isCurrent = step === current;
          const isClickable = isComplete;

          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                onClick={() => isClickable && onSelect(step)}
                disabled={!isClickable}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-1 py-1 ${
                  isClickable
                    ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    : "cursor-default"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isComplete
                      ? "bg-brand-600 text-white"
                      : isCurrent
                        ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isComplete ? <CheckIcon className="h-4 w-4" /> : step}
                </span>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isCurrent ? "text-slate-900" : "text-slate-500"
                  }`}
                >
                  {STEP_TITLES[step]}
                </span>
              </button>

              {index < steps.length - 1 && (
                <span
                  className={`mx-3 h-0.5 flex-1 rounded transition-colors ${
                    isComplete ? "bg-brand-500" : "bg-slate-200"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
