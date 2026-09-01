/**
 * Uygulama kabuğu ve sayfalar arası gezinme.
 *
 * Dört görünüm: sihirbaz (Sayfa 4), süreç editörü (Sayfa 5), sonuç ekranı
 * (Sayfa 6) ve senaryo karşılaştırması (Sayfa 6'nın alt görünümü). Ayrı bir
 * yönlendirme kütüphanesi eklenmedi: görünümler arasında taşınan durum
 * (kurulan model, son sonuç, karşılaştırma referansı) zaten bu bileşende
 * tutuluyor ve URL'e sığdırılabilecek türden değil.
 *
 * Karşılaştırma referansı burada saklanır. Kullanıcı sonuç ekranında "kopyala
 * ve karşılaştır" dediğinde o anki model referans olur; editörde değişiklik
 * yapıp tekrar çalıştırdığında iki senaryo yan yana getirilebilir. Kalıcı
 * depolama gerekmez — karşılaştırma tek oturumluk bir işlemdir.
 */

import { useEffect, useState } from "react";
import { OnboardingWizard } from "./components/wizard/OnboardingWizard";
import { ProcessEditor } from "./components/editor/ProcessEditor";
import { ResultsPage } from "./components/results/ResultsPage";
import {
  ScenarioComparison,
  type ComparisonScenario,
} from "./components/results/ScenarioComparison";
import { WarningIcon } from "./components/shared/icons";
import { API_BASE_URL, isBackendReachable } from "./lib/apiClient";
import type { SimulationConfig, SimulationRunResponse } from "./types/simulationTypes";

type View = "wizard" | "editor" | "results" | "comparison";

export default function App() {
  const [view, setView] = useState<View>("wizard");
  const [config, setConfig] = useState<SimulationConfig | null>(null);
  const [result, setResult] = useState<SimulationRunResponse | null>(null);
  const [baseline, setBaseline] = useState<ComparisonScenario | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isBackendReachable().then((online) => {
      if (!cancelled) {
        setBackendOnline(online);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSimulationComplete = (
    response: SimulationRunResponse,
    usedConfig: SimulationConfig,
  ) => {
    setResult(response);
    setConfig(usedConfig);
    setView("results");
  };

  const startComparison = () => {
    if (!config) {
      return;
    }
    // Referans, o anki modelin derin kopyasıdır: kullanıcı editörde değişiklik
    // yaptığında referans senaryo da değişseydi karşılaştırma anlamsız olurdu.
    setBaseline({ label: "Mevcut model", config: structuredClone(config) });
    setView("editor");
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar />

      {backendOnline === false && (
        <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            Simülasyon servisine ulaşılamıyor ({API_BASE_URL}). Modeli
            kurabilirsiniz, ancak çalıştırmak için servisin açık olması gerekir.
          </p>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {view === "wizard" && (
          <OnboardingWizard
            onEditModel={(nextConfig) => {
              setConfig(nextConfig);
              setView("editor");
            }}
            onSimulationComplete={handleSimulationComplete}
          />
        )}

        {view === "editor" && config && (
          <ProcessEditor
            initialConfig={config}
            lastResult={result}
            onBack={() => setView(result ? "results" : "wizard")}
            onSimulationComplete={handleSimulationComplete}
          />
        )}

        {view === "results" && result && config && (
          <ResultsPage
            result={result}
            config={config}
            onBackToEditor={() => setView("editor")}
            onStartOver={() => {
              setResult(null);
              setConfig(null);
              setBaseline(null);
              setView("wizard");
            }}
            onCompareFromHere={startComparison}
            onOpenComparison={baseline ? () => setView("comparison") : undefined}
            baselineLabel={baseline?.label ?? null}
          />
        )}

        {view === "comparison" && baseline && config && (
          <ScenarioComparison
            baseline={baseline}
            candidate={{ label: "Değiştirilmiş model", config }}
            onBack={() => setView("results")}
          />
        )}
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
        S
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">Üretim Simülasyonu</p>
        <p className="text-xs text-slate-500">
          Hattınızı kurun, çalıştırın, darboğazı görün
        </p>
      </div>
    </header>
  );
}
