/**
 * Geçmiş trendler ekranı.
 *
 * Üç pencere (1 saat / 24 saat / 7 gün) aynı `telemetry` tablosundan beslenir.
 * Bu ekranda benzetim yoktur: her nokta bir cihazdan gerçekten okunmuş bir
 * ölçümdür ve ölçümü olmayan aralıkta çizgi kesilir.
 */

import { memo } from "react";
import { Database, RefreshCw } from "lucide-react";
import {
  TREND_WINDOW_ORDER,
  formatPercent,
  formatValue,
  originLabel,
  seriesCaption,
  windowLabel,
} from "../../lib/telemetry";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { NOT_MEASURED } from "../monitoring/monitoringStyles";
import { TrendChart } from "./TrendChart";
import { useTrends } from "./useTrends";

interface HistoricalTrendsPageProps {
  /** Kapalıyken hiç istek yapılmaz. */
  enabled?: boolean;
}

function HistoricalTrendsPageInner({ enabled = true }: HistoricalTrendsPageProps) {
  const trends = useTrends({ enabled });
  const series = trends.view;

  return (
    <div className="space-y-4">
      {trends.error !== null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">Trend verisi okunamadı.</p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            {trends.error} Ekrandaki değerler son okunan yanıta aittir.
          </p>
        </div>
      )}

      <Card className="p-4">
        <SectionTitle
          title="Geçmiş Trendler"
          description="Kayıtlı telemetri tablosundan okunur; benzetim kullanılmaz."
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => void trends.refresh()}
              busy={trends.loading}
            >
              Yenile
            </Button>
          }
        />

        {trends.tags.length === 0 ? (
          <EmptyState
            icon={Database}
            title="Henüz kayıtlı ölçüm yok"
            description="Bir cihaz bağlanıp akış başladığında ölçümler telemetri tablosuna yazılır ve burada görünür."
          />
        ) : (
          <div className="space-y-4">
            {/*
              375 piksellik ekranda etiket seçici, pencere düğmeleriyle aynı
              satırda kalınca hiçbir şey okunamayacak kadar daralıyordu
              (tarayıcıda görüldü): geriye yalnızca ok işareti kalıyor ve
              kullanıcı hangi etikete baktığını göremiyordu. Seçici mobilde
              kendi satırını alır, geniş ekranda düğmelerin yanına geçer.
            */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="text-xs font-medium text-slate-600" htmlFor="trend-tag">
                Etiket
              </label>
              <select
                id="trend-tag"
                className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 sm:w-auto sm:flex-1"
                value={`${trends.device ?? ""}::${trends.tag ?? ""}`}
                onChange={(event) => {
                  const [device, tag] = event.target.value.split("::");
                  trends.select(device, tag);
                }}
              >
                {trends.tags.map((item) => (
                  <option key={`${item.device}::${item.tag}`} value={`${item.device}::${item.tag}`}>
                    {item.device} · {item.tag}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-1">
                {TREND_WINDOW_ORDER.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={trends.windowId === id ? "primary" : "secondary"}
                    onClick={() => trends.setWindowId(id)}
                  >
                    {windowLabel(id)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" icon={Database}>
                {originLabel(series.origin)}
              </Badge>
              {!series.hasData && <Badge tone="neutral">Veri yok</Badge>}
              {series.excluded > 0 && (
                <Badge tone="warning">{series.excluded} ölçüm hesap dışı</Badge>
              )}
            </div>

            <TrendChart series={series} />

            <p className="text-xs text-slate-500">{seriesCaption(series)}</p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCell label="Ortalama" value={formatValue(series.summary.average)} />
              <SummaryCell label="En düşük" value={formatValue(series.summary.min)} />
              <SummaryCell label="En yüksek" value={formatValue(series.summary.max)} />
              <SummaryCell
                label="Kapsama"
                value={formatPercent(series.summary.coverage)}
                note={
                  series.summary.coverage === null
                    ? "Ölçüm yok"
                    : `${series.summary.filledBuckets}/${series.buckets.length} aralık`
                }
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Özet hücresi.
 *
 * Ölçülmemiş değer "—" gösterir; sıfır yazılsaydı, hiç ölçüm almamış bir
 * etiket "ortalama 0" diye okunurdu.
 */
function SummaryCell({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value || NOT_MEASURED}</p>
      {note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

export const HistoricalTrendsPage = memo(HistoricalTrendsPageInner);
