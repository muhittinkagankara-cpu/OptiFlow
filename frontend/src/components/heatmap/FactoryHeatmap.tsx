/**
 * "Param nerede yanıyor?" — fabrika şemasının ısı haritası.
 *
 * Süreç editöründen (`ProcessEditor.tsx`) tamamen ayrı, salt okunur bir
 * React Flow örneğidir. Kendi düğüm türlerini kendi `<ReactFlow>` örneğine
 * kaydeder; editörün `nodeTypes` haritasına hiç dokunmaz, dolayısıyla editörü
 * bozma riski yoktur.
 *
 * Yerleşim `configBuilder.buildFlowFromConfig` ile üretilir — editörün zaten
 * kullandığı ve test edilmiş aynı saf işlev. Kutuların konumu burada tekrar
 * hesaplanmaz, yalnızca ısı verisiyle boyanır.
 *
 * Şeffaflık: skor ve renk bandı backend'den gelir (`StationHeat`). Bu bileşen
 * hiçbir eşik ya da ağırlık uygulamaz — yalnızca gelen bandı bir CSS sınıfına
 * çevirir (`heatmapFormatting.ts`).
 */

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
} from "reactflow";
import type { SimulationConfig } from "../../types/simulationTypes";
import type { StationHeat } from "../../types/simulationTypes";
import {
  buildFlowFromConfig,
  isStationNode,
  type ArrivalFlowNode,
  type StationNodeData,
} from "../../lib/configBuilder";
import {
  bandDot,
  bandSurface,
  bandText,
  formatScore,
  heatById,
  shouldPulse,
} from "../../lib/heatmapFormatting";
import { StationTooltip } from "./StationTooltip";

/** İstasyon düğümünün verisi, ısı skoruyla genişletilmiş hâli. */
interface HeatStationData extends StationNodeData {
  heat: StationHeat | null;
}

type HeatStationFlowNode = Node<HeatStationData, "station">;

/** Bu haritanın çizdiği düğüm türü: ısılı istasyon ya da düz giriş kutusu. */
type HeatFlowNode = HeatStationFlowNode | ArrivalFlowNode;

interface FactoryHeatmapProps {
  config: SimulationConfig;
  heat: StationHeat[];
  /** Şu anda odaklanmış istasyon; dışarıdan (Top 5 listesinden) da gelebilir. */
  focusedId: string | null;
  onFocus: (stationId: string) => void;
}

export function FactoryHeatmap(props: FactoryHeatmapProps) {
  return (
    // `useReactFlow` sağlayıcı içinde olmalı (editördeki aynı gereklilik).
    <ReactFlowProvider>
      <HeatmapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function HeatmapCanvas({ config, heat, focusedId, onFocus }: FactoryHeatmapProps) {
  const { nodes, edges } = useMemo(() => buildFlowFromConfig(config), [config]);
  const { setCenter, getZoom } = useReactFlow();

  const nodeTypes = useMemo(() => ({ station: HeatStationNode, arrival: PlainArrivalNode }), []);

  // Isı verisi node'un `data` alanina gomulur; ReactFlow her node'a kendi
  // verisini geciriyor, ayri bir eslesme mantigi node bilesenine tasinmaz.
  const decorated = useMemo<HeatFlowNode[]>(
    () =>
      nodes.map((node): HeatFlowNode => {
        if (!isStationNode(node)) {
          return node;
        }
        return { ...node, data: { ...node.data, heat: heatById(heat, node.id) } };
      }),
    [nodes, heat],
  );

  const handleNodeClick = (stationId: string, x: number, y: number) => {
    onFocus(stationId);
    // "Node tiklayinca odaklan": gorunumu tiklanan kutunun uzerine kaydirir.
    // Mevcut yakinlastirma korunur — odaklanma yakinlastirmayi degil,
    // konumu degistirmelidir.
    setCenter(x + 90, y + 40, { zoom: Math.max(getZoom(), 1), duration: 400 });
  };

  return (
    <div className="optiflow-stage h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <ReactFlow
        nodes={decorated}
        edges={edges}
        nodeTypes={nodeTypes}
        // Salt okunur: kullanici kutulari taşıyamaz, baglanti cizemez. Bu
        // haritanin amaci incelemektir, model duzenlemek degil.
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        panOnDrag
        zoomOnScroll
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: false }}
        onNodeClick={(_event, node) => {
          // `node.type` burada dogrudan sinanir: ReactFlow'un genel `onNodeClick`
          // imzasi, `decorated`'in birlesim turunu (istasyon | giris) tam olarak
          // tasimaz; tur adi karsilastirmasi hem yeterli hem de acik bir kontroldur.
          if (node.type === "station") {
            handleNodeClick(node.id, node.position.x, node.position.y);
          }
        }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Odaklanan istasyonun disaridan (Top 5 listesi) da vurgulanmasi icin
          `focusedId` prop olarak node bileseninde okunur; burada ayrica bir
          seye gerek yok, decorate asamasinda tasindi. */}
      <HighlightBridge focusedId={focusedId} nodes={decorated} onFocus={onFocus} />
    </div>
  );
}

