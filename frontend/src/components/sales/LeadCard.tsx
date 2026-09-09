/**
 * Firma kartı — hem listede hem kanban sütununda aynı kart kullanılır.
 *
 * Tek bileşen olması bilinçlidir: iki yerde ayrı yazılsaydı biri demo
 * bilgisini gösterir, öteki göstermez ve aynı firma iki ekranda farklı
 * görünürdü.
 *
 * Kanban'da kart sürüklenebilir; listede değil. Fark `draggable` bayrağıyla
 * verilir, ayrı bir bileşenle değil.
 */

import { memo } from "react";
import { Building2, Clock, MapPin, Phone, User } from "lucide-react";
import { STAGE_LABEL, type Lead } from "../../lib/sales";
import { STAGE_STYLE, relativeTime } from "./salesStyles";

interface LeadCardProps {
  lead: Lead;
  now: Date;
  onOpen: (leadId: string) => void;
  draggable?: boolean;
  onDragStart?: (leadId: string) => void;
  onDragEnd?: () => void;
  /** Sürüklenmekte olan kart soluklaşır. */
  isDragging?: boolean;
  /** Girişte kademeli belirme sırası. */
  index?: number;
  /** Kompakt hâl: kanban sütununda daha az alan kaplar. */
  compact?: boolean;
}

function LeadCardInner({
  lead,
  now,
  onOpen,
  draggable = false,
  onDragStart,
  onDragEnd,
  isDragging = false,
  index = 0,
  compact = false,
}: LeadCardProps) {
  const style = STAGE_STYLE[lead.stage];

  return (
    <article
      draggable={draggable}
      onDragStart={() => onDragStart?.(lead.id)}
      onDragEnd={onDragEnd}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`optiflow-enter optiflow-lift optiflow-glass overflow-hidden rounded-xl border border-slate-200 transition-all duration-200 ${
        isDragging ? "opacity-40" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <button
        type="button"
        onClick={() => onOpen(lead.id)}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <div className="flex gap-3 p-3.5">
          <span className={`w-1 shrink-0 rounded-full ${style.bar}`} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">
                {lead.company}
              </p>
              {/* Durak rengi tek başına konuşmaz; adı da yazılı. */}
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
              >
                {STAGE_LABEL[lead.stage]}
              </span>
            </div>

            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {lead.sector}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {lead.city}
              </span>
            </p>

            {!compact && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {lead.contactName || "—"}
                </span>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Phone className="h-3 w-3" />
                  {lead.phone || "—"}
                </span>
              </p>
            )}

            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="h-3 w-3" />
              {relativeTime(lead.updatedAt, now)}
            </p>

            {/* Demo geçmişi: teklif konuşmasının dayanağı. */}
            {lead.demo !== null && !compact && (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-100/50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
                Demo {relativeTime(lead.demo.at, now)} ·{" "}
                {lead.demo.durationMinutes} dk ·{" "}
                {lead.demo.screens.join(", ")}
              </p>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}

export const LeadCard = memo(LeadCardInner);
