/**
 * Runtime tanılama ekranı.
 *
 * Sekiz ölçüt sunucudaki gerçek sayaçlardan gelir: olay verimi, kuyruk
 * derinliği, düşürülen olay, akış gecikmesi, yeniden bağlanma, son veri yaşı,
 * telemetri yazma hızı ve bekleyen ölçüm.
 *
 * Ekranın amacı sistemin ne bildiğini **ve ne bilmediğini** göstermektir:
 * ölçülemeyen her ölçüt "—" ile birlikte nedenini yazar. Sıfır gösterilseydi,
 * hiç olay işlememiş bir sistem arızalı sanılırdı.
 */

import { memo } from "react";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";
import {
  formatAge,
  historySpanMs,
  metricNote,
  metricValue,
  persistenceWarning,
  reportCaption,
  streamCaption,
  type DiagnosticLevel,
  type DiagnosticMetric,
  type StreamLiveness,
} from "../../lib/diagnostics";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import type { BadgeTone } from "../ui/Primitives";
import { useDiagnostics } from "./useDiagnostics";

/**
 * Ölçüt durumunun rengi.
 *
 * "Ölçülmedi" nötr görünür: ölçülemeyen bir şey ne iyi ne kötüdür ve yeşil
 * gösterilseydi eksik ölçüm sağlıklı sanılırdı.
 */
const LEVEL_TONE: Record<DiagnosticLevel, BadgeTone> = {
  ok: "good",
  warning: "warning",
  critical: "bad",
  unknown: "neutral",
};

interface RuntimeDiagnosticsPageProps {
  enabled?: boolean;
}

function RuntimeDiagnosticsPageInner({ enabled = true }: RuntimeDiagnosticsPageProps) {
  const diagnostics = useDiagnostics({ enabled });
  const report = diagnostics.report;
  const warning = persistenceWarning(report.persistenceMode);
  const span = historySpanMs(report);

  return (
    <div className="space-y-4">
      {diagnostics.error !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold text-amber-900">Tanılama okunamadı.</p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              {diagnostics.error} Ekrandaki değerler son okunan yanıta aittir.
            </p>
          </div>
        </div>
      )}

      <Card className="p-4">
        <SectionTitle
          title="Runtime Tanılama"
          description={reportCaption(report)}
          action={
            <div className="flex items-center gap-2">
              <Badge tone={LEVEL_TONE[report.level]}>{report.levelLabel}</Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={() => void diagnostics.refresh()}
                busy={diagnostics.loading}
              >
                Yenile
              </Button>
            </div>
          }
        />

        {report.metrics.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Tanılama verisi henüz yüklenmedi"
            description="Sunucudan yanıt alındığında olay verimi, kuyruk derinliği ve telemetri hızı burada görünür."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.metrics.map((metric) => (
              <MetricCell key={metric.id} metric={metric} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle
            title="Akış Canlılığı"
            description="Her akışın son veri yaşı ve kaç kez kopup geri geldiği."
          />
          {report.streams.length === 0 ? (
            <p className="text-xs text-slate-500">
              İzlenen akış yok. Bir bağlantı için akış başlatıldığında burada görünür.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.streams.map((stream) => (
                <StreamRow key={stream.connectorId} stream={stream} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Telemetri Saklama"
            description="Kayıtlı satır sayısı, geçmişin süresi ve temizleme işi."
          />

          {warning !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-800">{warning}</p>
            </div>
          )}

          <dl className="space-y-2 text-sm">
            <Row label="Kayıtlı satır" value={report.telemetryRows.toLocaleString("tr-TR")} />
            <Row
              label="Geçmiş süresi"
              value={span === null ? "—" : formatAge(span)}
              note={span === null ? "Tablo boş" : undefined}
            />
            <Row label="Saklama süresi" value={`${report.cleanup.retentionDays} gün`} />
            <Row
              label="Temizleme"
              value={
                report.cleanup.lastRunMs === null
                  ? "—"
                  : `${report.cleanup.runs} tur · ${report.cleanup.totalDeleted} satır silindi`
              }
              note={report.cleanup.lastRunMs === null ? "Henüz çalışmadı" : undefined}
            />
            <Row
              label="Kalıcılık"
              value={report.persistenceMode === "database" ? "Veritabanı" : report.persistenceMode}
            />
          </dl>

          {report.cleanup.lastError !== null && (
            <p className="mt-2 text-[11px] text-red-700">
              Son temizleme hatası: {report.cleanup.lastError}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Tek bir ölçüt kutusu. */
function MetricCell({ metric }: { metric: DiagnosticMetric }) {
  const note = metricNote(metric);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {metric.label}
        </p>
        <Badge tone={LEVEL_TONE[metric.level]}>{metric.measured ? "Ölçüldü" : "—"}</Badge>
      </div>
      <p className="mt-1 text-lg font-semibold text-slate-900">{metricValue(metric)}</p>
      {note !== "" && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

/** Bir akışın canlılık satırı. */
function StreamRow({ stream }: { stream: StreamLiveness }) {
  const tone: BadgeTone =
    stream.liveness === "live"
      ? "good"
      : stream.liveness === "idle"
        ? "warning"
        : stream.liveness === "stale"
          ? "bad"
          : "neutral";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
      <span className="min-w-0 break-words text-xs text-slate-700">{streamCaption(stream)}</span>
      <Badge tone={tone}>{stream.livenessLabel}</Badge>
    </li>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-right">
        <span className="text-sm font-medium text-slate-900">{value}</span>
        {note && <p className="text-[11px] text-slate-500">{note}</p>}
      </dd>
    </div>
  );
}

export const RuntimeDiagnosticsPage = memo(RuntimeDiagnosticsPageInner);
