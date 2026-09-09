/**
 * Olay günlüğü — bağlandı, koptu, tekrar bağlandı, veri geldi, hata.
 *
 * Bir bağlantı sorununun tek kanıtı budur: "sabah 8'de üç kez koptu" cümlesi,
 * ancak zaman damgalı bir kayıt varsa söylenebilir. Bu yüzden çözülen olaylar
 * da listede kalır.
 *
 * Süzgeç seviyeye göredir; bağlantıya göre süzme, bağlantı kartından
 * yapılabilir. İki süzgeci birden koymak, dar ekranda listeden çok yer kaplardı.
 */

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import {
  EVENT_KIND_LABEL,
  type ConnectorEvent,
  type EventLevel,
} from "../../lib/connectors";
import { relativeTime } from "../../lib/connectors";
import { Card } from "../ui/Primitives";
import { EVENT_TONE, TONE_CLASS } from "./connectorStyles";

type Filter = "all" | EventLevel;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Hepsi" },
  { id: "critical", label: "Kritik" },
  { id: "warning", label: "Uyarı" },
  { id: "info", label: "Bilgi" },
];

interface EventLogPanelProps {
  events: ConnectorEvent[];
  nowMs: number;
  /** Listede gösterilecek en fazla satır. */
  limit?: number;
}

export function EventLogPanel({ events, nowMs, limit = 40 }: EventLogPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    const filtered =
      filter === "all" ? events : events.filter((item) => item.level === filter);
    return filtered.slice(0, limit);
  }, [events, filter, limit]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Olay günlüğü</h3>
        <nav className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors duration-200 focus:outline-none ${
                filter === item.id
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          {events.length === 0
            ? "Henüz olay yok. Bir bağlantıyı test ettiğinizde ya da bağladığınızda kayıtlar burada birikir."
            : "Bu süzgeçte olay yok."}
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {shown.map((event) => {
            const tone = TONE_CLASS[EVENT_TONE[event.level]];
            return (
              <li
                key={event.id}
                className="flex items-start gap-2.5 border-b border-slate-100 pb-1.5 last:border-0"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-900">{event.text}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {EVENT_KIND_LABEL[event.kind]} ·{" "}
                    {relativeTime(event.atMs, nowMs)}
                    {event.connectorName !== null && ` · ${event.connectorName}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {events.length > shown.length && filter === "all" && (
        <p className="mt-2 text-[11px] text-slate-500">
          Son {shown.length} olay gösteriliyor; günlükte {events.length} kayıt var.
        </p>
      )}
    </Card>
  );
}
