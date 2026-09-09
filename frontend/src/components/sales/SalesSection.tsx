/**
 * Satış bölümünün kabuğu — durumun tek sahibi.
 *
 * Firma listesi burada durur ve her değişiklikte tarayıcıya yazılır. Kanban,
 * pano ve teklif ekranı aynı listeyi okur; her biri kendi kopyasını tutsaydı
 * bir sürüklemeden sonra pano eski durağı göstermeye devam ederdi.
 *
 * Saklama bilinçli olarak **tarayıcıdadır**: bu sprintte backend'e dokunulmuyor
 * ve bir CRM'in her sekme yenilemesinde sıfırlanması, iki dakikada teklif
 * çıkarma hedefiyle çelişirdi. Sunucuya taşındığında değişecek tek şey bu
 * dosyadaki iki çağrı olacak.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Columns3, LayoutGrid } from "lucide-react";
import {
  buildQuote,
  moveLead,
  recallLeads,
  rememberLeads,
  sampleLeads,
  sampleMeetings,
  type Lead,
  type LeadStage,
} from "../../lib/sales";
import { LeadDashboard } from "./LeadDashboard";
import { LeadFormModal, type LeadFormValues } from "./LeadFormModal";
import { PipelineBoard } from "./PipelineBoard";
import { ProposalPage } from "./ProposalPage";
import { SalesAnalytics } from "./SalesAnalytics";
import { SalesSidePanel } from "./SalesSidePanel";

type SalesTab = "board" | "pipeline" | "analytics";

const TABS: { id: SalesTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "board", label: "Firmalar", icon: LayoutGrid },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
  { id: "analytics", label: "Analitik", icon: BarChart3 },
];

interface SalesSectionProps {
  /** Teklifte kullanılacak satıcı adı (organizasyon). */
  vendorName: string;
  /**
   * Açık koşumdan gelen aylık kayıp; teklife tasarruf tahmini olarak girer.
   * Ölçülmemişse `null` — o zaman teklif tahmini hiç yazmaz.
   */
  monthlyLoss: number | null;
}

export function SalesSection({ vendorName, monthlyLoss }: SalesSectionProps) {
  /*
   * "Şimdi" bir kez alınır ve saklanır. Her render'da `new Date()` çağrılsaydı
   * göreli zaman etiketleri ("2 saat önce") ve hatırlatıcı eşikleri her
   * karede yeniden hesaplanır, memolar boşa çıkardı.
   */
  const [now] = useState(() => new Date());

  const [leads, setLeads] = useState<Lead[]>(() => {
    const stored = recallLeads();
    // İlk açılışta boş bir CRM ürünün ne yaptığını anlatmaz; örnek hat
    // yüklenir ve kullanıcının kendi kaydı yanına eklenir.
    return stored.length > 0 ? stored : sampleLeads(new Date());
  });

  const meetings = useMemo(() => sampleMeetings(now), [now]);

  const [tab, setTab] = useState<SalesTab>("board");
  const [editing, setEditing] = useState<Lead | null | "new">(null);
  const [proposalFor, setProposalFor] = useState<string | null>(null);

  useEffect(() => {
    rememberLeads(leads);
  }, [leads]);

  const openLead = useCallback((leadId: string) => setProposalFor(leadId), []);

  const handleMove = useCallback((leadId: string, stage: LeadStage) => {
    setLeads((current) => {
      const lead = current.find((item) => item.id === leadId);
      // Kazanıldı durağına taşınırken anlaşmanın aylık tutarı yazılır;
      // fiyat motoru dışında bir yerde tutar üretilmez.
      const wonMonthly =
        stage === "won" && lead
          ? buildQuote({
              machineCount: lead.machineCount,
              employeeCount: lead.employeeCount,
            }).monthly
          : null;
      return moveLead(current, leadId, stage, new Date(), wonMonthly);
    });
  }, []);

  const handleSave = useCallback(
    (values: LeadFormValues) => {
      const stamp = new Date().toISOString();
      setLeads((current) => {
        if (editing !== null && editing !== "new") {
          return current.map((item) =>
            item.id === editing.id
              ? { ...item, ...values, updatedAt: stamp }
              : item,
          );
        }
        const created: Lead = {
          ...values,
          id: `lead-${Date.now().toString(36)}`,
          stage: "new",
          createdAt: stamp,
          updatedAt: stamp,
          demo: null,
          wonMonthly: null,
        };
        return [created, ...current];
      });
      setEditing(null);
    },
    [editing],
  );

  const selected = useMemo(
    () => leads.find((item) => item.id === proposalFor) ?? null,
    [leads, proposalFor],
  );

  /* --- Teklif ekranı tam genişlik kaplar --- */
  if (selected !== null) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <ProposalPage
          lead={selected}
          monthlyLoss={monthlyLoss}
          vendorName={vendorName}
          onBack={() => setProposalFor(null)}
          onProposalSent={(leadId) => handleMove(leadId, "sent")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Satış
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Demoyu gösterin, teklifi iki dakikada çıkarın.
          </p>
        </div>

        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 focus:outline-none ${
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

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {tab === "board" && (
            <LeadDashboard
              leads={leads}
              now={now}
              onOpenLead={openLead}
              onNewLead={() => setEditing("new")}
            />
          )}
          {tab === "pipeline" && (
            <PipelineBoard
              leads={leads}
              now={now}
              onOpenLead={openLead}
              onMove={handleMove}
            />
          )}
          {tab === "analytics" && <SalesAnalytics leads={leads} now={now} />}
        </div>

        {/* Yan panel her sekmede görünür: bekleyen iş, sekme değiştirince
            kaybolmamalı. */}
        <aside className="min-w-0">
          <SalesSidePanel
            leads={leads}
            meetings={meetings}
            now={now}
            onOpenLead={openLead}
          />
        </aside>
      </div>

      {editing !== null && (
        <LeadFormModal
          lead={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
