/**
 * Finansal Etki paneli — kayıpların parasal karşılığı.
 *
 * Sonuç sayfasının "nerede tıkanıyorum?" sorusunu "bu bana ne kadara mal
 * oluyor?" sorusuna bağlar. Varsayılan olarak **kapalıdır** ve maliyet
 * oranları girilmeden hiçbir rakam göstermez: uydurulmuş oranlarla üretilen
 * bir kayıp rakamı, hiç rakam göstermemekten kötüdür — kullanıcı onu kendi
 * verisi sanır.
 *
 * Şeffaflık paneli taşıyan asıl fikirdir. Her kalem, tutarının nereden
 * geldiğini yanında taşır (Ölçüldü / Hesaplandı / Tahmin) ve eksik bir
 * maliyet oranı **sıfır olarak gösterilmez**; o kalem "hesaplanamadı" diye
 * işaretlenir. Aksi hâlde hiç oran girmemiş bir kullanıcı "toplam kaybınız
 * ₺0" yanıtını alır ve bunu iyi haber sanardı.
 */

import { useCallback, useState } from "react";
import type {
  FinancialReport,
  FinancialSettings,
  LossComponent,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import { ApiError, getFinancialImpact } from "../../lib/apiClient";
import { FactoryHeatmap } from "../heatmap/FactoryHeatmap";
import { HeatLegend } from "../heatmap/HeatLegend";
import { TopLossStations } from "../heatmap/TopLossStations";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  confidenceLabel,
  confidenceTone,
  formatMoney,
  provenanceHint,
  provenanceLabel,
  provenanceTone,
  rateLabel,
  shareOfTotal,
} from "../../lib/financeFormatting";
import type { Tone } from "../../lib/resultsFormatting";
import { Field, NumberField } from "../shared/FormControls";
import { WarningIcon } from "../shared/icons";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

const TONE_BADGE: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

/** Vardiya süresi hazır seçenekleri — envanter modülüyle aynı değerler. */
const SHIFT_PRESETS = [
  { label: "Tek vardiya (480 dk)", value: 480 },
  { label: "Çift vardiya (960 dk)", value: 960 },
  { label: "Kesintisiz (1440 dk)", value: 1440 },
];

interface FinancialImpactPanelProps {
  result: SimulationRunResponse;
  config: SimulationConfig;
}

