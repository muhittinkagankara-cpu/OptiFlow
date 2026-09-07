/**
 * Adım 4 — Eksik bilgiler.
 *
 * Dosyada bulunmayan her alan burada **açıkça** sorulur. Varsayılanlar sessizce
 * uygulanmaz: kullanıcının hiç vermediği bir sayıyı ona kendi verisiymiş gibi
 * geri sunmak, ürünün geri kalanında da kaçınılan bir şeydir.
 *
 * Yalnızca gerçekten eksik olan alanlar gösterilir. Eşleştirilmiş bir alanı
 * burada tekrar sormak, kullanıcıya "verdiğin bilgi işe yaramadı" hissi
 * verirdi.
 */

import { Info } from "lucide-react";
import { INFINITE_CAPACITY } from "../../types/simulationTypes";
import type { DistributionType } from "../../types/simulationTypes";
import { DISTRIBUTION_LABELS } from "../../types/simulationTypes";
import type { ColumnMapping, ImportDefaults, OptiFlowField } from "../../lib/import";

interface MissingFieldsFormProps {
  /** Eşleştirilememiş model alanları. */
  missing: OptiFlowField[];
  mapping: ColumnMapping;
  defaults: ImportDefaults;
  onChange: (patch: Partial<ImportDefaults>) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function MissingFieldsForm({
  missing,
  mapping,
  defaults,
  onChange,
  onContinue,
  onBack,
}: MissingFieldsFormProps) {
  const missingIds = new Set(missing.map((field) => field.id));

  // Makine sayısı, "Operatör" kolonu eşleştirilmişse eksik sayılmaz: model
  // ikisini de aynı alandan besler (bkz. `buildFactoryFromRows`).
  const needsMachines =
    missingIds.has("machines") &&
    (mapping.operators === null || mapping.operators === undefined);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Birkaç bilgi eksik
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Dosyanızda bulunmayan alanlar için ne varsayalım? Hepsini sonradan
          editörde değiştirebilirsiniz.
        </p>
      </header>

      <div className="optiflow-glass optiflow-enter space-y-5 rounded-xl border border-slate-200 p-5">
        {needsMachines && (
          <NumberRow
            label="Makine sayısı"
            hint="Her istasyonda kaç paralel makine ya da operatör çalışıyor?"
            value={defaults.machines}
            min={1}
            step={1}
            onChange={(machines) => onChange({ machines })}
          />
        )}

        {missingIds.has("scrap") && (
          <NumberRow
            label="Hurda oranı"
            hint="İşlenen parçaların yüzde kaçı hurdaya ayrılıyor? Bilmiyorsanız 0 bırakın."
            value={defaults.scrapRate * 100}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            onChange={(percent) =>
              onChange({ scrapRate: Math.min(1, Math.max(0, percent / 100)) })
            }
          />
        )}

        {missingIds.has("buffer") && (
          <div>
            <p className="text-sm font-medium text-slate-800">
              Tampon kapasitesi
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              İstasyon önünde en fazla kaç parça bekleyebilir?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChange({ bufferCapacity: INFINITE_CAPACITY })}
                aria-pressed={defaults.bufferCapacity === INFINITE_CAPACITY}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus:outline-none ${
                  defaults.bufferCapacity === INFINITE_CAPACITY
                    ? "border-brand-400 bg-brand-600/12 text-brand-700"
                    : "border-slate-200 bg-slate-100 text-slate-700 hover:border-brand-300"
                }`}
              >
                Sınırsız
              </button>
              <input
                type="number"
                min={0}
                step={1}
                value={
                  defaults.bufferCapacity === INFINITE_CAPACITY
                    ? ""
                    : defaults.bufferCapacity
                }
                placeholder="ör. 20"
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  onChange({
                    bufferCapacity: Number.isFinite(raw) && raw >= 0 ? raw : INFINITE_CAPACITY,
                  });
                }}
                className="w-28 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-800 tabular-nums focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Dağılım tipi her zaman sorulur: Excel yalnızca bir ortalama taşır,
            değişkenlik bilgisi dosyada hiç yoktur. */}
        <div>
          <p className="text-sm font-medium text-slate-800">
            İşlem süresi nasıl değişiyor?
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Dosyanızda yalnızca ortalama süre var. Gerçek süreler bu ortalama
            etrafında nasıl dağılıyor?
          </p>
          <select
            value={defaults.distributionType}
            onChange={(event) =>
              onChange({ distributionType: event.target.value as DistributionType })
            }
            className="mt-2 w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none"
          >
            {(["normal", "constant", "triangular", "exponential"] as const).map(
              (type) => (
                <option key={type} value={type}>
                  {DISTRIBUTION_LABELS[type]}
                </option>
              ),
            )}
          </select>
          {defaults.distributionType === "normal" && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Standart sapma, ortalamanın onda biri varsayılır. Editörde her
              istasyon için ayrı ayrı değiştirebilirsiniz.
            </p>
          )}
        </div>

        <NumberRow
          label="Parçalar hatta ne sıklıkla giriyor?"
          hint="İki parçanın hatta girişi arasında geçen ortalama süre (dakika). Başlangıç değeri, en yavaş istasyonunuza göre önerildi."
          value={defaults.interarrivalMinutes}
          min={0.1}
          step={0.1}
          suffix="dk"
          onChange={(interarrivalMinutes) => onChange({ interarrivalMinutes })}
        />
      </div>

      <div className="mt-6 flex gap-2">
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
          className="flex-1 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none"
        >
          Önizlemeyi gör
        </button>
      </div>
    </div>
  );
}

function NumberRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
          {hint}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? value : ""}
            onChange={(event) => {
              const raw = Number(event.target.value);
              if (Number.isFinite(raw)) {
                onChange(raw);
              }
            }}
            className="w-32 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800 tabular-nums focus:border-brand-500 focus:outline-none"
          />
          {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
        </span>
      </label>
    </div>
  );
}
