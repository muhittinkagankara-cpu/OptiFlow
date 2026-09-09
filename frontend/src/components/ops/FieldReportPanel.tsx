/**
 * Saha devreye alma raporu paneli.
 *
 * Rapor, ekranın gördüğü **gerçek ölçümlerden** kurulur: bağlantı listesi
 * köprüden, alarm ve OEE izlemeden, telemetri sayıları tanılamadan gelir.
 * Örnek veri yoktur; ölçülemeyen alan "—" olarak basılır.
 *
 * Bileşen yalnızca render eder ve indirmeyi başlatır; raporun içeriği
 * `lib/ops/fieldReport` içindeki saf işlevle kurulur ve orada sınanır.
 */

import { memo, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import {
  buildFieldReport,
  formatSpan,
  unmappedDevices,
  verifiedCount,
  type FieldReportInput,
} from "../../lib/ops";
import { downloadPdf } from "../../lib/reports/pdf";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";

interface FieldReportPanelProps {
  input: FieldReportInput;
  /** Ölçümler okunamadıysa rapor eksik olur ve düğme uyarı taşır. */
  loaded: boolean;
}

function FieldReportPanelInner({ input, loaded }: FieldReportPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const document = useMemo(() => buildFieldReport(input), [input]);
  const verified = verifiedCount(input.devices);
  const unmapped = unmappedDevices(input.devices);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      await downloadPdf(document, null);
    } catch (cause) {
      // Hata yutulmaz: indirilmeyen bir rapor, indirildi sanılan bir rapordan
      // iyidir.
      setError(cause instanceof Error ? cause.message : "PDF üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle
        title="Saha Devreye Alma Raporu"
        description="Kurulumun gerçek ölçümlerinden üretilir; ölçülemeyen alan “—” basılır."
        action={
          <Button
            variant="primary"
            size="sm"
            icon={FileDown}
            onClick={() => void handleDownload()}
            busy={busy}
          >
            PDF indir
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verified === input.devices.length && verified > 0 ? "good" : "warning"}>
          {verified}/{input.devices.length} cihaz doğrulandı
        </Badge>
        <Badge tone={input.alarms.exercised ? "good" : "warning"}>
          {input.alarms.exercised ? "Alarm zinciri tetiklendi" : "Alarm zinciri denenmedi"}
        </Badge>
        <Badge tone={input.telemetryRows > 0 ? "good" : "warning"}>
          {input.telemetryRows.toLocaleString("tr-TR")} telemetri satırı
        </Badge>
        <Badge tone="neutral">Geçmiş: {formatSpan(input.historySpanMs)}</Badge>
      </div>

      {unmapped.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-800">
          {unmapped.length} bağlantının ölçüm eşlemesi yok; raporda uyarı olarak basılır.
        </p>
      )}

      {!loaded && (
        <p className="mt-2 text-[11px] text-amber-800">
          Sunucudan tüm ölçümler okunamadı; rapor eksik alanlarla basılacak.
        </p>
      )}

      {error !== null && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </Card>
  );
}

export const FieldReportPanel = memo(FieldReportPanelInner);
