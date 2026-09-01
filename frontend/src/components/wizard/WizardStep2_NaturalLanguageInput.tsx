/**
 * Adım 2/3 — Süreci anlatma ve modeli düzenleme.
 *
 * İki yol sunulur. Üstte, süreci kendi cümlelerinizle anlatıp modeli otomatik
 * kurduran alan; bu özellik henüz hazır olmadığı için düğme "Yakında" olarak
 * devre dışı gösterilir. Altta ise modelin form alanlarıyla düzenlenebildiği
 * bölüm bulunur.
 *
 * Alttaki düzenleme bölümü olmadan sihirbaz yarım kalırdı: otomatik kurulum
 * gelene kadar kullanıcının modeli kendi rakamlarına uyarlayabilmesi gerekir.
 * Bu yüzden asıl işlevsel yol odur; metin alanı ise gelecekteki özelliğin
 * yerini tutar ve kullanıcıdan girdi toplar.
 */

import type { SimulationConfig, Station } from "../../types/simulationTypes";
import { DistributionEditor } from "../shared/DistributionEditor";
import { Field, NumberField, TextField } from "../shared/FormControls";
import { PlusIcon, TrashIcon, WarningIcon } from "../shared/icons";
import {
  createBlankConfig,
  createDefaultStation,
  meanServiceTime,
  relinkLinearChain,
} from "../../lib/configDefaults";
import { useWizard } from "./WizardContext";

const PLACEHOLDER = `Örnek: Kesim istasyonunda 2 makine var, her biri ortalama 3 dakikada bir parça kesiyor. Dikiş hattında 5 operatör var, bir parça ortalama 6 dakika sürüyor. Son olarak tek kişilik kalite kontrol var, ortalama 2 dakika.

Fabrikaya ortalama 2,5 dakikada bir yeni iş geliyor.`;

export function WizardStep2_NaturalLanguageInput() {
  const { config, updateConfig, description, setDescription } = useWizard();
  const current = config ?? createBlankConfig();

  const applyChange = (next: SimulationConfig) => {
    updateConfig(relinkLinearChain(next));
  };

  const updateStation = (index: number, changes: Partial<Station>) => {
    const stations = current.stations.map((station, position) =>
      position === index ? { ...station, ...changes } : station,
    );
    applyChange({ ...current, stations });
  };

  const addStation = () => {
    const station = createDefaultStation(current.stations.map((item) => item.id));
    applyChange({ ...current, stations: [...current.stations, station] });
  };

  const removeStation = (index: number) => {
    applyChange({
      ...current,
      stations: current.stations.filter((_, position) => position !== index),
    });
  };

  const updateArrivalMean = (mean: number) => {
    applyChange({
      ...current,
      arrival_process: {
        ...current.arrival_process,
        distribution: { type: "exponential", params: { mean } },
      },
    });
  };

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold text-slate-900">
          Sürecinizi kendi rakamlarınıza göre ayarlayın
        </h2>
        <p className="text-sm text-slate-600">
          Aşağıdaki alanları kendi fabrikanıza göre düzenleyin. Emin olmadığınız
          değerleri şimdilik olduğu gibi bırakabilirsiniz — sonradan
          değiştirebilirsiniz.
        </p>
      </header>

      {/* --- Doğal dil ile kurulum (yakında) --- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Sürecinizi anlatın
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Yazdıklarınızdan modeli otomatik kuran özellik hazırlanıyor. Şimdilik
              buraya not alabilir, modeli aşağıdan elle düzenleyebilirsiniz.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
            Yakında
          </span>
        </div>

        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled
            title="Bu özellik henüz hazır değil"
            className="cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
          >
            Analiz Et
          </button>
          <span className="text-xs text-slate-500">
            Aşağıdaki alanlardan elle düzenleme her zaman çalışır.
          </span>
        </div>
      </section>

      {/* --- Parça girişi --- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">
          Fabrikaya ne sıklıkla iş geliyor?
        </h3>
        <p className="mb-4 text-xs text-slate-500">
          Ortalama olarak kaç dakikada bir yeni parça/sipariş hatta giriyor?
        </p>
        <div className="max-w-xs">
          <Field
            label="Ortalama giriş aralığı"
            help="İki parçanın hatta girişi arasında geçen ortalama süre. Örneğin 2,5 yazarsanız, saatte yaklaşık 24 parça girer. Gerçek aralıklar bu ortalama etrafında rastgele değişir."
          >
            {(id) => (
              <NumberField
                id={id}
                value={Number(current.arrival_process.distribution.params.mean ?? 5)}
                onChange={updateArrivalMean}
                min={0.1}
                step={0.1}
                suffix="dk"
              />
            )}
          </Field>
        </div>
      </section>

      {/* --- İstasyonlar --- */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              İş istasyonları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Parçalar bu istasyonlardan sırayla geçer.
            </p>
          </div>
          <button
            type="button"
            onClick={addStation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <PlusIcon className="h-4 w-4" />
            İstasyon Ekle
          </button>
        </div>

        {current.stations.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Henüz istasyon yok</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Devam edebilmek için en az bir iş istasyonu ekleyin. Örneğin
              “Kesim”, “Montaj” veya “Paketleme”.
            </p>
            <button
              type="button"
              onClick={addStation}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <PlusIcon className="h-4 w-4" />
              İlk istasyonu ekle
            </button>
          </div>
        )}

        {current.stations.map((station, index) => (
          <StationCard
            key={station.id}
            station={station}
            index={index}
            isLast={index === current.stations.length - 1}
            canRemove={current.stations.length > 1}
            onChange={(changes) => updateStation(index, changes)}
            onRemove={() => removeStation(index)}
          />
        ))}
      </section>
    </div>
  );
}

