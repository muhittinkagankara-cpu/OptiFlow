/**
 * Aktivite geçmişi.
 *
 * Örnek olaylar listede kalır ama rozetleri vardır ve tek tıkla gizlenebilir:
 * "bu raporu kim indirdi?" sorusunu yanıtlayan kişi, yanıtın gerçek bir kayda
 * mı yoksa bir örneğe mi dayandığını görmek zorundadır.
 */

import { useState } from "react";
import { History, Search } from "lucide-react";
import {
  ACTIVITY_LABEL,
  EMPTY_ACTIVITY_FILTER,
  ORIGIN_LABEL,
  describeEvent,
  eventsByOrigin,
  filterEvents,
  relativeTime,
  type ActivityEvent,
  type ActivityFilter,
  type ActivityKind,
} from "../../lib/team";
import { Badge, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { ORIGIN_TONE } from "./teamStyles";

interface ActivityTimelineProps {
  events: ActivityEvent[];
  nowMs: number;
}

export function ActivityTimeline({ events, nowMs }: ActivityTimelineProps) {
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_ACTIVITY_FILTER);
  const visible = filterEvents(events, filter);
  const origins = eventsByOrigin(events);

  return (
    <div>
      <SectionTitle
        title="Aktivite geçmişi"
        description={`${origins.local + origins.account} gerçek kayıt, ${origins.fixture} örnek kayıt.`}
      />

      <Card className="p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filter.query}
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
              placeholder="Kişi, olay ya da konu ara"
              aria-label="Geçmişte ara"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-brand-400 focus:outline-none"
            />
          </label>

          <select
            value={filter.kind}
            onChange={(event) =>
              setFilter({ ...filter, kind: event.target.value as ActivityKind | "all" })
            }
            aria-label="Olay türüne göre süz"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
          >
            <option value="all">Tüm olaylar</option>
            {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {ACTIVITY_LABEL[kind]}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-600">
            <input
              type="checkbox"
              checked={filter.hideFixtures}
              onChange={(event) =>
                setFilter({ ...filter, hideFixtures: event.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Yalnızca gerçek kayıtlar
          </label>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={History}
            title="Gösterilecek olay yok"
            description="Süzgeci genişletin. Bu cihazda yapılan işler (davet, rol değişikliği, yorum) buraya kendiliğinden düşer."
          />
        ) : (
          <ol className="space-y-2">
            {visible.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm text-slate-800">
                    {describeEvent(event)}
                  </p>
                  {event.detail !== null && (
                    <p className="mt-0.5 break-words text-xs text-slate-500">
                      {event.detail}
                    </p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {relativeTime(event.atMs, nowMs)}
                  </span>
                  <Badge tone={ORIGIN_TONE[event.origin]}>
                    {ORIGIN_LABEL[event.origin]}
                  </Badge>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
