/**
 * Sayfa 1 — Executive Command Center.
 *
 * Giriş yapan yöneticinin ilk gördüğü ekran. Amacı bir "hoş geldiniz" sayfası
 * olmak değil, üç soruyu ilk bakışta yanıtlamaktır: hattım ne durumda, bugün
 * neyi çözmeliyim, dün ne oldu?
 *
 * Ekranın sırası bu üç soruyu izler:
 *   1. Hero + KPI  — durum
 *   2. Morning Brief + Bugün Yapılacaklar — öncelik
 *   3. Son Simülasyonlar + Fabrika Sağlığı — bağlam
 *
 * Veri kaynağı
 * ------------
 * Ekrandaki her sayı, uygulamanın **zaten sahip olduğu** son koşumdan, finans
 * raporundan ve envanter analizinden türetilir; hiçbir hesap burada yeniden
 * yapılmaz ve hiçbir yeni uç çağrılmaz. Türetmelerin tamamı sınanmış saf
 * işlevlerdedir (`lib/dashboardMetrics`, `lib/actionItems`, `lib/factoryHealth`).
 *
 * Hesaplanamayan bir gösterge uydurulmaz: değeri "—" olur ve kart kullanıcıyı
 * eksik adıma götürür. Maliyet oranları girilmeden "aylık kaybınız ₺0" demek,
 * hiçbir şey dememekten kötüdür.
 */

import {
  Activity,
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Gauge,
  History,
  Info,
  Package,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  SHIFT_MINUTES,
  bottleneckSummary,
  capacityShare,
  dailyThroughput,
  monthlyLoss,
  monthlyRecoverable,
  morningBrief,
} from "../../lib/dashboardMetrics";
import {
  buildActionItems,
  countByPriority,
  type ActionItem,
  type ActionPriority,
  type ActionTarget,
} from "../../lib/actionItems";
import { buildHealthIndicators, type HealthTone } from "../../lib/factoryHealth";
import { relativeTime, type RunHistoryEntry } from "../../lib/runHistory";
import { formatMoney } from "../../lib/financeFormatting";
import { formatDecimal, formatUnits } from "../../lib/resultsFormatting";
import { Badge, Button, Card } from "../ui/Primitives";

interface CommandCenterProps {
  greetingText: string;
  userName: string;
  results: SimulationResults | null;
  report: FinancialReport | null;
  analyses: InventoryAnalysis[] | null;
  runHistory: RunHistoryEntry[];
  factoryCount: number;
  onNavigate: (target: ActionTarget) => void;
  onOpenCopilot: () => void;
}

