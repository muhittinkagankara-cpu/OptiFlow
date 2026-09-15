/**
 * Fabrika sağlığı — altı mini kart yerine tek şerit (Sprint 2D).
 *
 * Göstergelerin kendisi değişmedi: `buildHealthIndicators` ne üretiyorsa o
 * çizilir, eşikleri ve tonları dâhil. Değişen yalnızca sunum — altı ayrı
 * kenarlıklı kart, ekranda altı ayrı kutu demekti (ANTI-PATTERNS #1).
 *
 * Durum yine iki sinyalle taşınır: renk **ve** değerin yanındaki yazılı ipucu
 * (`title`). Renk körlüğü olan kullanıcı da okuyabilmeli.
 */

import type { HealthIndicator, HealthTone } from "../../lib/factoryHealth";
import { STATE_COLOR_VAR, type MeasuredState } from "../../lib/ui";

/** Sağlık tonu, ölçülmüş durum sözlüğüne çevrilir; yeni renk üretilmez. */
const TONE_STATE: Record<HealthTone, MeasuredState> = {
  good: "ok",
  warning: "warn",
  bad: "fault",
};

interface FactoryHealthStripProps {
  indicators: HealthIndicator[];
}

export function FactoryHealthStrip({ indicators }: FactoryHealthStripProps) {
  if (indicators.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="mb-[var(--of-spacing-8)] text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
        Hat sağlığı
      </h3>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--of-radius-md)] bg-[var(--of-surface-hairline)] sm:grid-cols-3 xl:grid-cols-6">
        {indicators.map((indicator) => (
          <div
            key={indicator.id}
            title={indicator.hint}
            className="bg-[var(--of-surface-1)] px-[var(--of-spacing-12)] py-[var(--of-spacing-12)]"
          >
            <p className="truncate text-[10px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
              {indicator.label}
            </p>
            <p
              className="mt-1 font-mono text-[15px] tabular-nums"
              style={{
                color: `var(${STATE_COLOR_VAR[TONE_STATE[indicator.tone]]})`,
              }}
            >
              {indicator.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
