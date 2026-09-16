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

import { useEffect, useState } from "react";
import { Film, Radio } from "lucide-react";
import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import type { ScenarioId } from "../../lib/live";
import type { StreamStatus } from "../../lib/connectors";
import { LivePage } from "./LivePage";
import { useLiveStream } from "../monitoring/useLiveStream";
import { useMonitoring } from "../monitoring/useMonitoring";
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
  initialSource?: "demo" | "replay" | "runtime";
  initialScenario?: ScenarioId;
  /** Sunucu köprüsündeki cihaz akışları; yoksa yalnızca kaynağa bakılır. */
  bridge?: { streams: StreamStatus[]; anyVerifiedConnection: boolean };
}

export function LiveSection({
  simulationId,
  config,
  results,
  onStartSimulation,
  initialSource,
  initialScenario,
  bridge,
}: LiveSectionProps) {
  const [tab, setTab] = useState<LiveTab>("center");

  /*
   * Gerçek cihaz KPI'ları. Yalnızca komuta merkezi açıkken yoklanır: koşum
   * izi sekmesindeyken sunucuya on saniyede bir istek atmak, bakılmayan bir
   * ekran uğruna gereksiz yük olurdu.
   */
  const monitoring = useMonitoring({ enabled: tab === "center" });

  /*
   * Canlı akış. KPI'lar yoklamayla da tazelenir ama on saniyelik aralık,
   * cihazdan gelen bir değişimi ekranda on saniye geciktirir. Akıştan bir
   * üretim ya da OEE güncellemesi geldiğinde KPI hemen yeniden okunur.
   */
  const live = useLiveStream({ enabled: tab === "center" });

  useEffect(() => {
    if (live.lastProduction === null && live.lastOee === null) return;
    void monitoring.refresh();
  }, [live.lastProduction, live.lastOee, monitoring.refresh]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <nav className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            /* 44px dokunma hedefi; alt çizgi ve punto aynen korunur. */
            className={`-mb-px flex min-h-[44px] items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${
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
            bridge={bridge}
            runtimeKpi={monitoring.kpi}
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
