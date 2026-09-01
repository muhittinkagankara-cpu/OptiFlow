/**
 * Fabrika geneli özet — 20 istasyonluk bir modeli tek bakışta okunur kılar.
 *
 * İstasyon tablosunun **yerine** değil, üstüne konur. Tablo hâlâ her sayıyı
 * gösterir; buradaki katman kullanıcının ilk sorusuna cevap verir: "fabrikam
 * genel olarak nasıl ve nereye bakmalıyım?". Yirmi satırı tek tek karşılaştırıp
 * bu cevaba varmak, tam olarak kullanıcının yapmak istemediği iştir.
 *
 * Kartlar yalnızca birden fazla hat varsa gösterilir. Üç istasyonlu bir modelde
 * tek bir "Genel" kartı, hiçbir ayrım göstermeden ekrana gürültü eklerdi.
 */

import type { FactorySummary, LineSummary } from "../../lib/factoryOverview";
import { formatPercent, oeeTone, utilizationTone } from "../../lib/resultsFormatting";
import { WarningIcon } from "../shared/icons";
import { Tooltip } from "../shared/Tooltip";

const OEE_TEXT_COLORS: Record<string, string> = {
  good: "text-emerald-700",
  warning: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-slate-700",
};

const BAR_COLORS: Record<string, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-slate-400",
};

interface FactoryOverviewProps {
  summary: FactorySummary;
  /** Seçili hat; `null` ise tüm istasyonlar gösteriliyor. */
  selectedLine: string | null;
  /** Kart tıklanınca çağrılır; aynı karta yeniden tıklamak seçimi kaldırır. */
  onSelectLine: (lineName: string | null) => void;
}

export function FactoryOverview({
  summary,
  selectedLine,
  onSelectLine,
}: FactoryOverviewProps) {
  if (summary.stationCount === 0) {
    return null;
  }

  return (
    <section className="mt-6 space-y-3">
      <StatusLine summary={summary} />

      {summary.isGrouped && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.lines.map((line) => (
              <LineCard
                key={line.lineName}
                line={line}
                isSelected={selectedLine === line.lineName}
                onSelect={() =>
                  onSelectLine(selectedLine === line.lineName ? null : line.lineName)
                }
              />
            ))}
          </div>

          <p className="text-xs text-slate-500">
            {selectedLine
              ? `Aşağıdaki tablo “${selectedLine}” hattını gösteriyor. Karta yeniden tıklayarak tüm istasyonlara dönebilirsiniz.`
              : "Bir hatta tıklayarak aşağıdaki tabloyu o hatla sınırlayabilirsiniz."}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Tek satırlık fabrika durumu.
 *
 * Üç bilgi taşır: ölçek, kısıt ve genel verimlilik. Kısıt ortada durur çünkü
 * kullanıcının yapabileceği tek şeydir — ölçek zaten bilinir, verimlilik ise
 * kısıt düzelmeden değişmez.
 */
function StatusLine({ summary }: { summary: FactorySummary }) {
  const { bottleneck, bottleneckLineName } = summary;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-slate-700">
          {summary.isGrouped && (
            <>
              <strong className="font-semibold text-slate-900">
                {summary.lineCount} hat
              </strong>
              <span className="text-slate-400">, </span>
            </>
          )}
          <strong className="font-semibold text-slate-900">
            {summary.stationCount} istasyon
          </strong>
        </span>

        {bottleneck && (
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <WarningIcon className="h-4 w-4 shrink-0 text-red-600" />
            <span>
              Genel darboğaz:{" "}
              {summary.isGrouped && !bottleneckLineName?.startsWith("Genel") && (
                <span className="text-slate-500">{bottleneckLineName} — </span>
              )}
              <strong className="font-semibold text-slate-900">
                {bottleneck.station_name}
              </strong>{" "}
              <span className="tabular-nums text-slate-600">
                ({formatPercent(bottleneck.utilization)} doluluk)
              </span>
            </span>
          </span>
        )}

        <span className="inline-flex items-center gap-1.5 text-slate-700">
          <span>
            Ortalama istasyon verimliliği:{" "}
            <strong
              className={`font-semibold tabular-nums ${OEE_TEXT_COLORS[oeeTone(summary.averageOee)]}`}
            >
              {formatPercent(summary.averageOee, 1)}
            </strong>
          </span>
          {/*
            Bu sayı, yukarıdaki "Genel OEE" kartından çok daha düşük çıkabilir ve
            açıklanmazsa çelişki gibi görünür. Genel OEE darboğazın kendi
            skorudur; buradaki ise tüm istasyonların ortalamasıdır. Darboğaz
            dışındaki istasyonlar sırasını beklediği için düşük skor alır, bu
            beklenen bir durumdur — hepsini birden hızlandırmak çıktıyı
            artırmaz.
          */}
          <Tooltip
            label="Ortalama istasyon verimliliği hakkında"
            content="Tüm istasyonların OEE ortalaması. Yukarıdaki 'Genel OEE' ise yalnızca darboğazın skorudur. Aradaki fark büyükse bu bir hata değildir: darboğaz dışındaki istasyonlar sıralarını beklediği için düşük skor alır. Bu istasyonları hızlandırmak toplam çıktıyı artırmaz — darboğazı hızlandırmak artırır."
          />
        </span>
      </div>
    </div>
  );
}

/**
 * Tek bir hattın kartı.
 *
 * Hattın kendi en yoğun istasyonu ("mini darboğaz") kartın ana bilgisidir:
 * fabrika genelinde kısıt olmayan bir hat bile kendi içinde bir yerde
 * sıkışıyordur ve kullanıcı sıradaki iyileştirmeyi oradan seçer.
 */
function LineCard({
  line,
  isSelected,
  onSelect,
}: {
  line: LineSummary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const utilTone = utilizationTone(
    line.bottleneck.utilization,
    line.hasFactoryBottleneck,
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`rounded-xl border bg-white px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        isSelected
          ? "border-brand-500 ring-1 ring-brand-300"
          : line.hasFactoryBottleneck
            ? "border-red-200 hover:border-red-300"
            : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">
          {line.lineName}
        </span>
        {line.hasFactoryBottleneck && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            <WarningIcon className="h-3 w-3" />
            Darboğaz
          </span>
        )}
      </div>

      <p className="mt-0.5 text-xs text-slate-500">
        {line.stations.length} istasyon
      </p>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs text-slate-600">
            En yoğun: {line.bottleneck.station_name}
          </span>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
            {formatPercent(line.bottleneck.utilization)}
          </span>
        </div>
        <span
          className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
          role="img"
          aria-label={`En yoğun istasyon doluluğu ${formatPercent(line.bottleneck.utilization)}`}
        >
          <span
            className={`block h-full rounded-full ${BAR_COLORS[utilTone]}`}
            style={{
              width: `${Math.min(Math.max(line.bottleneck.utilization, 0), 1) * 100}%`,
            }}
          />
        </span>
      </div>

      <p className="mt-2.5 text-xs text-slate-600">
        Ortalama OEE{" "}
        <span
          className={`font-semibold tabular-nums ${OEE_TEXT_COLORS[oeeTone(line.averageOee)]}`}
        >
          {formatPercent(line.averageOee, 1)}
        </span>
      </p>
    </button>
  );
}
