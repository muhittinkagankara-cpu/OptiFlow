/**
 * Akış ve kayıp analizi — Sankey diyagramı.
 *
 * Tablo her istasyonun sayısını verir ama "hatta giren işin ne kadarı sona
 * ulaşıyor?" sorusuna cevap vermez; bunun için satırları tek tek çıkarmak
 * gerekir. Sankey aynı veriyi akışın **kalınlığıyla** anlatır: fire dalı ne
 * kadar kalınsa o kadar kapasite boşa gidiyordur.
 *
 * Veri hazırlığı `flowDiagram.ts` içinde ve birim testlidir; buradaki iş
 * yalnızca çizim. Bölüm varsayılan olarak kapalıdır ve diğer katlanabilir
 * bölümlerle aynı biçimde davranır.
 */

import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip as RechartsTooltip } from "recharts";
import type {
  SimulationConfig,
  StationMetricsResponse,
} from "../../types/simulationTypes";
import { buildFlowDiagram, type FlowLinkKind } from "../../lib/flowDiagram";
import { formatUnits } from "../../lib/resultsFormatting";
import { WarningIcon } from "../shared/icons";

/** Bağlantı renkleri; ana akış nötr, kayıplar uyarı renginde. */
const LINK_COLORS: Record<FlowLinkKind, string> = {
  flow: "#94a3b8",
  scrap: "#f87171",
  rejected: "#fbbf24",
};

interface FlowSankeyProps {
  stations: StationMetricsResponse[];
  config: SimulationConfig;
}

/**
 * Diyagram bilinçli olarak hat filtresi almaz.
 *
 * Zincir, sistemin giriş istasyonuna demirlenerek ileriye doğru üretilir. Tek
 * bir hatta süzülseydi bu demir kaybolur, akış hattın ortasından başlar ve
 * toplamlar gerçek üretimle örtüşmezdi — diyagramın tek işi zaten uçtan uca
 * resmi vermek. Ölçek sorunu bunun yerine yükseklikle çözülür: diyagram
 * istasyon sayısıyla birlikte uzar, bantlar incelmez.
 */
