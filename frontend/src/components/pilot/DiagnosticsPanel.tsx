/**
 * Bağlantı tanılama paneli.
 *
 * Satırların tamamı `lib/connectors/runtime/diagnostics.ts` içinde üretilir.
 * Ölçülmemiş her satır **"Doğrulanmadı"** yazar; sıfır göstermez. Sıfır, bu
 * ekranda en yanıltıcı değer olurdu: hiç denenmemiş bir bağlantı "0 hata" ile
 * sağlıklı görünürdü.
 */

import { Activity, AlertTriangle } from "lucide-react";
import {
  diagnosticRows,
  successRate,
  type Diagnostics,
} from "../../lib/connectors";
import { Card } from "../ui/Primitives";

interface DiagnosticsPanelProps {
  diagnostics: Diagnostics;
  nowMs: number;
}

export function DiagnosticsPanel({ diagnostics, nowMs }: DiagnosticsPanelProps) {
  const rows = diagnosticRows(diagnostics, nowMs);
  const rate = successRate(diagnostics);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Activity className="h-4 w-4 text-slate-400" />
          Bağlantı tanılaması
        </h3>
        <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {rate === null
            ? "Deneme yok"
            : `Başarı %${Math.round(rate * 100)} (${diagnostics.successes}/${diagnostics.attempts})`}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {row.label}
            </dt>
            <dd
              className={`mt-0.5 text-sm font-medium tabular-nums ${
                row.value === null ? "text-slate-400" : "text-slate-900"
              }`}
            >
              {row.value ?? row.fallback}
            </dd>
          </div>
        ))}
      </dl>

      {diagnostics.lastError !== null && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {diagnostics.lastError}
        </p>
      )}
    </Card>
  );
}
