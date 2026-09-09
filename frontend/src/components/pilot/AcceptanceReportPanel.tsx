/**
 * Saha kabul raporu paneli.
 *
 * Müşteriye teslim edilen ve imzalanan belge buradan basılır. İçeriği
 * ekranın gördüğü **gerçek ölçümlerden** kurulur: bağlantılar köprüden,
 * alarm ve OEE izlemeden, kurulum durumu kontrol listesinden.
 *
 * Doğrulanmayan protokol rapordan çıkarılmaz. Gizlenseydi, müşteri eksiksiz
 * bir belge imzalar ve eksiklik aylar sonra ortaya çıkardı.
 */

import { memo, useMemo, useState } from "react";
import { FileSignature } from "lucide-react";
import {
  buildAcceptanceReport,
  verifiedDevices,
  verifiedProtocols,
  type AcceptanceInput,
} from "../../lib/ops";
import { downloadPdf } from "../../lib/reports/pdf";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";

interface AcceptanceReportPanelProps {
  input: AcceptanceInput;
}

function AcceptanceReportPanelInner({ input }: AcceptanceReportPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const document = useMemo(() => buildAcceptanceReport(input), [input]);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      await downloadPdf(document, null);
    } catch (cause) {
      // Hata yutulmaz: basılmayan bir rapor, basıldı sanılan bir rapordan
      // iyidir.
      setError(cause instanceof Error ? cause.message : "PDF üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle
        title="Saha Kabul Raporu"
        description="Müşterinin imzalayacağı belge; gerçek ölçümlerden üretilir."
        action={
          <Button
            variant="primary"
            size="sm"
            icon={FileSignature}
            onClick={() => void handleDownload()}
            busy={busy}
          >
            PDF indir
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={
            verifiedDevices(input.devices) === input.devices.length &&
            input.devices.length > 0
              ? "good"
              : "warning"
          }
        >
          {verifiedDevices(input.devices)}/{input.devices.length} cihaz doğrulandı
        </Badge>
        <Badge tone={verifiedProtocols(input.protocols) > 0 ? "good" : "warning"}>
          {verifiedProtocols(input.protocols)}/{input.protocols.length} protokol
        </Badge>
        <Badge tone={input.alarms.exercised ? "good" : "warning"}>
          {input.alarms.exercised ? "Alarm testi geçti" : "Alarm testi yapılmadı"}
        </Badge>
        <Badge tone={input.checklistReady ? "good" : "warning"}>
          {input.checklistReady ? "Kurulum tamam" : "Kurulum eksik"}
        </Badge>
      </div>

      {!input.checklistReady && (
        <p className="mt-2 text-[11px] text-amber-800">
          Kontrol listesi tamamlanmadı; rapor imzalansa bile kurulum eksik sayılır.
        </p>
      )}

      {error !== null && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </Card>
  );
}

export const AcceptanceReportPanel = memo(AcceptanceReportPanelInner);
