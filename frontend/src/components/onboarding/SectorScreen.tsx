/**
 * Ekran 2 — Sektör seçimi.
 *
 * Solda kartlar, sağda seçime göre değişen canlı önizleme. Önizleme,
 * kullanıcının "bu şablon bana uyar mı?" sorusunu **seçmeden önce**
 * yanıtlamasını sağlar; tek başına kart başlıkları bunu yapamaz.
 *
 * Önizlemedeki kapasite bir **tahmindir** ve öyle etiketlenir: şablonun en
 * yavaş istasyonundan türetilen kaba bir üst sınırdır, kuyruk ve arıza hesaba
 * katılmaz. Gerçek çıktı yalnızca simülasyondan gelir; ikisi aynı görünürse
 * kullanıcı hiç çalıştırmadığı bir modelin sonucunu ölçülmüş sanır.
 */

import {
  ArrowRight,
  Boxes,
  Check,
  CircleDashed,
  Cog,
  Shirt,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { SimulationConfig } from "../../types/simulationTypes";
import {
  SECTORS,
  previewOf,
  sectorById,
  type SectorIconName,
  type SectorId,
} from "../../lib/onboarding";
import { formatDecimal } from "../../lib/resultsFormatting";

/** Katalogdaki simge adlarının gerçek bileşen karşılığı. */
const ICONS: Record<SectorIconName, LucideIcon> = {
  metal: Cog,
  food: UtensilsCrossed,
  textile: Shirt,
  plastic: Boxes,
  generic: CircleDashed,
};

interface SectorScreenProps {
  selected: SectorId | null;
  onSelect: (id: SectorId) => void;
  /** Seçili sektörün şablonu; önizleme bundan türetilir. */
  selectedConfig: SimulationConfig | null;
  onContinue: () => void;
  onBack: () => void;
}

export function SectorScreen({
  selected,
  onSelect,
  selectedConfig,
  onContinue,
  onBack,
}: SectorScreenProps) {
  const sector = sectorById(selected);
  const preview = previewOf(selectedConfig);

  return (
    <div className="relative min-h-full overflow-hidden">
      <div className="optiflow-aurora" />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <header className="optiflow-enter mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Hangi tür üretim yapıyorsunuz?
          </h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Size en yakın örneği seçin; hazır bir model yükleyelim. Sonraki
            adımda istasyonları şema üzerinde görecek, kendi rakamlarınıza göre
            düzenleyeceksiniz.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* -- Kartlar -- */}
          <div className="grid gap-3 sm:grid-cols-2">
            {SECTORS.map((option, index) => {
              const Icon = ICONS[option.icon];
              const isSelected = option.id === selected;

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${option.title} — ${option.description}`}
                  onClick={() => onSelect(option.id)}
                  style={{ animationDelay: `${index * 55}ms` }}
                  className={`optiflow-enter optiflow-lift optiflow-glass group relative min-h-[8.5rem] rounded-xl border-2 p-5 text-left focus:outline-none ${
                    isSelected
                      ? "border-brand-500"
                      : "border-slate-200 hover:border-brand-300"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}

                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors duration-200 ${
                      isSelected
                        ? "optiflow-icon-pulse bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-500 group-hover:bg-brand-600/15 group-hover:text-brand-700"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>

                  <span className="mt-3.5 block text-base font-semibold text-slate-900">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          {/* -- Canlı önizleme -- */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="optiflow-glass optiflow-enter rounded-xl border border-slate-200 p-5">
              <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                Önizleme
              </p>

              {!sector ? (
                <div className="py-10 text-center">
                  <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <CircleDashed className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-slate-500">
                    Bir sektör seçin; hattın özeti burada belirir.
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="mt-1.5 text-lg font-semibold text-slate-900">
                    {sector.title}
                  </h2>

                  {sector.stages.length > 0 ? (
                    <ol className="mt-4 space-y-1.5">
                      {sector.stages.map((stage, index) => (
                        <li
                          key={stage}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-600/15 text-[10px] font-bold text-brand-700">
                            {index + 1}
                          </span>
                          {stage}
                          {index < sector.stages.length - 1 && (
                            <ArrowRight className="ml-auto h-3 w-3 text-slate-400" />
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
                      Boş bir şemayla başlarsınız; istasyonları editörde tek tek
                      eklersiniz.
                    </p>
                  )}

                  <dl className="mt-5 space-y-2 border-t border-slate-200 pt-4">
                    <Row label="İstasyon" value={String(preview.stationCount)} />
                    <Row label="Bağlantı" value={String(preview.connectionCount)} />
                    <Row
                      label="Kaba darboğaz"
                      value={preview.slowestStation ?? "—"}
                    />
                    <Row
                      label="Tahmini kapasite"
                      value={
                        preview.roughCapacityPerHour === null
                          ? "—"
                          : `${formatDecimal(preview.roughCapacityPerHour, 0)}/saat`
                      }
                    />
                  </dl>

                  {preview.roughCapacityPerHour !== null && (
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                      Kapasite, en yavaş istasyondan türetilen kaba bir üst
                      sınırdır. Kuyruk, arıza ve fire hesaba katılmaz — gerçek
                      çıktıyı simülasyon ölçer.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onBack}
                className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:text-slate-900 focus:outline-none"
              >
                Geri
              </button>
              <button
                type="button"
                onClick={onContinue}
                disabled={!sector}
                title={sector ? undefined : "Devam etmek için bir sektör seçin"}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                Devam
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
