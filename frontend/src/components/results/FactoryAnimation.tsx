/**
 * Canlı fabrika animasyonu — Faz 2.
 *
 * Amacı kullanıcının "bu gerçek bir simülasyon, sadece bir hesap makinesi
 * değil" hissini yaşamasıdır: parçaların istasyondan istasyona geçtiğini,
 * kuyrukların oluşup eridiğini ve darboğazda tıkanmanın nasıl göründüğünü
 * gözle görmesi.
 *
 * Hibrit çizim
 * ------------
 * İstasyon kutuları React Flow ile **statik** olarak çizilir (düzenlenemez,
 * sürüklenemez); hareket eden parçalar ise üzerine yerleştirilmiş bir canvas
 * katmanına çizilir. Nedeni DOM düğüm sayısı değildir — ölçtüğümüz izde aynı
 * anda ekranda en fazla birkaç parça bulunuyor. Asıl kazanç kare hızındadır:
 * parçaları React bileşeni yapmak, saniyede altmış kez yeniden render
 * tetiklerdi. Canvas'ta ise tek bir çizim döngüsü çalışır ve React hiç
 * yeniden render edilmez.
 *
 * Canvas, React Flow'un görünüm dönüşümünü (`useViewport`) uygular; böylece
 * kullanıcı yakınlaştırıp kaydırsa bile parçalar kutularla hizalı kalır.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useViewport,
  type Node,
  type Viewport,
} from "reactflow";
import type {
  SimulationConfig,
  SimulationTrace,
} from "../../types/simulationTypes";
import {
  ANIMATION_SPEEDS,
  DEFAULT_ANIMATION_SPEED,
} from "../../types/simulationTypes";
import { ApiError, getSimulationTrace } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  buildPhases,
  entitiesAt,
  summarizeTrace,
  type ActiveEntity,
  type EntityPhase,
} from "../../lib/animationTimeline";
import { buildFlowFromConfig, isStationNode } from "../../lib/configBuilder";
import { configLines } from "../../lib/factoryOverview";
import { CHART_COLORS, formatDecimal } from "../../lib/resultsFormatting";
import { ArrivalNode } from "../editor/nodes/ArrivalNode";
import { StationNode } from "../editor/nodes/StationNode";
import { PlayIcon, WarningIcon } from "../shared/icons";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

/** İpucunun bir daha gösterilmemesi için kullanılan anahtar. */
const HINT_DISMISSED_KEY = "optiflow.animation.speedHintDismissed";

/** Parça noktasının yarıçapı (akış koordinatlarında). */
const DOT_RADIUS = 7;

/** İstasyon kutusunun yaklaşık ölçüleri; canvas hizalaması bunlara dayanır. */
const NODE_WIDTH = 190;
const NODE_HEIGHT = 62;

/** Kuyruktaki parçaların kutunun soluna doğru dizilme aralığı. */
const QUEUE_SPACING = 17;
/**
 * İstasyon kutusunun içinde yan yana çizilen parçaların aralığı.
 *
 * Kuyruk aralığından dardır: kutunun genişliği sabittir ve paralel makine
 * sayısı arttıkça parçaların kutuyu taşmaması gerekir.
 */
const SERVICE_SPACING = 16;

const NODE_TYPES = { station: StationNode, arrival: ArrivalNode };

interface FactoryAnimationProps {
  simulationId: string;
  config: SimulationConfig;
  bottleneckStationId: string;
}

