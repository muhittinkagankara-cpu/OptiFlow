/**
 * Operasyon ekranı: sistem sağlığı, devreye alma, yedekleme ve denetim.
 *
 * Dört panel de **gerçek sunucu ölçümlerini** okur; hiçbiri örnek veri
 * göstermez. Sunucudan yanıt alınmadığında paneller boş kalmaz, "okunmadı"
 * yazar ve nedenini söyler — boş bir ekran, sağlıklı bir kurulumdan ayırt
 * edilemez.
 */

import { memo, useMemo, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import {
  buildCommissionReport,
  toFieldDevice,
  type FieldReportInput,
} from "../../lib/ops";
import { Button } from "../ui/Primitives";
import { useMonitoring } from "../monitoring/useMonitoring";
import { useDiagnostics } from "../diagnostics/useDiagnostics";
import { historySpanMs } from "../../lib/diagnostics";
import { useRuntimeBridge } from "../runtime/useRuntimeBridge";
import { AuditLogPanel } from "./AuditLogPanel";
import { BackupPanel } from "./BackupPanel";
import { CommissionChecklist } from "./CommissionChecklist";
import { FieldReportPanel } from "./FieldReportPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { useOps } from "./useOps";

function OperationsPageInner() {
  const ops = useOps();
  const monitoring = useMonitoring({ intervalMs: 15_000 });
  const bridge = useRuntimeBridge();
  // Telemetri sayıları tanılamadan gelir: saha raporunda kaç ölçümün
  // gerçekten kaydedildiği, kurulumun çalıştığının tek somut kanıtıdır.
  const diagnostics = useDiagnostics({ intervalMs: 30_000 });
  const [busy, setBusy] = useState(false);

  /*
   * Devreye alma listesi üç kaynaktan beslenir: bağlantı durumu (köprü),
   * OEE ve alarm (izleme), yedek (operasyon). Üçü de gerçek ölçümdür;
   * hiçbiri kullanıcının işaretlemesiyle tamamlanmaz.
   */
  /*
   * Saha raporunun girdisi. Her alan gerçek bir ölçümdür; eşleme sayısı
   * bağlantı başına ayrıştırılamadığı için (uyarı listesi makine taşır,
   * bağlantı değil) uyarı yokken bağlantıların eşlenmiş sayıldığı aynı kural
   * burada da uygulanır — uydurulmuş bir sayı yerine bilinen kural.
   */
  const fieldInput: FieldReportInput = useMemo(() => {
    /*
     * Saat sunucunun raporundan alınır, tarayıcıdan değil: cihaz yaşları
     * sunucunun ölçtüğü anlara göre hesaplanır ve iki saat arasındaki fark,
     * raporda olmayan bir gecikme gösterirdi. Rapor henüz okunmadıysa `0`
     * kalır ve veri yaşları "ölçülmedi" olur.
     */
    const nowMs = diagnostics.report.atMs;
    const mapped = bridge.state.devices.mappingWarnings.length === 0 ? 1 : 0;
    return {
      factoryName: bridge.state.connections[0]?.label ?? "Fabrika",
      orgName: null,
      generatedAtLabel:
        nowMs > 0 ? new Date(nowMs).toLocaleString("tr-TR") : "Sunucu saati okunmadı",
      devices: bridge.state.connections.map((connection) =>
        toFieldDevice(connection, mapped, nowMs),
      ),
      alarms: {
        raised: monitoring.counts.raisedTotal,
        active: monitoring.counts.active,
        exercised: monitoring.counts.raisedTotal > 0,
      },
      /*
       * Üretim durumu yalnızca birleşik OEE'yi taşır; üç çarpan ayrı ayrı
       * bildirilmez. Uydurmak yerine `null` bırakılır ve raporda "—" basılır.
       * Neden alanı, sunucunun yazdığı gerekçelerden gelir; yoksa genel bir
       * cümle yazılır.
       */
      oee: {
        oee: monitoring.status?.oee ?? null,
        availability: null,
        performance: null,
        quality: null,
        reason:
          monitoring.status?.oee == null
            ? Object.values(monitoring.status?.oeeReasons ?? {})[0] ??
              "OEE hesaplanamadı; planlanan süre ya da ideal çevrim verilmedi."
            : null,
      },
      telemetryRows: diagnostics.report.telemetryRows,
      historySpanMs: historySpanMs(diagnostics.report),
      persistenceMode: diagnostics.report.persistenceMode,
    };
  }, [bridge.state, monitoring.counts, monitoring.status, diagnostics.report]);

  const commission = useMemo(
    () =>
      buildCommissionReport({
        connections: bridge.state.connections.map((item) => ({
          id: item.connectionId,
          protocol: item.kind,
          verified: item.everVerified,
        })),
        /*
         * "Eşleme tamam" ölçümü, eşleme **uyarılarının yokluğundan** türer.
         * Bir uyarı, gelen bir ölçümün hangi makineye ait olduğunun
         * bilinmediğini söyler. Uyarı listesi hangi **makinenin** eşlenmediğini
         * taşır, hangi bağlantının değil; bu yüzden tek bir uyarı bile varsa
         * adım tamamlanmamış sayılır. Bağlantı başına ayrıştırmak, uyarının
         * taşımadığı bir bilgiyi uydurmak olurdu.
         */
        mappedConnections:
          bridge.state.devices.mappingWarnings.length === 0
            ? bridge.state.connections.length
            : 0,
        oee: monitoring.status?.oee ?? null,
        alarmsRaised: monitoring.counts.raisedTotal,
        // PDF üretimi bu ekrandan ölçülemez; raporlar ayrı bir akıştadır.
        // Ölçülemeyen bir adımı "tamam" saymak, listenin tamamını
        // güvenilmez kılardı.
        reportGenerated: false,
        backupVerified: ops.lastBackup !== null,
        loaded: ops.loaded && !bridge.state.isLoading,
      }),
    [
      bridge.state.connections,
      bridge.state.devices.mappingWarnings,
      bridge.state.isLoading,
      monitoring.status,
      monitoring.counts.raisedTotal,
      ops.lastBackup,
      ops.loaded,
    ],
  );

  const handleBackup = async () => {
    setBusy(true);
    try {
      await ops.createBackup();
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (backup: Record<string, unknown>) => {
    setBusy(true);
    try {
      await ops.restoreBackup(backup);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {ops.error !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-900">
              Operasyon verisi okunamadı.
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              {ops.error} Ekrandaki değerler son okunan yanıta aittir.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={() => void ops.refresh()}
          >
            Yenile
          </Button>
        </div>
      )}

      <SystemHealthPanel
        health={ops.health}
        readiness={ops.readiness}
        metrics={ops.metrics}
        environment={ops.environment}
      />

      <FieldReportPanel input={fieldInput} loaded={ops.loaded && diagnostics.loaded} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CommissionChecklist report={commission} />
        <BackupPanel
          lastBackup={ops.lastBackup}
          lastBackupPayload={ops.lastBackupPayload}
          lastRestore={ops.lastRestore}
          onCreate={() => void handleBackup()}
          onRestore={(backup) => void handleRestore(backup)}
          busy={busy}
        />
      </div>

      <AuditLogPanel
        entries={ops.audit}
        summary={ops.auditSummary}
        loaded={ops.loaded}
      />
    </div>
  );
}

export const OperationsPage = memo(OperationsPageInner);
