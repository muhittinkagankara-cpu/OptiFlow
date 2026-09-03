/**
 * Sayfa 5 — Süreç Editörü.
 *
 * Canvas (React Flow) + sağ parametre paneli + üst araç çubuğundan oluşur.
 * Canvas'taki node/edge yapısı tek doğruluk kaynağıdır; "Simülasyonu Çalıştır"
 * anında `configBuilder` ile backend şemasına çevrilir. Ayrı bir config state'i
 * tutulmaz — iki temsil arasında eşitlemeyi elle sürdürmek, ekranda görünen
 * model ile çalışan modelin sessizce ayrışmasına yol açardı.
 */

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection as FlowConnection,
  type NodeMouseHandler,
} from "reactflow";
import type {
  Distribution,
  SimulationConfig,
  SimulationDepth,
  SimulationRunResponse,
  Station,
} from "../../types/simulationTypes";
import { SIMULATION_DEPTH_OPTIONS } from "../../types/simulationTypes";
import {
  ARRIVAL_NODE_ID,
  buildFlowFromConfig,
  buildLineGroups,
  buildSimulationConfig,
  collectLineNames,
  createStationNode,
  isStationNode,
  type FlowEdge,
  type FlowNode,
  type StationNodeData,
} from "../../lib/configBuilder";
import { ApiError, runSimulation } from "../../lib/apiClient";
import {
  extractLayout,
  hasUnsavedChanges,
  type SavedSnapshot,
} from "../../lib/factoryModel";
import type { FactoryLayout } from "../../types/simulationTypes";
import { GENERIC_ERROR_MESSAGE, summarizeWarning } from "../../lib/errorMessages";
import { ParameterPanel } from "./ParameterPanel";
import { Toolbar } from "./Toolbar";
import { ArrivalNode } from "./nodes/ArrivalNode";
import { LineGroupNode } from "./nodes/LineGroupNode";
import { StationNode } from "./nodes/StationNode";
import { WarningIcon } from "../shared/icons";

/** Yeni eklenen istasyonun canvas üzerindeki başlangıç konumu. */
const NEW_NODE_POSITION = { x: 420, y: 420 };
/**
 * Yeni istasyonlar ızgaraya dizilir: satır başına bu kadar kutu, sonra alt
 * satıra geçilir.
 *
 * Önceden her kutu bir öncekinden 30 piksel sağa, 20 piksel aşağı
 * kaydırılıyordu. Bu, birkaç istasyonda hoş bir yelpaze veriyordu ama kutu
 * genişliği 220 pikselin üzerinde olduğu için 15-20 istasyonluk gerçek bir
 * fabrikada çapraz bir yığın oluşuyor ve kutular birbirini örtüyordu.
 */
const NEW_NODE_COLUMNS = 4;
const NEW_NODE_STEP_X = 260;
const NEW_NODE_STEP_Y = 130;

interface ProcessEditorProps {
  initialConfig: SimulationConfig;
  /**
   * Bu model için en son alınan simülasyon sonucu.
   *
   * Kullanıcı sonuç ekranından editöre döndüğünde kutuların kullanım oranına
   * göre renklenmiş olması gerekir. Sonuç aktarılmazsa editör her açılışta
   * sıfırdan kurulur ve renk kodlaması —yani darboğazın şema üzerinde
   * görünmesi— pratikte hiç izlenemez hâle gelirdi.
   */
  lastResult?: SimulationRunResponse | null;
  onBack: () => void;
  onSimulationComplete: (result: SimulationRunResponse, config: SimulationConfig) => void;
  /**
   * Verilirse editör kurulum sihirbazının bir adımı olarak davranır: ana düğme
   * simülasyonu başlatmak yerine bir sonraki adıma (onay ekranına) geçer.
   *
   * Canvas'ın o anki hâli de geri verilir. Sihirbaz bunu saklayıp kullanıcı
   * geri döndüğünde `initialFlow` olarak iade eder; aksi hâlde kullanıcının
   * elle yerleştirdiği kutular her gidiş-dönüşte otomatik yerleşime sıfırlanır
   * ve 20 istasyonlu bir şemada bu, yapılan tüm düzenlemenin kaybı demektir.
   */
  onContinue?: (
    config: SimulationConfig,
    flow: { nodes: FlowNode[]; edges: FlowEdge[] },
  ) => void;
  /** Daha önce bırakılmış canvas durumu; verilirse `initialConfig` yerine kullanılır. */
  initialFlow?: { nodes: FlowNode[]; edges: FlowEdge[] } | null;