export function FactoryAnimation({
  simulationId,
  config,
  bottleneckStationId,
}: FactoryAnimationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [trace, setTrace] = useState<SimulationTrace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setTrace(await getSimulationTrace(simulationId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessages[0] : GENERIC_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [simulationId]);

  // İz yalnızca kullanıcı bölümü açtığında çekilir: sunucu izi yeniden
  // üretmek için simülasyonu tekrar çalıştırır ve bu birkaç saniye sürer.
  useEffect(() => {
    if (isOpen && trace === null && !isLoading && error === null) {
      void load();
    }
  }, [isOpen, trace, isLoading, error, load]);

  useEffect(() => {
    setTrace(null);
    setError(null);
  }, [simulationId]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <PlayIcon className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Canlı Akışı Gör
            </span>
            <span className="block text-xs text-slate-500">
              Parçaların hattınızda nasıl ilerlediğini izleyin
            </span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 p-5">
          {isLoading && (
            <div className="flex items-center gap-3 py-6">
              <Spinner />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Akış hazırlanıyor…
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Sunucu, sonuçları üreten koşumu aynı başlangıç değeriyle tekrar
                  çalıştırıyor.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="text-sm text-amber-900">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-1.5 font-medium underline underline-offset-2"
                >
                  Tekrar dene
                </button>
              </div>
            </div>
          )}

          {trace && (
            <AnimationPlayer
              trace={trace}
              config={config}
              bottleneckStationId={bottleneckStationId}
            />
          )}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Oynatıcı
// --------------------------------------------------------------------------- //

interface AnimationPlayerProps {
  trace: SimulationTrace;
  config: SimulationConfig;
  bottleneckStationId: string;
}

function AnimationPlayer({
  trace,
  config,
  bottleneckStationId,
}: AnimationPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(DEFAULT_ANIMATION_SPEED);
  const [displayTime, setDisplayTime] = useState(0);
  const [showSpeedHint, setShowSpeedHint] = useState(() => !isHintDismissed());

  /** Gerçek zaman, canvas döngüsünde tutulur; React state'i yalnızca göstergeyi
   *  günceller. Zamanı doğrudan state'te tutmak saniyede altmış render
   *  tetiklerdi. */
  const timeRef = useRef(0);

  const phases = useMemo<EntityPhase[]>(() => buildPhases(trace), [trace]);
  const summary = useMemo(() => summarizeTrace(trace, phases), [trace, phases]);

  /**
   * Hatlar. Birden fazlaysa sekme gösterilir ve sahnede aynı anda yalnızca bir
   * hat çizilir: yirmi istasyonu ve üzerlerindeki onlarca parçayı aynı anda
   * göstermek hem ekranı okunmaz hâle getirir hem de her karede gereksiz iş
   * yapar.
   */
  const lines = useMemo(() => configLines(config), [config]);
  const hasTabs = lines.length > 1;

  // Varsayılan sekme, darboğazın bulunduğu hattır: kullanıcının izlemek
  // isteyeceği ilk yer orasıdır.
  const [selectedLine, setSelectedLine] = useState<string | null>(() => {
    if (lines.length <= 1) {
      return null;
    }
    const withBottleneck = lines.find((line) =>
      line.stationIds.includes(bottleneckStationId),
    );
    return (withBottleneck ?? lines[0]).lineName;
  });

  const { nodes, edges } = useMemo(() => {
    const flow = buildFlowFromConfig(config);
    const visibleIds =
      selectedLine === null
        ? null
        : new Set(
            lines.find((line) => line.lineName === selectedLine)?.stationIds ?? [],
          );
    /**
     * Seçili hatta ait olmayan kutular sahneden çıkarılır. Bunları elemek
     * parçaları da eler: `entityPosition`, konumu bilinmeyen bir istasyondaki
     * parçayı atlar. Hattın dışına giden ya da dışarıdan gelen parçalar ise
     * sahnenin kenarından girip çıkıyormuş gibi çizilmeye devam eder — hattın
     * yalıtılmış değil, daha büyük bir akışın parçası olduğu görünür kalır.
     */
    const keep = (nodeId: string) => visibleIds === null || visibleIds.has(nodeId);
    const visibleNodes = flow.nodes.filter(
      (node) => !isStationNode(node) || keep(node.id),
    );
    // Varış kutusu yalnızca giriş istasyonu sahnedeyse anlamlıdır.
    const withoutOrphanArrival = visibleNodes.filter(
      (node) =>
        isStationNode(node) || keep(config.arrival_process.entry_station_id),
    );
    const shownIds = new Set(withoutOrphanArrival.map((node) => node.id));

    // Animasyonda kutular yalnızca görüntülenir; düzenleme editörün işidir.
    return {
      nodes: withoutOrphanArrival.map((node) =>
        isStationNode(node)
          ? {
              ...node,
              data: {
                ...node.data,
                metrics: {
                  utilization: 0,
                  is_bottleneck: node.id === bottleneckStationId,
                },
              },
            }
          : node,
      ) as Node[],
      edges: flow.edges.filter(
        (edge) => shownIds.has(edge.source) && shownIds.has(edge.target),
      ),
    };
  }, [config, bottleneckStationId, selectedLine, lines]);

  const seek = useCallback(
    (next: number) => {
      timeRef.current = Math.min(Math.max(next, 0), trace.duration_minutes);
      setDisplayTime(timeRef.current);
    },
    [trace.duration_minutes],
  );

  const dismissHint = useCallback(() => {
    setShowSpeedHint(false);
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      // Tarayıcı depolamayı engelliyorsa ipucu her açılışta gösterilir;
      // bu, animasyonun çalışmasını etkilemez.
    }
  }, []);

  return (
    <div className="space-y-4">
      <SamplingNotice trace={trace} />

      {hasTabs && (
        <LineTabs
          lines={lines.map((line) => line.lineName)}
          selected={selectedLine}
          onSelect={setSelectedLine}
        />
      )}

      <div className="relative h-[340px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        {/*
          Sekme değişince React Flow yeniden kurulur. `fitView` yalnızca ilk
          kurulumda çalışır; anahtar verilmeseydi yeni hat, önceki hattın
          yakınlaştırma ayarıyla çizilir ve çoğu zaman ekran dışında kalırdı.
          Zaman `timeRef`'te tutulduğu için animasyon kaldığı yerden sürer.
        */}
        <ReactFlowProvider key={selectedLine ?? "tumu"}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          />
          <EntityCanvas
            phases={phases}
            timeRef={timeRef}
            isPlaying={isPlaying}
            speed={speed}
            duration={trace.duration_minutes}
            nodes={nodes}
            bottleneckStationId={bottleneckStationId}
            onTimeChange={setDisplayTime}
            onFinished={() => setIsPlaying(false)}
          />
        </ReactFlowProvider>
      </div>

      <Controls
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (timeRef.current >= trace.duration_minutes) {
            seek(0);
          }
          setIsPlaying((previous) => !previous);
        }}
        speed={speed}
        onSpeedChange={setSpeed}
        time={displayTime}
        duration={trace.duration_minutes}
        onSeek={seek}
        showSpeedHint={showSpeedHint}
        onDismissHint={dismissHint}
      />

      <Legend summary={summary} bottleneckStationId={bottleneckStationId} />
    </div>
  );
}

function isHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------- //
// Canvas katmanı
// --------------------------------------------------------------------------- //

interface EntityCanvasProps {
  phases: EntityPhase[];
  timeRef: React.MutableRefObject<number>;
  isPlaying: boolean;
  speed: number;
  duration: number;
  nodes: Node[];
  bottleneckStationId: string;
  onTimeChange: (time: number) => void;
  onFinished: () => void;
}

/**
 * Parçaları çizen canvas katmanı.
 *
 * React'in render döngüsünün dışında çalışır: `requestAnimationFrame` içinde
 * doğrudan çizim yapar ve React state'ini yalnızca zaman göstergesini
 * güncellemek için, saniyede birkaç kez tetikler.
 */
function EntityCanvas({
  phases,
  timeRef,
  isPlaying,
  speed,
  duration,
  nodes,
  bottleneckStationId,
  onTimeChange,
  onFinished,
}: EntityCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewport = useViewport();
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      map.set(node.id, node.position);
    }
    return map;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let frame = 0;
    let previous = performance.now();
    let lastReported = -1;

    const render = (now: number) => {
      const deltaSeconds = (now - previous) / 1000;
      previous = now;

      if (isPlaying) {
        // 1x hız, saniyede bir simülasyon dakikası demektir.
        timeRef.current = Math.min(timeRef.current + deltaSeconds * speed, duration);
        if (timeRef.current >= duration) {
          onFinished();
        }
      }

      // Zaman göstergesi saniyede birkaç kez güncellenir; her karede React
      // state'i güncellemek gereksiz render maliyeti yaratırdı.
      if (Math.abs(timeRef.current - lastReported) > duration / 400) {
        lastReported = timeRef.current;
        onTimeChange(timeRef.current);
      }

      drawFrame(
        context,
        canvas,
        viewportRef.current,
        entitiesAt(phases, timeRef.current),
        positions,
        bottleneckStationId,
        now,
      );
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [
    phases,
    isPlaying,
    speed,
    duration,
    positions,
    bottleneckStationId,
    timeRef,
    onTimeChange,
    onFinished,
  ]);

  // Canvas çözünürlüğü, kapsayıcı boyutuna ve ekran yoğunluğuna göre ayarlanır;
  // aksi hâlde yüksek yoğunluklu ekranlarda çizim bulanık görünür.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) {
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * ratio;
      canvas.height = parent.clientHeight * ratio;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

