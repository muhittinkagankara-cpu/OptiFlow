/**
 * Kalem detay sayfası — EOQ, güvenlik stoku, sipariş noktası ve tükenme riski.
 *
 * Sayfa kullanıcının sorularının doğal sırasını izler: "ne kadar sipariş
 * vereyim?" (EOQ) → "ne zaman?" (sipariş noktası) → "hiçbir şey yapmazsam ne
 * olur?" (tükenme riski) → "üretimim ne kadar durur?" (bağlı istasyon etkisi).
 *
 * Stok projeksiyonu, üretim sonuçlarındaki güven aralığı gösterimiyle **aynı**
 * görsel dili kullanır: koyu çizgi ortalama, açık bant %95 aralığı. İki ekranda
 * iki farklı gösterim, kullanıcının aynı istatistiği iki kez öğrenmesi demek
 * olurdu.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  InventoryAnalysis,
  InventoryItem,
  StockoutRiskReport,
} from "../../types/simulationTypes";
import { DEFAULT_SERVICE_LEVEL, SERVICE_LEVELS } from "../../types/simulationTypes";
import { ApiError, analyzeInventoryItem, getStockoutRisk } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  formatDays,
  formatMoney,
  formatProbability,
  formatQuantity,
  riskTone,
  serviceLevelLabel,
  statusLabel,
  statusTone,
} from "../../lib/inventoryFormatting";
import type { Tone } from "../../lib/resultsFormatting";
import { ArrowLeftIcon, WarningIcon } from "../shared/icons";
import { Tooltip } from "../shared/Tooltip";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700",
  warning: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-slate-900",
};

const TONE_BADGE: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

interface InventoryItemDetailProps {
  item: InventoryItem;
  /** Üretim etkisi için okunacak koşum; yoksa etki hesaplanmaz. */
  simulationId: string | null;
  onBack: () => void;
  onEdit: () => void;
}

export function InventoryItemDetail({
  item,
  simulationId,
  onBack,
  onEdit,
}: InventoryItemDetailProps) {
  const [serviceLevel, setServiceLevel] = useState(DEFAULT_SERVICE_LEVEL);
  const [analysis, setAnalysis] = useState<InventoryAnalysis | null>(null);
  const [risk, setRisk] = useState<StockoutRiskReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrors([]);
    try {
      // İki çağrı paralel: biri kapalı form hesap, diğeri Monte Carlo. Sıralı
      // yapılsaydı kullanıcı iki bekleme süresini art arda yaşardı.
      const [nextAnalysis, nextRisk] = await Promise.all([
        analyzeInventoryItem(item.id, serviceLevel),
        getStockoutRisk(item.id, { simulationId }),
      ]);
      setAnalysis(nextAnalysis);
      setRisk(nextRisk);
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, [item.id, serviceLevel, simulationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-brand-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Envanter listesi
          </button>
          <h1 className="text-2xl font-semibold text-slate-900">{item.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Elde {formatQuantity(item.current_stock, item.unit)} · günde{" "}
            {formatQuantity(item.daily_demand_avg, item.unit, 1)} tüketiliyor
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
        >
          Kalemi düzenle
        </button>
      </header>

      {errors.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <ul className="list-inside list-disc space-y-1 text-sm text-red-800">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && !analysis && (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
          Hesaplanıyor…
        </p>
      )}

      {analysis && (
        <>
          <ServiceLevelPicker value={serviceLevel} onChange={setServiceLevel} />
          <AnalysisCards analysis={analysis} />
          <Recommendation analysis={analysis} />
        </>
      )}

      {risk && <StockoutSection risk={risk} />}
    </div>
  );
}

/**
 * Hizmet seviyesi seçimi.
 *
 * Sabit bir değere gömülmez: güvenlik stoku tamamen bu seçime bağlıdır ve
 * "%95" ile "%99" arasındaki fark, tutulacak stok miktarında ciddi bir fark
 * demektir. Kullanıcının bu ödünleşimi görmesi gerekir.
 */
function ServiceLevelPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (level: number) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
        Hizmet seviyesi
        <Tooltip
          label="Hizmet seviyesi hakkında"
          content="Tedarik süresi boyunca stoğun yetme olasılığı. Yükseltmek güvenlik stokunu ve dolayısıyla tutma maliyetini artırır; düşürmek tükenme riskini artırır."
        />
      </span>
      <div className="flex gap-1.5">
        {SERVICE_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={value === level}
            onClick={() => onChange(level)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              value === level
                ? "bg-brand-600 text-white shadow-sm"
                : "border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
            }`}
          >
            {serviceLevelLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

function AnalysisCards({ analysis }: { analysis: InventoryAnalysis }) {
  if (!analysis.is_applicable) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
        Bu kalem için günlük tüketim girilmemiş. Talep bilinmeden sipariş miktarı
        ve zamanı hesaplanamaz; kalemi düzenleyip günlük tüketimi ekleyin.
      </div>
    );
  }

  const tone = statusTone(analysis.status);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Sipariş Miktarı (EOQ)"
        help="Sipariş ve stok tutma maliyetlerinin toplamını en aza indiren parti büyüklüğü. Bu noktada iki maliyet birbirine eşitlenir."
        value={formatQuantity(analysis.economic_order_quantity, analysis.unit)}
        note={`Yılda ${analysis.orders_per_year.toFixed(1)} sipariş · ${formatDays(
          analysis.days_between_orders,
        )} arayla`}
      />
      <Card
        label="Sipariş Noktası"
        help="Stok bu seviyeye indiğinde sipariş verilmelidir: tedarik süresi boyunca tüketilecek miktar artı güvenlik stoku."
        value={formatQuantity(analysis.reorder_point, analysis.unit)}
        note={`Güvenlik stoku ${formatQuantity(analysis.safety_stock, analysis.unit)}`}
      />
      <Card
        label="Mevcut Durum"
        help="Stoğun sipariş noktasına ne kadar yakın olduğu."
        value={formatQuantity(analysis.current_stock, analysis.unit)}
        note={`${formatDays(analysis.days_of_stock)} yeter`}
        tone={tone}
        badge={statusLabel(analysis.status)}
      />
      <Card
        label="Yıllık Maliyet"
        help="Sipariş ve stok tutma maliyetlerinin toplamı. Malın satın alma bedeli dahil değildir; parti büyüklüğünden bağımsız olduğu için karşılaştırmayı bulanıklaştırırdı."
        value={formatMoney(analysis.total_annual_cost)}
        note={`Sipariş ${formatMoney(analysis.annual_ordering_cost)} · tutma ${formatMoney(
          analysis.annual_holding_cost,
        )}`}
      />
    </div>
  );
}

function Card({
  label,
  help,
  value,
  note,
  tone = "neutral",
  badge,
}: {
  label: string;
  help: string;
  value: string;
  note: string;
  tone?: Tone;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </p>
        <Tooltip content={help} label={`${label} hakkında`} />
      </div>
      <p className={`mt-2 text-2xl font-semibold ${TONE_TEXT[tone]}`}>{value}</p>
      {badge && (
        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_BADGE[tone]}`}
        >
          {badge}
        </span>
      )}
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function Recommendation({ analysis }: { analysis: InventoryAnalysis }) {
  const tone = statusTone(analysis.status);
  const border =
    tone === "bad"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-white text-slate-700";

  return (
    <p className={`mt-4 rounded-xl border px-5 py-4 text-sm leading-relaxed ${border}`}>
      {analysis.recommendation}
    </p>
  );
}

