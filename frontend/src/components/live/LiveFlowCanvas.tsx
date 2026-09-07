/**
 * Canlı fabrika diyagramı.
 *
 * Yerleşim `buildFlowFromConfig` ile üretilir — editörle **aynı** yerleşim
 * motoru. Ayrı bir yerleşim yazılsaydı, kullanıcının editörde düzenlediği hat
 * burada başka bir sırada görünür ve iki ekran aynı fabrikayı anlatmıyormuş
 * gibi okunurdu.
 *
 * Tuval salt okunurdur: düğümler sürüklenmez, bağlantı kurulmaz. Canlı ekranda
 * modeli değiştirmek anlamsızdır ve yanlışlıkla yapılan bir sürükleme, izlenen
 * hattın bozulduğu izlenimini verirdi.
 *
 * Parça hareketi kenarların `animated` özelliğiyle çizilir. Ayrı bir canvas
 * katmanı (`FactoryAnimation`'daki gibi) burada gerekmez: orada kaydedilmiş bir
 * izin her parçası tek tek çiziliyor, burada ise akışın **var olup olmadığı**
 * gösteriliyor.
 */

import { memo, useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "reactflow";
import type { SimulationConfig } from "../../types/simulationTypes";
import { buildFlowFromConfig, isStationNode } from "../../lib/configBuilder";
import { bottleneckStationId, type StationLiveState } from "../../lib/live";
import { LiveStationNode, type LiveNodeData } from "./LiveStationNode";

const NODE_TYPES = { live: LiveStationNode };

interface LiveFlowCanvasProps {
  config: SimulationConfig;
  stations: StationLiveState[];
  onSelectStation: (stationId: string) => void;
  selectedStationId: string | null;
}

function LiveFlowCanvasInner({
  config,
  stations,
  onSelectStation,
  selectedStationId,
}: LiveFlowCanvasProps) {
  /*
   * Yerleşim yalnızca **model** değiştiğinde yeniden hesaplanır. Canlı duruma
   * bağlansaydı her olayda düğümler yeniden konumlandırılır ve diyagram
   * saniyede birkaç kez zıplardı.
   */
  const layout = useMemo(() => buildFlowFromConfig(config), [config]);

  const bottleneckId = useMemo(() => bottleneckStationId(stations), [stations]);

  const byId = useMemo(
    () => new Map(stations.map((item) => [item.stationId, item])),
    [stations],
  );

  const nodes = useMemo<Node<LiveNodeData>[]>(
    () =>
      layout.nodes.filter(isStationNode).map((node) => {
        const live = byId.get(node.data.station.id);
        return {
          id: node.id,
          type: "live",
          position: node.position,
          selected: node.data.station.id === selectedStationId,
          data: {
            stationName: node.data.station.name || "Adsız istasyon",
            status: live?.status ?? "idle",
            queue: live?.queue ?? 0,
            oee: live?.oee ?? 0,
            completed: live?.completed ?? 0,
            isBottleneck: node.data.station.id === bottleneckId,
            operatorName: live?.operatorName ?? null,
          },
        };
      }),
    [layout.nodes, byId, bottleneckId, selectedStationId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges
        // Varış düğümü canlı tuvalde çizilmiyor; ona giden kenar da atlanır.
        .filter((edge) => nodes.some((node) => node.id === edge.source))
        .map((edge) => {
          const source = byId.get(edge.source);
          const flowing =
            source?.status === "running" || source?.status === "queued";
          return {
            ...edge,
            animated: flowing,
            style: {
              stroke: flowing ? "#3B82F6" : "#1F2937",
              strokeWidth: flowing ? 2 : 1.5,
            },
          };
        }),
    [layout.edges, byId, nodes],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => onSelectStation(node.id),
    [onSelectStation],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      // Az istasyonlu bir hatta sınırsız yakınlaşma, dört kutuyu ekrana
      // sığmayacak kadar büyütüyordu.
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      className="optiflow-stage"
    >
      <Background color="#1F2937" gap={22} />
      <Controls showInteractive={false} className="!shadow-none" />
    </ReactFlow>
  );
}

const MemoCanvas = memo(LiveFlowCanvasInner);

export function LiveFlowCanvas(props: LiveFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <MemoCanvas {...props} />
    </ReactFlowProvider>
  );
}
