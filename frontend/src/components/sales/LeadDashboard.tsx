/**
 * CRM panosu — dört KPI kartı ve firma listesi.
 *
 * Sayılar `pipelineCounts` ile gelir; bu bileşen hiçbir toplama yapmaz. KPI
 * kartlarındaki rakamla kanban sütunundaki kart adedi bu sayede ayrışamaz.
 */

import { memo, useMemo, useState } from "react";
import { Handshake, Plus, Search, Send, Sparkles, Users } from "lucide-react";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  pipelineCounts,
  type Lead,
  type LeadStage,
} from "../../lib/sales";
import { formatMoney } from "../../lib/financeFormatting";
import { Button, EmptyState } from "../ui/Primitives";
import { LeadCard } from "./LeadCard";

interface LeadDashboardProps {
  leads: Lead[];
  now: Date;
  onOpenLead: (leadId: string) => void;
  onNewLead: () => void;
}

function LeadDashboardInner({
  leads,
  now,
  onOpenLead,
  onNewLead,
}: LeadDashboardProps) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all");

  const counts = useMemo(() => pipelineCounts(leads), [leads]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    return leads
      .filter((lead) => stageFilter === "all" || lead.stage === stageFilter)
      .filter((lead) => {
        if (needle === "") {
          return true;
        }
        // Arama firma, şehir, sektör ve yetkili üzerinde çalışır: satışçı
        // aklında kalan neyse onu yazar.
        return [lead.company, lead.city, lead.sector, lead.contactName]
          .join(" ")
          .toLocaleLowerCase("tr-TR")
          .includes(needle);
      })
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );
  }, [leads, query, stageFilter]);

  return (
    <div className="space-y-4">
      {/* --- KPI --- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Users}
          label="Toplam Lead"
          value={String(counts.total)}
          hint="Hattaki tüm firmalar"
        />
        <Kpi
          icon={Sparkles}
          label="Demo Bekleyen"
          value={String(counts.awaitingDemo)}
          hint="Henüz demo yapılmadı"
          tone="brand"
        />
        <Kpi
          icon={Send}
          label="Teklif Bekleyen"
          value={String(counts.awaitingProposal)}
          hint="Demosu yapıldı, teklifi çıkmadı"
          tone="amber"
        />
        <Kpi
          icon={Handshake}
          label="Kazanılan"
          value={String(counts.won)}
          hint={
            counts.won === 0
              ? "Henüz kazanılan anlaşma yok"
              : `${formatMoney(counts.wonMonthlyTotal)} / ay`
          }
          tone="emerald"
        />
      </div>

      {/* --- Arama ve süzgeç --- */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Firma, şehir, sektör ya da yetkili ara"
            className="w-full rounded-xl border border-slate-200 bg-slate-100 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-1">
          <FilterChip
            active={stageFilter === "all"}
            onClick={() => setStageFilter("all")}
            label="Tümü"
          />
          {STAGE_ORDER.map((stage) => (
            <FilterChip
              key={stage}
              active={stageFilter === stage}
              onClick={() => setStageFilter(stage)}
              label={STAGE_LABEL[stage]}
            />
          ))}
        </div>

        <Button variant="primary" icon={Plus} onClick={onNewLead}>
          Yeni Lead
        </Button>
      </div>

      {/* --- Liste --- */}
      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={leads.length === 0 ? "Henüz firma yok" : "Eşleşen firma yok"}
          description={
            leads.length === 0
              ? "İlk firmayı ekleyerek satış hattını başlatın; demo ve teklif adımları buradan ilerler."
              : "Arama ya da süzgeci değiştirerek tekrar deneyin."
          }
          action={
            leads.length === 0 ? (
              <Button variant="primary" icon={Plus} onClick={onNewLead}>
                Yeni Lead
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((lead, index) => (
            <li key={lead.id}>
              <LeadCard
                lead={lead}
                now={now}
                onOpen={onOpenLead}
                index={index}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const KPI_TONE = {
  neutral: "text-slate-900",
  brand: "text-brand-700",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
} as const;

const Kpi = memo(function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  tone?: keyof typeof KPI_TONE;
}) {
  return (
    <div className="optiflow-enter optiflow-glass rounded-xl border border-slate-200 p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${KPI_TONE[tone]}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
});

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-200 focus:outline-none ${
        active
          ? "border-brand-500 bg-brand-600/15 text-brand-700"
          : "border-slate-200 bg-slate-100 text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

export const LeadDashboard = memo(LeadDashboardInner);
