/**
 * Bölüm C — Doğrulama ve güvenilirlik paneli.
 *
 * Varsayılan olarak kapalıdır: çoğu kullanıcı sonucu okuyup geçecektir ve bu
 * bölüm ekranı gereksiz doldurmamalıdır. Ancak "bu sayılara neden güveneyim?"
 * sorusunu soran kullanıcının yanıtı aynı ekranda bulabilmesi gerekir.
 *
 * Panel açıldığında `/validation-report` ucuna istek atılır — sayfa yüklenirken
 * değil. Kullanıcının hiç açmayacağı bir bölüm için her sonuçta ek bir ağ
 * çağrısı yapmak gereksizdir.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  AnalyticalStationComparison,
  ValidationReportResponse,
} from "../../types/simulationTypes";
import { ApiError, getValidationReport } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  classifyWarning,
  explainInapplicableComparison,
  formatDecimal,
  formatPercent,
} from "../../lib/resultsFormatting";
import { CheckIcon, WarningIcon } from "../shared/icons";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

interface ValidationPanelProps {
  simulationId: string;
  /** `/run` yanıtındaki ham uyarılar. */
  warnings: string[];
}

export function ValidationPanel({ simulationId, warnings }: ValidationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [report, setReport] = useState<ValidationReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setReport(await getValidationReport(simulationId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessages[0] : GENERIC_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [simulationId]);

  useEffect(() => {
    if (isOpen && report === null && !isLoading && error === null) {
      void load();
    }
  }, [isOpen, report, isLoading, error, load]);

  // Simülasyon değiştiğinde eski rapor gösterilmemeli.
  useEffect(() => {
    setReport(null);
    setError(null);
  }, [simulationId]);

  const classified = warnings.map(classifyWarning);

  return (
    <section className="space-y-3">
      {/* Uyarılar panelin dışında, her zaman görünür: kararsız bir modelde
          kullanıcının bunu "detaylar" altında araması beklenemez. */}
      {classified.map((warning, index) => (
        <WarningBanner key={`${warning.kind}-${index}`} warning={warning} />
      ))}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Doğrulama ve güvenilirlik
            </span>
            <span className="block text-xs text-slate-500">
              Bu sonuçlara neden güvenebilirsiniz?
            </span>
          </span>
          <span className="flex items-center gap-2">
            {report && <ReliabilityBadge passed={report.passed} />}
            <span
              aria-hidden="true"
              className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
            >
              ▸
            </span>
          </span>
        </button>

        {isOpen && (
          <div className="border-t border-slate-100 px-5 py-4">
            {isLoading && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner />
                Doğrulama raporu alınıyor…
              </p>
            )}

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-900">
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-1.5 font-medium underline underline-offset-2"
                  >
                    Tekrar dene
                  </button>
                </div>
              </div>
            )}

            {report && <ReportBody report={report} />}
          </div>
        )}
      </div>
    </section>
  );
}

function ReliabilityBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
      <CheckIcon className="h-3.5 w-3.5" />
      Doğrulandı
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
      <WarningIcon className="h-3.5 w-3.5" />
      İnceleyin
    </span>
  );
}

