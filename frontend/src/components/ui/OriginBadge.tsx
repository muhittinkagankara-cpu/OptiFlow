/**
 * Köken rozeti — verinin nereden geldiği (Sprint 1A).
 *
 * KURAL 1'in görsel karşılığı: gerçek bir cihazdan gelmeyen veri gerçek gibi
 * gösterilmez. Rozet kalıcı bir **bilgidir**, geçici bir uyarı değildir; bu
 * yüzden tam genişlik amber bant değil, başlığın yanında duran küçük bir
 * işarettir (ANTI-PATTERNS #20). Uyarı dilini kalıcı bilgi için harcamak,
 * gerçek uyarı çıktığında kimsenin bakmamasına yol açar.
 *
 * Durum iki sinyalle taşınır: renkli nokta **ve** yazılı etiket. Renk körlüğü
 * olan kullanıcı da, gri tonlamalı bir çıktı da kökeni okuyabilir.
 *
 * Bu bileşen henüz hiçbir ekrana bağlı değildir.
 */

import {
  STATE_DOT_CLASS,
  originPresentation,
  type DataOrigin,
} from "../../lib/ui";

interface OriginBadgeProps {
  origin: DataOrigin;
  className?: string;
}

export function OriginBadge({ origin, className = "" }: OriginBadgeProps) {
  const { label, description, state } = originPresentation(origin);
  return (
    <span
      className={`inline-flex items-center gap-[var(--of-spacing-4)] rounded-[var(--of-radius-xs)] px-[var(--of-spacing-8)] py-[var(--of-spacing-4)] text-[11px] font-medium text-[var(--of-ink-2)] ${className}`}
      // Fare kullanıcısı için de tam açıklama erişilebilir olsun.
      title={description}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-[var(--of-radius-full)] ${STATE_DOT_CLASS[state]}`}
      />
      {label}
      {/* Kısa etiket ekranda yeterlidir; ekran okuyucu tam cümleyi duyar. */}
      <span className="sr-only">{description}</span>
    </span>
  );
}