  /** Açık fabrikanın adı; üst çubukta gösterilir. */
  factoryName?: string | null;
  /**
   * En son kaydedilen model ve yerleşim.
   *
   * Kaydedilmemiş değişiklik göstergesi buna göre hesaplanır. `null` ise model
   * hiç kaydedilmemiştir ve her şey kaydedilmemiş sayılır.
   */
  savedSnapshot?: SavedSnapshot | null;
  /**
   * Verilirse üst çubukta "Kaydet" düğmesi görünür.
   *
   * Model **ve** yerleşim birlikte gönderilir: sürüm ikisinin anlık
   * görüntüsüdür ve yalnızca biri kaydedilseydi "sürüm 3'ü aç" belirsiz bir
   * istek hâline gelirdi.
   */
  onSave?: (config: SimulationConfig, layout: FactoryLayout) => Promise<void>;
  /**
   * Kayıtlı sürümü çalıştıran uç.
   *
   * Verildiğinde ve canvas'ta kaydedilmemiş değişiklik yokken bu kullanılır;
   * sonuç, kendisini üreten fabrika sürümüyle işaretlenir ve aylar sonra hangi
   * modelden geldiği kesin olarak okunabilir.
   *
   * Kaydedilmemiş değişiklik varken bilinçli olarak kullanılmaz: kayıtlı sürüm
   * ekrandaki modelden farklıdır ve onu çalıştırmak, kullanıcının gördüğünden
   * başka bir modelin sonucunu göstermek olurdu.
   */
  onRunSaved?: () => Promise<SimulationRunResponse>;
}

/**
 * Simülasyon metriklerini node'lara işler (renk kodlaması için).
 *
 * Yalnızca istasyon node'ları metrik taşır; varış kutusunun kullanım oranı
 * yoktur. Tip daraltması bunu derleme zamanında güvence altına alır — aksi
 * hâlde varış node'unun verisi yanlışlıkla istasyon verisiyle karıştırılabilirdi.
 */
function applyMetrics(nodes: FlowNode[], result: SimulationRunResponse): FlowNode[] {
  const metricsById = new Map(
    result.results.station_metrics.map((item) => [item.station_id, item]),
  );
  return nodes.map((node): FlowNode => {
    if (!isStationNode(node)) {
      return node;
    }
    const metrics = metricsById.get(node.id);
    if (!metrics) {
      return node;
    }
    return {
      ...node,
      data: {
        ...node.data,
        metrics: {
          utilization: metrics.utilization,
          is_bottleneck: metrics.is_bottleneck,
        },
      },
    };
  });
}

export function ProcessEditor(props: ProcessEditorProps) {
  // React Flow'un `useReactFlow` gibi kancaları sağlayıcı içinde olmalıdır.
  return (
    <ReactFlowProvider>
      <EditorCanvas {...props} />
    </ReactFlowProvider>
  );
}

