/**
 * Pilot çalışma alanının verisi.
 *
 * Bu kanca yalnızca **taşır**: sunucudan gelen çözümlenmiş veriyi bileşenlere
 * verir. Eşik, karar ve metin `lib/licensing`, `lib/commissioning` ve
 * `lib/monitoring` altındaki saf işlevlerdedir.
 *
 * Neden tek okuma değil
 * ---------------------
 * `/pilot-workspace` sayfanın çekirdeğini tek anda getirir; lisans, token,
 * etiket ve kontrol listesi ayrı uçlardır çünkü ayrı hızlarda değişirler.
 * Lisans günde bir kez değişir, akış saniyede birkaç kez. Hepsini aynı
 * aralıkla yoklamak, değişmeyen veriyi boş yere yeniden çekmek olurdu.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import {
  EMPTY_DEPLOYMENT,
  EMPTY_FIELD_DIAGNOSTICS,
  type DeploymentReport,
  type FieldDiagnostics,
  type InstallToken,
  type IssuedToken,
  type LabelReview,
} from "../../lib/commissioning";
import { EMPTY_LICENSE_VIEW, type LicenseView } from "../../lib/licensing";

/** Çalışma alanının yoklama aralığı (ms). */
export const WORKSPACE_INTERVAL_MS = 15_000;

const EMPTY_LABELS: LabelReview = {
  labels: [],
  duplicates: [],
  unlabeled: [],
  suggestions: {},
  machineCount: 0,
};

export interface PilotState {
  license: LicenseView;
  tokens: InstallToken[];
  labels: LabelReview;
  checklist: DeploymentReport;
  diagnostics: FieldDiagnostics;
  /** Sunucudan hiç yanıt alındı mı? Alınmadıysa ekran "—" gösterir. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: PilotState = {
  license: EMPTY_LICENSE_VIEW,
  tokens: [],
  labels: EMPTY_LABELS,
  checklist: EMPTY_DEPLOYMENT,
  diagnostics: EMPTY_FIELD_DIAGNOSTICS,
  loaded: false,
  loading: false,
  error: null,
};

export interface UsePilotOptions {
  intervalMs?: number;
  /** Kapalıyken hiç istek yapılmaz; görünmeyen bir ekranı yoklamak israftır. */
  enabled?: boolean;
}

export function usePilotWorkspace({
  intervalMs = WORKSPACE_INTERVAL_MS,
  enabled = true,
}: UsePilotOptions = {}) {
  const [state, setState] = useState<PilotState>(EMPTY);
  /**
   * Yeni üretilen token; **yalnızca bellekte** tutulur.
   *
   * Kalıcı bir yere yazılsaydı, tarayıcı belleğine düşen bir kurulum anahtarı
   * olurdu. Sayfa yenilendiğinde kaybolur ve yenisi üretilir.
   */
  const [issued, setIssued] = useState<IssuedToken | null>(null);

  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (client === null) return;
    setState((current) => ({ ...current, loading: true }));

    const [license, tokens, labels, checklist, diagnostics] = await Promise.all([
      client.license(),
      client.installTokens(),
      client.machineLabels(),
      client.deploymentChecklist(),
      client.fieldDiagnostics(),
    ]);

    const errors = [license, tokens, labels, checklist, diagnostics]
      .map((item) => item.error)
      .filter((item): item is string => item !== null);

    setState((current) => ({
      // Hatalı yanıtta önceki değer korunur: ekranın boşalması, kurulumun
      // silindiği izlenimini verirdi.
      license: license.data ?? current.license,
      tokens: tokens.data ?? current.tokens,
      labels: labels.data ?? current.labels,
      checklist: checklist.data ?? current.checklist,
      diagnostics: diagnostics.data ?? current.diagnostics,
      loaded: true,
      loading: false,
      error: errors.length > 0 ? errors[0] : null,
    }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(2_000, intervalMs));
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  const startTrial = useCallback(
    async (customer: string) => {
      const client = clientRef.current;
      if (client === null) return;
      await client.startTrial(customer);
      await refresh();
    },
    [refresh],
  );

  const issueToken = useCallback(
    async (site: string, ttlHours?: number) => {
      const client = clientRef.current;
      if (client === null) return;
      const result = await client.issueInstallToken(site, ttlHours);
      setIssued(result.data);
      await refresh();
    },
    [refresh],
  );

  const revokeToken = useCallback(
    async (tokenId: string, reason: string) => {
      const client = clientRef.current;
      if (client === null) return;
      await client.revokeInstallToken(tokenId, reason);
      await refresh();
    },
    [refresh],
  );

  const saveLabel = useCallback(
    async (machineId: string, label: string, line = "") => {
      const client = clientRef.current;
      if (client === null) return;
      const result = await client.saveMachineLabel({ machineId, label, line });
      if (result.data === null) {
        setState((current) => ({ ...current, error: result.error }));
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const markPrinted = useCallback(
    async (labels: string[]) => {
      const client = clientRef.current;
      if (client === null) return;
      await client.markLabelsPrinted(labels);
      await refresh();
    },
    [refresh],
  );

  /** Üretilen tokenı ekrandan kaldırır; metin bir daha gösterilemez. */
  const dismissIssued = useCallback(() => setIssued(null), []);

  return {
    ...state,
    issued,
    refresh,
    startTrial,
    issueToken,
    revokeToken,
    saveLabel,
    markPrinted,
    dismissIssued,
  };
}
