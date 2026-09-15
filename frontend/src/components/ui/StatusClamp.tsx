/**
 * Durum kelepçesi — 2px sol çizgi (Sprint 1A).
 *
 * Yeni görsel dilde bir satırın durumu, satırın zeminini boyayarak değil,
 * sol kenarına ince bir çizgi çekerek gösterilir (MASTER §5). Zemin boyamak
 * yüzeyi renkli hâle getirir ve Yasa 3'ü ihlal eder; kelepçe ise yalnızca
 * kenarda durur, okunabilirliği bozmaz ve satırlar üst üste geldiğinde
 * birbirine karışmaz.
 *
 * `stateLabel` **zorunludur** ve bu bilinçlidir: durum asla yalnızca renkle
 * taşınmaz (MASTER §22). Görünen içerik durumu zaten yazıyla söylüyorsa bile,
 * ekran okuyucu için bir karşılığı olmalıdır. Zorunlu bir alan, unutulabilir
 * bir iyi niyetten daha güvenilirdir.
 *
 * Bu bileşen henüz hiçbir ekrana bağlı değildir.
 */

import type { ReactNode } from "react";
import { STATE_RULE_CLASS, type MeasuredState } from "../../lib/ui";

interface StatusClampProps {
  /** Ölçülmüş durum. `unknown` nötr kalır, kırmızı olmaz. */
  state: MeasuredState;
  /**
   * Durumun yazılı karşılığı ("Darboğaz", "Eşik aşıldı", "Ölçülmedi").
   *
   * Ekran okuyucuya okunur. Zorunludur — bkz. dosya başlığı.
   */
  stateLabel: string;
  children: ReactNode;
  className?: string;
}

export function StatusClamp({
  state,
  stateLabel,
  children,
  className = "",
}: StatusClampProps) {
  return (
    <div
      className={`border-l-2 pl-[var(--of-spacing-12)] ${STATE_RULE_CLASS[state]} ${className}`}
    >
      <span className="sr-only">{stateLabel}</span>
      {children}
    </div>
  );
}