export function FinancialImpactPanel({ result, config }: FinancialImpactPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<FinancialSettings>({});
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const update = useCallback((patch: Partial<FinancialSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const calculate = useCallback(async () => {
    setIsLoading(true);
    setErrors([]);
    try {
      setReport(await getFinancialImpact(result.simulation_id, settings));
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, [result.simulation_id, settings]);

  // En az bir oran girilmeden hesap anlamsizdir: tum kalemler
  // "hesaplanamadi" doner ve kullanici bos bir tablo gorur.
  const hasAnyRate = Object.entries(settings).some(
    ([key, value]) =>
      key !== "production_minutes_per_day" && typeof value === "number",
  );

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Finansal Etki
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Kayıplarınızın parasal karşılığı. Maliyet oranlarınızı girin.
          </span>
        </span>
        <span className="text-sm text-slate-400">{isOpen ? "Gizle" : "Göster"}</span>
      </button>

      {isOpen && (
        <div className="border-t border-slate-200 px-5 py-5">
          <SettingsForm settings={settings} onChange={update} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void calculate()}
              disabled={isLoading || !hasAnyRate}
              title={hasAnyRate ? undefined : "En az bir maliyet oranı girin"}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
            >
              {isLoading && <Spinner />}
              Kaybı hesapla
            </button>
            {!hasAnyRate && (
              <span className="text-xs text-slate-500">
                Oranlar girilmeden rakam gösterilmez.
              </span>
            )}
          </div>

          {errors.length > 0 && (
            <ul className="mt-4 list-inside list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}

          {report && <ReportView report={report} config={config} />}
        </div>
      )}
    </section>
  );
}

/** Maliyet oranları formu. */
function SettingsForm({
  settings,
  onChange,
}: {
  settings: FinancialSettings;
  onChange: (patch: Partial<FinancialSettings>) => void;
}) {
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Birim katkı payı" hint="Satış fiyatı eksi değişken maliyet. Fırsat kaybı bununla hesaplanır — ciroyla değil.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.contribution_margin ?? Number.NaN}
              onChange={(value) => onChange({ contribution_margin: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik makine maliyeti" hint="Arıza süresinin maliyeti bununla hesaplanır.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.machine_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ machine_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik işçilik maliyeti" hint="Bloke (bekleme) süresinin maliyeti bununla hesaplanır.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.labor_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ labor_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Birim fire maliyeti" hint="Hurdaya ayrılan her parçanın maliyeti.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.scrap_cost_per_unit ?? Number.NaN}
              onChange={(value) => onChange({ scrap_cost_per_unit: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Satış fiyatı" hint="Kayıt için tutulur; kayıp hesabına girmez.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.selling_price ?? Number.NaN}
              onChange={(value) => onChange({ selling_price: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
        <Field label="Saatlik fazla mesai maliyeti" hint="Kaybı telafi etmenin maliyetini kıyaslamak için; kayıp hesabına girmez.">
          {(id) => (
            <NumberField
              id={id}
              value={settings.overtime_cost_per_hour ?? Number.NaN}
              onChange={(value) => onChange({ overtime_cost_per_hour: value })}
              min={0}
              step="any"
            />
          )}
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">
          Günde kaç dakika üretim yapıyorsunuz?
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Günlük kayıp projeksiyonu için gerekli. Girilmezse günlük rakam
          gösterilmez — uydurulmuş bir vardiya süresiyle hesaplanan rakam
          yanıltıcı olurdu.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SHIFT_PRESETS.map((preset) => {
            const isActive = settings.production_minutes_per_day === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  onChange({
                    production_minutes_per_day: isActive ? null : preset.value,
                  })
                }
                aria-pressed={isActive}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  isActive
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-700 hover:border-brand-300"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Hesaplanmış raporun görünümü. */
function ReportView({
  report,
  config,
}: {
  report: FinancialReport;
  config: SimulationConfig;
}) {
  const { impact } = report;
  const [focusedId, setFocusedId] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-6">
      {/* --- Isı haritası: "param nerede yanıyor?" tek ekranda --- */}
      {report.heat.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">Isı haritası</h4>
          <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
            <FactoryHeatmap
              config={config}
              heat={report.heat}
              focusedId={focusedId}
              onFocus={setFocusedId}
            />
            <div className="space-y-3">
              <HeatLegend isRelative={report.heat.some((item) => item.is_relative)} />
              <TopLossStations
                stations={report.top_loss_stations}
                focusedId={focusedId}
                onFocus={setFocusedId}
              />
            </div>
          </div>
        </div>
      )}
      {/* --- Başlık kartları --- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <HeadlineCard
          label="Bugünkü tahmini kayıp"
          value={
            report.daily_loss === null || report.daily_loss === undefined
              ? null
              : formatMoney(report.daily_loss)
          }
          fallback="Günlük üretim süresi girilmedi"
          hint={`${report.window_minutes.toLocaleString("tr-TR")} dakikalık pencereden ölçeklendi.`}
        />
        <HeadlineCard
          label="Kurtarılabilir kayıp"
          value={formatMoney(report.recoverable_loss)}
          hint="Bilinen bir eylemin doğrudan hedefleyebileceği tutar. Fire buna dâhil değildir."
        />
        <HeadlineCard
          label="Pencere toplamı"
          value={formatMoney(impact.total_loss)}
          hint="Simülasyon penceresindeki toplam kayıp."
          badge={{
            text: `Güven: ${confidenceLabel(impact.confidence)}`,
            tone: confidenceTone(impact.confidence),
          }}
        />
      </div>

      {/* --- Eksik oran uyarısı --- */}
      {impact.missing_inputs.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">
              Bazı kalemler hesaplanamadı; toplam gerçek kaybın altındadır.
            </p>
            <p className="mt-1">
              Eksik oranlar: {impact.missing_inputs.map(rateLabel).join(", ")}.
            </p>
          </div>
        </div>
      )}

      {/* --- Kalem dökümü --- */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Kayıp kalemleri</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <Th>Kalem</Th>
                <Th>Tutar</Th>
                <Th>Pay</Th>
                <Th>Kaynak</Th>
                <Th>Dayanak</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {impact.components.map((component) => (
                <ComponentRow
                  key={component.name}
                  component={component}
                  total={impact.total_loss}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Notlar --- */}
      {impact.notes.length > 0 && (
        <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {impact.notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}

      {/* --- İstasyon bazlı --- */}
      {report.stations.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">
            İstasyon bazlı kayıplar
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <Th>İstasyon</Th>
                  <Th>Arıza</Th>
                  <Th>Bekleme</Th>
                  <Th>Fire</Th>
                  <Th>Fırsat</Th>
                  <Th>Toplam</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.stations.map((station) => (
                  <tr key={station.station_id}>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {station.station_name}
                      </span>
                      {station.is_bottleneck && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          darboğaz
                        </span>
                      )}
                    </Td>
                    <Td numeric>{formatMoney(station.downtime_loss)}</Td>
                    <Td numeric>{formatMoney(station.waiting_loss)}</Td>
                    <Td numeric>{formatMoney(station.scrap_loss)}</Td>
                    <Td numeric>{formatMoney(station.opportunity_loss)}</Td>
                    <Td numeric>
                      <span className="font-semibold text-slate-900">
                        {formatMoney(station.total_loss)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- En yüksek ROI önerisi --- */}
      {report.suggestions.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">
            En yüksek getirili iyileştirme
          </h4>
          <div className="space-y-2">
            {report.suggestions.map((suggestion, index) => (
              <div
                key={suggestion.station_id}
                className={`rounded-lg border px-4 py-3 ${
                  index === 0
                    ? "border-brand-300 bg-brand-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {suggestion.station_name}
                  </span>
                  <span className="text-sm font-semibold text-brand-700">
                    {formatMoney(suggestion.recoverable_amount)} hedefleniyor
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{suggestion.rationale}</p>
                <p className="mt-2 text-sm text-slate-800">{suggestion.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HeadlineCard({
  label,
  value,
  hint,
  fallback,
  badge,
}: {
  label: string;
  value: string | null;
  hint: string;
  fallback?: string;
  badge?: { text: string; tone: Tone };
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </p>
        {badge && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_BADGE[badge.tone]}`}
          >
            {badge.text}
          </span>
        )}
      </div>
      {value === null ? (
        <p className="mt-1 text-sm text-slate-400">{fallback}</p>
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {value}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function ComponentRow({
  component,
  total,
}: {
  component: LossComponent;
  total: number;
}) {
  const tone = provenanceTone(component.provenance);
  const share = shareOfTotal(component.amount, total);

  return (
    <tr className={component.is_available ? "" : "bg-slate-50"}>
      <Td>
        <span className="font-medium text-slate-900">{component.label}</span>
      </Td>
      <Td numeric>
        {component.is_available ? (
          formatMoney(component.amount)
        ) : (
          <span className="text-xs text-slate-400">hesaplanamadı</span>
        )}
      </Td>
      <Td numeric>
        {component.is_available ? (
          <span className="text-slate-600">%{share.toFixed(0)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Td>
      <Td>
        {/* Renk tek basina bilgi tasimaz: rozet her zaman yazi da icerir. */}
        <span
          title={provenanceHint(component.provenance)}
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_BADGE[tone]}`}
        >
          {provenanceLabel(component.provenance)}
        </span>
      </Td>
      <Td>
        <span className="text-xs text-slate-500">{component.basis}</span>
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
      {children}
    </th>
  );
}

function Td({
  children,
  numeric = false,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <td className={`px-3 py-2.5 align-middle ${numeric ? "tabular-nums" : ""}`}>
      {children}
    </td>
  );
}
