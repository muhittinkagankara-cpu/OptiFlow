/**
 * Tek bir bağlantının kartı.
 *
 * Kart hiçbir hesap yapmaz: durum, gecikme, son senkron ve yeniden deneme
 * cümlesi `lib/connectors` içinde üretilir. Buradaki tek karar, hangi bilginin
 * ne kadar büyük görüneceğidir.
 */

import { Plug, PlugZap, Settings2, Zap } from "lucide-react";
import {
  CONNECTOR_DESCRIPTION,
  CONNECTOR_LABEL,
  STATUS_LABEL,
  averageLatency,
  relativeTime,
  retryLabel,
  statusTone,
  type ConnectorConfig,
  type ConnectorRuntime,
} from "../../lib/connectors";
import { Button, Card } from "../ui/Primitives";
import {
  KIND_ICON,
  TONE_CLASS,
  pulseClass,
  showCount,
  showLatency,
} from "./connectorStyles";

interface ConnectorCardProps {
  config: ConnectorConfig;
  runtime: ConnectorRuntime;
  nowMs: number;
  /** Bu bağlantının kaç düğümü var. */
  sourceCount: number;
  /** Ayar hatası sayısı; sıfırsa rozet gösterilmez. */
  errorCount: number;
  busy: boolean;
  index: number;
  onTest: () => void;
  onToggleConnection: () => void;
  onSettings: () => void;
}

export function ConnectorCard({
  config,
  runtime,
  nowMs,
  sourceCount,
  errorCount,
  busy,
  index,
  onTest,
  onToggleConnection,
  onSettings,
}: ConnectorCardProps) {
  const Icon = KIND_ICON[config.kind];
  const tone = TONE_CLASS[statusTone(runtime.status)];
  const retry = retryLabel(runtime, nowMs);
  const isConnected = runtime.status === "connected";

  return (
    <Card className="optiflow-glass p-4" index={index}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {config.name}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {CONNECTOR_LABEL[config.kind]} · {CONNECTOR_DESCRIPTION[config.kind]}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${pulseClass(runtime.status)}`}
          />
          {STATUS_LABEL[runtime.status]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Row label="Son senkron" value={relativeTime(runtime.lastSyncAtMs, nowMs)} />
        <Row
          label="Gecikme"
          value={showLatency(averageLatency(runtime.latencySamplesMs))}
        />
        <Row label="Alınan kayıt" value={showCount(runtime.recordsReceived)} />
        <Row
          label="Düğüm"
          value={sourceCount === 0 ? "—" : `${sourceCount} adet`}
        />
      </dl>

      {retry !== null && (
        <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          {retry}
        </p>
      )}

      {runtime.detail !== null && retry === null && (
        <p className="mt-2.5 truncate text-[11px] text-slate-500" title={runtime.detail}>
          {runtime.detail}
        </p>
      )}

      {errorCount > 0 && (
        <p className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          {errorCount} ayar hatası bağlanmayı engelliyor.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" icon={Zap} onClick={onTest} busy={busy}>
          Test
        </Button>
        <Button
          size="sm"
          variant={isConnected ? "secondary" : "primary"}
          icon={isConnected ? Plug : PlugZap}
          onClick={onToggleConnection}
        >
          {isConnected ? "Kes" : "Bağlan"}
        </Button>
        <Button size="sm" variant="ghost" icon={Settings2} onClick={onSettings}>
          Ayarlar
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-slate-500">{label}</dt>
      <dd className="truncate font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
