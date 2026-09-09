/**
 * Kurumsal kurulum sihirbazı — yedi adım tek akışta.
 *
 * Sihirbaz hiçbir şeyi "tamamlandı" diye işaretlemez: adımların tamamlanma
 * bilgisi hazırlık raporundan gelir ve rapor da ürünün gerçekten ürettiği
 * sonuçlara bakar. Onay kutusuyla ilerleyen bir kurulum, hiç koşum almamış bir
 * müşteriye "hazırsınız" derdi.
 *
 * Son üç adım (simülasyon, doğrulama, rapor) burada **yapılmaz**; kullanıcı
 * ilgili ekrana gönderilir ve dönüşte adım kendiliğinden tamamlanmış görünür.
 * Aynı işi iki yerde yapmak, iki ayrı davranış demek olurdu.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ExternalLink,
  Factory as FactoryIcon,
  ImageUp,
} from "lucide-react";
import { ACCEPTED_LOGO_TYPES, readLogo, saveLogo, validateLogo } from "../../lib/reports";
import {
  STEP_LABEL,
  STEP_ORDER,
  STEP_VIEW,
  buildChecklist,
  type CompanyProfile,
  type EnterpriseState,
  type FactoryProfile,
  type ReadinessReport,
  type SetupStepId,
} from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { MachineInventoryManager } from "./MachineInventoryManager";
import { ReadinessCard } from "./ReadinessCard";
import { BAND_STYLE, STEP_ICON } from "./enterpriseStyles";

interface EnterpriseSetupWizardProps {
  state: EnterpriseState;
  report: ReadinessReport;
  onChange: (state: EnterpriseState) => void;
  onNavigate: (view: string) => void;
  /** Kurulum bittiğinde başarı ekranını açar. */
  onFinish: () => void;
}

