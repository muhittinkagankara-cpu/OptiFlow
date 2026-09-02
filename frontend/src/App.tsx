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
import { InventoryPage } from "./components/inventory/InventoryPage";
import { ResultsPage } from "./components/results/ResultsPage";
import {
  ScenarioComparison,
  type ComparisonScenario,
} from "./components/results/ScenarioComparison";
import { WarningIcon } from "./components/shared/icons";
import { API_BASE_URL, isBackendReachable } from "./lib/apiClient";
import type { SimulationConfig, SimulationRunResponse } from "./types/simulationTypes";

type View = "wizard" | "editor" | "results" | "comparison" | "inventory";

export default function App() {
  const [view, setView] = useState<View>("wizard");
  const [config, setConfig] = useState<SimulationConfig | null>(null);
  const [result, setResult] = useState<SimulationRunResponse | null>(null);
  /**
   * Envanter sekmesinden dönüldüğünde hangi üretim görünümüne gidileceği.
   *
   * Sekme değiştirmek kurulan modeli kaybettirmemelidir; kullanıcı envantere
   * bakıp geri döndüğünde bıraktığı yeri bulmalıdır.
   */
  const [productionView, setProductionView] = useState<View>("wizard");
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
      <TopBar
        current={view}
        onSelect={(next) => {
          if (next === "inventory") {
            // Üretim tarafındaki yer işaretlenir ki geri dönüşte aynı ekran
            // açılsın; envanter sekmesi akışı sıfırlamamalıdır.
            setProductionView(view === "inventory" ? productionView : view);
            setView("inventory");
          } else {
            setView(productionView === "inventory" ? "wizard" : productionView);
          }
        }}
      />

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
          <OnboardingWizard onSimulationComplete={handleSimulationComplete} />
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

        {view === "inventory" && (
          <InventoryPage
            config={config}
            simulationId={result?.simulation_id ?? null}
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

/**
 * Üst çubuk ve ana sekmeler.
 *
 * İki alan vardır: üretim (sihirbaz → editör → sonuç) ve envanter. Envanter
 * ayrı bir sekmedir çünkü bağımsız bir modüldür — kalem eklemeden üretim
 * simülasyonu, simülasyon çalıştırmadan envanter analizi yapılabilir. Akış
 * içine gömülseydi, biri olmadan diğerinin çalışmadığı izlenimi doğardı.
 */
function TopBar({
  current,
  onSelect,
}: {
  current: View;
  onSelect: (area: "production" | "inventory") => void;
}) {
  const isInventory = current === "inventory";

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          S
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Üretim Simülasyonu</p>
          <p className="text-xs text-slate-500">
            Hattınızı kurun, çalıştırın, darboğazı görün
          </p>
        </div>
      </div>

      <nav aria-label="Ana bölümler" className="flex gap-1">
        <TabButton
          label="Üretim"
          isActive={!isInventory}
          onClick={() => onSelect("production")}
        />
        <TabButton
          label="Envanter"
          isActive={isInventory}
          onClick={() => onSelect("inventory")}
        />
      </nav>
    </header>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        isActive
          ? "bg-brand-50 text-brand-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}
