/**
 * Üretim izleme ekranı.
 *
 * Üç bölüm tek bir gerçeği okur: alarm merkezi, zaman çizelgesi ve köprü
 * sağlığı. Hepsi `useMonitoring` üzerinden aynı sunucu yanıtından beslenir;
 * ekranların kendi eşiklerini uygulaması, aynı arızanın üç farklı biçimde
 * görünmesine yol açardı.
 */

import { memo } from "react";
import { HeartPulse, RefreshCw, TriangleAlert } from "lucide-react";
import { formatPercent } from "../../lib/monitoring";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";
import { NOT_MEASURED, scoreTone } from "./monitoringStyles";
import { PayloadInspector } from "./PayloadInspector";
import { ProductionStatusPanel } from "./ProductionStatusPanel";
import { StreamHealthPanel } from "./StreamHealthPanel";
import { ProductionTimeline } from "./ProductionTimeline";
import { UnifiedAlarmPanel } from "./UnifiedAlarmPanel";
import { useLiveStream } from "./useLiveStream";
import { useMonitoring } from "./useMonitoring";

interface MonitoringPageProps {
  /** Vardiyanın planlanan süresi; verilmezse OEE hesaplanmaz. */
  plannedTimeMs?: number;
  idealCycleSeconds?: number;
}

function MonitoringPageInner({
  plannedTimeMs,
  idealCycleSeconds,
}: MonitoringPageProps) {
  const monitoring = useMonitoring({ plannedTimeMs, idealCycleSeconds });
  /*
   * Canlı akış ayrı bir kancadır: alarm ve KPI yoklamayla okunur (susan bir
   * cihaz hiçbir olay üretmez), cihaz ölçümleri ise akışla gelir.
   */
  const live = useLiveStream();

  return (
    <div className="space-y-4">
      {monitoring.error !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold text-amber-900">
              İzleme verisi okunamadı.
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              {monitoring.error} Ekrandaki değerler son okunan yanıta aittir.
            </p>
          </div>
        </div>
      )}

      <ProductionStatusPanel status={monitoring.status} />

      <StreamHealthPanel
        stats={live.stats}
        reconnect={live.reconnect}
        connected={live.connected}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <UnifiedAlarmPanel
          alarms={monitoring.alarms}
          history={monitoring.history}
          onAcknowledge={(id) => void monitoring.acknowledge(id)}
          onSilence={(id) => void monitoring.silence(id)}
          onUnsilence={(id) => void monitoring.unsilence(id)}
          loaded={monitoring.loaded}
        />

        <Card>
          <SectionTitle
            title="Köprü Sağlığı"
            description="Çalışma süresi, hata oranı, yeniden bağlanma ve gecikmenin ağırlıklı bileşimi."
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={() => void monitoring.refresh()}
              >
                Yenile
              </Button>
            }
          />

          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <HeartPulse className="h-5 w-5 text-slate-400" />
            <div>
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {monitoring.health === null || monitoring.health.score === null
                  ? NOT_MEASURED
                  : formatPercent(monitoring.health.score, 0).replace("%", "")}
              </p>
              <p className="text-[11px] text-slate-500">
                {monitoring.health?.label ?? "Ölçülmedi"}
                {monitoring.health !== null &&
                  ` · ${monitoring.health.measured}/${monitoring.health.total} bağlantı ölçüldü`}
              </p>
            </div>
          </div>

          {monitoring.health !== null && monitoring.health.connections.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {monitoring.health.connections.map((connection) => (
                <li
                  key={connection.connectionId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-2"
                >
                  <span className="text-xs font-medium text-slate-800">
                    {connection.connectionId}
                  </span>
                  <div className="flex items-center gap-2">
                    {connection.missing.length > 0 && (
                      <span className="text-[10px] text-slate-500">
                        {connection.missing.length} bileşen ölçülmedi
                      </span>
                    )}
                    <Badge tone={scoreTone(connection.label)}>
                      {connection.score === null
                        ? NOT_MEASURED
                        : connection.score.toFixed(0)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[11px] text-slate-500">
              Kayıtlı bağlantı yok. Skor, ölçüm olmadan hesaplanmaz; sıfır
              göstermek hiç izlenmemiş bir köprüyü "tamamen bozuk" diye
              raporlamak olurdu.
            </p>
          )}
        </Card>
      </div>

      <PayloadInspector buffer={live.buffer} nowMs={Date.now()} />

      <ProductionTimeline entries={monitoring.timeline} loaded={monitoring.loaded} />
    </div>
  );
}

export const MonitoringPage = memo(MonitoringPageInner);