/** Tek bir kareyi çizer. */
function drawFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  viewport: Viewport,
  entities: ActiveEntity[],
  positions: Map<string, { x: number; y: number }>,
  bottleneckStationId: string,
  now: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);

  // React Flow'un görünüm dönüşümü uygulanır; parçalar kutularla hizalı kalır.
  context.translate(viewport.x, viewport.y);
  context.scale(viewport.zoom, viewport.zoom);

  for (const entity of entities) {
    const point = entityPosition(entity, positions);
    if (!point) {
      continue;
    }
    drawDot(context, point, entity, bottleneckStationId, now);
  }
}

/** Bir parçanın akış koordinatlarındaki konumunu hesaplar. */
function entityPosition(
  entity: ActiveEntity,
  positions: Map<string, { x: number; y: number }>,
): { x: number; y: number } | null {
  if (entity.kind === "travel") {
    const from = entity.fromStation ? positions.get(entity.fromStation) : null;
    const to = entity.toStation ? positions.get(entity.toStation) : null;

    // Girişte kaynak, çıkışta hedef bilinmez; parça sahnenin kenarından
    // gelir ya da kenarına doğru gider.
    const start = from
      ? { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 }
      : to
        ? { x: to.x - 120, y: to.y + NODE_HEIGHT / 2 }
        : null;
    const finish = to
      ? { x: to.x, y: to.y + NODE_HEIGHT / 2 }
      : from
        ? { x: from.x + NODE_WIDTH + 120, y: from.y + NODE_HEIGHT / 2 }
        : null;

    if (!start || !finish) {
      return null;
    }
    return {
      x: start.x + (finish.x - start.x) * entity.progress,
      y: start.y + (finish.y - start.y) * entity.progress,
    };
  }

  const station = entity.stationId ? positions.get(entity.stationId) : null;
  if (!station) {
    return null;
  }

  if (entity.kind === "queued") {
    // Kuyruk kutunun soluna doğru dizilir: en önde bekleyen kutuya en yakın.
    return {
      x: station.x - DOT_RADIUS - 6 - entity.queueIndex * QUEUE_SPACING,
      y: station.y + NODE_HEIGHT / 2,
    };
  }

  // İşlemde ve bloke parçalar kutunun içinde gösterilir. Paralel makinesi olan
  // bir istasyonda aynı anda birden fazla parça işlem görebilir; hepsi kutunun
  // merkezine çizilseydi üst üste biner ve üç meşgul makine tek parça gibi
  // görünürdü. Bu yüzden grup, merkez etrafında yatay olarak dağıtılır.
  const offset = (entity.queueIndex - (entity.groupSize - 1) / 2) * SERVICE_SPACING;
  return {
    x: station.x + NODE_WIDTH / 2 + offset,
    y: station.y + NODE_HEIGHT / 2,
  };
}

