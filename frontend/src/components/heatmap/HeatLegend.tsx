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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="mb-2 text-xs font-semibold text-slate-700">Isı skoru</p>

      <ul className="space-y-1.5">
        {BANDS.map(({ band, range }) => (
          <li key={band} className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-3 w-3 rounded ${bandDot(band)}`} />
            <span className="font-medium text-slate-800">{bandLabel(band)}</span>
            <span className="ml-auto tabular-nums text-slate-500">{range}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-500">
        %40 kayıp · %25 kullanım · %20 bekleme · %15 fire
      </p>

      {isRelative && (
        // Skorun goreli oldugu gizlenmemeli: kayiplarin tamami onemsizse bile
        // en kotu istasyon kirmiziya boyanir. Kullanici bunu bilmeden kirmizi
        // bir kutuyu felaket sanabilir.
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          Kayıp bileşeni bu koşumdaki <strong>en kötü istasyona</strong> göre
          ölçülür. Kutulardaki tutarlara da bakın.
        </p>
      )}
    </div>
  );
}
