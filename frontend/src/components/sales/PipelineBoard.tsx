/**
 * Kanban panosu — beş sütun, sürükle-bırakla durum değişimi.
 *
 * Sürükleme tarayıcının kendi HTML5 API'siyle yapılır; ayrı bir kütüphane
 * eklenmedi. İhtiyaç tek yönlü ve basit: bir kartı bir sütuna bırakmak.
 * Sıralama, çoklu seçim ya da dokunmatik jest gerekmediği sürece bir
 * bağımlılık, paketi büyütmekten başka bir şey yapmazdı.
 *
 * Durum değişimi `moveLead` ile olur; bu bileşen listeye dokunmaz.
 */

import { memo, useCallback, useMemo, useState } from "react";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  groupByStage,
  type Lead,
  type LeadStage,
} from "../../lib/sales";
import { LeadCard } from "./LeadCard";
import { STAGE_STYLE } from "./salesStyles";

interface PipelineBoardProps {
  leads: Lead[];
  now: Date;
  onOpenLead: (leadId: string) => void;
  onMove: (leadId: string, stage: LeadStage) => void;
}

function PipelineBoardInner({
  leads,
  now,
  onOpenLead,
  onMove,
}: PipelineBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<LeadStage | null>(null);

  const groups = useMemo(() => groupByStage(leads), [leads]);

  const handleDrop = useCallback(
    (stage: LeadStage) => {
      if (dragging !== null) {
        onMove(dragging, stage);
      }
      setDragging(null);
      setHovered(null);
    },
    [dragging, onMove],
  );

  return (
    /*
     * Dar ekranda sütunlar yatay kaydırılır. Alt alta dizmek beş sütunu
     * beş ayrı listeye çevirir ve kanban'ın tek faydasını — hattın tamamını
     * bir bakışta görmeyi — ortadan kaldırırdı.
     */
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGE_ORDER.map((stage) => {
        const style = STAGE_STYLE[stage];
        const items = groups[stage];
        const isTarget = hovered === stage && dragging !== null;

        return (
          <section
            key={stage}
            onDragOver={(event) => {
              // Varsayılan davranış engellenmezse bırakma hiç gerçekleşmez.
              event.preventDefault();
              setHovered(stage);
            }}
            onDragLeave={() => setHovered((current) => (current === stage ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              handleDrop(stage);
            }}
            className={`flex w-64 shrink-0 flex-col rounded-2xl border-2 border-dashed p-2.5 transition-colors duration-200 ${
              isTarget ? `${style.column} bg-brand-600/10` : "border-transparent"
            }`}
          >
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                {STAGE_LABEL[stage]}
              </span>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                {items.length}
              </span>
            </header>

            <div className="flex min-h-[6rem] flex-1 flex-col gap-2">
              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-[11px] text-slate-500">
                  {isTarget ? "Buraya bırakın" : "Bu durakta kayıt yok"}
                </p>
              ) : (
                items.map((lead, index) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    now={now}
                    onOpen={onOpenLead}
                    draggable
                    compact
                    index={index}
                    isDragging={dragging === lead.id}
                    onDragStart={setDragging}
                    onDragEnd={() => {
                      setDragging(null);
                      setHovered(null);
                    }}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const PipelineBoard = memo(PipelineBoardInner);
