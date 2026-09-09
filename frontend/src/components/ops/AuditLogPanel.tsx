/**
 * Denetim günlüğü paneli.
 *
 * "Bu alarmı kim kapattı?", "bu bağlantıyı kim durdurdu?" sorularının yanıtı
 * burada okunur. Panelde **silme düğmesi yoktur** ve olmaması bilinçlidir:
 * sonradan düzeltilebilen bir denetim günlüğü kanıt değeri taşımaz.
 *
 * Kayıtlar diske yazılmıyorsa panel bunu söyler; sessiz kalsaydı, yeniden
 * başlatmada kaybolan bir günlük kalıcı sanılırdı.
 */

import { memo, useMemo, useState } from "react";
import { CircleAlert, FileClock, ShieldQuestion } from "lucide-react";
import {
  formatTimestamp,
  type AuditEntry,
  type AuditSummary,
} from "../../lib/ops";
import { Badge, Card, EmptyState, SectionTitle } from "../ui/Primitives";

interface AuditLogPanelProps {
  entries: AuditEntry[];
  summary: AuditSummary | null;
  loaded: boolean;
}

function AuditLogPanelInner({ entries, summary, loaded }: AuditLogPanelProps) {
  const [filter, setFilter] = useState<string>("all");

  const actions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      seen.set(entry.action, entry.actionLabel);
    }
    return [...seen.entries()];
  }, [entries]);

  const visible = useMemo(
    () =>
      filter === "all" ? entries : entries.filter((item) => item.action === filter),
    [entries, filter],
  );

  return (
    <Card>
      <SectionTitle
        title="Denetim Günlüğü"
        description="Kritik her işlem: kim, ne zaman, neye, ne yaptı. Kayıtlar yalnızca eklenir."
        action={
          summary === null ? undefined : (
            <div className="flex items-center gap-1.5">
              <Badge tone={summary.persistent ? "good" : "warning"}>
                {summary.persistent ? "Kalıcı" : "Yalnızca bellekte"}
              </Badge>
              {summary.failures > 0 && (
                <Badge tone="bad">{summary.failures} başarısız</Badge>
              )}
            </div>
          )
        }
      />

      {summary !== null && summary.writeErrors > 0 && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {summary.writeErrors} kayıt diske yazılamadı; günlük eksik olabilir.
            {summary.lastError !== null && ` Son hata: ${summary.lastError}`}
          </span>
        </p>
      )}

      {actions.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {[["all", "Hepsi"] as [string, string], ...actions].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                filter === id
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={loaded ? FileClock : ShieldQuestion}
          title={loaded ? "Henüz kayıt yok." : "Günlük okunmadı."}
          description={
            loaded
              ? "Bir bağlantı kurulduğunda, bir alarm onaylandığında ya da yedek alındığında satır burada belirir."
              : "Sunucudan yanıt alınmadı; kayıtların olup olmadığı bilinmiyor."
          }
        />
      ) : (
        <ul className="space-y-1">
          {visible.slice(0, 50).map((entry) => (
            <li
              key={`${entry.orgId}-${entry.sequence}`}
              className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-900">
                  {entry.actionLabel}
                  <span className="ml-1.5 font-normal text-slate-600">
                    {entry.resource}
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {entry.actor} · {formatTimestamp(entry.atMs)} · #{entry.sequence}
                </p>
              </div>
              <Badge tone={entry.outcome === "failure" ? "bad" : "good"}>
                {entry.outcomeLabel}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export const AuditLogPanel = memo(AuditLogPanelInner);
