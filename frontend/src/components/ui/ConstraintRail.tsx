/**
 * Kısıt şeridi — ürünün imza öğesi (MASTER §15).
 *
 * Hattı tek bir şeritte gösterir ve kısıtı **geometriyle** işaretler: segment
 * genişliği istasyonun ölçülmüş doluluğuyla orantılıdır, dolayısıyla en geniş
 * segment kısıttır. Renk tek başına taşıyıcı değildir; kısıt üç sinyalle
 * birden işaretlenir — genişlik, üstteki 2 piksellik kelepçe ve yazılı "KISIT"
 * etiketi (MASTER §15.2).
 *
 * Dar ekranda şerit dikey bir listeye döner; geometri yatay dolgu çubuğu olarak
 * korunur ve **sayfa yana kaymaz**.
 *
 * Bu sürümde `compact` varyantı çizilir (Command Center). `plan`, `live` ve
 * `money` varyantları aynı sözleşmeyi paylaşacak; bu yüzden bileşen
 * `components/ui/` altında durur, tek bir ekranın içinde değil.
 */

import { STATE_COLOR_VAR, type MeasuredState } from "../../lib/ui";

export interface ConstraintRailStation {
  id: string;
  label: string;
  /** Genişliği belirleyen ölçülmüş oran (0–1). */
  share: number;
  /** Segmentin üstünde yazılan okuma değeri. */
  value: string;
  state: MeasuredState;
  isConstraint: boolean;
}

interface ConstraintRailProps {
  stations: ConstraintRailStation[];
  className?: string;
}

/** Segment genişliğinin taban payı: çok düşük doluluklu istasyon da okunmalı. */
const MIN_GROW = 0.25;

export function ConstraintRail({ stations, className = "" }: ConstraintRailProps) {
  if (stations.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Hat kısıdı"
      className={`flex flex-col gap-[var(--of-spacing-4)] md:flex-row ${className}`}
    >
      {stations.map((station) => {
        const color = `var(${STATE_COLOR_VAR[station.state]})`;
        return (
          <div
            key={station.id}
            // Genişlik ölçülmüş doluluğa göre büyür; taban pay, düşük dolulukta
            // etiketin okunamaz hâle gelmesini engeller.
            style={{ flexGrow: Math.max(station.share, MIN_GROW) }}
            className="min-w-0 flex-1 basis-0"
          >
            {/* Kelepçe: yalnızca kısıtta kalın ve renkli. */}
            <div
              aria-hidden="true"
              className="h-0.5 w-full rounded-[var(--of-radius-xs)]"
              style={{
                backgroundColor: station.isConstraint
                  ? color
                  : "var(--of-surface-hairline)",
              }}
            />
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
                {station.label}
              </span>
              {station.isConstraint && (
                <span
                  className="shrink-0 text-[10px] font-semibold tracking-[0.08em] uppercase"
                  style={{ color }}
                >
                  Kısıt
                </span>
              )}
            </div>
            <p
              className="mt-0.5 font-mono text-xl tabular-nums"
              style={{
                color: station.isConstraint ? color : "var(--of-ink-1)",
              }}
            >
              {station.value}
            </p>
            {/* Dolgu çubuğu: dar ekranda geometri burada okunur. */}
            <div className="mt-1.5 h-1 w-full rounded-[var(--of-radius-xs)] bg-[var(--of-surface-2)]">
              <div
                className="h-full rounded-[var(--of-radius-xs)]"
                style={{
                  width: `${Math.round(Math.min(1, Math.max(0, station.share)) * 100)}%`,
                  backgroundColor: station.isConstraint
                    ? color
                    : "var(--of-ink-4)",
                }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
