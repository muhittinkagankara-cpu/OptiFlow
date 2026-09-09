/**
 * Sağ sütun: hatırlatıcılar ve takvim.
 *
 * İkisi de saf işlevlerden beslenir (`buildFollowUps`, `upcomingMeetings`);
 * bu dosyada hiçbir eşik ya da gün hesabı yoktur.
 *
 * Hatırlatıcı ile takvim ayrı tutulur çünkü farklı sorulara bakarlar:
 * hatırlatıcı "neyi unuttum?", takvim "bugün ne var?" der. Tek listede
 * birleştirilselerdi geciken bir iş, yarınki bir toplantının altında kaybolurdu.
 */

import { memo } from "react";
import { BellOff, CalendarDays, CalendarCheck } from "lucide-react";
import {
  BUCKET_LABEL,
  buildFollowUps,
  upcomingMeetings,
  type Lead,
  type Meeting,
  type MeetingBucket,
} from "../../lib/sales";
import { SEVERITY_STYLE } from "./salesStyles";

const BUCKETS: MeetingBucket[] = ["today", "tomorrow", "week"];

function SalesSidePanelInner({
  leads,
  meetings,
  now,
  onOpenLead,
}: {
  leads: Lead[];
  meetings: Meeting[];
  now: Date;
  onOpenLead: (leadId: string) => void;
}) {
  const followUps = buildFollowUps(leads, now);
  const calendar = upcomingMeetings(meetings, now);

  return (
    <div className="space-y-4">
      {/* --- Hatırlatıcılar --- */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          <CalendarCheck className="h-3.5 w-3.5" />
          Hatırlatıcılar
          {followUps.length > 0 && (
            <span className="rounded bg-slate-100 px-1 text-[10px] tabular-nums">
              {followUps.length}
            </span>
          )}
        </h3>

        {followUps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-6 text-center">
            <BellOff className="mx-auto mb-2 h-5 w-5 text-slate-400" />
            <p className="text-xs font-medium text-slate-800">
              Bekleyen iş yok.
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Bir durakta beklemeye başlayan firma burada görünür.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {followUps.map((item, index) => {
              const style = SEVERITY_STYLE[item.severity];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenLead(item.leadId)}
                    style={{ animationDelay: `${index * 40}ms` }}
                    className={`optiflow-enter w-full rounded-xl border px-3 py-2.5 text-left transition-transform duration-200 hover:-translate-y-px focus:outline-none ${style.box}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-slate-900">
                        {item.company}
                      </span>
                      {/* Renk tek başına konuşmaz; seviye yazıyla da verilir. */}
                      <span
                        className={`shrink-0 text-[10px] font-semibold ${style.text}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      {item.text}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Takvim --- */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          <CalendarDays className="h-3.5 w-3.5" />
          Yaklaşan görüşmeler
        </h3>

        <div className="space-y-3">
          {BUCKETS.map((bucket) => (
            <div key={bucket}>
              <p className="mb-1 text-[10px] font-semibold text-slate-500">
                {BUCKET_LABEL[bucket]}
              </p>
              {calendar[bucket].length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[10px] text-slate-500">
                  Görüşme yok
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {calendar[bucket].map((meeting) => (
                    <li key={meeting.id}>
                      <button
                        type="button"
                        onClick={() => onOpenLead(meeting.leadId)}
                        className="optiflow-glass w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition-transform duration-200 hover:-translate-y-px focus:outline-none"
                      >
                        <p className="truncate text-xs font-medium text-slate-900">
                          {meeting.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                          {new Date(meeting.at).toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export const SalesSidePanel = memo(SalesSidePanelInner);
