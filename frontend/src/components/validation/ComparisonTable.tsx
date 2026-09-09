/**
 * İstasyon karşılaştırma tablosu.
 *
 * Her satır bir istasyon-ölçüt çiftidir: model değeri, saha değeri ve aradaki
 * sapma. Ölçülmemiş satırlar gizlenmez, "—" ile gösterilir — hangi alanın
 * ölçülmediğini görmek, doğruluğun neyi kapsadığını anlamanın tek yoludur.
 *
 * Dar ekranda tablo kendi kapsayıcısında yatay kayar; sayfanın tamamı kaymaz.
 */

import {
  bandOf,
  METRIC_LABEL,
  METRIC_ORDER,
  type StationValidation,
  type ValidationMetric,
} from "../../lib/validation";
import { NOT_MEASURED } from "../../lib/reports";
import { Card } from "../ui/Primitives";
import {
  showNumber,
  showPercent,
  showSignedPercent,
  styleOfBand,
} from "./validationStyles";

interface ComparisonTableProps {
  stations: StationValidation[];
}

export function ComparisonTable({ stations }: ComparisonTableProps) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        İstasyon karşılaştırması
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Sapma gerçeğe göre hesaplanır: "+" model olduğundan düşük, "−" model
        olduğundan yüksek tahmin ediyor demektir.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                İstasyon
              </th>
              <th className="py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Ölçüt
              </th>
              <th className="py-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Model
              </th>
              <th className="py-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Gerçek
              </th>
              <th className="py-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sapma
              </th>
              <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Doğruluk
              </th>
            </tr>
          </thead>

          <tbody>
            {stations.map((station) =>
              METRIC_ORDER.map((metric, index) => {
                const comparison = station.metrics[metric];
                const style = styleOfBand(
                  // Bant eşikleri doğruluk motorundan gelir; burada yeniden
                  // yazılsaydı tablo, özet kartlarından farklı renklenirdi.
                  bandOf(comparison.accuracy),
                );
                return (
                  <tr
                    key={`${station.stationId}-${metric}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {index === 0 ? station.stationName : ""}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {METRIC_LABEL[metric]}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                      {formatValue(metric, comparison.simulated)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-900">
                      {formatValue(metric, comparison.real)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums font-medium ${style.text}`}
                    >
                      {showSignedPercent(comparison.errorRatio)}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${style.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${style.bar}`} />
                        {showPercent(comparison.accuracy)}
                      </span>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Oranlar yüzde, süre ve hız ondalık gösterilir. */
function formatValue(metric: ValidationMetric, value: number | null): string {
  if (value === null) {
    return NOT_MEASURED;
  }
  return metric === "scrap" ? showPercent(value, 1) : showNumber(value, 2);
}