/**
 * `focusedId` dışarıdan değiştiğinde (Top 5 listesinden tıklanınca) görünümü
 * o kutuya kaydırır.
 *
 * Ayrı bir bileşen olması bilinçlidir: `useReactFlow` yalnızca sağlayıcının
 * İÇİNDE çağrılabilir ve bu hook'un tetiklediği yan etki (kaydırma), asıl
 * çizim mantığından ayrı tutulunca `HeatmapCanvas`'ın render gövdesi
 * karışmaz.
 */
function HighlightBridge({
  focusedId,
  nodes,
}: {
  focusedId: string | null;
  nodes: HeatFlowNode[];
  onFocus: (stationId: string) => void;
}) {
  const { setCenter, getZoom } = useReactFlow();

  // Render govdesinde `setCenter` cagirmak, React'in "render sirasinda yan
  // etki uretme" kuralini bozardi (StrictMode'da cift calisir, uyari verir).
  // Kaydirma bir yan etkidir; bu yuzden `useEffect` icinde yapilir ve yalnizca
  // `focusedId` gercekten degistiginde tetiklenir.
  useEffect(() => {
    if (!focusedId) {
      return;
    }
    const target = nodes.find((node) => node.id === focusedId);
    if (target) {
      setCenter(target.position.x + 90, target.position.y + 40, {
        zoom: Math.max(getZoom(), 1),
        duration: 400,
      });
    }
    // `nodes` kasitli olarak disarida birakildi: yerlesim ayni koşum icinde
    // sabittir (config degismedikce). Bagimliliga eklenseydi, her render'da
    // yeni bir dizi referansi olusup (`useMemo` cikisinin bile) gereksiz
    // yeniden kaydirmalara yol acardi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, setCenter, getZoom]);

  return null;
}

// --------------------------------------------------------------------------- //
// Düğüm bileşenleri
// --------------------------------------------------------------------------- //

function HeatStationNode({ data, selected }: NodeProps<HeatStationData>) {
  const { heat } = data;
  const [isHovered, setIsHovered] = useState(false);

  // Eslesmeyen bir kutu (or. model backend'de silinmis bir istasyon
  // tasiyorsa) notr gri kalir; cokmez, sessizce "veri yok" gosterir.
  if (!heat) {
    return (
      <div className="w-44 rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-3 text-center shadow-sm">
        <p className="truncate text-sm font-medium text-slate-500">{data.station.name}</p>
        <p className="mt-1 text-[11px] text-slate-400">Isı verisi yok</p>
      </div>
    );
  }

  const pulse = shouldPulse(heat.band) ? "optiflow-heat-pulse" : "";
  const ring = selected ? "ring-2 ring-brand-500 ring-offset-2" : "";

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${heat.station_name}: ısı skoru ${formatScore(heat.score)}`}
        className={`w-44 cursor-pointer rounded-xl border-2 px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md ${bandSurface(
          heat.band,
        )} ${pulse} ${ring}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`truncate text-sm font-semibold ${bandText(heat.band)}`}>
            {heat.station_name}
          </p>
          {heat.is_bottleneck && (
            <span className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600">
              darboğaz
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${bandDot(heat.band)}`} />
          <span className={`text-lg font-bold tabular-nums ${bandText(heat.band)}`}>
            {formatScore(heat.score)}
          </span>
          <span className="text-[10px] text-slate-500">/100</span>
        </div>
      </div>

      {isHovered && (
        <div className="absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2">
          <StationTooltip heat={heat} />
        </div>
      )}
    </div>
  );
}

/** Varış kutusu — ısı taşımaz, yalnızca akışın başlangıcını gösterir. */
function PlainArrivalNode() {
  return (
    <div className="flex w-32 items-center justify-center rounded-xl border-2 border-emerald-300 bg-emerald-50 px-3 py-2.5">
      <p className="text-xs font-medium text-emerald-800">Giriş</p>
    </div>
  );
}
