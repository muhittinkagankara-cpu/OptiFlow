/**
 * Akış sağlığı kartları.
 *
 * Beş ölçüm: olay hızı, yoklama sıklığı, kuyruk derinliği, düşen ölçüm ve
 * akış durumu. Hepsi sunucudan ölçülmüş değerlerdir; ölçülemeyen alan "—"
 * gösterir ve nedenini yazar.
 *
 * Düşen ölçüm neden ayrı bir kart
 * -------------------------------
 * Kuyruk dolduğunda en eski ölçüm düşürülür. Bu sessiz kalsaydı, ekrandaki
 * üretim gerçeğin altında kalır ve kimse nedenini bilemezdi. Kayıp sayısı
 * sıfır olduğunda kart yeşil değil **nötr**dür: "hiç kayıp yok" ile "henüz
 * ölçülmedi" aynı şey değildir.
 */

import { memo } from "react";
import { Activity, Gauge, Layers, TriangleAlert, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  STREAM_HEALTH_LABEL,
  describePollRate,
  describeQueue,
  describeThroughput,
  pressureWarning,
  type ReconnectState,
  type StreamStats,
} from "../../lib/stream";
import { describeReconnect } from "../../lib/stream";
import { Badge, Card, SectionTitle } from "../ui/Primitives";
import { NOT_MEASURED } from "./monitoringStyles";
import type { BadgeTone } from "../ui/Primitives";

const HEALTH_TONE: Record<string, BadgeTone> = {
  running: "good",
  idle: "info",
  backpressure: "warning",
  failing: "bad",
  stopped: "neutral",
};

interface StreamCard {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}

function cards(stats: StreamStats | null): StreamCard[] {
  const dispatcher = stats?.dispatcher ?? null;

  return [
    {
      key: "throughput",
      label: "Olay hızı",
      value:
        dispatcher?.eventsPerSecond === null || dispatcher === null
          ? NOT_MEASURED
          : `${dispatcher.eventsPerSecond.toFixed(1)}`,
      hint: describeThroughput(stats),
      icon: Activity,
    },
    {
      key: "poll",
      label: "Yoklama",
      value: stats?.pollRateHz === null || stats === null ? NOT_MEASURED : `${stats.pollRateHz.toFixed(2)}`,
      hint: describePollRate(stats),
      icon: Waves,
    },
    {
      key: "queue",
      label: "Kuyruk",
      value: describeQueue(stats),
      hint:
        dispatcher === null
          ? "Kuyruk okunmadı"
          : `Tepe ${dispatcher.queue.peakDepth}`,
      icon: Layers,
    },
    {
      key: "dropped",
      label: "Düşen ölçüm",
      value: dispatcher === null ? NOT_MEASURED : String(dispatcher.queue.dropped),
      hint:
        dispatcher === null
          ? "Ölçülmedi"
          : dispatcher.lossRatio === null
            ? "Kayıp oranı ölçülmedi"
            : `Kayıp %${(dispatcher.lossRatio * 100).toFixed(1)}`,
      icon: TriangleAlert,
    },
    {
      key: "latency",
      label: "Gecikme",
      value:
        dispatcher?.avgLatencyMs === null || dispatcher === null
          ? NOT_MEASURED
          : `${Math.round(dispatcher.avgLatencyMs)} ms`,
      hint:
        dispatcher?.maxLatencyMs === null || dispatcher === null
          ? "Gecikme ölçülmedi"
          : `En yüksek ${Math.round(dispatcher.maxLatencyMs)} ms`,
      icon: Gauge,
    },
  ];
}

interface StreamHealthPanelProps {
  stats: StreamStats | null;
  reconnect: ReconnectState;
  connected: boolean;
}

function StreamHealthPanelInner({
  stats,
  reconnect,
  connected,
}: StreamHealthPanelProps) {
  const warning = pressureWarning(stats);
  const health = stats?.health ?? "stopped";

  return (
    <Card>
      <SectionTitle
        title="Cihaz Akışı"
        description={describeReconnect(reconnect)}
        action={
          <div className="flex items-center gap-1.5">
            <Badge tone={connected ? "good" : "neutral"}>
              {connected ? "Akış açık" : "Akış kapalı"}
            </Badge>
            <Badge tone={HEALTH_TONE[health] ?? "neutral"}>
              {STREAM_HEALTH_LABEL[health]}
            </Badge>
          </div>
        }
      />

      {warning !== null && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {warning}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards(stats).map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2"
          >
            <dt className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              <card.icon className="h-3 w-3" />
              {card.label}
            </dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {card.value}
            </dd>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              {card.hint}
            </p>
          </div>
        ))}
      </dl>

      {stats !== null && stats.streams > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          {stats.running}/{stats.streams} akış çalışıyor · işlenen{" "}
          {stats.dispatcher.processed} ölçüm · elenen {stats.dispatcher.duplicates}{" "}
          yineleme
        </p>
      )}
    </Card>
  );
}

export const StreamHealthPanel = memo(StreamHealthPanelInner);