interface StationCardProps {
  station: Station;
  index: number;
  isLast: boolean;
  canRemove: boolean;
  onChange: (changes: Partial<Station>) => void;
  onRemove: () => void;
}

function StationCard({
  station,
  index,
  isLast,
  canRemove,
  onChange,
  onRemove,
}: StationCardProps) {
  const mean = meanServiceTime(station);
  const capacityPerHour = mean > 0 ? (station.num_servers / mean) * 60 : 0;

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${station.name} istasyonunu sil`}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="İstasyon adı">
          {(id) => (
            <TextField
              id={id}
              value={station.name}
              onChange={(name) => onChange({ name })}
              placeholder="Örn. Kesim"
            />
          )}
        </Field>

        <Field
          label="Kaç makine / operatör?"
          help="Bu istasyonda aynı anda kaç parça işlenebilir? Örneğin 5 dikiş makinesi varsa 5 yazın."
        >
          {(id) => (
            <NumberField
              id={id}
              value={station.num_servers}
              onChange={(value) => onChange({ num_servers: Math.max(1, Math.round(value)) })}
              min={1}
              step={1}
            />
          )}
        </Field>
      </div>

      <div className="mt-4">
        <DistributionEditor
          value={station.service_time_distribution}
          onChange={(service_time_distribution) => onChange({ service_time_distribution })}
          label="Bir parça ne kadar sürede işleniyor?"
        />
      </div>

      {capacityPerHour > 0 && (
        <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Bu istasyon saatte yaklaşık{" "}
          <strong className="font-semibold text-slate-800">
            {capacityPerHour.toFixed(0)} parça
          </strong>{" "}
          işleyebilir.
        </p>
      )}

      {mean <= 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <WarningIcon className="h-4 w-4 shrink-0" />
          İşlem süresi sıfır görünüyor. Lütfen geçerli bir süre girin.
        </p>
      )}

      {!isLast && (
        <div className="absolute -bottom-4 left-1/2 z-10 -translate-x-1/2 text-slate-300">
          ↓
        </div>
      )}
    </div>
  );
}
