/**
 * Üretim göstergeleri — komuta merkezi sunumu (Sprint 2J).
 *
 * Bu bileşen **veri üretmez**. Girdisi `lib/live/metrics.ts`'in döndürdüğü
 * `MetricItem[]`'dır; yani değer, sonuç satırı ve "ölçülemedi" nedeni zaten
 * saf katmanda kararlaştırılmıştır. Burada yapılan tek iş çizmektir.
 *
 * ## Neden `MetricGroup` değil?
 *
 * Paylaşılan `MetricGroup`, hücreleri 1 piksellik boşluk ve arkadaki hairline
 * zeminle ayırır; bu, Command Center ve Sonuç ekranlarının sıkışık ölçüm
 * şeridi için doğru bir dildir. Komuta merkezi brifi ise ayrık, nefes alan,
 * yükseltilebilen kartlar istiyor — ikisi aynı bileşende karşılanamaz ve
 * paylaşılan bileşeni bu yöne çekmek diğer iki ekranı da değiştirirdi.
 *
 * Bölünen yalnızca **sunum**dur: `liveMetrics()` her iki dilde de tek
 * kaynaktır, dolayısıyla sayılar ayrışamaz.
 *
 * ## Yasa 2 ve Yasa 4
 *
 * Her kart bir sonuç satırı taşır; sonucu olmayan metriğe sonuç uydurulmaz,
 * satır hiç yazılmaz. Ölçülemeyen değer "—" olur ve altına nedeni yazılır;
 * sıfıra düşürülmez.
 */

import type { MetricItem } from "../ui/MetricGroup";

interface LiveKpiCardsProps {
  items: MetricItem[];
  className?: string;
}

export function LiveKpiCards({ items, className = "" }: LiveKpiCardsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 ${className}`}
    >
      {items.map((item) => {
        const measured = item.value !== null;
        return (
          <article
            key={item.id}
            className="rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-5"
          >
            <p className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
              {item.label}
            </p>

            <p
              className={`mt-2 font-mono text-[30px] leading-9 tabular-nums ${
                measured
                  ? item.isMoney
                    ? "text-[var(--of-semantic-value-ink)]"
                    : "text-[var(--of-cc-ink)]"
                  : "text-[var(--of-cc-ink-label)]"
              }`}
            >
              {measured ? item.value : "—"}
            </p>

            {/* Çıplak metrik yasak: ölçülen değer sonucunu, ölçülemeyen değer
                nedenini taşır. İkisi de yoksa satır yazılmaz. */}
            {measured
              ? item.consequence && (
                  <p className="mt-1.5 text-[13px] leading-5 text-[var(--of-cc-ink-muted)]">
                    {item.consequence}
                  </p>
                )
              : item.emptyReason && (
                  <p className="mt-1.5 text-[13px] leading-5 text-[var(--of-cc-ink-label)]">
                    {item.emptyReason}
                  </p>
                )}

            {!measured && item.action && <div className="mt-3">{item.action}</div>}
          </article>
        );
      })}
    </div>
  );
}
