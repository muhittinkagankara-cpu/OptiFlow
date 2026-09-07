/**
 * Bölüm 6 — Fabrika sağlık radarı.
 *
 * Altı eksen `lib/intelligence/metrics.buildRadarData` tarafından üretilir;
 * bu bileşen yalnızca çizer. Normalizasyon ve yön çevirmesi (fire arttıkça
 * skorun düşmesi gibi) orada tek yerde yapılır — burada yapılsaydı iki eksen
 * yanlışlıkla ters yönde çizilebilirdi.
 *
 * Radar tek başına okunmaz: altında her eksenin neye dayandığı yazılı olarak
 * listelenir. Şekil bir izlenim verir, sayı ve gerekçe ise kararı destekler.
 */

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { RadarAxis } from "../../lib/intelligence";

/** Skorun rengini belirleyen eşikler; yalnızca sunum içindir. */
function toneOf(score: number): string {
  if (score >= 75) return "text-emerald-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-700";
}

function dotOf(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

export function HealthRadar({ axes }: { axes: RadarAxis[] }) {
  if (axes.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          {/* Dar ekranda yarıçapı büyütmek eksen adlarını ("Kararlılık")
              kenardan taşırıp kırpıyordu; %62 hem masaüstünde hem telefonda
              adlara yer bırakır. */}
          <RadarChart data={axes} outerRadius="62%">
            <PolarGrid stroke="#1F2937" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "#9CA3AF", fontSize: 11 }}
            />
            {/* Eksen etiketleri kapalı: dolgunun üzerine binip okunmuyorlardı
                ve her eksenin tam skoru zaten sağdaki listede yazılı. */}
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              name="Skor"
              dataKey="score"
              stroke="#3B82F6"
              fill="#2563EB"
              fillOpacity={0.35}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111827",
                border: "1px solid #1F2937",
                borderRadius: 12,
                color: "#F9FAFB",
                fontSize: 12,
              }}
              // Recharts formatter'lari degeri genis bir birlesim tipiyle
              // verir; mevcut grafiklerdeki desen izlenir.
              formatter={(value: unknown) => [`${Number(value)}/100`, "Skor"]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Eksenlerin gerekçesi. Renk tek başına bilgi taşımaz: her satır skoru
          da yazıyla verir. */}
      <ul className="space-y-2">
        {axes.map((item, index) => (
          <li
            key={item.axis}
            style={{ animationDelay: `${index * 45}ms` }}
            className="optiflow-enter rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
            title={item.basis}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${dotOf(item.score)}`} />
                {item.axis}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${toneOf(item.score)}`}
              >
                {item.score}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {item.basis}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