function EditorCanvas({
  initialConfig,
  lastResult,
  onBack,
  onSimulationComplete,
  onContinue,
  initialFlow: savedFlow,
  factoryName,
  savedSnapshot,
  onSave,
  onRunSaved,
}: ProcessEditorProps) {
  const initialFlow = useMemo(() => {
    // Kullanıcı bu editörden daha önce çıkıp geri döndüyse kendi yerleşimi
    // korunur; yalnızca ilk girişte otomatik yerleşim kurulur.
    const flow = savedFlow ?? buildFlowFromConfig(initialConfig);
    return lastResult
      ? { ...flow, nodes: applyMetrics(flow.nodes, lastResult) }
      : flow;
    // `lastResult` bilinçli olarak bağımlılık dışında: yalnızca editör ilk
    // kurulduğunda uygulanır. Bağımlılığa eklenirse, çalıştırma sonrası gelen
    // sonuç canvas'ı baştan kurar ve kullanıcının taşıdığı kutular yerine döner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConfig, savedFlow]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode["data"]>(
    initialFlow.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [depth, setDepth] = useState<SimulationDepth>("standard");
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const nodeTypes = useMemo(
    () => ({ station: StationNode, arrival: ArrivalNode, lineGroup: LineGroupNode }),
    [],
  );

  const flowNodes = nodes as FlowNode[];
  const flowEdges = edges as FlowEdge[];

  // Hat adları parametre panelindeki otomatik tamamlamayı besler.
  const lineNames = useMemo(() => collectLineNames(flowNodes), [flowNodes]);

  /**
   * Grup kutuları state'te tutulmaz, her renderda istasyonların konumundan
   * türetilir. State'te tutulsalardı kullanıcı bir istasyonu taşıdığında kutu
   * yerinde kalır ve elle eşitlenmeleri gerekirdi; türetilmiş olduklarında
   * kutu istasyonu kendiliğinden izler.
   */
  const canvasNodes = useMemo(() => {
    const groups = buildLineGroups(flowNodes);
    if (groups.length === 0) {
      return flowNodes;
    }
    const groupNodes = groups.map((group) => ({
      id: `hat:${group.lineName}`,
      type: "lineGroup",
      position: group.position,
      // Kutular arkada durur ve hiçbir etkileşim almaz; aksi hâlde
      // istasyonların üstünü kapatır ve tıklamaları yutarlardı.
      zIndex: -1,
      draggable: false,
      selectable: false,
      focusable: false,
      deletable: false,
      // Ölçü hem node üzerinde hem style'da verilir. React Flow, iç deposunda
      // boyutu bilinmeyen bir node'u `visibility: hidden` ile gizler; yalnızca
      // style verilseydi kutu DOM'da olur ama hiç görünmezdi.
      width: group.width,
      height: group.height,
      style: { width: group.width, height: group.height },
      data: { lineName: group.lineName, stationCount: group.stationIds.length },
    }));
    return [...groupNodes, ...flowNodes];
  }, [flowNodes]);
  const selectedNode = flowNodes.find((node) => node.id === selectedNodeId) ?? null;
  const stationCount = flowNodes.filter(isStationNode).length;

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handleConnect = useCallback(
    (connection: FlowConnection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            // Olasılık verilmez: configBuilder aynı kaynaktan çıkan yollara
            // eşit dağıtır. Kullanıcı isterse sonradan değiştirebilir.
            data: {},
            animated: connection.source === ARRIVAL_NODE_ID,
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const handleAddStation = useCallback(() => {
    const fresh = createStationNode(
      flowNodes.map((node) => node.id),
      {
        // Kutular üst üste binmesin diye ızgaraya dizilir; satır dolunca
        // alta geçilir.
        x: NEW_NODE_POSITION.x + (stationCount % NEW_NODE_COLUMNS) * NEW_NODE_STEP_X,
        y:
          NEW_NODE_POSITION.y +
          Math.floor(stationCount / NEW_NODE_COLUMNS) * NEW_NODE_STEP_Y,
      },
    );
    setNodes((current) => [...current, fresh] as typeof current);
    setSelectedNodeId(fresh.id);
  }, [flowNodes, stationCount, setNodes]);

  const handleUpdateStation = useCallback(
    (nodeId: string, station: Station) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...(node.data as StationNodeData), station } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const handleUpdateArrival = useCallback(
    (distribution: Distribution) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === ARRIVAL_NODE_ID ? { ...node, data: { distribution } } : node,
        ),
      );
    },
    [setNodes],
  );

  const handleDeleteStation = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      // Silinen istasyona bağlı kenarlar da kaldırılır; aksi hâlde canvas'ta
      // hiçbir yere gitmeyen oklar kalırdı.
      setEdges((current) =>
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      );
      setSelectedNodeId(null);
    },
    [setNodes, setEdges],
  );

  /**
   * Canvas'ın o anki yerleşimi.
   *
   * `SimulationConfig` kutu konumlarını taşımaz; bu yüzden kaydetme ve
   * kaydedilmemiş değişiklik hesabı için ayrıca çıkarılır.
   */
  const currentLayout = useMemo(() => extractLayout(flowNodes), [flowNodes]);

  /**
   * Canvas'ın şemaya çevrilmiş hâli — **hata yazmadan**.
   *
   * `buildFromCanvas` hataları panele yazdığı için render sırasında
   * çağrılamaz: her tuş vuruşunda hata kutusu açılıp kapanırdı. Bu türetme
   * sessizdir ve yalnızca karşılaştırma için kullanılır.
   */
  const silentConfig = useMemo(() => {
    const option =
      SIMULATION_DEPTH_OPTIONS.find((item) => item.id === depth) ??
      SIMULATION_DEPTH_OPTIONS[1];
    const built = buildSimulationConfig(flowNodes, flowEdges, {
      simulation_duration_minutes: option.simulation_duration_minutes,
      warmup_period_minutes: option.warmup_period_minutes,
      num_replications: option.num_replications,
      random_seed: initialConfig.random_seed ?? 42,
    });
    return built.ok ? built.config : null;
  }, [flowNodes, flowEdges, depth, initialConfig.random_seed]);

  /**
   * Kaydedilecek bir değişiklik var mı?
   *
   * Model geçersizken de "değişiklik var" sayılır: kullanıcı bir şeyler
   * düzenlemiştir, yalnızca henüz geçerli değildir. Bu durumda kaydetme
   * denenirse hata gösterilir — düğmenin sessizce pasif kalması, kullanıcının
   * neden kaydedemediğini anlamaması demek olurdu.
   */
  const isDirty = useMemo(() => {
    if (!silentConfig) {
      return true;
    }
    return hasUnsavedChanges(
      { config: silentConfig, layout: currentLayout },
      savedSnapshot ?? null,
    );
  }, [silentConfig, currentLayout, savedSnapshot]);

  /**
   * Canvas'ı şemaya çevirir ve hataları panele yazar.
   *
   * Hem çalıştırma hem "ileri" aynı doğrulamadan geçer: sihirbazda bozuk bir
   * modelle onay adımına geçilebilseydi kullanıcı hatayı bir adım geç, üstelik
   * modeli göremediği bir ekranda öğrenirdi.
   */
  const buildFromCanvas = useCallback(() => {
    setErrors([]);
    setWarnings([]);

    const option =
      SIMULATION_DEPTH_OPTIONS.find((item) => item.id === depth) ??
      SIMULATION_DEPTH_OPTIONS[1];

    const built = buildSimulationConfig(flowNodes, flowEdges, {
      simulation_duration_minutes: option.simulation_duration_minutes,
      warmup_period_minutes: option.warmup_period_minutes,
      num_replications: option.num_replications,
      random_seed: initialConfig.random_seed ?? 42,
    });

    if (!built.ok) {
      setErrors(built.errors);
      return null;
    }
    setWarnings(built.warnings);
    return built.config;
  }, [flowNodes, flowEdges, depth, initialConfig.random_seed]);

  const handleContinue = useCallback(() => {
    const config = buildFromCanvas();
    if (config && onContinue) {
      onContinue(config, { nodes: flowNodes, edges: flowEdges });
    }
  }, [buildFromCanvas, onContinue, flowNodes, flowEdges]);

  const handleSave = useCallback(async () => {
    if (!onSave) {
      return;
    }
    const config = buildFromCanvas();
    if (!config) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(config, extractLayout(flowNodes));
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsSaving(false);
    }
  }, [onSave, buildFromCanvas, flowNodes]);

  const handleRun = useCallback(async () => {
    const config = buildFromCanvas();
    if (!config) {
      return;
    }

    setIsRunning(true);
    try {
      // Model kayıtlıysa ve ekranda kaydedilmemiş değişiklik yoksa koşum
      // sürümden başlatılır; böylece sonuç hangi modelden geldiğini taşır.
      const result =
        onRunSaved && !isDirty ? await onRunSaved() : await runSimulation(config);

      // Kutular kullanım oranına göre renklenir; kullanıcı sonuç ekranından
      // buraya döndüğünde darboğazı kendi şemasının üzerinde görür.
      setNodes((current) => applyMetrics(current as FlowNode[], result) as typeof current);

      setWarnings((current) => [
        ...current,
        ...result.warnings.map(summarizeWarning),
      ]);
      onSimulationComplete(result, config);
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsRunning(false);
    }
  }, [buildFromCanvas, setNodes, onSimulationComplete, onRunSaved, isDirty]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        depth={depth}
        onDepthChange={setDepth}
        onAddStation={handleAddStation}
        onRun={onContinue ? handleContinue : handleRun}
        onBack={onBack}
        isRunning={isRunning}
        stationCount={stationCount}
        variant={onContinue ? "continue" : "run"}
        factoryName={factoryName}
        onSave={onSave ? handleSave : undefined}
        isSaving={isSaving}
        isDirty={isDirty}
      />

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          {errors.map((message) => (
            <Banner key={message} tone="error" message={message} />
          ))}
          {warnings.map((message) => (
            <Banner key={message} tone="warning" message={message} />
          ))}
        </div>
      )}

      {isRunning && (
        <p className="border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-900">
          Simülasyon çalışıyor, birkaç saniye sürebilir.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={canvasNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: false }}
            className="bg-slate-50"
          >
            <Background gap={20} size={1} color="#cbd5e1" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className="!bottom-4 !right-4 hidden !rounded-lg !border !border-slate-200 sm:block"
              // Hat kutuları haritada gösterilmez: istasyonları kaplayan büyük
              // dikdörtgenler haritayı okunmaz hâle getirirdi.
              nodeColor={(node) =>
                node.type === "lineGroup"
                  ? "transparent"
                  : node.type === "arrival"
                    ? "#34d399"
                    : "#94a3b8"
              }
              nodeStrokeWidth={0}
            />
          </ReactFlow>

          {stationCount === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto rounded-xl border-2 border-dashed border-slate-300 bg-white/90 px-6 py-5 text-center shadow-sm">
                <p className="text-sm font-medium text-slate-700">
                  Şema boş görünüyor
                </p>
                <p className="mt-1 max-w-xs text-xs text-slate-500">
                  Yukarıdaki “İstasyon Ekle” düğmesiyle ilk iş istasyonunuzu ekleyin,
                  sonra yeşil giriş kutusundan ona bir ok çizin.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="w-80 shrink-0 max-lg:hidden">
          <ParameterPanel
            selectedNode={selectedNode}
            lineNames={lineNames}
            onUpdateStation={handleUpdateStation}
            onUpdateArrival={handleUpdateArrival}
            onDeleteStation={handleDeleteStation}
          />
        </div>
      </div>

      {/* Dar ekranlarda panel canvas'ın altına iner; yan yana sığmadığında
          canvas kullanılamayacak kadar daralırdı. */}
      {selectedNode && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-slate-200 lg:hidden">
          <ParameterPanel
            selectedNode={selectedNode}
            lineNames={lineNames}
            onUpdateStation={handleUpdateStation}
            onUpdateArrival={handleUpdateArrival}
            onDeleteStation={handleDeleteStation}
          />
        </div>
      )}
    </div>
  );
}

function Banner({ tone, message }: { tone: "error" | "warning"; message: string }) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  const iconColor = tone === "error" ? "text-red-600" : "text-amber-600";

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${styles}`}>
      <WarningIcon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
      <p className="text-sm">{message}</p>
    </div>
  );
}