function WarningBanner({
  warning,
}: {
  warning: ReturnType<typeof classifyWarning>;
}) {
  // Kabul kriteri 3: "kararsız" ve "kapasite sınırlı" görsel olarak kesinlikle
  // ayrılmalı. İlki kırmızı (sonuçlar yorumlanamaz), ikincisi turuncu
  // (sonuçlar geçerli, ama parça kaybı var).
  const styles = {
    bad: "border-red-300 bg-red-50 text-red-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    neutral: "border-slate-300 bg-slate-50 text-slate-700",
  }[warning.tone];

  const iconColor = {
    bad: "text-red-600",
    warning: "text-amber-600",
    neutral: "text-slate-500",
  }[warning.tone];

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${styles}`}>
      <WarningIcon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
      <div className="text-sm">
        <p className="font-semibold">{warning.title}</p>
        <p className="mt-0.5 leading-relaxed">{warning.message}</p>
      </div>
    </div>
  );
}

function ReportBody({ report }: { report: ValidationReportResponse }) {
  const summary = report.littles_law_summary;
  const applicable = report.queueing_comparisons.filter((item) => item.applicable);
  const inapplicable = report.queueing_comparisons.filter((item) => !item.applicable);

  return (
    <div className="space-y-5">
      {/* --- Little's Law --- */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">
          Model iç tutarlılığı
        </h3>
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            summary.passed
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          {summary.passed ? (
            <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          )}
          <div
            className={`text-sm ${summary.passed ? "text-emerald-900" : "text-red-900"}`}
          >
            <p className="font-semibold">
              {summary.passed
                ? "Model iç tutarlılığı doğrulandı"
                : "İç tutarlılık denetimi beklenenin dışında"}
            </p>
            <p className="mt-0.5 leading-relaxed">
              {summary.replications_passed} / {summary.replications_checked} tekrarda
              tutarlılık sağlandı; en büyük sapma %
              {formatDecimal(summary.deviation_pct, 3).replace(".", ",")} (kabul sınırı %
              {formatDecimal(summary.tolerance_pct, 0)}).
              {summary.passed
                ? " Bu, simülasyonun sayaçlarının kendi içinde çeliştiği bir durum bulunmadığı anlamına gelir."
                : " Bu sapma bir hesaplama sorununa işaret edebilir; sonuçları temkinli değerlendirin."}
            </p>
          </div>
        </div>
      </div>

      {/* --- Analitik karşılaştırma --- */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">
          Bilinen formüllerle karşılaştırma
        </h3>

        {applicable.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  <th className="px-3 py-2">İstasyon</th>
                  <th className="px-3 py-2">Büyüklük</th>
                  <th className="px-3 py-2 text-right">Formül</th>
                  <th className="px-3 py-2 text-right">Simülasyon</th>
                  <th className="px-3 py-2 text-right">Fark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applicable.flatMap((comparison) => rowsFor(comparison))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
            {explainInapplicableComparison(
              inapplicable.map((comparison) => comparison.reason),
            )}
          </p>
        )}

        {applicable.length > 0 && inapplicable.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {inapplicable.length} istasyon daha gerçekçi olduğu için basit formülle
            karşılaştırılamadı; bu bir sorun değildir.
          </p>
        )}
      </div>

      {/* --- Tekrarlanabilirlik --- */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Tekrarlanabilirlik</h3>
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          Bu koşum, modele{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-800">
            {report.master_seed}
          </code>{" "}
          başlangıç değeri verilerek birebir tekrarlanabilir. Aynı değerle
          çalıştırılan iki simülasyon aynı sonucu üretir — sonuçlar rastgele
          değişmez, denetlenebilir.
        </p>
      </div>
    </div>
  );
}

/** Bir istasyonun karşılaştırılabilir üç büyüklüğünü satırlara çevirir. */
function rowsFor(comparison: AnalyticalStationComparison) {
  const analytical = comparison.analytical;
  if (!analytical) {
    return [];
  }

  const entries = [
    {
      key: "utilization",
      label: "Doluluk",
      expected: formatPercent(analytical.utilization, 1),
      observed: formatPercent(comparison.simulated_utilization, 1),
      deviation: comparison.deviation_utilization_pct,
    },
    {
      key: "queue",
      label: "Kuyruk uzunluğu",
      expected: formatDecimal(analytical.l_queue, 2),
      observed: formatDecimal(comparison.simulated_l_queue, 2),
      deviation: comparison.deviation_l_queue_pct,
    },
    {
      key: "wait",
      label: "Bekleme süresi",
      expected: formatDecimal(analytical.w_queue, 2),
      observed: formatDecimal(comparison.simulated_w_queue, 2),
      deviation: comparison.deviation_w_queue_pct,
    },
  ];

  return entries.map((entry, index) => (
    <tr key={`${comparison.station_id}-${entry.key}`}>
      <td className="px-3 py-2 text-slate-700">
        {index === 0 ? comparison.station_name : ""}
      </td>
      <td className="px-3 py-2 text-slate-600">{entry.label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
        {entry.expected}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
        {entry.observed}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span
          className={
            (entry.deviation ?? 0) <= 5 ? "text-emerald-700" : "text-amber-700"
          }
        >
          {entry.deviation === null ? "—" : `%${formatDecimal(entry.deviation, 2)}`}
        </span>
      </td>
    </tr>
  ));
}
