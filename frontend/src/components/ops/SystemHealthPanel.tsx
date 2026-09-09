/**
 * Sistem sağlığı paneli.
 *
 * İki soruyu ayrı ayrı yanıtlar: süreç ayakta mı (**sağlık**) ve istek
 * gönderilebilir mi (**hazırlık**). İkisini tek göstergeye indirgemek, bir
 * dakikalığına yavaşlayan veritabanı yüzünden bütün kapsayıcıların yeniden
 * başlatılmasına yol açardı.
 *
 * Ölçülemeyen değer "—" gösterir ve nedeni panelin altında yazar.
 */

import { memo } from "react";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Cpu,
  Gauge,
  MemoryStick,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CHECK_LABEL,
  EMPTY,
  formatCpu,
  formatMemory,
  formatRatio,
  formatUptime,
  measurementNotice,
  type EnvironmentReport,
  type HealthStatus,
  type ProcessMetrics,
  type ReadinessStatus,
} from "../../lib/ops";
import { Badge, Card, SectionTitle } from "../ui/Primitives";

interface MetricCard {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}

function cards(metrics: ProcessMetrics | null): MetricCard[] {
  return [
    {
      key: "uptime",
      label: "Çalışma süresi",
      value: formatUptime(metrics?.uptimeMs ?? null),
      hint: metrics === null ? "Okunmadı" : "Süreç ayakta",
      icon: Timer,
    },
    {
      key: "memory",
      label: "Bellek",
      value: formatMemory(metrics?.memoryMb ?? null),
      hint: metrics?.memoryMb === null ? "Ölçülemedi" : "Süreç belleği",
      icon: MemoryStick,
    },
    {
      key: "cpu",
      label: "İşlemci",
      value: formatCpu(metrics?.cpuPercent ?? null),
      hint:
        metrics?.cpuPercent === null
          ? "İlk ölçüm henüz alınmadı"
          : "Süreç kullanımı",
      icon: Cpu,
    },
    {
      key: "requests",
      label: "İstek",
      value: metrics === null ? EMPTY : String(metrics.requests),
      hint: metrics === null ? "Okunmadı" : `${metrics.errors} hata`,
      icon: Activity,
    },
    {
      key: "error-rate",
      label: "Hata oranı",
      value: formatRatio(metrics?.errorRate ?? null),
      hint:
        metrics?.errorRate === null
          ? "Henüz istek görülmedi"
          : "Toplam istekler üzerinden",
      icon: Gauge,
    },
  ];
}

interface SystemHealthPanelProps {
  health: HealthStatus | null;
  readiness: ReadinessStatus | null;
  metrics: ProcessMetrics | null;
  environment: EnvironmentReport | null;
}

function SystemHealthPanelInner({
  health,
  readiness,
  metrics,
  environment,
}: SystemHealthPanelProps) {
  const notice = measurementNotice(metrics);

  return (
    <Card>
      <SectionTitle
        title="Sistem Sağlığı"
        description={
          health === null
            ? "Sunucudan yanıt alınmadı."
            : `Sürüm ${health.version} · ${readiness?.environment ?? "ortam bilinmiyor"}`
        }
        action={
          <div className="flex items-center gap-1.5">
            <Badge tone={health === null ? "neutral" : "good"}>
              {health === null ? "Bilinmiyor" : "Ayakta"}
            </Badge>
            <Badge
              tone={
                readiness === null ? "neutral" : readiness.ready ? "good" : "bad"
              }
            >
              {readiness === null
                ? "Hazırlık bilinmiyor"
                : readiness.ready
                  ? "Hazır"
                  : "Hazır değil"}
            </Badge>
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards(metrics).map((card) => (
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

      {notice !== null && (
        <p className="mt-2 text-[11px] text-slate-500">{notice}</p>
      )}

      {readiness !== null && readiness.checks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {readiness.checks.map((check) => (
            <li
              key={check.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-2"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
                {check.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <CircleAlert className="h-3.5 w-3.5 text-red-600" />
                )}
                {CHECK_LABEL[check.name] ?? check.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-500">
                {check.detail}
                {check.latencyMs !== null && ` · ${check.latencyMs} ms`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {environment !== null && environment.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-900">
            Yapılandırma eksik
          </p>
          <ul className="mt-1 space-y-0.5">
            {environment.errors.map((finding) => (
              <li key={finding.key} className="text-[11px] text-red-800">
                <span className="font-medium">{finding.key}</span> — {finding.remedy}
              </li>
            ))}
          </ul>
        </div>
      )}

      {environment !== null && environment.warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">Uyarılar</p>
          <ul className="mt-1 space-y-0.5">
            {environment.warnings.map((finding) => (
              <li key={finding.key} className="text-[11px] text-amber-800">
                <span className="font-medium">{finding.key}</span> — {finding.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export const SystemHealthPanel = memo(SystemHealthPanelInner);
