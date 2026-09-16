/**
 * Isı haritasında seçilen istasyonun ayrıntı kartı.
 *
 * Haritada bir kutuya (ya da Top 5 listesinden bir satıra) tıklandığında sağ
 * sütunda açılır. İpucu balonunun yerini **almaz**: balon fareyle gezerken
 * hızlı bir bakış verir ve kaybolur; bu kart seçim boyunca kalır, böylece
 * kullanıcı sayıları okurken haritayı kaydırabilir.
 *
 * Şeffaflık: buradaki hiçbir değer hesaplanmaz. Skor, bant ve bileşenlerin
 * tümü backend'in `StationHeat` yanıtından okunur; arayüz yalnızca bandı bir
 * CSS sınıfına çevirir. Eşikler iki yerde tanımlansaydı, biri değiştiğinde
 * aynı skor iki ekranda iki farklı renk alırdı.
 */

import { TriangleAlert, X } from "lucide-react";
import type { StationHeat } from "../../types/simulationTypes";
import { formatMoney } from "../../lib/financeFormatting";
import {
  bandDot,
  bandLabel,
  bandText,
  formatComponentValue,
  formatScore,
} from "../../lib/heatmapFormatting";

/** Bileşen anahtarlarının kart üzerindeki sırası ve başlığı. */
const COMPONENT_ORDER: { name: string; label: string }[] = [
  { name: "loss", label: "Parasal kayıp" },
  { name: "utilization", label: "Doluluk (OEE)" },
  { name: "waiting", label: "Bekleme" },
  { name: "scrap", label: "Fire" },
];

export function SelectedStationCard({
  heat,
  onClear,
}: {
  heat: StationHeat;
  onClear: () => void;
}) {
  const byName = new Map(heat.components.map((item) => [item.name, item]));

  return (
    <div className="optiflow-enter rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--of-cc-ink)]">
            {heat.station_name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--of-cc-ink-muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${bandDot(heat.band)}`} />
            {bandLabel(heat.band)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Seçimi kaldır"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--of-cc-ink-muted)] transition-colors hover:bg-[var(--of-cc-card-raised)] hover:text-[var(--of-cc-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={`text-3xl font-bold tracking-tight tabular-nums ${bandText(heat.band)}`}
        >
          {formatScore(heat.score)}
        </span>
        <span className="text-xs text-[var(--of-cc-ink-muted)]">/100 ısı skoru</span>
      </div>

      {heat.is_bottleneck && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
          <TriangleAlert className="h-3 w-3" />
          Darboğaz
        </p>
      )}

      <dl className="mt-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 border-b border-[var(--of-cc-border)] pb-1.5">
          <dt className="text-xs text-[var(--of-cc-ink-muted)]">Toplam kayıp</dt>
          <dd className="text-sm font-semibold text-[var(--of-cc-ink)] tabular-nums">
            {formatMoney(heat.total_loss)}
          </dd>
        </div>

        {COMPONENT_ORDER.map(({ name, label }) => {
          const component = byName.get(name);
          if (!component) {
            return null;
          }
          return (
            <div
              key={name}
              className="flex items-baseline justify-between gap-2 border-b border-[var(--of-cc-border)] pb-1.5 last:border-0"
            >
              <dt className="text-xs text-[var(--of-cc-ink-muted)]">{label}</dt>
              <dd className="flex items-baseline gap-1.5">
                <span className="text-sm font-medium text-[var(--of-cc-ink)] tabular-nums">
                  {formatComponentValue(component.name, component.raw_value)}
                </span>
                {/* Bileşenin skora katkısı: kutunun neden bu renkte olduğunu
                    sayıyla söyler. */}
                <span className="text-[10px] text-[var(--of-cc-ink-label)] tabular-nums">
                  +{component.contribution.toFixed(0)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      {heat.is_relative && (
        <p className="mt-3 text-[10px] leading-relaxed text-[var(--of-cc-ink-muted)]">
          Kayıp bileşeni bu koşumdaki en kötü istasyona göre ölçüldü; skor
          göreli bir sıralamadır, mutlak bir not değil.
        </p>
      )}
    </div>
  );
}
