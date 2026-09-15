/**
 * Ekranı açan durum tespiti (Yasa 1).
 *
 * Bir ekranın en büyük yazısı, en çok bilgi taşıyan şey olmalıdır. Command
 * Center eskiden "İyi günler …" ile açılıyordu: sayfanın en büyük yazısı sıfır
 * bilgi taşıyordu ve operasyonel içerik onun altında kalıyordu
 * (ANTI-PATTERNS #21).
 *
 * Cümlenin kendisi burada kurulmaz — `lib/commandCenter/statement.ts` içinde,
 * ölçülmüş veriden üretilir ve sınanır. Bileşen yalnızca çizer.
 */

import type { ReactNode } from "react";

interface StatementProps {
  /** Ana cümle: ekranın durum tespiti. */
  headline: string;
  /** Destekleyici tek satır; ölçülemiyorsa verilmez. */
  detail?: string | null;
  /** Kökeni ya da zamanı söyleyen rozet gibi küçük içerik. */
  meta?: ReactNode;
  /** Kısıt bilinmediğinde ölçümü üretecek eylem. */
  action?: ReactNode;
  className?: string;
}

export function Statement({
  headline,
  detail,
  meta,
  action,
  className = "",
}: StatementProps) {
  return (
    <section className={className}>
      {meta && <div className="mb-2 flex flex-wrap items-center gap-2">{meta}</div>}

      <h2 className="text-3xl leading-9 font-semibold tracking-tight text-[var(--of-ink-1)]">
        {headline}
      </h2>

      {detail && (
        <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[var(--of-ink-2)]">
          {detail}
        </p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}
