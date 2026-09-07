/**
 * Adım 5 — Önizleme.
 *
 * Kullanıcı, hiçbir şey kaydedilmeden önce kurulacak fabrikayı görür. Şema
 * mevcut `buildFlowFromConfig` ile üretilir ve mevcut düğüm bileşenleri
 * (`StationNode`, `ArrivalNode`) yeniden kullanılır — editörle birebir aynı
 * görünüm, ikinci bir çizim koduna gerek kalmadan.
 *
 * Canvas **salt okunurdur**: burada amaç incelemektir, düzenlemek değil.
 * Düzenleme, fabrika oluşturulduktan sonra asıl editörde yapılır.
 *
 * Sağ paneldeki kapasite ve darboğaz **tahmindir** ve öyle etiketlenir: en
 * yavaş istasyondan türetilen kaba bir üst sınırdır, kuyruk ve arıza hesaba
 * katılmaz. Gerçek çıktıyı yalnızca simülasyon ölçer; ikisi aynı görünürse
 * kullanıcı hiç çalıştırmadığı bir modelin sonucunu ölçülmüş sanır.
 */

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
} from "reactflow";
import { Info, Layers, TriangleAlert, Workflow, Zap } from "lucide-react";
import type { SimulationConfig } from "../../types/simulationTypes";
import { buildFlowFromConfig } from "../../lib/configBuilder";
import { previewOf } from "../../lib/onboarding";
import { formatDecimal } from "../../lib/resultsFormatting";
import { ArrivalNode } from "../editor/nodes/ArrivalNode";
import { StationNode } from "../editor/nodes/StationNode";

interface ImportPreviewProps {
  config: SimulationConfig;
  /** Dosyadan okunan ve atlanan satır sayıları. */
  importedCount: number;
  skippedCount: number;
  onContinue: () => void;
  onBack: () => void;
}

export function ImportPreview(props: ImportPreviewProps) {
  // `useReactFlow` benzeri kancalar sağlayıcı içinde olmalıdır; editördeki
  // aynı gereklilik.
  return (
    <ReactFlowProvider>
      <PreviewCanvas {...props} />
    </ReactFlowProvider>
  );
}

function PreviewCanvas({
  config,
  importedCount,
  skippedCount,
  onContinue,
  onBack,
}: ImportPreviewProps) {
  const { nodes, edges } = useMemo(() => buildFlowFromConfig(config), [config]);
  const stats = useMemo(() => previewOf(config), [config]);

  // Düğüm türleri örnek başına bir kez kurulur; her çizimde yeni bir nesne
  // verilseydi React Flow tüm canvas'ı yeniden kurardı.
  const nodeTypes = useMemo(
    () => ({ station: StationNode, arrival: ArrivalNode }),
    [],
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Fabrikanız böyle görünecek
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Henüz kaydedilmedi. Onaylarsanız model oluşturulur ve editöre
          geçersiniz.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Şema */}
        <div className="optiflow-enter h-[420px] min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            // Salt okunur: bu ekranın amacı incelemektir.
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            panOnDrag
            zoomOnScroll
            fitView
            fitViewOptions={{ padding: 0.25 }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Özet */}
        <aside className="space-y-3">
          <div className="optiflow-glass optiflow-enter rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Özet
            </p>

            <dl className="mt-3 space-y-2.5">
              <Row
                icon={Layers}
                label="İstasyon"
                value={String(stats.stationCount)}
              />
              <Row
                icon={Workflow}
                label="Bağlantı"
                value={String(stats.connectionCount)}
              />
              <Row
                icon={Zap}
                label="Tahmini kapasite"
                value={
                  stats.roughCapacityPerHour === null
                    ? "—"
                    : `${formatDecimal(stats.roughCapacityPerHour, 0)}/saat`
                }
              />
              <Row
                icon={TriangleAlert}
                label="Tahmini darboğaz"
                value={stats.slowestStation ?? "—"}
              />
            </dl>
          </div>

          {/* Uyarı: bu sayılar ölçüm değil tahmindir. */}
          <div className="optiflow-enter flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
            <p className="text-[11px] leading-relaxed text-amber-800">
              <span className="font-semibold">Bu tahmini önizlemedir.</span>{" "}
              Kapasite ve darboğaz, en yavaş istasyondan türetildi; kuyruk,
              arıza ve fire hesaba katılmadı. Gerçek çıktıyı simülasyon ölçer.
            </p>
          </div>

          {/* İçe aktarma sonucu */}
          <div className="optiflow-glass optiflow-enter rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              İçe aktarma
            </p>
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">
                {importedCount}
              </span>{" "}
              satır istasyona dönüştürüldü.
            </p>
            {skippedCount > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                {skippedCount} satır atlandı (istasyon adı ya da çevrim süresi
                okunamadı).
              </p>
            )}
          </div>

          <div className="flex gap-2">
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
              disabled={stats.stationCount === 0}
              className="flex-1 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              Fabrikayı oluştur
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="truncate text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
