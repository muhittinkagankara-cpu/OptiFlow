/**
 * Üretim zaman çizelgesi.
 *
 * Duruşlar ve alarmlar tek akışta, saate göre gruplanmış olarak görünür. İki
 * ayrı liste olsaydı, "makine neden durdu?" sorusunun yanıtı için operatörün
 * iki listeyi kafasında eşleştirmesi gerekirdi; oysa yanıt çoğu zaman duruşun
 * hemen öncesindeki alarmdadır.
 *
 * Bileşen yalnızca çizer: süzme, gruplama ve süre hesabı `lib/monitoring`
 * içindedir ve orada sınanır.
 */

import { memo, useMemo, useState } from "react";
import { Clock, Filter, ListX, TriangleAlert, Wrench } from "lucide-react";
import {
  ALARM_STATE_LABEL,
  describeEntry,
  entrySeverity,
  filterByType,
  formatClock,
  formatDuration,
  groupByHour,
  summarize,
  type TimelineEntry,
} from "../../lib/monitoring";
import { Badge, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { ENTRY_BORDER, NOT_MEASURED, SEVERITY_TONE } from "./monitoringStyles";

type TimelineFilter = "all" | "downtime" | "alarm";

const FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "Hepsi" },
  { id: "downtime", label: "Duruşlar" },
  { id: "alarm", label: "Alarmlar" },
];

interface ProductionTimelineProps {
  entries: TimelineEntry[];
  /** Sunucudan hiç yanıt alınmadıysa ekran bunu söyler. */
  loaded: boolean;
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const severity = entrySeverity(entry);
  const Icon = entry.type === "downtime" ? Wrench : TriangleAlert;

  return (
    <li
      className={`flex flex-col gap-1 border-l-2 ${ENTRY_BORDER[severity]} bg-white/60 py-2 pl-3 pr-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-800">
            {describeEntry(entry)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {formatClock(entry.atMs)}
            {entry.endMs !== null && ` – ${formatClock(entry.endMs)}`}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pl-5 sm:pl-0">
        <Badge tone={SEVERITY_TONE[severity]}>
          {entry.type === "downtime" ? "Duruş" : "Alarm"}
        </Badge>
        {entry.state !== null && (
          <Badge tone="neutral">{ALARM_STATE_LABEL[entry.state]}</Badge>
        )}
        <span className="text-[11px] font-semibold tabular-nums text-slate-700">
          {formatDuration(entry.durationMs)}
        </span>
      </div>
    </li>
  );
}

function ProductionTimelineInner({ entries, loaded }: ProductionTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const visible = useMemo(
    () => filterByType(entries, filter),
    [entries, filter],
  );
  const groups = useMemo(() => groupByHour(visible), [visible]);
  const totals = useMemo(() => summarize(entries), [entries]);

  return (
    <Card>
      <SectionTitle
        title="Üretim Zaman Çizelgesi"
        description="Duruşlar ve alarmlar tek akışta; bir duruşun nedeni çoğu zaman hemen öncesindeki alarmdır."
        action={
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    filter === item.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Duruş", value: String(totals.downtimeCount) },
          { label: "Alarm", value: String(totals.alarmCount) },
          { label: "Süren", value: String(totals.openCount) },
          {
            label: "Toplam duruş",
            value:
              totals.downtimeTotalMs === null
                ? NOT_MEASURED
                : formatDuration(totals.downtimeTotalMs),
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2"
          >
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {groups.length === 0 ? (
        <EmptyState
          icon={ListX}
          title={loaded ? "Bu aralıkta kayıt yok." : "Veri okunmadı."}
          description={
            loaded
              ? "Bir makine durduğunda ya da bir alarm açıldığında satır burada belirir."
              : "Sunucudan henüz yanıt alınmadı; okunan bir ölçüm olmadan bu ekran boş kalır."
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.hourStartMs}>
              <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Clock className="h-3 w-3" />
                {group.label}
                <span className="font-normal text-slate-400">
                  · {group.entries.length} kayıt
                </span>
              </h3>
              <ul className="space-y-1">
                {group.entries.map((entry, index) => (
                  <TimelineRow
                    key={`${entry.type}-${entry.atMs}-${entry.machineId ?? index}`}
                    entry={entry}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

export const ProductionTimeline = memo(ProductionTimelineInner);
