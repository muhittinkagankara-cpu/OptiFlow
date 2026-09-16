/**
 * Isı haritasının renk lejantı.
 *
 * Her bandın yanında hem rengi hem yazısı bulunur: renk tek başına bilgi
 * taşımaz ve renk körü bir kullanıcı için kırmızı ile yeşil ayırt edilemez.
 * Aralıklar da yazılır, çünkü "turuncu" tek başına bir şey söylemez —
 * kullanıcının 50–75 aralığını görmesi, skorun ne kadar kötü olduğunu
 * anlamasını sağlar.
 */

import type { HeatBand } from "../../types/simulationTypes";
import { bandDot, bandLabel } from "../../lib/heatmapFormatting";

/** Lejantta gösterilen bandlar ve karşılık gelen skor aralıkları. */
const BANDS: { band: HeatBand; range: string }[] = [
  { band: "green", range: "0–25" },
  { band: "yellow", range: "25–50" },
  { band: "orange", range: "50–75" },
  { band: "red", range: "75–100" },
];

export function HeatLegend({ isRelative }: { isRelative: boolean }) {
  return (
    <div className="rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] px-3 py-3">
      <p className="mb-2 text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
        Isı skoru
      </p>

      <ul className="space-y-1.5">
        {BANDS.map(({ band, range }) => (
          <li key={band} className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-3 w-3 rounded ${bandDot(band)}`} />
            <span className="font-medium text-[var(--of-cc-ink)]">
              {bandLabel(band)}
            </span>
            <span className="ml-auto text-[var(--of-cc-ink-muted)] tabular-nums">
              {range}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-[var(--of-cc-border)] pt-2.5 text-[11px] leading-snug text-[var(--of-cc-ink-muted)]">
        %40 kayıp · %25 kullanım · %20 bekleme · %15 fire
      </p>

      {isRelative && (
        // Skorun goreli oldugu gizlenmemeli: kayiplarin tamami onemsizse bile
        // en kotu istasyon kirmiziya boyanir. Kullanici bunu bilmeden kirmizi
        // bir kutuyu felaket sanabilir.
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--of-cc-ink-muted)]">
          Kayıp bileşeni bu koşumdaki <strong>en kötü istasyona</strong> göre
          ölçülür. Kutulardaki tutarlara da bakın.
        </p>
      )}
    </div>
  );
}
