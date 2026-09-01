/**
 * Adım 3/3 — Özet ve devam seçenekleri.
 *
 * Kullanıcı burada iki yol arasında seçim yapar: modeli görsel olarak düzenlemek
 * ya da doğrudan çalıştırmak. "Direkt Çalıştır" seçeneği bilinçli olarak öne
 * çıkarılmıştır — sihirbazın amacı kullanıcıyı iki dakikada bir sonuca
 * ulaştırmaktır ve editöre girmek zorunda bırakmak bu yolu uzatır.
 *
 * Özet kartı, simülasyonu beklemeden basit bir kapasite ön kontrolü de yapar.
 * Modelin tıkanacağı belliyse kullanıcı bunu sonuç ekranında değil burada
 * görmelidir; aksi hâlde bir dakika bekleyip anlamsız sayılarla karşılaşır.
 */

import { previewCapacity, interarrivalMean } from "../../lib/configDefaults";
import { DEFAULT_DEPTH } from "../../types/simulationTypes";
import { ArrowRightIcon, PlayIcon, WarningIcon } from "../shared/icons";
import { useWizard } from "./WizardContext";

interface WizardStep3Props {
  /** Modeli süreç editöründe açar. */
  onEdit: () => void;
  /** Varsayılan ayarlarla simülasyonu başlatır. */
  onRun: () => void;
  isRunning: boolean;
  /** Çalıştırma sırasında oluşan hata mesajları. */
  errors: string[];
}

export function WizardStep3_Confirmation({
  onEdit,
  onRun,
  isRunning,
  errors,
}: WizardStep3Props) {
  const { config } = useWizard();

  if (!config || config.stations.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Model henüz kurulmadı. Lütfen önceki adıma dönüp en az bir istasyon ekleyin.
      </p>
    );
  }

  const capacity = previewCapacity(config);
  const arrivalPerHour = capacity.arrivalRate * 60;
  const totalMachines = config.stations.reduce(
    (total, station) => total + station.num_servers,
    0,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold text-slate-900">Modeliniz hazır</h2>
        <p className="text-sm text-slate-600">
          Aşağıdaki özeti kontrol edin. İsterseniz modeli görsel olarak
          düzenleyebilir, isterseniz doğrudan çalıştırabilirsiniz.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryStat
              value={String(config.stations.length)}
              label={config.stations.length === 1 ? "istasyon" : "istasyon"}
            />
            <SummaryStat value={String(totalMachines)} label="makine / operatör" />
            <SummaryStat
              value={arrivalPerHour > 0 ? arrivalPerHour.toFixed(0) : "—"}
              label="saatlik iş girişi"
            />
          </div>
        </div>

        <ol className="divide-y divide-slate-100">
          {config.stations.map((station, index) => (
            <li key={station.id} className="flex items-center gap-4 px-6 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {station.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {station.num_servers} makine
                  {station.scrap_rate > 0 &&
                    ` · %${Math.round(station.scrap_rate * 100)} fire`}
                  {station.failure_rate != null && " · arıza modeli açık"}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 text-xs text-slate-600">
          Simülasyon ayarı:{" "}
          <strong className="font-semibold text-slate-800">{DEFAULT_DEPTH.label}</strong>{" "}
          — {DEFAULT_DEPTH.description} Ortalama{" "}
          {interarrivalMean(config).toFixed(1)} dakikada bir iş girişi varsayılıyor.
        </div>
      </div>

      {capacity.isOverloaded && capacity.bottleneck && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">
              “{capacity.bottleneck.station.name}” gelen işi yetiştiremeyebilir.
            </p>
            <p className="mt-1 text-amber-800">
              Bu istasyona hattın kapasitesinden fazla iş geliyor; kuyruk sürekli
              büyüyecektir. Yine de çalıştırabilirsiniz — sonuç ekranında ayrıntılı
              uyarı göreceksiniz. Düzeltmek için bu istasyona makine ekleyin ya da
              iş giriş sıklığını azaltın.
            </p>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="text-sm text-red-900">
            <p className="font-medium">Simülasyon başlatılamadı</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-red-800">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onEdit}
          disabled={isRunning}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
        >
          Modeli Düzenle
          <ArrowRightIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-brand-400"
        >
          {isRunning ? (
            <>
              <Spinner />
              Simülasyon çalışıyor…
            </>
          ) : (
            <>
              <PlayIcon className="h-4 w-4" />
              Direkt Çalıştır
            </>
          )}
        </button>
      </div>

      {isRunning && (
        <p className="text-center text-xs text-slate-500">
          Simülasyon çalışıyor, birkaç saniye sürebilir.
        </p>
      )}
    </div>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-semibold text-slate-900">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"
      />
    </svg>
  );
}
