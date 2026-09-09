/**
 * Runtime durum panosu — sunucudaki bağlantılar ve ölçümleri.
 *
 * Ekrandaki her sayı sunucunun **ölçtüğü** değerdir; ölçülemeyen alan "—"
 * gösterilir. Bir bağlantının "Bağlandı (doğrulandı)" yazması, sunucunun o
 * cihazdan somut bir yanıt aldığı anlamına gelir ve kanıt satırda görünür.
 */

import { Activity, PlayCircle, PlugZap, RefreshCw, StopCircle, Unplug } from "lucide-react";
import {
  BRIDGE_KIND_LABEL,
  BRIDGE_STATUS_LABEL,
  describeStream,
  type BridgeConnection,
  type BridgeSummary,
  type StreamStatus,
} from "../../lib/connectors";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import {
  NOT_MEASURED,
  STATUS_TONE,
  showCount,
  showDuration,
  showLatency,
  showRate,
} from "./runtimeStyles";

interface RuntimeStatusPanelProps {
  connections: BridgeConnection[];
  summary: BridgeSummary | null;
  /** Sunucudaki veri akışları; bağlantı başına eşleştirilir. */
  streams: StreamStatus[];
  isLoading: boolean;
  onRefresh: () => void;
  onDisconnect: (connectionId: string) => void;
  onSubscribe: (connectionId: string) => void;
  onUnsubscribe: (connectionId: string) => void;
}

/** Bağlantıya ait akış kaydı; yoksa `undefined`. */
function streamOf(
  streams: StreamStatus[],
  connectionId: string,
): StreamStatus | undefined {
  return streams.find((stream) => stream.connectionId === connectionId);
}

export function RuntimeStatusPanel({
  connections,
  summary,
  streams,
  isLoading,
  onRefresh,
  onDisconnect,
  onSubscribe,
  onUnsubscribe,
}: RuntimeStatusPanelProps) {
  const cards = [
    {
      label: "Kayıtlı bağlantı",
      value: summary === null ? NOT_MEASURED : showCount(summary.total),
      hint: "Sunucuda tanımlı",
    },
    {
      label: "Doğrulanmış",
      value: summary === null ? NOT_MEASURED : showCount(summary.verifiedEver),
      hint: "Cihazdan yanıt alındı",
    },
    {
      label: "Ortalama gecikme",
      value: showLatency(summary?.avgLatencyMs ?? null),
      hint: "Yalnızca ölçümü olanlar",
    },
    {
      label: "Paket / hata",
      value:
        summary === null
          ? NOT_MEASURED
          : `${showCount(summary.totalPackets)} / ${showCount(summary.totalErrors)}`,
      hint: "Oturum toplamı",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle
          title="Runtime durumu"
          description="Cihazla konuşan taraf sunucudur; tarayıcı yalnızca sonucu okur."
          action={
            <Button size="sm" icon={RefreshCw} busy={isLoading} onClick={onRefresh}>
              Yenile
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card, index) => (
            <Card key={card.label} className="p-4" index={index}>
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900">
                {card.value}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{card.hint}</p>
            </Card>
          ))}
        </div>
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon={PlugZap}
          title="Sunucuda kayıtlı bağlantı yok"
          description="Aşağıdaki formdan bir uç nokta tanımlayın. Bağlantı sunucudan denenir; sonuç ve ölçümler burada görünür."
        />
      ) : (
        <ul className="space-y-2">
          {connections.map((connection) => (
            <li key={connection.connectionId}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="break-words">{connection.label}</span>
                      <Badge tone="neutral">{BRIDGE_KIND_LABEL[connection.kind]}</Badge>
                      <Badge tone={STATUS_TONE[connection.status]}>
                        {BRIDGE_STATUS_LABEL[connection.status]}
                      </Badge>
                    </p>
                    <p className="mt-0.5 break-all font-mono text-xs text-slate-500">
                      {connection.endpoint}
                      {connection.port === null ? "" : `:${connection.port}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {streamOf(streams, connection.connectionId)?.running === true ? (
                      <Button
                        size="sm"
                        icon={StopCircle}
                        onClick={() => onUnsubscribe(connection.connectionId)}
                      >
                        Akışı durdur
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={PlayCircle}
                        disabled={!connection.everVerified}
                        title={
                          connection.everVerified
                            ? "Sürekli veri akışını başlat"
                            : "Akış yalnızca doğrulanmış bir bağlantı için açılır."
                        }
                        onClick={() => onSubscribe(connection.connectionId)}
                      >
                        Veri akışını başlat
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Unplug}
                      onClick={() => onDisconnect(connection.connectionId)}
                    >
                      Kapat
                    </Button>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">Gecikme (ort.)</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showLatency(connection.health.avgLatencyMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">En kötü</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showLatency(connection.health.maxLatencyMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Çalışma süresi</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showDuration(connection.health.uptimeMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Hata oranı</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showRate(connection.health.errorRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Paket</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showCount(connection.health.packets)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Hata</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showCount(connection.health.errors)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Yeniden bağlanma</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {showCount(connection.health.reconnects)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Doğrulandı mı?</dt>
                    <dd className="font-semibold text-slate-900">
                      {connection.everVerified ? "Evet" : "Hayır"}
                    </dd>
                  </div>
                </dl>

                {streamOf(streams, connection.connectionId) !== undefined && (
                  <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                    Veri akışı: {describeStream(streamOf(streams, connection.connectionId)!)}
                  </p>
                )}

                {connection.lastProbe !== null && (
                  <p
                    className={`mt-3 break-words rounded-lg border p-2.5 text-xs leading-relaxed ${
                      connection.lastProbe.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-red-200 bg-red-50 text-red-900"
                    }`}
                  >
                    {connection.lastProbe.detail}
                    {connection.lastProbe.evidence !== null && (
                      <span className="mt-1 block font-mono text-[11px]">
                        Kanıt: {connection.lastProbe.evidence}
                      </span>
                    )}
                  </p>
                )}

                {connection.health.lastError !== null && !connection.everVerified && (
                  <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
                    <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Bu bağlantı hiç doğrulanmadı; ekranda hiçbir üretim verisi bu
                    kaynaktan gelmiyor.
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