export function CommandCenter({
  greetingText,
  userName,
  results,
  report,
  analyses,
  runHistory,
  factoryCount,
  onNavigate,
  onOpenCopilot,
}: CommandCenterProps) {
  const daily = dailyThroughput(results);
  const capacity = capacityShare(results);
  const bottleneck = bottleneckSummary(results);
  const monthly = monthlyLoss(report);
  const recoverable = monthlyRecoverable(report);
  const brief = morningBrief(results, report);
  const actions = buildActionItems({ results, report, analyses, factoryCount });
  const health = buildHealthIndicators(results);
  const counts = countByPriority(actions);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      {/* --- 1. Hero --- */}
      <header className="optiflow-enter mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {greetingText}
          {userName && ` ${userName}`}
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
          Bugün fabrikanızda çözmeniz gereken öncelikli konular.
        </p>
      </header>

      {/* --- 2. KPI kartları --- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          index={0}
          icon={Package}
          label="Günlük Üretim"
          value={daily === null ? null : formatUnits(daily)}
          unit="birim"
          hint={`Tek vardiya (${SHIFT_MINUTES} dk) varsayımıyla ölçeklendi.`}
          gradient="from-brand-500/20 via-brand-600/10 to-transparent"
          iconClass="bg-brand-600/15 text-brand-700"
          footer={
            capacity === null ? undefined : (
              <span className="text-slate-500">
                Teorik kapasitenin{" "}
                <span className="font-semibold text-slate-700">
                  %{Math.round(capacity * 100)}
                </span>
                'i
              </span>
            )
          }
          onEmptyAction={() => onNavigate("simulation")}
        />

        <KpiCard
          index={1}
          icon={Gauge}
          label="OEE"
          value={results === null ? null : `%${Math.round(results.line_oee * 100)}`}
          hint="Hat geneli ekipman etkinliği: kullanılabilirlik × performans × kalite."
          gradient="from-emerald-500/20 via-emerald-500/8 to-transparent"
          iconClass="bg-emerald-500/15 text-emerald-700"
          footer={
            bottleneck && (
              <span className="text-slate-500">
                Darboğaz:{" "}
                <span className="font-semibold text-slate-700">
                  {bottleneck.name}
                </span>{" "}
                (%{Math.round(bottleneck.utilization * 100)})
              </span>
            )
          }
          onEmptyAction={() => onNavigate("simulation")}
        />

        <KpiCard
          index={2}
          icon={Wallet}
          label="Aylık Kayıp"
          value={monthly === null ? null : formatMoney(monthly)}
          hint="Finans ekranındaki günlük kayıptan 22 iş günü üzerinden ölçeklendi."
          gradient="from-red-500/20 via-red-500/8 to-transparent"
          iconClass="bg-red-500/15 text-red-700"
          emptyLabel="Maliyet oranları girilmedi"
          emptyAction="Finans'a git"
          onEmptyAction={() => onNavigate("finance")}
        />

        <KpiCard
          index={3}
          icon={TrendingUp}
          label="Potansiyel Kazanç"
          value={recoverable === null ? null : formatMoney(recoverable)}
          hint="Bilinen bir eylemin doğrudan hedefleyebileceği aylık tutar. Fire dâhil değildir."
          gradient="from-amber-500/20 via-amber-500/8 to-transparent"
          iconClass="bg-amber-500/15 text-amber-700"
          emptyLabel="Maliyet oranları girilmedi"
          emptyAction="Finans'a git"
          onEmptyAction={() => onNavigate("finance")}
        />
      </div>

      {/* --- 3. AI Morning Brief --- */}
      <Card className="mt-4 overflow-hidden" index={4}>
        <div className="bg-gradient-to-br from-brand-600/12 via-brand-600/4 to-transparent p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600/15 text-brand-700">
                <Sparkles className="h-4.5 w-4.5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  AI Morning Brief
                </h3>
                <p className="text-[11px] text-slate-500">
                  Bugünün özeti, mevcut koşum verinizden derlendi.
                </p>
              </div>
            </div>
            {/* Kartın bu sürümde bir dil modeline gitmediği açıkça yazılır:
                türetilmiş bir cümleyi model çıktısı gibi sunmak, kullanıcının
                ona olduğundan fazla güvenmesine yol açardı. */}
            <Badge tone="info">Önizleme · model bağlı değil</Badge>
          </div>

          <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-slate-800">
            {brief.headline}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {brief.lines.map((line) => (
              <div
                key={line.label}
                className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3"
              >
                <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  {line.label}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {line.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={ArrowRight}
              onClick={() => onNavigate("finance")}
            >
              Detaylı Analiz
            </Button>
            <Button icon={Sparkles} onClick={onOpenCopilot}>
              Senaryoları Gör
            </Button>
          </div>
        </div>
      </Card>

      {/* --- 4. Bugün Yapılacaklar + 6. Fabrika Sağlığı --- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              Bugün Yapılacaklar
            </h3>
            <div className="flex items-center gap-1.5">
              {counts.critical > 0 && (
                <Badge tone="bad" icon={CircleAlert}>
                  {counts.critical} acil
                </Badge>
              )}
              {counts.warning > 0 && (
                <Badge tone="warning" icon={TriangleAlert}>
                  {counts.warning} uyarı
                </Badge>
              )}
              {counts.critical === 0 && counts.warning === 0 && (
                <Badge tone="good">Acil konu yok</Badge>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            {actions.map((item, position) => (
              <ActionCard
                key={item.id}
                item={item}
                index={position}
                onClick={() => onNavigate(item.target)}
              />
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <h3 className="mb-3 text-base font-semibold text-slate-900">
            Fabrika Sağlığı
          </h3>

          {health.length === 0 ? (
            <Card className="p-5 text-center" index={0}>
              <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <Activity className="h-4.5 w-4.5" />
              </span>
              <p className="text-sm font-medium text-slate-700">
                Sağlık verisi yok
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Bir koşum çalıştırdığınızda hattın durumu burada özetlenir.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {health.map((indicator, position) => (
                <Card key={indicator.id} index={position} className="p-3.5">
                  <div
                    className="flex items-center gap-1.5"
                    title={indicator.hint}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT[indicator.tone]}`}
                    />
                    <p className="truncate text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                      {indicator.label}
                    </p>
                  </div>
                  {/* Renk tek başına bilgi taşımaz: değer her zaman yazıyla da
                      okunur. */}
                  <p
                    className={`mt-1 truncate text-base font-semibold ${HEALTH_TEXT[indicator.tone]}`}
                  >
                    {indicator.value}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* --- 5. Son Simülasyonlar --- */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Son Simülasyonlar
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Bu tarayıcıda çalıştırdığınız koşumların özeti.
            </p>
          </div>
          {runHistory.length > 0 && (
            <Button
              size="sm"
              icon={ChevronRight}
              onClick={() => onNavigate("simulation")}
            >
              Simülasyona git
            </Button>
          )}
        </div>

        {runHistory.length === 0 ? (
          <Card className="p-6 text-center" index={0}>
            <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <History className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-slate-700">
              Henüz koşum geçmişi yok
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
              Bir simülasyon çalıştırdığınızda sonucun özeti buraya eklenir.
              Liste bu tarayıcıda tutulur; başka bir cihazda aldığınız koşumlar
              burada görünmez.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden" index={0}>
            <ul className="divide-y divide-slate-200">
              {runHistory.map((run) => (
                <li
                  key={run.simulationId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors duration-200 hover:bg-slate-100/40"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      run.isStable ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    title={run.isStable ? "Hat kararlı" : "Hat kararsız"}
                  />
                  {/* Dar ekranda ad kendi satırını alır: aynı satırda dört
                      sayıyla yarışsaydı, "Fabr…" gibi okunamaz bir kırpmaya
                      düşerdi. Geniş ekranda kalan boşluğu doldurur. */}
                  <div className="min-w-0 w-[calc(100%-1.75rem)] sm:w-auto sm:flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {run.factoryName ?? "Kaydedilmemiş model"}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {run.stationCount} istasyon ·{" "}
                      {run.bottleneckName
                        ? `darboğaz: ${run.bottleneckName}`
                        : "darboğaz belirlenemedi"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatUnits(run.throughput)}
                    </p>
                    <p className="text-[11px] text-slate-500">birim</p>
                  </div>
                  <div className="w-14 text-right">
                    <p className="text-sm font-semibold text-slate-800 tabular-nums">
                      %{Math.round(run.oee * 100)}
                    </p>
                    <p className="text-[11px] text-slate-500">OEE</p>
                  </div>
                  <div className="w-24 text-right">
                    <p className="text-xs text-slate-500">
                      {relativeTime(run.ranAt)}
                    </p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {formatDecimal(run.durationSeconds, 1)} sn
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Öncelik kartı                                                               */
/* -------------------------------------------------------------------------- */

const PRIORITY_STYLE: Record<
  ActionPriority,
  { bar: string; icon: string; badge: string; label: string; Icon: LucideIcon }
> = {
  critical: {
    bar: "bg-red-500",
    icon: "bg-red-500/15 text-red-700",
    badge: "border-red-200 bg-red-50 text-red-800",
    label: "Acil",
    Icon: CircleAlert,
  },
  warning: {
    bar: "bg-amber-500",
    icon: "bg-amber-500/15 text-amber-700",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    label: "Uyarı",
    Icon: TriangleAlert,
  },
  info: {
    bar: "bg-brand-500",
    icon: "bg-brand-600/15 text-brand-700",
    badge: "border-brand-200 bg-brand-50 text-brand-700",
    label: "Bilgi",
    Icon: Info,
  },
};

/**
 * Tek bir öncelik kartı.
 *
 * Aciliyet üç ayrı sinyalle anlatılır: sol kenardaki renkli çubuk, simge ve
 * yazılı etiket ("Acil" / "Uyarı" / "Bilgi"). Yalnızca renk kullanılsaydı,
 * kırmızı-yeşil ayrımı yapamayan bir kullanıcı için kartlar birbirinin aynısı
 * olurdu — oysa bu ekranın tek işi neyin önce geldiğini söylemek.
 */
function ActionCard({
  item,
  index,
  onClick,
}: {
  item: ActionItem;
  index: number;
  onClick: () => void;
}) {
  const style = PRIORITY_STYLE[item.priority];

  return (
    <Card interactive index={index} className="overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 p-4 text-left focus:outline-none"
      >
        <span className={`w-0.5 shrink-0 self-stretch rounded-full ${style.bar}`} />
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.icon}`}
        >
          <style.Icon className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {item.title}
            </span>
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}
            >
              {style.label}
            </span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            {item.detail}
          </span>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
            {item.actionLabel}
            <ArrowRight className="h-3 w-3" />
          </span>
        </span>
      </button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Sağlık göstergesi tonları                                                   */
/* -------------------------------------------------------------------------- */

const HEALTH_DOT: Record<HealthTone, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
};

const HEALTH_TEXT: Record<HealthTone, string> = {
  good: "text-slate-900",
  warning: "text-amber-700",
  bad: "text-red-700",
};

/* -------------------------------------------------------------------------- */
/* KPI kartı                                                                   */
/* -------------------------------------------------------------------------- */

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string | null;
  unit?: string;
  hint: string;
  gradient: string;
  iconClass: string;
  footer?: React.ReactNode;
  emptyLabel?: string;
  emptyAction?: string;
  onEmptyAction?: () => void;
  index: number;
}

/**
 * Tek bir özet göstergesi.
 *
 * Değer `null` olduğunda kart bir sayı uydurmaz: eksik olanı söyler ve onu
 * tamamlayacak ekrana bir bağlantı verir. Böylece boş bir gösterge bile bir
 * sonraki adımı taşır.
 */
function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  gradient,
  iconClass,
  footer,
  emptyLabel = "Henüz koşum yok",
  emptyAction = "Simülasyon çalıştır",
  onEmptyAction,
  index,
}: KpiCardProps) {
  return (
    <Card interactive index={index} className="overflow-hidden">
      <div className={`bg-gradient-to-br p-5 ${gradient}`}>
        <div className="flex items-start justify-between gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconClass}`}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
        </div>

        <p className="mt-4 text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </p>

        {value === null ? (
          <>
            <p className="mt-1.5 text-2xl font-semibold text-slate-400">—</p>
            <button
              type="button"
              onClick={onEmptyAction}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 transition-colors hover:text-brand-800 focus:outline-none"
            >
              {emptyAction}
              <ArrowRight className="h-3 w-3" />
            </button>
            <p className="mt-1 text-[11px] text-slate-500">{emptyLabel}</p>
          </>
        ) : (
          <>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {value}
              </span>
              {unit && <span className="text-sm text-slate-500">{unit}</span>}
            </p>
            <p
              className="mt-1.5 text-[11px] leading-relaxed text-slate-500"
              title={hint}
            >
              {footer ?? hint}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
