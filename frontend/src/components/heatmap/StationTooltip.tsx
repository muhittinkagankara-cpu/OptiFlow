/**
 * Bir istasyonun ısı skorunun gerekçesi.
 *
 * Yalnızca skoru göstermek, sayıyı bir hükme dönüştürür ama gerekçesini
 * görünmez kılar. Bu balon "neden kırmızı?" sorusunu kutuya bakan kişinin
 * okuyabileceği biçimde yanıtlar: her bileşenin ham değeri, ağırlığı ve skora
 * kaç puan kattığı yazılır.
 *
 * Hiçbir hesap burada yapılmaz — bileşenler ve katkıları backend'den hazır
 * gelir.
 */

import type { StationHeat } from "../../types/simulationTypes";
import {
  bandDot,
  bandLabel,
  formatComponentValue,
  formatScore,
} from "../../lib/heatmapFormatting";
import { formatMoney } from "../../lib/financeFormatting";

export function StationTooltip({ heat }: { heat: StationHeat }) {
  return (
    <div
      role="tooltip"
      className="w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {heat.station_name}
          </p>
          {heat.is_bottleneck && (
            <span className="text-[11px] font-medium text-brand-700">
              Darboğaz
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded ${bandDot(heat.band)}`} />
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {formatScore(heat.score)}
          </span>
        </div>
      </div>

      {/* Mutlak tutar skorla BIRLIKTE gosterilir: skor goreli oldugu icin
          tek basina "kirmizi" bir kutu, kucuk bir kaybi buyuk gosterebilir. */}
      <p className="mb-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
        Kayıp: <strong className="tabular-nums">{formatMoney(heat.total_loss)}</strong>
        <span className="ml-1 text-slate-500">· {bandLabel(heat.band)}</span>
      </p>

      <ul className="space-y-1">
        {heat.components.map((component) => (
          <li key={component.name} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-600">{component.label}</span>
              <span className="tabular-nums text-slate-800">
                {formatComponentValue(component.name, component.raw_value)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Katki cubugu: bilesenin skora kac puan kattigini gosterir. */}
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-400"
                  style={{ width: `${Math.min(100, component.contribution)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                +{component.contribution.toFixed(1)} p
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] leading-snug text-slate-500">
        Skor = %40 kayıp + %25 kullanım + %20 bekleme + %15 fire
      </p>
    </div>
  );
}
