/**
 * Makine etiketleri paneli.
 *
 * Etiket, ekrandaki `freze_hat1_2` ile makinenin üstünde yazan `FREZE-02`
 * arasındaki köprüdür. İkisi ayrılmasa, sahadaki teknisyen ekranda gördüğü
 * arızayı hangi makinede arayacağını bilemez.
 *
 * QR PDF'i buradan basılır ve içerik **adres değil kimlik** taşır: sunucu
 * adresi değiştiğinde fabrikadaki bütün etiketlerin yeniden basılması
 * gerekmemelidir.
 */

import { memo, useState } from "react";
import { Printer, QrCode, TriangleAlert } from "lucide-react";
import {
  buildLabelDocument,
  labelWarnings,
  pageCount,
  printedRatio,
  type LabelReview,
  type MachineLabel,
} from "../../lib/commissioning";
import { downloadPdf } from "../../lib/reports/pdf";
import { Badge, Button, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import { NOT_MEASURED } from "../monitoring/monitoringStyles";

interface MachineLabelsPanelProps {
  review: LabelReview;
  factoryName: string;
  onSave: (machineId: string, label: string) => void;
  onMarkPrinted: (labels: string[]) => void;
  busy?: boolean;
}

function MachineLabelsPanelInner({
  review,
  factoryName,
  onSave,
  onMarkPrinted,
  busy,
}: MachineLabelsPanelProps) {
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warnings = labelWarnings(review);
  const ratio = printedRatio(review);

  async function handlePrint() {
    setPrinting(true);
    setError(null);
    try {
      await downloadPdf(buildLabelDocument(review.labels, factoryName), null);
      onMarkPrinted(review.labels.map((item) => item.label));
    } catch (cause) {
      // Hata yutulmaz: basılmayan bir etiket, basıldı sanılan bir etiketten
      // iyidir.
      setError(cause instanceof Error ? cause.message : "PDF üretilemedi.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle
        title="Makine Etiketleri"
        description="Sahadaki kalıcı kimlik ve QR etiketleri."
        action={
          <Button
            variant="primary"
            size="sm"
            icon={Printer}
            onClick={() => void handlePrint()}
            busy={printing}
            disabled={review.labels.length === 0}
          >
            QR PDF ({pageCount(review.labels)} sayfa)
          </Button>
        }
      />

      {warnings.map((warning) => (
        <div
          key={warning}
          className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-800">{warning}</p>
        </div>
      ))}

      {error !== null && <p className="mb-2 text-[11px] text-red-700">{error}</p>}

      {review.unlabeled.length > 0 && (
        <ul className="mb-3 space-y-1">
          {review.unlabeled.map((machine) => (
            <UnlabeledRow
              key={machine}
              machineId={machine}
              suggestion={review.suggestions[machine] ?? null}
              onSave={onSave}
              busy={busy}
            />
          ))}
        </ul>
      )}

      {review.labels.length === 0 ? (
        <EmptyState
          icon={QrCode}
          title="Etiket yok"
          description="Makinelere kalıcı saha kimliği verildiğinde burada listelenir ve QR etiketleri basılabilir."
        />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-slate-500">
            {review.labels.length} etiket · basılan:{" "}
            {ratio === null ? NOT_MEASURED : `%${Math.round(ratio * 100)}`}
          </p>
          <ul className="space-y-1">
            {review.labels.map((label) => (
              <LabelRow key={label.machineId} label={label} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * Etiketsiz makine satırı.
 *
 * Öneri **doldurulmuş olarak** gelir ama kaydedilmez: etiket makinenin üstüne
 * yapıştırılacak fiziksel bir şeydir ve onu insan onaylar.
 */
function UnlabeledRow({
  machineId,
  suggestion,
  onSave,
  busy,
}: {
  machineId: string;
  suggestion: string | null;
  onSave: (machineId: string, label: string) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState(suggestion ?? "");

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-2 py-1.5">
      <span className="min-w-0 flex-1 break-all text-xs text-slate-700">{machineId}</span>
      <input
        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
        placeholder={suggestion ?? "FREZE-02"}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onSave(machineId, value)}
        disabled={value.trim().length === 0}
        busy={busy}
      >
        Kaydet
      </Button>
    </li>
  );
}

function LabelRow({ label }: { label: MachineLabel }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-900">{label.label}</p>
        <p className="break-all text-[10px] text-slate-500">{label.machineId}</p>
      </div>
      <Badge tone={label.printedAtMs === null ? "warning" : "good"}>
        {label.printedAtMs === null ? "Basılmadı" : "Basıldı"}
      </Badge>
    </li>
  );
}

export const MachineLabelsPanel = memo(MachineLabelsPanelInner);
