/**
 * Teklif ekranı — solda müşteri, sağda fiyat.
 *
 * Ekrandaki her rakam `buildQuote`'tan gelir; bu bileşende tek bir tutar
 * yazılı değildir. PDF de aynı işlevi çağırdığı için ekranda görülenle
 * müşteriye gidenin ayrışması mümkün değil.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  FileDown,
  Headphones,
  Mail,
  MapPin,
  Phone,
  TriangleAlert,
  User,
} from "lucide-react";
import {
  PLANS,
  PLAN_ORDER,
  buildProposalDocument,
  buildQuote,
  estimateFirstMonthSaving,
  type Lead,
  type PlanId,
} from "../../lib/sales";
import { downloadPdf, readLogo } from "../../lib/reports";
import { formatMoney } from "../../lib/financeFormatting";
import { Badge, Button, Card } from "../ui/Primitives";

interface ProposalPageProps {
  lead: Lead;
  /** Demoda ölçülmüş aylık kayıp; bilinmiyorsa `null`. */
  monthlyLoss: number | null;
  vendorName: string;
  onBack: () => void;
  /** Teklif PDF'i indirildiğinde kaydı bir sonraki durağa taşır. */
  onProposalSent: (leadId: string) => void;
}

export function ProposalPage({
  lead,
  monthlyLoss,
  vendorName,
  onBack,
  onProposalSent,
}: ProposalPageProps) {
  /*
   * Motorun önerdiği paket başlangıç seçimidir; satışçı elle değiştirebilir.
   * Değiştirdiğinde makine başına ücret o paketin tarifesinden hesaplanır.
   */
  const recommended = useMemo(
    () =>
      buildQuote({
        machineCount: lead.machineCount,
        employeeCount: lead.employeeCount,
      }),
    [lead.machineCount, lead.employeeCount],
  );

  const [planId, setPlanId] = useState<PlanId>(recommended.plan.id);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const quote = useMemo(() => {
    const plan = PLANS[planId];
    const monthly = plan.monthlyBase + lead.machineCount * plan.monthlyPerMachine;
    return {
      plan,
      monthly,
      setupFee: plan.setupFee,
      firstYearTotal: monthly * 12 + plan.setupFee,
      rationale:
        planId === recommended.plan.id
          ? recommended.rationale
          : `${plan.label} elle seçildi; bu ölçek için motorun önerisi ${recommended.plan.label}.`,
    };
  }, [planId, lead.machineCount, recommended]);

  const saving = estimateFirstMonthSaving(monthlyLoss, quote.monthly);

  const download = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const document = buildProposalDocument({
        lead,
        quote,
        preparedAt: new Date(),
        vendorName,
        monthlyLoss,
      });
      await downloadPdf(document, readLogo());
      onProposalSent(lead.id);
    } catch (error) {
      // Sessizce başarısız olursa satışçı düğmeye basıp hiçbir şey olmadığını
      // görür ve ürünün bozuk olduğunu düşünür.
      setFailure(
        error instanceof Error
          ? `Teklif oluşturulamadı: ${error.message}`
          : "Teklif oluşturulamadı.",
      );
    } finally {
      setBusy(false);
    }
  }, [lead, quote, vendorName, monthlyLoss, onProposalSent]);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
      >
        <ArrowLeft className="h-4 w-4" />
        Satış hattına dön
      </button>

      {failure !== null && (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {failure}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* --- Sol: müşteri --- */}
        <div className="space-y-4">
          <Card className="p-5" index={0}>
            <h2 className="text-xl font-semibold text-slate-900">
              {lead.company}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{quote.rationale}</p>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Info icon={Building2} label="Sektör" value={lead.sector} />
              <Info icon={MapPin} label="Şehir" value={lead.city || "—"} />
              <Info icon={User} label="Yetkili" value={lead.contactName || "—"} />
              <Info icon={Phone} label="Telefon" value={lead.phone || "—"} />
              <Info icon={Mail} label="E-posta" value={lead.email || "—"} />
              <Info
                icon={BadgeCheck}
                label="Ölçek"
                value={`${lead.machineCount} makine · ${lead.employeeCount} çalışan`}
              />
            </dl>

            {lead.note.trim() !== "" && (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-100/50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                {lead.note}
              </p>
            )}
          </Card>

          {lead.demo !== null && (
            <Card className="p-5" index={1}>
              <h3 className="text-sm font-semibold text-slate-900">
                Demo geçmişi
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(lead.demo.at).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {lead.demo.durationMinutes} dakika
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {lead.demo.screens.map((screen) => (
                  <li
                    key={screen}
                    className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                  >
                    {screen}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Paket seçimi */}
          <Card className="p-5" index={2}>
            <h3 className="text-sm font-semibold text-slate-900">Paket</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Motorun önerisi {recommended.plan.label}; gerekirse değiştirin.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {PLAN_ORDER.map((id) => {
                const plan = PLANS[id];
                const selected = id === planId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPlanId(id)}
                    aria-pressed={selected}
                    className={`rounded-xl border p-3 text-left transition-all duration-200 focus:outline-none ${
                      selected
                        ? "border-brand-500 bg-brand-600/12"
                        : "border-slate-200 bg-slate-100/50 hover:border-slate-300"
                    }`}
                  >
                    <p className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                      {selected && <Check className="h-3.5 w-3.5 text-brand-700" />}
                      {plan.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                      {formatMoney(plan.monthlyBase)} taban
                    </p>
                    {id === recommended.plan.id && (
                      <span className="mt-1.5 inline-block rounded border border-brand-200 bg-brand-50 px-1 py-px text-[9px] font-semibold text-brand-700">
                        Önerilen
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* --- Sağ: fiyat --- */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden" index={0}>
            <div className="bg-gradient-to-br from-brand-600/18 via-brand-600/6 to-transparent p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  Aylık ücret
                </p>
                <Badge tone="info">{quote.plan.label}</Badge>
              </div>
              <p className="mt-2 text-4xl font-bold text-slate-900 tabular-nums">
                {formatMoney(quote.monthly)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatMoney(quote.plan.monthlyBase)} taban +{" "}
                {lead.machineCount} × {formatMoney(quote.plan.monthlyPerMachine)}
              </p>
            </div>

            <dl className="divide-y divide-slate-200 border-t border-slate-200">
              <Row label="Kurulum (tek seferlik)" value={formatMoney(quote.setupFee)} />
              <Row label="İlk yıl toplamı" value={formatMoney(quote.firstYearTotal)} />
              <Row
                label="Destek"
                value={quote.plan.support}
                icon={Headphones}
                small
              />
              <Row
                label="İlk ay tasarruf tahmini"
                /* Ölçülmemiş bir tasarrufu yazmak, ilk faturada tartışma
                   çıkarır; bu yüzden tire ve nedeni. */
                value={saving === null ? "—" : formatMoney(saving.saving)}
                hint={
                  saving === null
                    ? "Firmanın kendi verisiyle koşum yapılmadı"
                    : `Aylık ücret düşülünce net ${formatMoney(saving.net)}`
                }
                tone={saving !== null && saving.net > 0 ? "good" : "neutral"}
              />
            </dl>

            <div className="border-t border-slate-200 p-4">
              <Button
                variant="primary"
                icon={FileDown}
                busy={busy}
                onClick={() => void download()}
                className="w-full"
              >
                {busy ? "Hazırlanıyor…" : "Teklifi PDF indir"}
              </Button>
              <p className="mt-2 text-center text-[10px] text-slate-500">
                İndirildiğinde kayıt "PDF Gönderildi" durağına taşınır.
              </p>
            </div>
          </Card>

          <Card className="p-4" index={1}>
            <h3 className="text-xs font-semibold text-slate-900">
              {quote.plan.label} kapsamı
            </h3>
            <ul className="mt-2 space-y-1.5">
              {quote.plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-1.5 text-[11px] leading-relaxed text-slate-600"
                >
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                  {feature}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100/40 p-2.5">
      <dt className="flex items-center gap-1.5 text-[10px] tracking-wide text-slate-500 uppercase">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  icon: Icon,
  small,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: typeof Headphones;
  small?: boolean;
  tone?: "neutral" | "good";
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          {Icon && <Icon className="h-3 w-3" />}
          {label}
        </span>
        <span
          className={`text-right tabular-nums ${small ? "text-[11px]" : "text-sm font-semibold"} ${
            tone === "good" ? "text-emerald-700" : "text-slate-900"
          }`}
        >
          {value}
        </span>
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
