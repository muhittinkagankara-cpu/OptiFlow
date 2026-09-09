/**
 * Kurulum bölümünün kabuğu — sihirbaz, sağlık paneli, danışman ve ayarlar.
 *
 * Durum yukarıdan (`useEnterpriseSetup`) gelir; bu bileşen yalnızca hangi
 * sekmenin çizileceğine karar verir ve değişikliği yukarı iletir.
 */

import { useState } from "react";
import { Cog, ListChecks, Settings2 } from "lucide-react";
import type {
  ConnectorHealthCard,
  EnterpriseState,
  ReadinessReport,
} from "../../lib/onboarding-enterprise";
import { EnterpriseSettingsPage } from "./EnterpriseSettingsPage";
import { EnterpriseSetupWizard } from "./EnterpriseSetupWizard";
import { ConnectorHealthPanel } from "./ConnectorHealthPanel";
import { SetupAdvisorPanel } from "./SetupAdvisorPanel";
import { WelcomeSuccessScreen } from "./WelcomeSuccessScreen";

type Tab = "wizard" | "health" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Cog }[] = [
  { id: "wizard", label: "Kurulum", icon: ListChecks },
  { id: "health", label: "Veri kaynakları", icon: Cog },
  { id: "settings", label: "Ayarlar", icon: Settings2 },
];

interface EnterpriseSectionProps {
  state: EnterpriseState;
  report: ReadinessReport;
  healthCards: ConnectorHealthCard[];
  onChange: (state: EnterpriseState) => void;
  onNavigate: (view: string) => void;
  onSetupCompleted: (atMs: number) => void;
  now?: Date;
}

export function EnterpriseSection({
  state,
  report,
  healthCards,
  onChange,
  onNavigate,
  onSetupCompleted,
  now = new Date(),
}: EnterpriseSectionProps) {
  const [tab, setTab] = useState<Tab>("wizard");
  const [celebrating, setCelebrating] = useState(false);

  if (celebrating) {
    return (
      <WelcomeSuccessScreen
        report={report}
        companyName={state.company?.name ?? null}
        onNavigate={onNavigate}
        onClose={() => setCelebrating(false)}
      />
    );
  }

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                tab === item.id
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "wizard" && (
        <EnterpriseSetupWizard
          state={state}
          report={report}
          onChange={onChange}
          onNavigate={onNavigate}
          onFinish={() => {
            onSetupCompleted(Date.now());
            setCelebrating(true);
          }}
        />
      )}

      {tab === "health" && (
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
          <ConnectorHealthPanel
            cards={healthCards}
            nowMs={now.getTime()}
            onOpenConnectors={() => onNavigate("connectors")}
          />
          <SetupAdvisorPanel
            input={{ state, readiness: report, health: healthCards, now }}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {tab === "settings" && (
        <EnterpriseSettingsPage
          settings={state.settings}
          onChange={(settings) => onChange({ ...state, settings })}
        />
      )}
    </div>
  );
}
