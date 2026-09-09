/**
 * Veri dışa aktarma paneli.
 *
 * Yalnızca **gerçek kayıtlar** aktarılır: telemetri tablosu, alarm geçmişi ve
 * OEE geçmişi. Benzetim çıktısı bu yoldan çıkmaz; çıksaydı, müşterinin
 * elindeki dosyada hangi satırın cihazdan hangisinin senaryodan geldiği
 * bilinemezdi.
 *
 * Boş dosya da indirilir ve bu söylenir: kayıt yoksa başlık satırı iner ve
 * panel "kayıt yok" yazar. Tamamen boş bir dosya, "veri yok" ile "dışa
 * aktarma bozuk" arasındaki farkı yok ederdi.
 */

import { memo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import {
  EXPORT_KIND_LABEL,
  EXPORT_KIND_ORDER,
  csvBlob,
  exportCaption,
  safeFileName,
  type ExportKind,
  type ExportResult,
} from "../../lib/export";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";

interface ExportPanelProps {
  /** Excel için hazır dosya üretimi ayrı bir akıştadır; buradan çağrılır. */
  onExportWorkbook?: () => void;
}

function ExportPanelInner({ onExportWorkbook }: ExportPanelProps) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [results, setResults] = useState<Partial<Record<ExportKind, ExportResult>>>({});
  const [error, setError] = useState<string | null>(null);

  const client = new RuntimeBridgeClient({
    baseUrl: API_BASE_URL,
    getToken: getAccessToken,
  });

  async function handleExport(kind: ExportKind) {
    setBusy(kind);
    setError(null);
    const result = await client.exportData(kind);
    setBusy(null);
    if (result.data === null) {
      setError(result.error);
      return;
    }
    setResults((current) => ({ ...current, [kind]: result.data as ExportResult }));
    download(result.data);
  }

  /**
   * Dosyayı indirir.
   *
   * Nesne URL'i indirmeden sonra serbest bırakılır; bırakılmasaydı, sayfa
   * açık kaldıkça her indirme bellekte bir kopya bırakırdı.
   */
  function download(result: ExportResult) {
    const url = URL.createObjectURL(csvBlob(result.content));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFileName(result.fileName);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-4">
      <SectionTitle
        title="Veri Dışa Aktarma"
        description="Kayıtlı gerçek veriler; benzetim çıktısı bu yoldan çıkmaz."
        action={
          onExportWorkbook !== undefined && (
            <Button
              variant="secondary"
              size="sm"
              icon={FileSpreadsheet}
              onClick={onExportWorkbook}
            >
              Excel
            </Button>
          )
        }
      />

      {error !== null && <p className="mb-2 text-[11px] text-red-700">{error}</p>}

      <ul className="space-y-2">
        {EXPORT_KIND_ORDER.map((kind) => {
          const result = results[kind];
          return (
            <li
              key={kind}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-900">
                  {EXPORT_KIND_LABEL[kind]}
                </p>
                {result !== undefined && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {exportCaption(result)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {result?.truncated === true && <Badge tone="warning">Kesildi</Badge>}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  onClick={() => void handleExport(kind)}
                  busy={busy === kind}
                >
                  CSV
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export const ExportPanel = memo(ExportPanelInner);
