/**
 * "Canlı Üretim" bölümünün iki görünümü.
 *
 * İkisi farklı soruları yanıtlar ve bu yüzden birleştirilmediler:
 *
 * - **Komuta merkezi** hattın *şu anki* hâlini gösterir; olay akışıyla beslenir
 *   ve yarın gerçek bir MES'e bağlanacak olan ekran budur.
 * - **Koşum izi** kaydedilmiş bir simülasyonun parçacık animasyonudur
 *   (`LivePage` → `FactoryAnimation`); geçmiş bir koşumu tekrar oynatır.
 *
 * Tek ekrana sığdırılsaydı, "canlı" sözcüğü aynı yerde iki farklı şey
 * anlatırdı: biri gerçek zamanlı durum, öteki kayıttan animasyon.
 */

import { useState } from "react";
import { Film, Radio } from "lucide-react";
import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import type { ScenarioId } from "../../lib/live";
import { LivePage } from "./LivePage";
import { LiveProductionCenter } from "./LiveProductionCenter";

type LiveTab = "center" | "trace";

const TABS: { id: LiveTab; label: string; icon: typeof Radio }[] = [
  { id: "center", label: "Komuta merkezi", icon: Radio },
  { id: "trace", label: "Koşum izi", icon: Film },
];

interface LiveSectionProps {
  simulationId: string | null;
  config: SimulationConfig | null;
  results: SimulationResults | null;
  onStartSimulation: () => void;
  /** Komuta merkezinin açılıştaki kaynağı ve senaryosu (demo modu kullanır). */
  initialSource?: "demo" | "replay";
  initialScenario?: ScenarioId;
}

export function LiveSection({
  simulationId,
  config,
  results,
  onStartSimulation,
  initialSource,
  initialScenario,
}: LiveSectionProps) {
  const [tab, setTab] = useState<LiveTab>("center");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <nav className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${
              tab === item.id
                ? "border-brand-500 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "center" ? (
          <LiveProductionCenter
            config={config}
            results={results}
            onStartSimulation={onStartSimulation}
            initialSource={initialSource}
            initialScenario={initialScenario}
          />
        ) : (
          /* Koşum izi ekranı kendi içinde kaydırılır; komuta merkezi ise tam
             ekran yerleşimini kendisi yönetir. */
          <div className="h-full overflow-y-auto">
            <LivePage
              simulationId={simulationId}
              config={config}
              results={results}
              onStartSimulation={onStartSimulation}
            />
          </div>
        )}
      </div>
    </div>
  );
}
