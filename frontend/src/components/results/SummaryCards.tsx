/**
 * Bölüm A — Özet kartları.
 *
 * Sayfanın en üstünde, her zaman görünür dört kart. Kullanıcının ekrana ilk
 * baktığında görmesi gereken dört sayı budur; geri kalan her şey bunları
 * açıklamak için vardır.
 *
 * Beklenen üretim kartı, sayının yanında güven aralığını **görsel olarak** da
 * gösterir. Tek bir sayı sunmak, simülasyonun ürettiği belirsizliği gizlemek
 * olurdu; kullanıcı "1.000 birim" ile "1.000 ± 200 birim" arasındaki farkı
 * yazıyı okumadan, bandın genişliğinden anlayabilmelidir.
 */

import type { SimulationResults } from "../../types/simulationTypes";
import {
  formatDecimal,
  formatMinutes,
  formatPercent,
  formatUnits,
  oeeTone,
  type Tone,
} from "../../lib/resultsFormatting";
import { Tooltip } from "../shared/Tooltip";

const TONE_STYLES: Record<Tone, { value: string; badge: string }> = {
  good: { value: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800" },
  warning: { value: "text-amber-700", badge: "bg-amber-100 text-amber-800" },
  bad: { value: "text-red-700", badge: "bg-red-100 text-red-800" },
  neutral: { value: "text-slate-900", badge: "bg-slate-100 text-slate-700" },
};

const OEE_TONE_LABEL: Record<Tone, string> = {
  good: "İyi",
  warning: "Orta",
  bad: "Düşük",
  neutral: "—",
};

interface SummaryCardsProps {
  results: SimulationResults;
}

export function SummaryCards({ results }: SummaryCardsProps) {
  const [lower, upper] = results.confidence_interval_95;
  const tone = oeeTone(results.line_oee);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Beklenen Üretim"
        help="Simülasyon süresince tamamlanan iyi ürün sayısı. Tek bir kesin sayı değil, bir tahmin aralığıdır: aynı hat farklı günlerde farklı sonuç verir."
        value={formatUnits(results.total_throughput)}
        unit="birim"
      >
        <ConfidenceIntervalBar
          lower={lower}
          upper={upper}
          mean={results.total_throughput}
        />
        <p className="mt-2 text-xs text-slate-500">
          %95 güven aralığı: {formatUnits(lower)} – {formatUnits(upper)}
        </p>
      </Card>

      <Card
        label="Ortalama Akış Süresi"
        help="Bir parçanın hatta girişinden çıkışına kadar geçen toplam süre. İşlem süreleri kadar kuyrukta bekleme sürelerini de içerir."
        value={formatMinutes(results.avg_flow_time)}
      />

      <Card
        label="Ortalama WIP"
        help="Aynı anda hatta bulunan ortalama parça sayısı (yarı mamul stoğu). Yüksek WIP, paranın hat üzerinde beklediği anlamına gelir."
        value={formatDecimal(results.avg_wip)}
        unit="parça"
      />

      <Card
        label="Genel OEE"
        help="Ekipman etkinliği: kullanılabilirlik, performans ve kalitenin çarpımı. Darboğaz istasyonunda ölçülür, çünkü hattın çıktısını o belirler."
        value={formatPercent(results.line_oee, 1)}
        tone={tone}
      >
        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_STYLES[tone].badge}`}
        >
          {OEE_TONE_LABEL[tone]}
        </span>
      </Card>
    </div>
  );
}

interface CardProps {
  label: string;
  help: string;
  value: string;
  unit?: string;
  tone?: Tone;
  children?: React.ReactNode;
}

function Card({ label, help, value, unit, tone = "neutral", children }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </p>
        <Tooltip content={help} label={`${label} hakkında`} />
      </div>
      <p className={`mt-2 text-3xl font-semibold ${TONE_STYLES[tone].value}`}>
        {value}
        {unit && <span className="ml-1.5 text-base font-normal text-slate-400">{unit}</span>}
      </p>
      {children}
    </div>
  );
}

interface ConfidenceIntervalBarProps {
  lower: number;
  upper: number;
  mean: number;
}

/**
 * Güven aralığının görsel gösterimi.
 *
 * Özel SVG kullanılır çünkü gösterilmek istenen şey bir "grafik" değil, tek bir
 * kestirimin belirsizliğidir: eksen, ızgara ve etiket gerekmez. Bant aralığı,
 * dikey çizgi ortalamayı gösterir.
 *
 * Ölçek, aralığın kendisine göre değil aralığın %60 payla genişletilmiş hâline
 * göre kurulur; aksi hâlde bant her zaman kartın tamamını doldurur ve dar bir
 * aralık ile geniş bir aralık aynı görünürdü.
 */
function ConfidenceIntervalBar({ lower, upper, mean }: ConfidenceIntervalBarProps) {
  const width = upper - lower;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }

  const padding = width * 0.6;
  const scaleMin = lower - padding;
  const scaleMax = upper + padding;
  const toPercent = (value: number) =>
    ((value - scaleMin) / (scaleMax - scaleMin)) * 100;

  const bandStart = toPercent(lower);
  const bandWidth = toPercent(upper) - bandStart;
  const meanPosition = toPercent(mean);
  /** Aralığın yarı genişliğinin ortalamaya oranı: "± %x" olarak okunur. */
  const relativeHalfWidth = width / 2 / Math.max(Math.abs(mean), 1);

  return (
    <div className="mt-3">
      <svg
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        className="h-3.5 w-full"
        role="img"
        aria-label={`Tahmin aralığı ${formatUnits(lower)} ile ${formatUnits(upper)} birim arasında, ortalama ${formatUnits(mean)} birim`}
      >
        {/* Ölçek çizgisi */}
        <line x1="0" y1="7" x2="100" y2="7" stroke="#e2e8f0" strokeWidth="1.5" />
        {/* Güven aralığı bandı */}
        <rect
          x={bandStart}
          y="3.5"
          width={bandWidth}
          height="7"
          rx="2"
          fill="#bfd3fe"
        />
        {/* Aralığın uçları */}
        <line x1={bandStart} y1="1.5" x2={bandStart} y2="12.5" stroke="#608cfa" strokeWidth="1.2" />
        <line
          x1={bandStart + bandWidth}
          y1="1.5"
          x2={bandStart + bandWidth}
          y2="12.5"
          stroke="#608cfa"
          strokeWidth="1.2"
        />
        {/* Ortalama */}
        <line x1={meanPosition} y1="0.5" x2={meanPosition} y2="13.5" stroke="#1d35d8" strokeWidth="2" />
      </svg>
      <p className="mt-1 text-[11px] text-slate-400">
        Belirsizlik payı ± {formatPercent(relativeHalfWidth, 1)}
      </p>
    </div>
  );
}
