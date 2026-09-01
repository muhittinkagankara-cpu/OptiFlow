/**
 * Bölüm D — Senaryo karşılaştırma.
 *
 * İki senaryoyu backend'in `/compare` ucuna gönderir ve dönen istatistiksel
 * anlamlılık testini birebir yansıtır.
 *
 * **Neden iki `/run` sonucunu yan yana koymuyoruz?** Çünkü iki ortalamayı
 * karşılaştırmak, aralarındaki farkın gerçek mi rastgele mi olduğunu söylemez.
 * Bunun için her senaryonun replikasyonlar arası standart sapması gerekir ve
 * `/run` yanıtı bunu taşımaz. Backend `/compare` ucunda senaryoları yeniden
 * çalıştırıp Welch yaklaşımıyla farkın güven aralığını kurar; aralık sıfırı
 * içeriyorsa fark anlamsızdır.
 *
 * Bu ayrımı belirsiz bırakmak, kullanıcının rastgeleliğe dayanarak yatırım
 * kararı almasına yol açardı — sayfanın en kritik tasarım kuralı budur.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ComparisonResponse,
  PairwiseDifference,
  SimulationConfig,
} from "../../types/simulationTypes";
import { ApiError, compareSimulations } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  differenceVerdict,
  formatDecimal,
  formatMetricValue,
  formatPercent,
  formatUnits,
  metricLabel,
  verdictLabel,
  type DifferenceVerdict,
} from "../../lib/resultsFormatting";
import { ArrowLeftIcon, CheckIcon, WarningIcon } from "../shared/icons";
import { Spinner } from "../wizard/WizardStep3_Confirmation";
import { ComparisonBarChart } from "./charts/ComparisonBarChart";

export interface ComparisonScenario {
  label: string;
  config: SimulationConfig;
}

interface ScenarioComparisonProps {
  baseline: ComparisonScenario;
  candidate: ComparisonScenario;
  onBack: () => void;
}

export function ScenarioComparison({
  baseline,
  candidate,
  onBack,
}: ScenarioComparisonProps) {
  const [report, setReport] = useState<ComparisonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrors([]);
    try {
      setReport(await compareSimulations([baseline.config, candidate.config]));
    } catch (cause) {
      setErrors(
        cause instanceof ApiError ? cause.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, [baseline.config, candidate.config]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Senaryo karşılaştırması
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            “{baseline.label}” ile “{candidate.label}” arasındaki fark
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Sonuçlara dön
        </button>
      </header>

      {isLoading && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-6">
          <Spinner />
          <div>
            <p className="text-sm font-medium text-slate-800">
              İki senaryo karşılaştırılıyor…
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Farkın gerçek olup olmadığını ölçebilmek için her iki senaryo da
              yeniden çalıştırılıyor. Bu biraz sürebilir.
            </p>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="text-sm text-red-900">
            <p className="font-medium">Karşılaştırma yapılamadı</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 font-medium underline underline-offset-2"
            >
              Tekrar dene
            </button>
          </div>
        </div>
      )}

      {report && (
        <ComparisonBody
          report={report}
          labels={[baseline.label, candidate.label]}
        />
      )}
    </div>
  );
}

function ComparisonBody({
  report,
  labels,
}: {
  report: ComparisonResponse;
  labels: [string, string];
}) {
  const [first, second] = report.scenarios;
  const significant = report.differences.filter((item) => item.is_significant);
  const nameFor = (index: number) => labels[index] ?? `Senaryo ${index + 1}`;

  return (
    <div className="space-y-6">
      {/* --- Genel karar --- */}
      <VerdictBanner
        report={report}
        significantCount={significant.length}
        bestLabel={nameFor(report.best_scenario_index)}
      />

      {/* --- Yan yana temel değerler --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ScenarioCard label={nameFor(0)} scenario={first} isBaseline />
        <ScenarioCard label={nameFor(1)} scenario={second} />
      </div>

      {/* --- Değişim grafiği --- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          “{nameFor(0)}” senaryosuna göre değişim
        </h2>
        <p className="mt-0.5 mb-3 text-xs text-slate-500">
          Gri çubuklar, rastgelelikle açıklanabilecek — yani güvenilmemesi
          gereken — farkları gösterir.
        </p>
        <ComparisonBarChart differences={report.differences} />
      </section>

      {/* --- Metrik metrik karar --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Fark gerçek mi?</h2>
        {report.differences.map((difference) => (
          <DifferenceRow
            key={difference.metric}
            difference={difference}
            baselineLabel={nameFor(0)}
            candidateLabel={nameFor(1)}
          />
        ))}
      </section>
    </div>
  );
}

function VerdictBanner({
  report,
  significantCount,
  bestLabel,
}: {
  report: ComparisonResponse;
  significantCount: number;
  bestLabel: string;
}) {
  if (significantCount === 0) {
    // En kritik durum: hiçbir fark anlamlı değil. Kullanıcı bunu net görmeli,
    // yoksa ortalamalardaki küçük oynamayı iyileşme sanar.
    return (
      <div className="flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-100 px-5 py-4">
        <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
        <div className="text-sm text-slate-800">
          <p className="font-semibold">İki senaryo arasında ölçülebilir bir fark yok</p>
          <p className="mt-1 leading-relaxed">
            Ortalamalar birbirinden farklı görünse de bu fark rastgelelikle
            açıklanabilir; aynı senaryoyu tekrar çalıştırsanız sıra değişebilir.
            Bu değişikliğin işe yaradığını söyleyemeyiz — daha belirgin bir
            değişiklik deneyin ya da “Detaylı” ayarla tekrar ölçün.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
      <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
      <div className="text-sm text-emerald-900">
        <p className="font-semibold">
          {significantCount} ölçütte gerçek bir fark bulundu
        </p>
        <p className="mt-1 leading-relaxed">
          En yüksek üretim <strong>“{bestLabel}”</strong> senaryosunda.{" "}
          {report.best_scenario_rationale.includes("ANLAMLI DEGIL")
            ? "Ancak üretimdeki bu üstünlük istatistiksel olarak anlamlı değil; aşağıdaki tabloda hangi ölçütlerin gerçekten değiştiğini görebilirsiniz."
            : "Aşağıdaki tabloda hangi ölçütlerin değiştiğini görebilirsiniz."}
        </p>
      </div>
    </div>
  );
}

function ScenarioCard({
  label,
  scenario,
  isBaseline = false,
}: {
  label: string;
  scenario: ComparisonResponse["scenarios"][number];
  isBaseline?: boolean;
}) {
  const [lower, upper] = scenario.throughput_ci_95;

  return (
    <div
      className={`rounded-xl border bg-white p-5 ${
        isBaseline ? "border-slate-200" : "border-brand-300 ring-1 ring-brand-100"
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isBaseline
              ? "bg-slate-100 text-slate-600"
              : "bg-brand-100 text-brand-800"
          }`}
        >
          {isBaseline ? "Referans" : "Yeni"}
        </span>
      </div>

      <p className="mt-3 text-2xl font-semibold text-slate-900">
        {formatUnits(scenario.total_throughput)}
        <span className="ml-1.5 text-sm font-normal text-slate-400">birim</span>
      </p>
      <p className="text-xs text-slate-500">
        %95 aralık: {formatUnits(lower)} – {formatUnits(upper)}
      </p>

      <dl className="mt-4 space-y-1.5 text-xs">
        <Row term="Akış süresi" value={`${formatDecimal(scenario.avg_flow_time)} dk`} />
        <Row term="Hattaki iş" value={formatDecimal(scenario.avg_wip)} />
        <Row
          term="Darboğaz"
          value={`${scenario.bottleneck_station_id} (${formatPercent(scenario.bottleneck_utilization)})`}
        />
        <Row term="Hat OEE" value={formatPercent(scenario.line_oee, 1)} />
      </dl>

      {!scenario.is_stable && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          Bu senaryoda bir istasyon gelen işi yetiştiremiyor; sonuçları temkinli
          değerlendirin.
        </p>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{term}</dt>
      <dd className="tabular-nums font-medium text-slate-800">{value}</dd>
    </div>
  );
}

const VERDICT_STYLES: Record<
  DifferenceVerdict,
  { container: string; badge: string; arrow: string }
> = {
  improvement: {
    container: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-800",
    arrow: "text-emerald-600",
  },
  regression: {
    container: "border-red-200 bg-red-50",
    badge: "bg-red-100 text-red-800",
    arrow: "text-red-600",
  },
  insignificant: {
    container: "border-slate-200 bg-slate-50",
    badge: "bg-slate-200 text-slate-700",
    arrow: "text-slate-400",
  },
};

function DifferenceRow({
  difference,
  baselineLabel,
  candidateLabel,
}: {
  difference: PairwiseDifference;
  baselineLabel: string;
  candidateLabel: string;
}) {
  const verdict = differenceVerdict(difference);
  const styles = VERDICT_STYLES[verdict];
  const arrow = verdict === "insignificant" ? "→" : difference.difference > 0 ? "↑" : "↓";

  return (
    <div className={`rounded-xl border px-5 py-4 ${styles.container}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`text-xl leading-none ${styles.arrow}`} aria-hidden="true">
            {arrow}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {metricLabel(difference.metric, difference.label)}
            </p>
            <p className="text-xs text-slate-600">
              {baselineLabel}:{" "}
              {formatMetricValue(difference.metric, difference.baseline_mean)} →{" "}
              {candidateLabel}:{" "}
              {formatMetricValue(difference.metric, difference.candidate_mean)}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${styles.badge}`}
        >
          {verdictLabel(verdict)}
        </span>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
        {verdict === "insignificant" ? (
          <>
            Gözlenen{" "}
            {formatMetricValue(difference.metric, Math.abs(difference.difference))}
            'lik ayrım <strong>rastgelelikle açıklanabilir</strong>. Farkın güven
            aralığı
            [{formatDecimal(difference.ci_lower, 2)},{" "}
            {formatDecimal(difference.ci_upper, 2)}] sıfırı içeriyor; yani gerçek
            farkın sıfır olması ihtimal dışı değil. Bu ölçütte bir değişiklik
            olduğunu söyleyemeyiz.
          </>
        ) : (
          <>
            Fark <strong>gerçek</strong>: güven aralığı [
            {formatDecimal(difference.ci_lower, 2)},{" "}
            {formatDecimal(difference.ci_upper, 2)}] sıfırı içermiyor, yani bu
            değişim rastgelelikle açıklanamaz.
          </>
        )}
      </p>
    </div>
  );
}
