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
  /**
   * Kökenin yanına yazılan tek satırlık ayrıntı — tipik olarak tazelik
   * ("Son koşum 12 dk önce").
   *
   * Rozetin **içinde** durur, ayrı bir satır ya da ikinci bir rozet açılmaz:
   * köken ile zaman aynı olgunun iki yüzüdür ve ayrı kutulara konsaydı
   * kullanıcı ikisini ayrı iddialar sanırdı. Verilmezse hiçbir şey çizilmez.
   */
  detail?: string | null;
  className?: string;
}

export function OriginBadge({
  origin,
  detail,
  className = "",
}: OriginBadgeProps) {
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
      {detail && (
        <span className="text-[var(--of-ink-3)]">
          <span aria-hidden="true">· </span>
          {detail}
        </span>
      )}
      {/* Kısa etiket ekranda yeterlidir; ekran okuyucu tam cümleyi duyar. */}
      <span className="sr-only">{description}</span>
    </span>
  );
}
