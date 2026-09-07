/**
 * Factory Intelligence — koşumun kararlara çevrildiği ekran.
 *
 * Sonuç sayfası "ne oldu?" sorusunu grafiklerle yanıtlar; bu ekran ondan
 * sonraki dört soruyu yanıtlar: en büyük problem ne, nedeni ne, etkisi ne,
 * ne yapmalıyım.
 *
 * Bu bileşende **hiçbir karar mantığı yoktur**. Yedi bölümün tamamı
 * `lib/intelligence` içindeki saf işlevlerin çıktısını çizer; eşikler,
 * sıralama ve cümle kurma orada yapılır ve orada sınanır.
 *
 * Yapay zekâ kullanılmaz ve bu, ekranın en üstünde açıkça yazılır. Kartlar
 * deterministiktir: aynı koşum her zaman aynı kartları üretir.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CircleAlert,
  CircleCheck,
  Gauge,
  Layers,
  Lightbulb,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type {
  FinancialReport,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  ASSUMED_INVESTMENT,
  DIFFICULTY_LABEL,
  SEVERITY_LABEL,
  buildCauseChain,
  buildComparison,
  buildExecutiveSummary,
  buildImprovementCards,
  buildPriorityCards,
  buildRadarData,
  type ComparisonRow,
  type Difficulty,
  type ImprovementCard,
  type PriorityCard,
  type Severity,
} from "../../lib/intelligence";
import { formatMoney } from "../../lib/financeFormatting";
import { Badge, Card } from "../ui/Primitives";
import { HealthRadar } from "./HealthRadar";

/* -------------------------------------------------------------------------- */
/* Renk ve simge eşlemeleri — yalnızca sunum                                   */
/* -------------------------------------------------------------------------- */

const SEVERITY_STYLE: Record<
  Severity,
  { bar: string; chip: string; icon: string }
> = {
  critical: {
    bar: "bg-red-500",
    chip: "border-red-200 bg-red-50 text-red-800",
    icon: "bg-red-500/15 text-red-700",
  },
  high: {
    bar: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    icon: "bg-amber-500/15 text-amber-700",
  },
  medium: {
    bar: "bg-yellow-500",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    icon: "bg-amber-500/12 text-amber-700",
  },
};

const CARD_ICON: Record<PriorityCard["icon"], LucideIcon> = {
  bottleneck: Workflow,
  unstable: TriangleAlert,
  scrap: Layers,
  queue: Boxes,
  money: Wallet,
  validation: CircleAlert,
};

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  hard: "border-red-200 bg-red-50 text-red-800",
};

/** Hazır Copilot komutları — bu sürümde hiçbiri çağrı yapmaz. */
const AI_PROMPTS = [
  "Darboğazı açıkla",
  "ROI hesapla",
  "Vardiya öner",
  "Makine artır",
];

/* -------------------------------------------------------------------------- */

interface FactoryIntelligenceProps {
  results: SimulationResults | null;
  report: FinancialReport | null;
  onBack: () => void;
  onOpenFinance: () => void;
}