export function EnterpriseSetupWizard({
  state,
  report,
  onChange,
  onNavigate,
  onFinish,
}: EnterpriseSetupWizardProps) {
  const [step, setStep] = useState<SetupStepId>(report.nextStep ?? "company");
  const checklist = useMemo(() => buildChecklist(report), [report]);
  const index = STEP_ORDER.indexOf(step);

  const complete = (id: SetupStepId): boolean =>
    checklist.find((item) => item.id === id)?.done ?? false;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Kurumsal Kurulum
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Yedi adım; tahmini toplam süre 30 dakika.
        </p>
      </div>

      {/* --- Adım şeridi --- */}
      <nav className="mb-4 flex flex-wrap gap-1.5">
        {STEP_ORDER.map((id, position) => {
          const Icon = STEP_ICON[id];
          const done = complete(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setStep(id)}
              aria-current={step === id ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-200 ${
                step === id
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : done
                    ? BAND_STYLE.green.chip
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{position + 1}.</span>
              {STEP_LABEL[id]}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {step === "company" && (
            <CompanyStep
              company={state.company}
              onChange={(company) => onChange({ ...state, company })}
            />
          )}

          {step === "factory" && (
            <FactoryStep
              factories={state.factories}
              onChange={(factories) => onChange({ ...state, factories })}
              onOpenFactories={() => onNavigate("factories")}
            />
          )}

          {step === "machines" && (
            <Card className="p-0">
              <MachineInventoryManager
                machines={state.machines}
                factoryId={state.factories[0]?.id ?? null}
                onChange={(machines) => onChange({ ...state, machines })}
              />
            </Card>
          )}

          {(step === "connectors" ||
            step === "simulation" ||
            step === "validation" ||
            step === "report") && (
            <HandoffStep
              step={step}
              done={complete(step)}
              detail={
                report.categories.find((category) => category.id === step)?.detail ?? ""
              }
              onNavigate={() => onNavigate(STEP_VIEW[step])}
            />
          )}

          {/* --- Gezinme --- */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Button
              icon={ArrowLeft}
              disabled={index === 0}
              onClick={() => setStep(STEP_ORDER[Math.max(0, index - 1)])}
            >
              Geri
            </Button>

            {index < STEP_ORDER.length - 1 ? (
              <Button
                variant="primary"
                icon={ArrowRight}
                onClick={() =>
                  setStep(STEP_ORDER[Math.min(STEP_ORDER.length - 1, index + 1)])
                }
              >
                Sonraki adım
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={Check}
                disabled={report.nextStep !== null}
                title={
                  report.nextStep === null
                    ? "Kurulumu tamamla"
                    : "Önce kalan adımları tamamlayın"
                }
                onClick={onFinish}
              >
                Kurulumu tamamla
              </Button>
            )}
          </div>
        </div>

        <aside className="min-w-0">
          <ReadinessCard
            report={report}
            onContinue={(view) => onNavigate(view)}
            viewOf={(id) => STEP_VIEW[id as SetupStepId] ?? "dashboard"}
          />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>
      )}
    </label>
  );
}

/** 1. adım — şirket bilgileri ve logo. */
function CompanyStep({
  company,
  onChange,
}: {
  company: CompanyProfile | null;
  onChange: (company: CompanyProfile) => void;
}) {
  const current: CompanyProfile = company ?? {
    name: "",
    logoDataUrl: readLogo(),
    sector: "",
    factoryCount: null,
    currency: "TRY",
  };
  const [logoError, setLogoError] = useState<string | null>(null);

  const patch = (values: Partial<CompanyProfile>): void =>
    onChange({ ...current, ...values });

  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Building2 className="h-4 w-4 text-slate-400" />
        Şirket bilgileri
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Şirket adı">
          <input
            type="text"
            value={current.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Sektör">
          <select
            value={current.sector}
            onChange={(event) => patch({ sector: event.target.value })}
            className={inputClass}
          >
            <option value="">Seçilmedi</option>
            <option value="metal">Metal</option>
            <option value="gida">Gıda</option>
            <option value="tekstil">Tekstil</option>
            <option value="plastik">Plastik</option>
            <option value="genel">Genel</option>
          </select>
        </Field>

        <Field label="Fabrika sayısı">
          <input
            type="number"
            min={1}
            value={current.factoryCount ?? ""}
            onChange={(event) =>
              patch({
                factoryCount: event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className={inputClass}
          />
        </Field>

        <Field label="Para birimi" hint="Raporlardaki tutarlar bu birimle yazılır.">
          <select
            value={current.currency}
            onChange={(event) => patch({ currency: event.target.value })}
            className={inputClass}
          >
            <option value="TRY">TRY — Türk lirası</option>
            <option value="EUR">EUR — Euro</option>
            <option value="USD">USD — Dolar</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {current.logoDataUrl !== null && (
          <img
            src={current.logoDataUrl}
            alt="Şirket logosu"
            className="h-10 w-auto rounded-lg border border-slate-200 bg-white p-1"
          />
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors duration-200 hover:border-brand-400">
          <ImageUp className="h-4 w-4" />
          Logo yükle
          <input
            type="file"
            accept={ACCEPTED_LOGO_TYPES.join(",")}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) {
                return;
              }
              const error = validateLogo(file);
              if (error !== null) {
                setLogoError(error);
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = String(reader.result);
                saveLogo(dataUrl);
                setLogoError(null);
                patch({ logoDataUrl: dataUrl });
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {logoError !== null && (
          <span className="text-[11px] text-red-600">{logoError}</span>
        )}
      </div>
    </Card>
  );
}

/** 2. adım — fabrika bilgileri. */
function FactoryStep({
  factories,
  onChange,
  onOpenFactories,
}: {
  factories: FactoryProfile[];
  onChange: (factories: FactoryProfile[]) => void;
  onOpenFactories: () => void;
}) {
  /*
   * Yeni fabrikanın kimliği bir kez üretilir. Render sırasında `Date.now()`
   * okunsaydı her çizimde başka bir kimlik çıkar, kullanıcı yazarken kayıt
   * kendini yeni bir fabrika sanardı.
   */
  const [draftId] = useState(() => `fab-${Date.now().toString(36)}`);
  const current: FactoryProfile = factories[0] ?? {
    id: draftId,
    name: "",
    location: "",
    lineCount: null,
    shiftsPerDay: null,
    shiftHours: null,
  };

  const patch = (values: Partial<FactoryProfile>): void =>
    onChange([{ ...current, ...values }, ...factories.slice(1)]);

  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <FactoryIcon className="h-4 w-4 text-slate-400" />
        Fabrika oluştur
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Fabrika adı">
          <input
            type="text"
            value={current.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Lokasyon">
          <input
            type="text"
            value={current.location}
            onChange={(event) => patch({ location: event.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Hat sayısı">
          <input
            type="number"
            min={1}
            value={current.lineCount ?? ""}
            onChange={(event) =>
              patch({
                lineCount: event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className={inputClass}
          />
        </Field>

        <Field label="Günlük vardiya">
          <input
            type="number"
            min={1}
            max={3}
            value={current.shiftsPerDay ?? ""}
            onChange={(event) =>
              patch({
                shiftsPerDay:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className={inputClass}
          />
        </Field>

        <Field label="Vardiya süresi (saat)">
          <input
            type="number"
            min={1}
            max={12}
            value={current.shiftHours ?? ""}
            onChange={(event) =>
              patch({
                shiftHours: event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className={inputClass}
          />
        </Field>
      </div>

      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        Bu bilgiler kurulum kaydında tutulur. Adım, fabrika sunucuya
        kaydedildiğinde tamamlanmış sayılır.
      </p>

      <Button className="mt-3" size="sm" icon={ExternalLink} onClick={onOpenFactories}>
        Fabrikalar ekranını aç
      </Button>
    </Card>
  );
}

/**
 * Ürünün başka ekranında yapılan adımlar.
 *
 * Burada iş yapılmaz; kullanıcı doğru ekrana gönderilir. Dönüşte adım,
 * hazırlık raporu üzerinden kendiliğinden tamamlanmış görünür.
 */
function HandoffStep({
  step,
  done,
  detail,
  onNavigate,
}: {
  step: SetupStepId;
  done: boolean;
  detail: string;
  onNavigate: () => void;
}) {
  const Icon = STEP_ICON[step];

  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Icon className="h-4 w-4 text-slate-400" />
        {STEP_LABEL[step]}
      </h3>

      <p className="mt-2 text-sm text-slate-600">{detail}</p>

      {done ? (
        <p className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${BAND_STYLE.green.chip}`}>
          <Check className="h-3.5 w-3.5" />
          Bu adım tamamlandı
        </p>
      ) : (
        <Button className="mt-3" variant="primary" icon={ExternalLink} onClick={onNavigate}>
          {STEP_LABEL[step]} ekranına git
        </Button>
      )}

      {step === "connectors" && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Bu sürümde veri kaynakları <strong>benzetimle</strong> çalışır; gerçek bir
          PLC, MQTT broker ya da MES ucuna bağlanılmaz.
        </p>
      )}

      {(step === "machines" || step === "report") && null}
    </Card>
  );
}
