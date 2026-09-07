/**
 * Finans ekranı — kaybın nereden geldiği ve neyin geri kazanılabileceği.
 *
 * Sonuç sayfasındaki katlanır panelin tam sayfa hâlidir ve **aynı veriyi**
 * kullanır: maliyet oranları `POST /api/finance/impact/{id}` ucuna gönderilir,
 * dönen rapor olduğu gibi gösterilir. Hiçbir tutar burada yeniden hesaplanmaz
 * — Pareto sıralaması ve aylık projeksiyon dâhil her türetme
 * `lib/dashboardMetrics.ts` içindeki saf işlevlerle yapılır ve o işlevler de
 * yalnızca backend'in verdiği alanları yeniden düzenler.
 *
 * Rapor yukarı taşınır (`onReportChange`): Command Center'daki "Aylık Kayıp"
 * ve "Potansiyel Kazanç" kartları aynı raporu okur. İki ekran ayrı ayrı
 * hesaplasaydı, aynı koşum için iki farklı rakam gösterebilirlerdi.
 */

import { useCallback, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator, PiggyBank, TrendingDown, Wallet } from "lucide-react";
import type {
  FinancialReport,
  FinancialSettings,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import { ApiError, getFinancialImpact } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import { formatMoney } from "../../lib/financeFormatting";
import {
  monthlyLoss,
  monthlyRecoverable,
  paretoOfComponents,
  paybackDays,
} from "../../lib/dashboardMetrics";
import { ReportView, SettingsForm } from "../results/FinancialImpactPanel";
import { Badge, Button, Card, EmptyState } from "../ui/Primitives";

interface FinancePageProps {
  result: SimulationRunResponse | null;
  config: SimulationConfig | null;
  report: FinancialReport | null;
  settings: FinancialSettings;
  onSettingsChange: (patch: Partial<FinancialSettings>) => void;
  onReportChange: (report: FinancialReport | null) => void;
  onStartSimulation: () => void;
  /**
   * Yeni hesap yapılamayan mod (demo).
   *
   * Hesaplama sunucuda yapılır ve oturum ister; demo oturumsuz çalıştığı için
   * düğme kapatılır. Açık bırakılıp yetki hatası aldırmak, ziyaretçiye ürünün
   * bozuk olduğunu düşündürürdü.
   */
  readOnly?: boolean;
}

export function FinancePage({
  result,
  config,
  report,
  settings,
  onSettingsChange,
  onReportChange,
  onStartSimulation,
  readOnly = false,
}: FinancePageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const simulationId = result?.simulation_id ?? null;

  const calculate = useCallback(async () => {
    if (!simulationId) {
      return;
    }
    setIsLoading(true);
    setErrors([]);
    try {
      onReportChange(await getFinancialImpact(simulationId, settings));
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, [simulationId, settings, onReportChange]);

  if (!result || !config) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Wallet}
          title="Finansal analiz için önce bir koşum gerekir"
          description="Kayıpların parasal karşılığı, kaydedilmiş bir simülasyonun metriklerinden hesaplanır. Bir model çalıştırın, sonra maliyet oranlarınızı girin."
          action={
            <Button variant="primary" onClick={onStartSimulation}>
              Simülasyona git
            </Button>
          }
        />
      </div>
    );
  }

  // En az bir oran girilmeden hesap anlamsizdir: tum kalemler
  // "hesaplanamadi" doner ve kullanici bos bir tablo gorur.
  const hasAnyRate = Object.entries(settings).some(
    ([key, value]) =>
      key !== "production_minutes_per_day" && typeof value === "number",
  );

  const monthly = monthlyLoss(report);
  const recoverable = monthlyRecoverable(report);
  const pareto = paretoOfComponents(report);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Finans
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Kayıplarınızın parasal karşılığı ve geri kazanım potansiyeli.
        </p>
      </div>

      {/* --- Oran girişi --- */}
      <Card className="p-5" index={0}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Calculator className="h-4 w-4 text-slate-500" />
            Maliyet oranlarınız
          </h3>
          <Badge tone="neutral">Oranlar sunucuda saklanmaz</Badge>
        </div>

        <SettingsForm settings={settings} onChange={onSettingsChange} />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void calculate()}
            disabled={!hasAnyRate || readOnly}
            busy={isLoading}
            title={
              readOnly
                ? "Demoda yeni hesap yapılamaz"
                : hasAnyRate
                  ? undefined
                  : "En az bir maliyet oranı girin"
            }
          >
            Kaybı hesapla
          </Button>
          {readOnly ? (
            <span className="text-xs text-slate-500">
              Demoda hazır bir hesap gösteriliyor; kendi oranlarınızla
              hesaplamak için bir hesap açın.
            </span>
          ) : (
            !hasAnyRate && (
              <span className="text-xs text-slate-500">
                Oranlar girilmeden rakam gösterilmez.
              </span>
            )
          )}
        </div>

        {errors.length > 0 && (
          <ul className="mt-4 list-inside list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </Card>

      {!report ? (
        <div className="mt-4">
          <EmptyState
            icon={Calculator}
            title="Henüz hesaplanmadı"
            description="Yukarıdaki oranlardan en az birini girip “Kaybı hesapla” deyin. Girmediğiniz her oran için ilgili kalem hesaplanmaz ve raporda eksik olarak bildirilir."
          />
        </div>
      ) : (
        <>
          {/* --- Büyük göstergeler --- */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MoneyCard
              index={1}
              icon={TrendingDown}
              label="Aylık Kayıp"
              value={monthly}
              hint="Günlük kayıptan 22 iş günü üzerinden ölçeklendi."
              tone="bad"
              emptyHint="Günlük üretim süresi girilmedi"
            />
            <MoneyCard
              index={2}
              icon={PiggyBank}
              label="Aylık Geri Kazanım"
              value={recoverable}
              hint="Bilinen bir eylemin hedefleyebileceği tutar. Fire dâhil değildir."
              tone="good"
              emptyHint="Günlük üretim süresi girilmedi"
            />
            <MoneyCard
              index={3}
              icon={Wallet}
              label="Pencere Toplamı"
              value={report.impact.total_loss}
              hint={`${report.window_minutes.toLocaleString("tr-TR")} dakikalık koşum penceresi.`}
              tone="neutral"
            />
            <PaybackCard index={4} report={report} />
          </div>

          {/* --- Pareto --- */}
          {pareto.length > 0 && (
            <Card className="mt-4 p-5" index={5}>
              <h3 className="text-sm font-semibold text-slate-900">
                Kayıp Pareto'su
              </h3>
              <p className="mt-0.5 mb-4 text-xs text-slate-500">
                Kalemler büyükten küçüğe; çizgi kümülatif payı gösterir. Soldaki
                bir veya iki kalem toplamın çoğunu oluşturuyorsa, çabayı oraya
                yoğunlaştırmak en yüksek getiriyi verir.
              </p>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={pareto.map((item) => ({
                      label: item.label,
                      amount: item.amount,
                      cumulative: Math.round(item.cumulativeShare * 100),
                    }))}
                    margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid stroke="#1F2937" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      stroke="#1F2937"
                    />
                    <YAxis
                      yAxisId="amount"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      stroke="#1F2937"
                      tickFormatter={(value: number) => formatMoney(value)}
                      width={80}
                    />
                    <YAxis
                      yAxisId="share"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      stroke="#1F2937"
                      tickFormatter={(value: number) => `%${value}`}
                      width={44}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #1F2937",
                        borderRadius: 12,
                        color: "#F9FAFB",
                        fontSize: 12,
                      }}
                      // Recharts formatter'lari degeri genis bir birlesim
                      // tipiyle verir; mevcut grafiklerdeki desen izlenir.
                      formatter={(value: unknown, name: unknown) =>
                        name === "cumulative"
                          ? [`%${Number(value)}`, "Kümülatif"]
                          : [formatMoney(Number(value)), "Tutar"]
                      }
                    />
                    <Bar
                      yAxisId="amount"
                      dataKey="amount"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={96}
                    >
                      {pareto.map((item, position) => (
                        <Cell
                          key={item.name}
                          fill={position === 0 ? "#EF4444" : "#2563EB"}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="share"
                      type="monotone"
                      dataKey="cumulative"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#F59E0B" }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* --- İstasyon bazlı kayıp --- */}
          {report.stations.length > 0 && (
            <Card className="mt-4 p-5" index={6}>
              <h3 className="text-sm font-semibold text-slate-900">
                İstasyon bazlı kayıp
              </h3>
              <p className="mt-0.5 mb-4 text-xs text-slate-500">
                Hangi istasyon ne kadar para kaybettiriyor?
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={report.stations.slice(0, 8).map((item) => ({
                      label: item.station_name,
                      amount: item.total_loss,
                      isBottleneck: item.is_bottleneck,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid stroke="#1F2937" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      stroke="#1F2937"
                      tickFormatter={(value: number) => formatMoney(value)}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      stroke="#1F2937"
                      width={110}
                    />
                    <Tooltip
                      cursor={{ fill: "#1F2937", opacity: 0.4 }}
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #1F2937",
                        borderRadius: 12,
                        color: "#F9FAFB",
                        fontSize: 12,
                      }}
                      formatter={(value: unknown) => [
                        formatMoney(Number(value)),
                        "Kayıp",
                      ]}
                    />
                    <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={28}>
                      {report.stations.slice(0, 8).map((item) => (
                        <Cell
                          key={item.station_id}
                          fill={item.is_bottleneck ? "#EF4444" : "#2563EB"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* --- Ayrıntılı rapor: mevcut, şeffaflık etiketli görünüm --- */}
          <div className="mt-4">
            <ReportView report={report} config={config} />
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MoneyCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  emptyHint,
  index,
}: {
  icon: typeof Wallet;
  label: string;
  value: number | null;
  hint: string;
  tone: "bad" | "good" | "neutral";
  emptyHint?: string;
  index: number;
}) {
  const accent =
    tone === "bad"
      ? "bg-red-500/15 text-red-700"
      : tone === "good"
        ? "bg-emerald-500/15 text-emerald-700"
        : "bg-slate-100 text-slate-500";

  return (
    <Card interactive index={index} className="p-5">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <p className="mt-4 text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      {value === null ? (
        <>
          <p className="mt-1.5 text-2xl font-semibold text-slate-400">—</p>
          <p className="mt-1 text-[11px] text-slate-500">{emptyHint}</p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {formatMoney(value)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>
        </>
      )}
    </Card>
  );
}

/**
 * Geri ödeme kartı.
 *
 * Yatırım tutarı kullanıcıdan alınır ve **hiçbir yere gönderilmez**; geri
 * ödeme süresi tarayıcıda, raporun günlük kurtarılabilir tutarına bölünerek
 * bulunur. Bu bir maliyet hesabı değil, kullanıcının kendi girdiği sayıyla
 * yaptığı basit bir bölmedir — finans motorunun işini tekrarlamaz.
 */
function PaybackCard({
  report,
  index,
}: {
  report: FinancialReport;
  index: number;
}) {
  const [investment, setInvestment] = useState<number>(50000);
  const days = paybackDays(report, investment);

  /*
   * Hesaplanamama nedeni ayırt edilir. İki farklı durum aynı mesajla
   * anlatılsaydı yanıltıcı olurdu: günlük üretim süresi girilmiş ama
   * kurtarılabilir kaybı sıfır olan bir kullanıcıya "günlük üretim süresi
   * girilmedi" demek, olmayan bir eksiği aramasına yol açardı.
   */
  const hasDaily = report.daily_loss !== null && report.daily_loss !== undefined;
  const emptyReason = !hasDaily
    ? "Günlük üretim süresi girilmedi"
    : report.recoverable_loss <= 0
      ? "Kurtarılabilir kayıp yok — bilinen bir eylemin hedefleyebileceği tutar sıfır"
      : "Yatırım tutarı girin";

  return (
    <Card interactive index={index} className="p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600/15 text-brand-700">
        <PiggyBank className="h-4.5 w-4.5" />
      </span>
      <p className="mt-4 text-xs font-medium tracking-wide text-slate-500 uppercase">
        Geri Ödeme
      </p>
      {days === null ? (
        <>
          <p className="mt-1.5 text-2xl font-semibold text-slate-400">—</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {emptyReason}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {days < 1 ? "<1" : Math.round(days)}
          <span className="ml-1.5 text-sm font-normal text-slate-500">gün</span>
        </p>
      )}
      <label className="mt-2.5 block">
        <span className="text-[10px] tracking-wide text-slate-500 uppercase">
          Yatırım tutarı
        </span>
        <input
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(investment) ? investment : ""}
          onChange={(event) => setInvestment(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 tabular-nums focus:border-brand-500 focus:outline-none"
        />
      </label>
    </Card>
  );
}