function StockoutSection({ risk }: { risk: StockoutRiskReport }) {
  const tone = riskTone(risk.stockout_probability);

  // Grafik verisi: gün, ortalama ve bandın alt ucu + genişliği. Recharts
  // yığılmış alanla bant çizer, bu yüzden üst sınır fark olarak verilir.
  const chartData = useMemo(
    () =>
      risk.projection.map((point) => ({
        day: point.day,
        mean: Number(point.mean_stock.toFixed(1)),
        lower: Number(point.ci_lower.toFixed(1)),
        band: Number((point.ci_upper - point.ci_lower).toFixed(1)),
      })),
    [risk.projection],
  );

  return (
    <section className="mt-8 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Stok Tükenme Riski</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Yeni sipariş gelmediği varsayımıyla, önümüzdeki {risk.horizon_days} gün.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm text-slate-700">
            Tükenme olasılığı:{" "}
            <strong className={`text-lg font-semibold ${TONE_TEXT[tone]}`}>
              {formatProbability(risk.stockout_probability)}
            </strong>
          </span>
          {risk.mean_first_stockout_day !== null && (
            <span className="text-sm text-slate-700">
              İlk tükenme ortalama{" "}
              <strong className="font-semibold text-slate-900">
                {Math.round(risk.mean_first_stockout_day)}. günde
              </strong>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            Beklenen boş süre:{" "}
            <strong className="font-semibold text-slate-900">
              {risk.expected_stockout_days.mean.toFixed(1)} gün
            </strong>
            <Tooltip
              label="Beklenen boş süre hakkında"
              content={`${risk.num_replications} bağımsız koşumun ortalaması. %95 güven aralığı: ${risk.expected_stockout_days.ci_lower.toFixed(1)} – ${risk.expected_stockout_days.ci_upper.toFixed(1)} gün.`}
            />
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">{risk.headline}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Stok seviyesi projeksiyonu
        </h3>
        <div className="overflow-hidden">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#64748b" }}
                label={{ value: "gün", position: "insideBottomRight", fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <RechartsTooltip
                formatter={(value: unknown, name: unknown) => {
                  if (typeof value !== "number") return String(value);
                  return name === "mean"
                    ? [`${value.toLocaleString("tr-TR")} ${risk.unit}`, "Ortalama stok"]
                    : [`${value.toLocaleString("tr-TR")} ${risk.unit}`, "Aralık"];
                }}
                labelFormatter={(label: unknown) => `${label}. gün`}
              />
              {/* Bant, alt sınırın üzerine görünmez bir taban + renkli bir
                  yığın olarak çizilir; Recharts'ın alan grafiğinde bir aralığı
                  göstermenin standart yolu budur. */}
              <Area
                type="monotone"
                dataKey="lower"
                stackId="ci"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="band"
                stackId="ci"
                stroke="none"
                fill="#93b4fd"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="mean"
                stroke="#1E2761"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Koyu çizgi ortalama stok, açık bant %95 güven aralığı —{" "}
          {risk.num_replications} bağımsız koşumdan.
        </p>
      </div>

      {risk.production_impact && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="text-sm text-red-900">
            <p className="font-medium">Üretim etkisi</p>
            <p className="mt-1 leading-relaxed">{risk.production_impact.message}</p>
            <p className="mt-1.5 text-xs text-red-800">
              Tahmini kayıp aralığı:{" "}
              {Math.round(risk.production_impact.lost_units_ci[0]).toLocaleString("tr-TR")}{" "}
              – {Math.round(risk.production_impact.lost_units_ci[1]).toLocaleString("tr-TR")}{" "}
              birim.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
