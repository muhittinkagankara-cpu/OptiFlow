/**
 * Canlı Üretim — akış animasyonu ve yanındaki durum paneli.
 *
 * Animasyonun kendisi `FactoryAnimation` bileşenidir ve **değiştirilmemiştir**;
 * burada yalnızca her zaman açık doğacak biçimde kullanılır ve yanına hattın o
 * anki durumunu okuyan bir panel konur. Animasyonu yeniden yazmak, iyi
 * çalışan bir zaman çizelgesi mantığını (`animationTimeline.ts`) gereksiz
 * riske atmak olurdu.
 *
 * Sağ paneldeki sayılar koşum metriklerinden **okunur**, yeniden hesaplanmaz:
 * throughput, kuyruk uzunluğu ve darboğaz zaten simülasyonun döndürdüğü
 * alanlardır.
 */

import { Activity, Gauge, Layers, Radio, TriangleAlert } from "lucide-react";
import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import { formatDecimal, formatUnits } from "../../lib/resultsFormatting";
import { bottleneckSummary } from "../../lib/dashboardMetrics";
import { FactoryAnimation } from "../results/FactoryAnimation";
import { Badge, Card, EmptyState, MetricRow, ProgressBar } from "../ui/Primitives";

interface LivePageProps {
  simulationId: string | null;
  config: SimulationConfig | null;
  results: SimulationResults | null;
  onStartSimulation: () => void;
}

export function LivePage({
  simulationId,
  config,
  results,
  onStartSimulation,
}: LivePageProps) {
  if (!simulationId || !config || !results) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Radio}
          title="İzlenecek bir koşum yok"
          description="Canlı akış, kaydedilmiş bir simülasyon koşumunun izinden üretilir. Bir model çalıştırdığınızda parçaların hat boyunca ilerleyişini buradan izleyebilirsiniz."
          action={
            <button
              type="button"
              onClick={onStartSimulation}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none"
            >
              Simülasyona git
            </button>
          }
        />
      </div>
    );
  }

  const bottleneck = bottleneckSummary(results);
  const busiest = [...results.station_metrics].sort(
    (left, right) => right.avg_queue_length - left.avg_queue_length,
  )[0];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            Canlı Üretim
            <span className="relative inline-flex h-2 w-2 text-emerald-500">
              <span className="optiflow-live-dot absolute inset-0 rounded-full bg-current" />
              <span className="relative h-2 w-2 rounded-full bg-current" />
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Kaydedilmiş koşumun izi üzerinden parça akışı.
          </p>
        </div>
        <Badge tone={results.is_stable ? "good" : "bad"}>
          {results.is_stable ? "Hat kararlı" : "Hat kararsız"}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Sahne */}
        <div className="min-w-0">
          <FactoryAnimation
            simulationId={simulationId}
            config={config}
            bottleneckStationId={results.bottleneck_station_id}
            defaultOpen
            hideHeader
          />
        </div>

        {/* Durum paneli */}
        <div className="space-y-4">
          <Card className="p-4" index={0}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Activity className="h-4 w-4 text-slate-500" />
              Durum
            </h3>
            <MetricRow
              label="Hat durumu"
              value={
                <span
                  className={
                    results.is_stable ? "text-emerald-700" : "text-red-700"
                  }
                >
                  {results.is_stable ? "Kararlı" : "Kararsız"}
                </span>
              }
              hint="Kuyruklar sınırsız büyümüyorsa hat kararlıdır."
            />
            <MetricRow
              label="Tekrar sayısı"
              value={results.num_replications}
              hint="Sonuç bu kadar bağımsız koşumun ortalamasıdır."
            />
            <MetricRow
              label="Ortalama akış süresi"
              value={`${formatDecimal(results.avg_flow_time, 1)} dk`}
            />
            <MetricRow
              label="Ortalama WIP"
              value={formatDecimal(results.avg_wip, 1)}
              hint="Hatta aynı anda bulunan ortalama parça sayısı."
            />
          </Card>

          <Card className="p-4" index={1}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Gauge className="h-4 w-4 text-slate-500" />
              Throughput
            </h3>
            <p className="text-2xl font-semibold text-slate-900 tabular-nums">
              {formatDecimal(results.throughput_per_minute, 2)}
              <span className="ml-1.5 text-sm font-normal text-slate-500">
                birim/dk
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Toplam {formatUnits(results.total_throughput)} birim ·{" "}
              %{Math.round(results.line_oee * 100)} OEE
            </p>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                <span>Teorik kapasite payı</span>
                <span className="tabular-nums">
                  %
                  {Math.round(
                    (results.throughput_per_minute /
                      Math.max(
                        results.theoretical_max_throughput_per_minute,
                        1e-9,
                      )) *
                      100,
                  )}
                </span>
              </div>
              <ProgressBar
                value={
                  results.throughput_per_minute /
                  Math.max(results.theoretical_max_throughput_per_minute, 1e-9)
                }
                tone="info"
              />
            </div>
          </Card>

          <Card className="p-4" index={2}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Layers className="h-4 w-4 text-slate-500" />
              Kuyruk
            </h3>
            {busiest ? (
              <>
                <p className="text-sm text-slate-500">En uzun kuyruk</p>
                <p className="mt-0.5 text-base font-semibold text-slate-900">
                  {busiest.station_name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ortalama {formatDecimal(busiest.avg_queue_length, 1)} parça ·{" "}
                  {formatDecimal(busiest.avg_wait_time, 1)} dk bekleme
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Kuyruk verisi yok.</p>
            )}
          </Card>

          <Card className="p-4" index={3}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <TriangleAlert className="h-4 w-4 text-slate-500" />
              Darboğaz
            </h3>
            {bottleneck ? (
              <>
                <p className="text-base font-semibold text-slate-900">
                  {bottleneck.name}
                </p>
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                    <span>Doluluk</span>
                    <span className="tabular-nums">
                      %{Math.round(bottleneck.utilization * 100)}
                    </span>
                  </div>
                  <ProgressBar
                    value={bottleneck.utilization}
                    tone={bottleneck.utilization >= 0.85 ? "bad" : "warning"}
                  />
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-slate-500">
                  Hattın çıktısını bu istasyon belirliyor. Kapasite eklemek için
                  önce buraya bakın.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Darboğaz belirlenemedi.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
