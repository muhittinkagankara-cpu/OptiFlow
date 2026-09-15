/**
 * Ölçüm şeridi — dört değer, dört kart değil (MASTER §19.1).
 *
 * Önceki hâl dört gradient zeminli karttı: her kartın kendi rengi vardı ve o
 * renk hiçbir ölçümü göstermiyordu — "Aylık Kayıp" kırmızıydı çünkü adı
 * kayıptı, eşiği aştığı için değil (ANTI-PATTERNS #8). Zeminler kalktı;
 * değerler hairline ile ayrıldı.
 *
 * Çıplak metrik yasaktır (Yasa 2): her değer bir **sonuç** satırı taşır. Sonuç
 * ölçülemiyorsa satır yazılmaz, uydurulmaz.
 *
 * Para değerleri `--of-semantic-value-ink` mürekkebiyle yazılır ve bu mürekkep
 * üründe başka hiçbir yerde kullanılmaz (MASTER §3.3).
 */

import type { ReactNode } from "react";

export interface MetricItem {
  id: string;
  /** Küçük büyük harfli etiket. */
  label: string;
  /** Biçimlendirilmiş değer; ölçülemiyorsa `null` → "—". */
  value: string | null;
  /** Değerin sonucu: kapasite, eşik, darboğaz. Yoksa yazılmaz. */
  consequence?: string | null;
  /** Değer ölçülemediğinde nedeni. */
  emptyReason?: string | null;
  /** Ölçümü tamamlayacak eylem. */
  action?: ReactNode;
  /** Para mı? Rezerve mürekkebi yalnızca bunlar kullanır. */
  isMoney?: boolean;
}

interface MetricGroupProps {
  items: MetricItem[];
  className?: string;
}

export function MetricGroup({ items, className = "" }: MetricGroupProps) {
  return (
    <section
      className={`grid grid-cols-1 gap-px overflow-hidden rounded-[var(--of-radius-md)] bg-[var(--of-surface-hairline)] sm:grid-cols-2 xl:grid-cols-4 ${className}`}
    >
      {items.map((item) => {
        const measured = item.value !== null;
        return (
          // Hücreler arasındaki çizgi, kenarlıkla değil 1 piksellik boşlukla
          // kurulur: ızgaranın kendi zemini hairline rengindedir ve hücreler
          // onun üstünde durur. Böylece iç içe kutu oluşmaz.
          <div
            key={item.id}
            className="bg-[var(--of-surface-1)] p-[var(--of-spacing-16)]"
          >
            <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase">
              {item.label}
            </p>

            <p
              className={`mt-1.5 font-mono text-xl tabular-nums ${
                measured
                  ? item.isMoney
                    ? "text-[var(--of-semantic-value-ink)]"
                    : "text-[var(--of-ink-1)]"
                  : "text-[var(--of-ink-4)]"
              }`}
            >
              {measured ? item.value : "—"}
            </p>

            {measured
              ? item.consequence && (
                  <p className="mt-1 text-[12px] leading-4 text-[var(--of-ink-2)]">
                    {item.consequence}
                  </p>
                )
              : item.emptyReason && (
                  <p className="mt-1 text-[12px] leading-4 text-[var(--of-ink-3)]">
                    {item.emptyReason}
                  </p>
                )}

            {!measured && item.action && <div className="mt-2">{item.action}</div>}
          </div>
        );
      })}
    </section>
  );
}
