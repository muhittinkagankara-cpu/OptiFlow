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
 *
 * ## Sprint 2F-B — görsel ağırlık
 *
 * Şerit ölçüyü doğru taşıyordu ama bir **alet** gibi değil, bir ayraç gibi
 * görünüyordu: 4 piksellik saç teli çubuklar, 67 piksellik satır. Üç şey
 * değişti ve hiçbiri veriyi değiştirmedi:
 *
 * 1. Dolgu çubuğu şeridin birincil aletidir; kalınlığı okunur bir ölçek
 *    hâline geldi (8px dar ekran, 12px geniş ekran).
 * 2. "KISIT" etiketi segmentin sağ ucundan alınıp **kendi istasyon adının
 *    hemen yanına** taşındı. Sağ uçtayken bir sonraki istasyonun adına
 *    yapışıyor ve "KISIT KAYNAK" diye okunuyordu — yani kısıt yanlış
 *    istasyona işaret ediyor gibi duruyordu.
 * 3. Dar ekranda ad ve değer tek satıra indi; satır 66,5 pikselden ~40
 *    piksele düştü, dört istasyon da okunur kaldı.
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
      className={`flex flex-col gap-[var(--of-spacing-4)] md:flex-row md:gap-[var(--of-spacing-8)] ${className}`}
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
            {/*
             * Dar ekranda ad ve değer aynı satırı paylaşır (kompakt liste);
             * geniş ekranda değer adın altına iner ve okunacak sayı büyür.
             * Değer tek bir düğümdür — iki kez yazılsaydı ekran okuyucu her
             * istasyonu iki kez okurdu.
             */}
            <div className="mt-[var(--of-spacing-8)] flex items-baseline justify-between gap-[var(--of-spacing-8)] md:mt-[var(--of-spacing-16)] md:flex-col md:items-start md:justify-start md:gap-[var(--of-spacing-4)]">
              <span className="flex min-w-0 items-baseline gap-[var(--of-spacing-8)]">
                <span className="truncate text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
                  {station.label}
                </span>
                {station.isConstraint && (
                  // Kendi adının yanında durur: hangi istasyonun kısıt olduğu
                  // tek bakışta, komşu segmente bakmadan okunur.
                  <span
                    className="shrink-0 text-[11px] font-semibold tracking-[0.08em] uppercase"
                    style={{ color }}
                  >
                    Kısıt
                  </span>
                )}
              </span>
              <p
                className="shrink-0 font-mono text-[16px] leading-[1.15] tabular-nums md:text-[28px]"
                style={{
                  color: station.isConstraint ? color : "var(--of-ink-1)",
                }}
              >
                {station.value}
              </p>
            </div>
            {/*
             * Dolgu çubuğu şeridin aleti: kalınlığı okunur olmalı, yoksa
             * geometri bilgi değil süs olur.
             */}
            <div className="mt-[var(--of-spacing-4)] h-[var(--of-spacing-8)] w-full rounded-[var(--of-radius-xs)] bg-[var(--of-surface-2)] md:mt-[var(--of-spacing-16)] md:h-[var(--of-spacing-12)]">
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