export function FlowSankey({ stations, config }: FlowSankeyProps) {
  const [isOpen, setIsOpen] = useState(false);

  const diagram = useMemo(
    () => (isOpen ? buildFlowDiagram(stations, config) : null),
    [isOpen, stations, config],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span
          aria-hidden="true"
          className={`inline-block text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">
            Akış ve Kayıp Analizi
          </span>
          <span className="block text-xs text-slate-500">
            Hatta giren işin ne kadarı sona ulaşıyor, nerede kayboluyor
          </span>
        </span>
      </button>

      {isOpen && <FlowBody diagram={diagram} />}
    </div>
  );
}

function FlowBody({ diagram }: { diagram: ReturnType<typeof buildFlowDiagram> }) {
  if (!diagram) {
    return (
      <p className="border-t border-slate-100 px-5 py-6 text-sm text-slate-600">
        Bu koşumda hatta hiç iş girmemiş; gösterilecek bir akış yok.
      </p>
    );
  }

  const { totalIn, totalScrapped, totalRejected } = diagram;
  const lossRatio = totalIn > 0 ? (totalScrapped + totalRejected) / totalIn : 0;

  /*
    Aşağıdaki cümle kullanıcıyı doğrudan toplama davet eder ("giren = tamamlanan
    + fire"). Üç sayı ayrı ayrı yuvarlanırsa toplam bir parça şaşabilir ve
    okuyan kişi diyagrama değil kendi aritmetiğine güvenmez. Bu yüzden kayıplar
    yuvarlanır, tamamlanan ise farktan bulunur: gösterilen sayılar her zaman
    birbirini tutar.
  */
  const shownIn = Math.round(totalIn);
  const shownScrapped = Math.round(totalScrapped);
  const shownRejected = Math.round(totalRejected);
  const shownOut = shownIn - shownScrapped - shownRejected;

  // Sankey düğüm sayısıyla birlikte uzar; sabit yükseklikte yirmi istasyonun
  // bantları saç teline döner.
  const height = Math.max(260, diagram.nodes.length * 34);
  // Sütun başına, istasyon adının sığacağı kadar yer.
  const minWidth = Math.max(520, diagram.columnCount * 130);

  return (
    <div className="space-y-4 border-t border-slate-100 px-5 py-5">
      <p className="text-sm leading-relaxed text-slate-700">
        Hatta giren{" "}
        <strong className="font-semibold text-slate-900">
          {formatUnits(shownIn)} parçanın
        </strong>{" "}
        <strong className="font-semibold text-slate-900">
          {formatUnits(shownOut)} tanesi
        </strong>{" "}
        tamamlandı.
        {totalScrapped > 0 && (
          <>
            {" "}
            <strong className="font-semibold text-red-700">
              {formatUnits(shownScrapped)} parça
            </strong>{" "}
            fire oldu.
          </>
        )}
        {totalRejected > 0 && (
          <>
            {" "}
            <strong className="font-semibold text-amber-700">
              {formatUnits(shownRejected)} parça
            </strong>{" "}
            tampon dolu olduğu için hatta hiç alınamadı.
          </>
        )}
        {lossRatio > 0 && (
          <> Toplam kayıp, giren işin %{(lossRatio * 100).toFixed(1)}'i.</>
        )}
      </p>

      {diagram.hasIgnoredRework && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">
            Modelde geriye dönen (yeniden işleme) bağlantı var. Akış diyagramı
            döngü çizemediği için bu yollar gösterilmiyor; diyagramdaki kayıp
            oranı bu nedenle gerçekte olduğundan yüksek görünebilir.
          </p>
        </div>
      )}

      {/*
        Sankey düğümleri derinliğe göre yatay dizer. Yirmi istasyonluk bir hat
        yirmi iki sütun demektir ve sabit genişlikte sütunlar birbirine girip
        etiketler okunmaz hâle gelir. Diyagram bu yüzden sütun başına asgari bir
        genişlik alır ve gerektiğinde **kendi kutusu içinde** yana kaydırılır;
        sayfanın kendisi hiçbir zaman yana kaymaz.
      */}
      <div className="overflow-x-auto">
        <ResponsiveContainer width="100%" height={height} minWidth={minWidth}>
          <Sankey
            data={diagram}
            nodePadding={26}
            nodeWidth={12}
            margin={{ top: 10, right: 120, bottom: 10, left: 90 }}
            link={<SankeyLink />}
            node={<SankeyNode />}
          >
            <RechartsTooltip
              formatter={(value: unknown) =>
                typeof value === "number" ? `${formatUnits(value)} parça` : String(value)
              }
            />
          </Sankey>
        </ResponsiveContainer>
      </div>

      <Legend hasScrap={totalScrapped > 0} hasRejected={totalRejected > 0} />

      {/*
        Diyagramdaki sayılar, giriş miktarının ölçülmüş fire ve red oranlarıyla
        hat boyunca taşınmasıyla üretilir; her düğümde giren ile çıkan bu sayede
        birebir eşittir. Özet karttaki üretim ise sistem sayacının replikasyon
        ortalamasıdır. Aynı koşumun iki farklı toplanma biçimi olduğu için binde
        birkaçlık bir fark kalabilir. Bunu yazmak, kullanıcının iki sayıyı yan
        yana görüp hangisine güveneceğini sormasından iyidir.
      */}
      <p className="text-xs leading-relaxed text-slate-500">
        Diyagram, giren işi ölçülmüş fire ve red oranlarıyla hat boyunca taşır;
        bu yüzden her adımda giren ile çıkan tam olarak eşittir. Özet karttaki
        üretim sayısı ayrı bir sayaçtan geldiği için aradaki fark binde birkaçı
        bulabilir.
      </p>
    </div>
  );
}

/**
 * Bağlantı bandı.
 *
 * Kayıp dalları ana akıştan renkle ayrılır; kalınlık zaten miktarı anlatıyor
 * ama ince bir fire dalı ile ince bir ana akış dalı aynı görünürdü.
 */
function SankeyLink(props: Record<string, unknown>) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth } =
    props as Record<string, number>;
  const payload = props.payload as { kind?: FlowLinkKind } | undefined;
  const color = LINK_COLORS[payload?.kind ?? "flow"];

  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={linkWidth}
      strokeOpacity={0.45}
    />
  );
}

/** Düğüm kutusu ve yanındaki etiket. */
function SankeyNode(props: Record<string, unknown>) {
  const { x, y, width, height } = props as Record<string, number>;
  const payload = props.payload as
    | { name?: string; kind?: string; isBottleneck?: boolean; value?: number }
    | undefined;

  const kind = payload?.kind ?? "station";
  const isSink = kind === "scrap" || kind === "rejected";
  const fill =
    kind === "scrap"
      ? "#dc2626"
      : kind === "rejected"
        ? "#d97706"
        : kind === "entry" || kind === "exit"
          ? "#0f766e"
          : payload?.isBottleneck
            ? "#dc2626"
            : "#1e2761";

  // Etiket, sağa taşan düğümlerde sola yazılır; aksi hâlde çizim alanının
  // dışına düşer ve okunmaz.
  const labelOnLeft = kind === "exit" || isSink;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />
      <text
        x={labelOnLeft ? x + width + 8 : x + width + 8}
        y={y + height / 2}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={11}
        fill="#334155"
      >
        {payload?.name}
      </text>
      <text
        x={x + width + 8}
        y={y + height / 2 + 13}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={10}
        fill="#94a3b8"
      >
        {typeof payload?.value === "number" ? formatUnits(payload.value) : ""}
      </text>
    </g>
  );
}

function Legend({ hasScrap, hasRejected }: { hasScrap: boolean; hasRejected: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
      <LegendItem color={LINK_COLORS.flow} label="Ana akış" />
      {hasScrap && <LegendItem color={LINK_COLORS.scrap} label="Fire (kalite kaybı)" />}
      {hasRejected && (
        <LegendItem color={LINK_COLORS.rejected} label="Reddedildi (tampon dolu)" />
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-5 rounded-sm"
        style={{ backgroundColor: color, opacity: 0.55 }}
      />
      {label}
    </span>
  );
}
