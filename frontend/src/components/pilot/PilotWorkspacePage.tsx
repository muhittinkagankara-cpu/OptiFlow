/**
 * Pilot fabrika çalışma alanı.
 *
 * İlk ücretli müşterinin kurulumunu tek ekranda toplar: fabrika, hatlar,
 * makineler, bağlantı durumu, son veri, alarmlar, OEE ve kurulum durumu.
 * Daha önce bu bilgiler altı ayrı ekrandaydı ve sahadaki mühendis aralarında
 * gidip geliyordu.
 *
 * Veri kaynağı
 * ------------
 * Ekrandaki her sayı **gerçek kayıtlardan** gelir. Benzetim verisi bu ekrana
 * girmez; girseydi, kurulum sırasında hangi sayının cihazdan geldiği
 * bilinemezdi. Bu yüzden "Benzetim" rozeti yalnızca sunucu kaynağı `runtime`
 * dışında bir şey bildirdiğinde çıkar — ve bugün bildirmiyor.
 */

import { memo, useMemo } from "react";
import { Factory, RefreshCw, TriangleAlert } from "lucide-react";
import { formatPercent } from "../../lib/monitoring";
import type { AcceptanceInput, ProtocolCheck } from "../../lib/ops";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";
import { NOT_MEASURED } from "../monitoring/monitoringStyles";
import { useMonitoring } from "../monitoring/useMonitoring";
import { useRuntimeBridge } from "../runtime/useRuntimeBridge";
import { AcceptanceReportPanel } from "./AcceptanceReportPanel";
import { DeploymentChecklistPanel } from "./DeploymentChecklistPanel";
import { ExportPanel } from "./ExportPanel";
import { FieldDiagnosticsPanel } from "./FieldDiagnosticsPanel";
import { InstallTokenPanel } from "./InstallTokenPanel";
import { LicensePanel } from "./LicensePanel";
import { MachineLabelsPanel } from "./MachineLabelsPanel";
import { usePilotWorkspace } from "./usePilotWorkspace";

interface PilotWorkspacePageProps {
  enabled?: boolean;
}

