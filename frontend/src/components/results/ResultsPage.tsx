/**
 * Sayfa 6 — Sonuç görselleştirme.
 *
 * Üç bölümü birleştirir: özet kartları (A), istasyon tablosu ve kullanım
 * grafiği (B), doğrulama paneli (C). Sıralama, kullanıcının sorularının doğal
 * sırasını izler: "ne kadar üretiyorum?" → "nerede tıkanıyorum?" → "bu
 * sayılara neden güveneyim?".
 *
 * `ResultsPlaceholder.tsx` bu bileşenle tamamen değiştirilmiştir.
 */

import type { SimulationConfig, SimulationRunResponse } from "../../types/simulationTypes";
import { formatDecimal, formatUnits } from "../../lib/resultsFormatting";
import { ArrowLeftIcon, ArrowRightIcon } from "../shared/icons";
import { SummaryCards } from "./SummaryCards";
import { StationMetricsTable } from "./StationMetricsTable";
import { ValidationPanel } from "./ValidationPanel";
import { UtilizationBarChart } from "./charts/UtilizationBarChart";

interface ResultsPageProps {
  result: SimulationRunResponse;
  config: SimulationConfig;
  onBackToEditor: () => void;
  onStartOver: () => void;
  /** Bu senaryoyu karşılaştırma referansı yapıp editöre döner. */
  onCompareFromHere: () => void;
  /** Referans senaryo varsa karşılaştırma görünümünü açar. */
  onOpenComparison?: () => void;
  /** Karşılaştırma için saklanmış referans senaryonun etiketi. */
  baselineLabel?: string | null;
}

export function ResultsPage({
  result,
  config,
  onBackToEditor,
  onStartOver,
  onCompareFromHere,
  onOpenComparison,
  baselineLabel,
}: ResultsPageProps) {
  const { results } = result;
  const bottleneck = results.station_metrics.find((station) => station.is_bottleneck);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Simülasyon sonucu</h1>
          <p className="mt-1 text-sm text-slate-600">
            {config.stations.length} istasyon · {results.num_replications} kez
            tekrarlandı · {formatDecimal(result.duration_seconds, 1)} saniyede
            tamamlandı
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToEditor}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Modeli düzenle
        </button>
      </header>

      {/* --- Bölüm A --- */}
      <SummaryCards results={results} />

      {/* Tek cümlelik yorum: sayıları okumadan önce ne anlama geldiklerini
          söyler. Darboğaz bilgisi kullanıcının en çok işine yarayan tek şeydir. */}
      {bottleneck && (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-relaxed text-slate-700">
          Hattınızın çıktısını{" "}
          <strong className="font-semibold text-slate-900">
            {bottleneck.station_name}
          </strong>{" "}
          belirliyor. Bu istasyon zamanının %
          {Math.round(bottleneck.utilization * 100)}'ini işlem yaparak geçiriyor.
          Üretimi artırmak için önce buraya kapasite eklemelisiniz — diğer
          istasyonları hızlandırmak toplam çıktıyı değiştirmez.
        </p>
      )}

      {/* --- Bölüm B --- */}
      <section className="mt-8 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">İstasyonlar</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Her istasyonun ne kadar dolu olduğu ve nerede beklemeler oluştuğu.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Doluluk karşılaştırması
          </h3>
          <UtilizationBarChart stations={results.station_metrics} />
        </div>

        <StationMetricsTable
          stations={results.station_metrics}
          bottleneckStationId={results.bottleneck_station_id}
        />
      </section>

      {/* --- Bölüm C --- */}
      <section className="mt-8">
        <ValidationPanel
          simulationId={result.simulation_id}
          warnings={result.warnings}
        />
      </section>

      {/* --- Bölüm D'ye giriş --- */}
      <section className="mt-8 rounded-xl border border-brand-200 bg-brand-50 px-5 py-5">
        {baselineLabel && onOpenComparison ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-950">
                Karşılaştırmaya hazır
              </p>
              <p className="mt-0.5 text-sm text-brand-900">
                “{baselineLabel}” senaryosu referans olarak saklandı. İki senaryoyu
                yan yana görebilirsiniz.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenComparison}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Senaryoları Karşılaştır
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-950">
                Bir değişikliğin işe yarayıp yaramadığını ölçün
              </p>
              <p className="mt-0.5 max-w-xl text-sm text-brand-900">
                Bu senaryoyu referans olarak saklayın, modelde bir değişiklik yapıp
                tekrar çalıştırın. Aradaki farkın gerçek mi yoksa rastgelelik mi
                olduğunu size söyleyeceğiz.
              </p>
            </div>
            <button
              type="button"
              onClick={onCompareFromHere}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Bu Senaryoyu Kopyala ve Karşılaştır
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-slate-500">
        Beklenen üretim {formatUnits(results.total_throughput)} birim ·{" "}
        <button
          type="button"
          onClick={onStartOver}
          className="font-medium text-slate-500 underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
        >
          Yeni bir model kur
        </button>
      </p>
    </div>
  );
}
