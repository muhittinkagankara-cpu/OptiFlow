/**
 * Yedekleme paneli.
 *
 * Üç işlem: yedek al, indir, geri yükle. Geri yükleme **onay ister** ve neyin
 * silineceğini önceden söyler: geri yükleme hedef kiracının satırlarını siler
 * ve bunu sonradan öğrenmek, veri kaybının en can sıkıcı biçimidir.
 *
 * Yedeğin sağlaması ekranda gösterilir. Gösterilmeseydi, iki yedeğin aynı
 * içerikte olup olmadığı ancak dosyaları açıp karşılaştırarak anlaşılırdı.
 */

import { memo, useState } from "react";
import { Database, Download, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  EMPTY,
  formatTimestamp,
  shortChecksum,
  type BackupSummary,
  type RestoreSummary,
} from "../../lib/ops";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";

interface BackupPanelProps {
  lastBackup: BackupSummary | null;
  lastBackupPayload: Record<string, unknown> | null;
  lastRestore: RestoreSummary | null;
  onCreate: () => void;
  onRestore: (backup: Record<string, unknown>) => void;
  busy?: boolean;
}

function BackupPanelInner({
  lastBackup,
  lastBackupPayload,
  lastRestore,
  onCreate,
  onRestore,
  busy = false,
}: BackupPanelProps) {
  const [confirming, setConfirming] = useState(false);

  const download = () => {
    if (lastBackupPayload === null) return;
    const blob = new Blob([JSON.stringify(lastBackupPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `optiflow-yedek-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <SectionTitle
        title="Yedekleme"
        description="Yedek mantıksaldır (JSON): aynı dosya hem SQLite hem PostgreSQL'de geri yüklenebilir."
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              icon={Database}
              onClick={onCreate}
              disabled={busy}
            >
              Yedek al
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={download}
              disabled={lastBackupPayload === null}
            >
              İndir
            </Button>
          </div>
        }
      />

      {lastBackup === null ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-600">
          Bu oturumda yedek alınmadı. Yedek almadan geri yükleme yapılamaz.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-900">
                {lastBackup.totalRows} satır yedeklendi
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {formatTimestamp(lastBackup.atMs)} · sağlama{" "}
                {shortChecksum(lastBackup.checksum)}
              </p>
            </div>
            <Badge tone="neutral">Biçim v{lastBackup.formatVersion}</Badge>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(lastBackup.counts).map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-slate-200 px-2.5 py-2"
              >
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {key}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <section className="mt-4 border-t border-slate-200 pt-3">
        <h3 className="mb-1.5 text-[11px] font-semibold text-slate-500">
          Geri yükleme
        </h3>

        {confirming ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-xs text-amber-900">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Geri yükleme, bu organizasyonun bağlantılarını, görüntülerini ve
                duruş kayıtlarını <strong>siler</strong> ve yedektekilerle
                değiştirir. Denetim kayıtlarına dokunulmaz.
              </span>
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                variant="danger"
                size="sm"
                icon={RotateCcw}
                disabled={lastBackupPayload === null || busy}
                onClick={() => {
                  if (lastBackupPayload !== null) onRestore(lastBackupPayload);
                  setConfirming(false);
                }}
              >
                Geri yükle
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Vazgeç
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            disabled={lastBackupPayload === null}
            onClick={() => setConfirming(true)}
          >
            Son yedekten geri yükle
          </Button>
        )}

        {lastRestore !== null && (
          <p className="mt-2 text-[11px] text-slate-600">
            {lastRestore.ok
              ? `${lastRestore.totalRestored} satır geri yüklendi.`
              : `Geri yükleme başarısız: ${lastRestore.error ?? EMPTY}`}
          </p>
        )}
      </section>
    </Card>
  );
}

export const BackupPanel = memo(BackupPanelInner);