/** Tek bir parçayı çizer. */
function drawDot(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  entity: ActiveEntity,
  bottleneckStationId: string,
  now: number,
): void {
  let fill = "#93b4fd";
  let alpha = 1;

  if (entity.kind === "service") {
    fill =
      entity.stationId === bottleneckStationId
        ? CHART_COLORS.bottleneck
        : CHART_COLORS.station;
  } else if (entity.kind === "queued") {
    fill = "#94a3b8";
  } else if (entity.kind === "blocked") {
    // Blokaj, darboğaz hissini veren olaydır: kırmızı ve yanıp sönen.
    fill = CHART_COLORS.bottleneck;
    alpha = 0.45 + 0.55 * Math.abs(Math.sin(now / 160));
  }

  context.globalAlpha = alpha;
  context.beginPath();
  context.arc(point.x, point.y, DOT_RADIUS, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.globalAlpha = 1;
}

// --------------------------------------------------------------------------- //
// Kontroller ve açıklamalar
// --------------------------------------------------------------------------- //

/**
 * Hat sekmeleri.
 *
 * Yirmi istasyonu aynı anda göstermek yerine kullanıcı tek bir hatta odaklanır.
 * Bu hem ekran karmaşasını önler hem de her karede çizilen parça sayısını
 * düşürür.
 */
function LineTabs({
  lines,
  selected,
  onSelect,
}: {
  lines: string[];
  selected: string | null;
  onSelect: (lineName: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Hat seçimi"
      className="flex flex-wrap gap-1.5 rounded-lg bg-slate-100 p-1"
    >
      {lines.map((lineName) => {
        const isSelected = selected === lineName;
        return (
          <button
            key={lineName}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(lineName)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
              isSelected
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {lineName}
          </button>
        );
      })}
    </div>
  );
}

interface ControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  time: number;
  duration: number;
  onSeek: (time: number) => void;
  showSpeedHint: boolean;
  onDismissHint: () => void;
}

function Controls({
  isPlaying,
  onTogglePlay,
  speed,
  onSpeedChange,
  time,
  duration,
  onSeek,
  showSpeedHint,
  onDismissHint,
}: ControlsProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {isPlaying ? (
            <>
              <span aria-hidden="true" className="text-xs">
                ❚❚
              </span>
              Duraklat
            </>
          ) : (
            <>
              <PlayIcon className="h-4 w-4" />
              Oynat
            </>
          )}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">Hız</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {ANIMATION_SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onSpeedChange(option);
                  onDismissHint();
                }}
                aria-pressed={speed === option}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  speed === option
                    ? "bg-brand-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>

        <span className="ml-auto text-sm tabular-nums text-slate-600">
          {formatDecimal(time, 0)} / {formatDecimal(duration, 0)} dakika
        </span>
      </div>

      {/* Varsayilan hizin neden 10x oldugunu bilmeyen bir kullanici, once
          normal hizda izlemek isteyip bunu nasil yapacagini bulamayabilir. */}
      {showSpeedHint && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs leading-relaxed text-brand-900">
            Akış varsayılan olarak <strong>10x hızda</strong> oynatılıyor; gerçek
            zamanda {formatDecimal(duration, 0)} dakika sürerdi. Hız kontrolünden
            yavaşlatabilirsiniz.
          </p>
          <button
            type="button"
            onClick={onDismissHint}
            className="shrink-0 rounded px-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
            aria-label="İpucunu kapat"
          >
            Anladım
          </button>
        </div>
      )}

      <input
        type="range"
        min={0}
        max={duration}
        step={duration / 500}
        value={time}
        onChange={(changeEvent) => onSeek(Number(changeEvent.target.value))}
        aria-label="Zaman çizelgesi"
        className="w-full accent-brand-600"
      />
    </div>
  );
}

function SamplingNotice({ trace }: { trace: SimulationTrace }) {
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
      Bu, {trace.total_replications} tekrarlı simülasyonun{" "}
      <strong>temsili bir örneğidir</strong>; istatistiksel sonuçlar tüm
      tekrarların ortalamasına dayanır. Burada gördüğünüz belirli bir kuyruk
      birikmesi bu tek koşuma özgü olabilir.
      {trace.truncated && (
        <>
          {" "}
          Olay sayısı çok yüksek olduğu için kayıt erken durdu; akış pencerenin
          tamamını kapsamıyor.
        </>
      )}
    </p>
  );
}

function Legend({
  summary,
  bottleneckStationId,
}: {
  summary: ReturnType<typeof summarizeTrace>;
  bottleneckStationId: string;
}) {
  const items = [
    { color: "#94a3b8", label: "Kuyrukta bekliyor" },
    { color: CHART_COLORS.station, label: "İşleniyor" },
    { color: CHART_COLORS.bottleneck, label: "Darboğazda / bloke" },
    { color: "#93b4fd", label: "Yolda" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Bu pencerede {summary.entityCount} parça işlendi
        {summary.blockedEvents > 0 && (
          <>
            , {summary.blockedEvents} kez blokaj oluştu
          </>
        )}
        {summary.busiestStationId && (
          <>
            . En uzun kuyruk{" "}
            <strong className="font-medium text-slate-700">
              {summary.busiestStationId}
            </strong>{" "}
            istasyonunda oluştu ({summary.peakQueueLength} parça)
            {summary.busiestStationId === bottleneckStationId &&
              " — darboğaz olarak tespit edilen istasyon"}
          </>
        )}
        .
      </p>
    </div>
  );
}