function PilotWorkspacePageInner({ enabled = true }: PilotWorkspacePageProps) {
  const pilot = usePilotWorkspace({ enabled });
  const monitoring = useMonitoring({ intervalMs: 15_000, enabled });
  const bridge = useRuntimeBridge();

  const customer = pilot.license.license?.customer ?? "";
  const factoryName = customer || "Pilot Fabrika";
  const connections = bridge.state.connections;
  const verified = connections.filter((item) => item.everVerified).length;

  /*
   * Kabul raporunun girdisi.
   *
   * Protokoller kayıtlı bağlantılardan türetilir: hiç bağlantısı olmayan bir
   * protokol listeye **girmez** çünkü denenmemiştir; denenmiş ama
   * doğrulanmamış olan `false` ile görünür. İkisini birleştirmek, müşteriye
   * hiç bakılmamış bir protokolü arızalı göstermek olurdu.
   */
  const acceptance: AcceptanceInput = useMemo(() => {
    const byKind = new Map<string, ProtocolCheck>();
    for (const connection of connections) {
      const existing = byKind.get(connection.kind);
      const verifiedNow = connection.everVerified;
      // Aynı protokolden birden çok bağlantı varsa, biri doğrulandıysa
      // protokol doğrulanmış sayılır: protokol katmanı çalışıyor demektir.
      if (existing === undefined || verifiedNow) {
        byKind.set(connection.kind, {
          protocol: connection.kind,
          verified: verifiedNow,
          detail: connection.lastProbe?.evidence ?? connection.lastProbe?.detail ?? null,
        });
      }
    }

    const labelOf = (machineId: string): string | null =>
      pilot.labels.labels.find((item) => item.machineId === machineId)?.label ?? null;

    return {
      customer,
      factoryName,
      installedAtMs: pilot.license.license?.issuedAtMs ?? null,
      generatedAtLabel: new Date().toLocaleString("tr-TR"),
      devices: connections.map((connection) => ({
        label: connection.label,
        protocol: connection.kind,
        endpoint: connection.endpoint,
        verified: connection.everVerified,
        latencyMs: connection.health.avgLatencyMs,
        machineLabel: labelOf(connection.connectionId),
      })),
      protocols: [...byKind.values()],
      alarms: {
        raised: monitoring.counts.raisedTotal,
        exercised: monitoring.counts.raisedTotal > 0,
      },
      oee: monitoring.status?.oee ?? null,
      licenseTier: pilot.license.license?.tierLabel ?? null,
      checklistReady: pilot.checklist.ready,
      checklistSummary: pilot.checklist.summary,
    };
  }, [
    connections,
    customer,
    factoryName,
    monitoring.counts.raisedTotal,
    monitoring.status,
    pilot.checklist.ready,
    pilot.checklist.summary,
    pilot.labels.labels,
    pilot.license.license,
  ]);

  return (
    <div className="space-y-4">
      {pilot.error !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-900">
              Kurulum verisi okunamadı.
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              {pilot.error} Ekrandaki değerler son okunan yanıta aittir.
            </p>
          </div>
        </div>
      )}

      <Card className="p-4">
        <SectionTitle
          title={factoryName}
          description="Pilot kurulumun tek ekranı; bütün sayılar gerçek kayıtlardan gelir."
          action={
            <div className="flex items-center gap-2">
              <Badge tone="info" icon={Factory}>
                Gerçek veri
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={() => void pilot.refresh()}
                busy={pilot.loading}
              >
                Yenile
              </Button>
            </div>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cell
            label="Bağlantı"
            value={`${verified}/${connections.length}`}
            note={connections.length === 0 ? "Bağlantı kurulmadı" : "Doğrulanan / kayıtlı"}
          />
          <Cell
            label="Makine"
            value={String(pilot.labels.machineCount)}
            note={
              pilot.labels.unlabeled.length > 0
                ? `${pilot.labels.unlabeled.length} etiketsiz`
                : "Tümü etiketli"
            }
          />
          <Cell
            label="Açık alarm"
            value={String(monitoring.counts.open)}
            note={`${monitoring.counts.active} etkin`}
          />
          <Cell
            label="OEE"
            value={
              monitoring.status?.oeePercent == null
                ? NOT_MEASURED
                : formatPercent(monitoring.status.oeePercent)
            }
            note={
              monitoring.status?.oee == null
                ? "Hesaplanamadı"
                : "Gerçek ölçümden"
            }
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Cell
            label="Kurulum"
            value={pilot.checklist.ready ? "Tamamlandı" : `${pilot.checklist.done}/${pilot.checklist.total}`}
            note={pilot.checklist.summary}
          />
          <Cell
            label="Lisans"
            value={pilot.license.statusLabel}
            note={pilot.license.license?.tierLabel ?? "Tanımlanmadı"}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <LicensePanel
          view={pilot.license}
          onStartTrial={(name) => void pilot.startTrial(name)}
          busy={pilot.loading}
        />
        <InstallTokenPanel
          tokens={pilot.tokens}
          issued={pilot.issued}
          onIssue={(site) => void pilot.issueToken(site)}
          onRevoke={(id, reason) => void pilot.revokeToken(id, reason)}
          onDismissIssued={pilot.dismissIssued}
          busy={pilot.loading}
        />
      </div>

      <DeploymentChecklistPanel report={pilot.checklist} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldDiagnosticsPanel
          report={pilot.diagnostics}
          onRefresh={() => void pilot.refresh()}
          busy={pilot.loading}
        />
        <MachineLabelsPanel
          review={pilot.labels}
          factoryName={factoryName}
          onSave={(machineId, label) => void pilot.saveLabel(machineId, label)}
          onMarkPrinted={(labels) => void pilot.markPrinted(labels)}
          busy={pilot.loading}
        />
      </div>

      <AcceptanceReportPanel input={acceptance} />

      <ExportPanel />
    </div>
  );
}

/**
 * Özet hücresi.
 *
 * Ölçülmemiş değer "—" gösterir; sıfır yazılsaydı, hesaplanamayan bir OEE
 * "sıfır verimlilik" diye okunur ve müşteri olmayan bir sorunu araştırırdı.
 */
function Cell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>
    </div>
  );
}

export const PilotWorkspacePage = memo(PilotWorkspacePageInner);
