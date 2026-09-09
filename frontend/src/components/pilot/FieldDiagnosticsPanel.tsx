/**
 * Saha tanılama paneli.
 *
 * Sahadaki mühendisin merdiven altında telefonla bakacağı ekran budur:
 * ping, protokol durumları, son veri, saat senkronu ve paket kaybı tek
 * yerde. Bu bilgiler daha önce üç ayrı ekrandan toplanıyordu.
 *
 * Ölçülemeyen satır **gizlenmez**: neyin bilinmediğini göstermek, bu ekranın
 * asıl işidir. Gizlenseydi, mühendis eksik bir tabloya bakıp her şeyin
 * ölçüldüğünü sanardı.
 */

import { memo } from "react";
import { Activity, RefreshCw } from "lucide-react";
import {
  diagnosticsCaption,
  lineValue,
  probeTone,
  type DiagnosticLine,
  type FieldDiagnostics,
} from "../../lib/commissioning";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";

interface FieldDiagnosticsPanelProps {
  report: FieldDiagnostics;
  onRefresh: () => void;
  busy?: boolean;
}

function FieldDiagnosticsPanelInner({
  report,
  onRefresh,
  busy,
}: FieldDiagnosticsPanelProps) {
  return (
    <Card className="p-4">
      <SectionTitle
        title="Saha Tanılama"
        description={diagnosticsCaption(report)}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={probeTone(report.state)}>{report.stateLabel}</Badge>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={onRefresh}
              busy={busy}
            >
              Yenile
            </Button>
          </div>
        }
      />

      {report.endpoint !== "" && (
        <p className="mb-2 break-all text-[11px] text-slate-500">
          Uç: {report.endpoint}
        </p>
      )}

      {report.lines.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-6">
          <Activity className="h-4 w-4 text-slate-400" />
          <p className="text-xs text-slate-500">
            Tanılama henüz okunmadı; sunucudan yanıt bekleniyor.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {report.lines.map((line) => (
            <LineCell key={line.id} line={line} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LineCell({ line }: { line: DiagnosticLine }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {line.label}
        </p>
        <Badge tone={probeTone(line.state)}>
          {line.measured ? "Ölçüldü" : "—"}
        </Badge>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-900">{lineValue(line)}</p>
      {line.reason !== null && (
        <p className="mt-0.5 text-[11px] text-slate-500">{line.reason}</p>
      )}
    </li>
  );
}

export const FieldDiagnosticsPanel = memo(FieldDiagnosticsPanelInner);
