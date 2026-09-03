/**
 * En çok para kaybettiren beş istasyon.
 *
 * Sıralama **ısı skoruna göre değil, tutara göredir** ve bu ayrım bilinçlidir:
 * ısı skoru kullanım oranını ve fireyi de içerdiği için en sıcak istasyon her
 * zaman en pahalı istasyon değildir. Bu panelin sorduğu soru tümüyle
 * parasaldır — "param nerede yanıyor?" — dolayısıyla sıralama da parasal
 * olmalıdır. İkisini aynı sırayla göstermek, "en sıcak" ile "en pahalı"yı
 * karıştırmak olurdu.
 *
 * Sıralama backend'de yapılır (`top_loss_stations`); burada yalnızca çizilir.
 */

import type { StationHeat } from "../../types/simulationTypes";
import { formatMoney } from "../../lib/financeFormatting";
import {
  bandDot,
  dominantComponentLabel,
  formatScore,
} from "../../lib/heatmapFormatting";

interface TopLossStationsProps {
  stations: StationHeat[];
  /** Şu anda odaklanmış istasyon; satır vurgulanır. */
  focusedId: string | null;
  onFocus: (stationId: string) => void;
}

export function TopLossStations({
  stations,
  focusedId,
  onFocus,
}: TopLossStationsProps) {
  if (stations.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
        <p className="text-xs font-semibold text-slate-700">En çok kaybeden</p>
        <p className="mt-1.5 text-xs text-slate-500">
          Hiçbir istasyonda parasal kayıp hesaplanamadı. Maliyet oranlarını
          girdiğinizde bu liste dolar.
        </p>
      </div>
    );
  }

  const worst = stations[0].total_loss;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="mb-0.5 text-xs font-semibold text-slate-700">
        En çok kaybeden
      </p>
      <p className="mb-2 text-[11px] text-slate-500">Tutara göre sıralı</p>

      <ol className="space-y-1">
        {stations.map((station, index) => {
          const isFocused = station.station_id === focusedId;
          const share = worst > 0 ? (station.total_loss / worst) * 100 : 0;
          const reason = dominantComponentLabel(station);

          return (
            <li key={station.station_id}>
              <button
                type="button"
                onClick={() => onFocus(station.station_id)}
                aria-current={isFocused ? "true" : undefined}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  isFocused ? "bg-brand-50 ring-1 ring-brand-300" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="w-3 shrink-0 text-[11px] tabular-nums text-slate-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-900">
                    {station.station_name}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-900">
                    {formatMoney(station.total_loss)}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-1.5 pl-5">
                  {/* Cubuk, en kotu istasyona gore oranı gosterir. */}
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${bandDot(station.band)}`}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                    {formatScore(station.score)}
                  </span>
                </div>

                {reason && (
                  <p className="mt-0.5 truncate pl-5 text-[10px] text-slate-500">
                    Ağırlıklı olarak: {reason.toLowerCase()}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
