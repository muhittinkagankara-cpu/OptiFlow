/**
 * Karar bloğuna girmeyen kritik konular (Sprint 2D).
 *
 * Eskiden bu liste "Bugün Yapılacaklar" başlığıyla ekranın yarısını kaplıyor
 * ve boşken bile 790×274 piksellik bir boşluk bırakıyordu; üstelik içi boşken
 * "Acil konu yok" diye bir kart çiziyordu (ANTI-PATTERNS #18).
 *
 * Artık: konu yoksa **bölüm hiç çizilmez**. Yokluğu bildiren bir kart, olmayan
 * bir şey için yer ayırmaktır.
 *
 * Öncelik ve eşikler `lib/actionItems` içinde kalır; burada yalnızca sıralı
 * liste çizilir.
 */

import { ChevronRight } from "lucide-react";
import type { ActionItem, ActionPriority } from "../../lib/actionItems";
import { STATE_COLOR_VAR, type MeasuredState } from "../../lib/ui";

/** Öncelik, ölçülmüş durum sözlüğüne çevrilir; yeni renk üretilmez. */
const PRIORITY_STATE: Record<ActionPriority, MeasuredState> = {
  critical: "fault",
  warning: "warn",
  info: "unknown",
};

const PRIORITY_LABEL: Record<ActionPriority, string> = {
  critical: "Acil",
  warning: "Uyarı",
  info: "Bilgi",
};

interface CriticalTopicsProps {
  items: ActionItem[];
  onSelect: (item: ActionItem) => void;
}

export function CriticalTopics({ items, onSelect }: CriticalTopicsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="mb-[var(--of-spacing-8)] text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
        Sıradaki konular
      </h3>

      <div className="overflow-hidden rounded-[var(--of-radius-md)] bg-[var(--of-surface-1)]">
        {items.map((item, index) => {
          const state = PRIORITY_STATE[item.priority];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`flex w-full items-center gap-[var(--of-spacing-12)] px-[var(--of-spacing-16)] py-[var(--of-spacing-12)] text-left transition-colors duration-200 hover:bg-[var(--of-surface-2)] focus:outline-none ${
                index === 0 ? "" : "border-t border-[var(--of-surface-hairline)]"
              }`}
            >
              {/* Durum iki sinyalle: kelepçe rengi ve yazılı öncelik. */}
              <span
                aria-hidden="true"
                className="h-8 w-0.5 shrink-0 rounded-[var(--of-radius-xs)]"
                style={{ backgroundColor: `var(${STATE_COLOR_VAR[state]})` }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-medium text-[var(--of-ink-1)]">
                    {item.title}
                  </span>
                  <span
                    className="text-[11px] font-semibold tracking-[0.08em] uppercase"
                    style={{ color: `var(${STATE_COLOR_VAR[state]})` }}
                  >
                    {PRIORITY_LABEL[item.priority]}
                  </span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-4 text-[var(--of-ink-3)]">
                  {item.detail}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--of-ink-4)]" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