export function FactoryIntelligence({
  results,
  report,
  onBack,
  onOpenFinance,
}: FactoryIntelligenceProps) {
  const summary = useMemo(
    () => buildExecutiveSummary(results, report),
    [results, report],
  );
  const priorities = useMemo(
    () => buildPriorityCards(results, report),
    [results, report],
  );
  const chain = useMemo(() => buildCauseChain(results, report), [results, report]);
  const improvements = useMemo(
    () => buildImprovementCards(results, report),
    [results, report],
  );
  const comparison = useMemo(
    () => buildComparison(results, report),
    [results, report],
  );
  const radar = useMemo(() => buildRadarData(results), [results]);

  const summaryTone =
    summary.tone === "good"
      ? "from-emerald-500/15 via-emerald-500/5 to-transparent"
      : summary.tone === "critical"
        ? "from-red-500/18 via-red-500/6 to-transparent"
        : summary.tone === "high"
          ? "from-amber-500/18 via-amber-500/6 to-transparent"
          : "from-brand-600/15 via-brand-600/5 to-transparent";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Başlık */}
      <div className="optiflow-enter mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
          >
            <ArrowLeft className="h-4 w-4" />
            Sonuçlara dön
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Factory Intelligence
          </h1>
        </div>
        {/* Kartların bir dil modelinden gelmediği açıkça söylenir. */}
        <Badge tone="neutral">Kural tabanlı · yapay zekâ kullanılmadı</Badge>
      </div>

      {/* --- Bölüm 1: Yönetici özeti --- */}
      <Card className="overflow-hidden" index={0}>
        <div className={`bg-gradient-to-br p-6 sm:p-7 ${summaryTone}`}>
          <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Fabrikanızın Bugünkü Durumu
          </p>
          <p className="mt-3 max-w-3xl text-lg leading-snug font-semibold text-slate-900 sm:text-xl">
            {summary.headline}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-500">
            {summary.detail}
          </p>
        </div>
      </Card>

      {/* --- Bölüm 2: Top 5 öncelik --- */}
      {priorities.length > 0 && (
        <section className="mt-6">
          <SectionHead
            icon={Target}
            title="Öncelikler"
            note={`En önemli ${priorities.length} bulgu, aciliyet ve parasal etkiye göre sıralandı.`}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {priorities.map((card, index) => {
              const style = SEVERITY_STYLE[card.severity];
              const Icon = CARD_ICON[card.icon];
              return (
                <Card key={card.id} index={index} className="overflow-hidden">
                  <div className="flex items-start gap-3 p-4">
                    <span
                      className={`w-0.5 shrink-0 self-stretch rounded-full ${style.bar}`}
                    />
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.icon}`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900">
                          {card.title}
                        </span>
                        {/* Aciliyet renkle DEĞİL, yazıyla da verilir. */}
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
                        >
                          {SEVERITY_LABEL[card.severity]}
                        </span>
                        {card.station && (
                          <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {card.station}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        {card.detail}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="text-[11px] text-slate-500">
                          Parasal etki:{" "}
                          {card.monetaryImpact === null ? (
                            <button
                              type="button"
                              onClick={onOpenFinance}
                              className="font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none"
                            >
                              oranları girin
                            </button>
                          ) : (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatMoney(card.monetaryImpact)}
                            </span>
                          )}
                        </span>
                      </div>

                      <p className="mt-1.5 text-[11px] leading-relaxed text-emerald-700">
                        {card.expectedGain}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* --- Bölüm 3: Sebep zinciri --- */}
      {chain.length > 0 && (
        <section className="mt-6">
          <SectionHead
            icon={Workflow}
            title="Sebep Zinciri"
            note="Sorunun nasıl oluştuğu; her adım ölçülmüş bir değerle destekleniyor."
          />
          <Card className="p-5" index={0}>
            <ol className="relative">
              {chain.map((link, index) => (
                <li
                  key={link.id}
                  style={{ animationDelay: `${index * 110}ms` }}
                  className="optiflow-timeline-step relative flex gap-3.5 pb-5 last:pb-0"
                >
                  {/* Dikey çizgi son halkada çizilmez. */}
                  {index < chain.length - 1 && (
                    <span
                      aria-hidden="true"
                      style={{ animationDelay: `${index * 110 + 90}ms` }}
                      className="optiflow-timeline-line absolute top-8 left-[0.9375rem] h-[calc(100%-1.5rem)] w-px bg-slate-300"
                    />
                  )}

                  <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold text-slate-600">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {link.label}
                      </span>
                      {link.measure && (
                        <span className="rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 tabular-nums">
                          {link.measure}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {link.detail}
                    </p>
                  </div>

                  {index < chain.length - 1 && (
                    <ArrowDown
                      aria-hidden="true"
                      className="absolute bottom-1 left-[0.5rem] h-3 w-3 text-slate-400"
                    />
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      {/* --- Bölüm 4: İyileştirme kartları --- */}
      {improvements.length > 0 && (
        <section className="mt-6">
          <SectionHead
            icon={Lightbulb}
            title="İyileştirme Önerileri"
            note="Öneriler finans raporundan, o yoksa koşumun kendi ölçümlerinden gelir; burada yeni tavsiye üretilmez."
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {improvements.map((card, index) => (
              <ImprovementTile key={card.id} card={card} index={index} />
            ))}
          </div>
        </section>
      )}

      {/* --- Bölüm 5: Önce / sonra --- */}
      {comparison.length > 0 && (
        <section className="mt-6">
          <SectionHead
            icon={TrendingUp}
            title="Mevcut ve Hedef"
            note="Hedefler bir tahmin değil: her biri ya bu koşumda gözlenmiş ya da teorik bir üst sınırdır."
          />
          <Card className="space-y-5 p-5" index={0}>
            {comparison.map((row) => (
              <ComparisonBar key={row.id} row={row} />
            ))}
          </Card>
        </section>
      )}

      {/* --- Bölüm 6: Sağlık radarı --- */}
      {radar.length > 0 && (
        <section className="mt-6">
          <SectionHead
            icon={Gauge}
            title="Fabrika Sağlık Radarı"
            note="Altı eksen de mevcut koşum verisinden normalize edildi; yüksek olan iyidir."
          />
          <Card className="p-5" index={0}>
            <HealthRadar axes={radar} />
          </Card>
        </section>
      )}

      {/* --- Bölüm 7: AI hazırlığı --- */}
      <section className="mt-6">
        <Card className="overflow-hidden" index={0}>
          <div className="bg-gradient-to-br from-brand-600/12 via-brand-600/4 to-transparent p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600/15 text-brand-700">
                  <Sparkles className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    AI Copilot ile derinleştir
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Bu kartları bir dil modeline sorabileceğiniz sürüm yolda.
                  </p>
                </div>
              </div>
              <Badge tone="warning">Yakında</Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {AI_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled
                  title="Copilot bu sürümde bağlı değil"
                  className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100/60 px-3 py-1.5 text-xs font-medium text-slate-500 opacity-70"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHead({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
}) {
  return (
    <div className="optiflow-enter mb-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon className="h-4 w-4 text-slate-500" />
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function ImprovementTile({
  card,
  index,
}: {
  card: ImprovementCard;
  index: number;
}) {
  return (
    <Card index={index} className="flex flex-col p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-900">{card.title}</span>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${DIFFICULTY_STYLE[card.difficulty]}`}
        >
          {DIFFICULTY_LABEL[card.difficulty]}
        </span>
      </div>

      <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600">
        {card.description}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
          <dt className="text-[10px] tracking-wide text-slate-500 uppercase">
            Beklenen kazanç
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-emerald-700 tabular-nums">
            {card.recoverableAmount === null
              ? "—"
              : formatMoney(card.recoverableAmount)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
          <dt className="text-[10px] tracking-wide text-slate-500 uppercase">
            Geri ödeme
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-800 tabular-nums">
            {card.paybackDays === null
              ? "—"
              : `${card.paybackDays < 1 ? "<1" : Math.round(card.paybackDays)} gün`}
          </dd>
          {/* Yatırım tutarı kullanıcıdan alınmadı; varsayıldı. Bunu yazmadan
              bir gün sayısı göstermek, uydurma bir kesinlik iddia ederdi. */}
          {card.paybackDays !== null && (
            <dd className="mt-0.5 text-[10px] leading-tight text-slate-500">
              {formatMoney(ASSUMED_INVESTMENT)} yatırım varsayımıyla
            </dd>
          )}
        </div>
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {card.expectedImpact}
      </p>

      {/* Yer tutucu: bu sürümde senaryo denemesi yok. Çalışıyormuş gibi
          görünüp başka bir ekrana atmak yerine devre dışı bırakılıp "Yakında"
          denmesi bilinçlidir — tıklayınca hiçbir şey olmayan bir düğme,
          ürünün bozuk olduğu izlenimini verirdi. */}
      <span className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100/60 px-3 py-2 text-xs font-semibold text-slate-500 opacity-70">
        Senaryoda Dene
        <span className="rounded border border-amber-200 bg-amber-50 px-1 py-px text-[9px] text-amber-800">
          Yakında
        </span>
      </span>
    </Card>
  );
}

function ComparisonBar({ row }: { row: ComparisonRow }) {
  const format = (value: number) =>
    row.format === "money" ? formatMoney(value) : `%${Math.round(value * 100)}`;

  /*
   * Çubuk, mevcut değerin hedefe göre konumunu gösterir. Kayıp satırında yön
   * terstir (az olan iyidir), bu yüzden dolgu oranı ona göre çevrilir —
   * çevrilmeseydi "kaybı azaltmak" çubuğu boşaltır ve kötüleşme gibi
   * görünürdü.
   */
  const isLowerBetter = row.format === "money";
  const ratio = isLowerBetter
    ? row.current <= 0
      ? 1
      : Math.min(1, row.target / row.current)
    : row.target <= 0
      ? 0
      : Math.min(1, row.current / row.target);

  /*
   * Çubuk sıfırdan başlayıp hedefe doğru dolar. Genişlik doğrudan son değerine
   * yazılsaydı geçiş hiç görünmezdi; ilk kareyi bekleyip değeri sonra vermek
   * animasyonun başlamasını sağlar. Hareket azaltma açıkken CSS geçişi
   * kapalıdır ve çubuk anında doğru yerde belirir.
   */
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(ratio));
    return () => cancelAnimationFrame(frame);
  }, [ratio]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{row.label}</span>
        <span className="flex items-center gap-2 text-sm tabular-nums">
          <span className="text-slate-500">{format(row.current)}</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <span className="font-semibold text-emerald-700">
            {format(row.target)}
          </span>
        </span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="optiflow-progress-fill h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
          style={{ width: `${Math.round(width * 100)}%` }}
        />
      </div>

      <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
        <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
        {row.targetSource}
      </p>
    </div>
  );
}
