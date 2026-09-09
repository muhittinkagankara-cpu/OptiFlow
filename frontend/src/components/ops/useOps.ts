/**
 * Operasyon verisinin okunması.
 *
 * Kanca yalnızca **taşır**: sunucudan gelen gövdeyi `lib/ops`
 * ayrıştırıcılarına verir. Karar, eşik ve biçimlendirme burada yoktur.
 *
 * Sağlık ve hazırlık ayrı okunur
 * ------------------------------
 * Hazırlık ucu hazır olmadığında **503** döner. Bu bir hata değil, bilgidir:
 * ekran bunu "sunucuya ulaşılamıyor" diye göstermemeli, "hazır değil ve
 * nedeni şu" diye göstermelidir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseAuditPage,
  parseBackupSummary,
  parseEnvironment,
  parseHealth,
  parseProcessMetrics,
  parseReadiness,
  parseRestoreSummary,
  type AuditEntry,
  type AuditSummary,
  type BackupSummary,
  type EnvironmentReport,
  type HealthStatus,
  type ProcessMetrics,
  type ReadinessStatus,
  type RestoreSummary,
} from "../../lib/ops";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";

/** Ölçümlerin yoklanma aralığı (ms). */
export const OPS_INTERVAL_MS = 10_000;

export interface OpsState {
  health: HealthStatus | null;
  readiness: ReadinessStatus | null;
  metrics: ProcessMetrics | null;
  environment: EnvironmentReport | null;
  audit: AuditEntry[];
  auditSummary: AuditSummary | null;
  /** Bu oturumda alınan son yedek; alınmadıysa `null`. */
  lastBackup: BackupSummary | null;
  /** Son yedeğin ham gövdesi; geri yükleme bunu kullanır. */
  lastBackupPayload: Record<string, unknown> | null;
  lastRestore: RestoreSummary | null;
  loaded: boolean;
  error: string | null;
}

const EMPTY: OpsState = {
  health: null,
  readiness: null,
  metrics: null,
  environment: null,
  audit: [],
  auditSummary: null,
  lastBackup: null,
  lastBackupPayload: null,
  lastRestore: null,
  loaded: false,
  error: null,
};

async function headers(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) base.Authorization = `Bearer ${token}`;
  return base;
}

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: await headers(),
  });
  // 503 bir hata değil bilgidir: hazırlık ucu "hazır değilim" derken de
  // gövdesinde nedenini taşır ve ekran onu göstermelidir.
  if (!response.ok && response.status !== 503) {
    throw new Error(`Sunucu ${response.status} döndü.`);
  }
  return response.json();
}

async function postJson(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: await headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Sunucu ${response.status} döndü.`);
  }
  return response.json();
}

export interface UseOpsOptions {
  enabled?: boolean;
  intervalMs?: number;
}

export function useOps(options: UseOpsOptions = {}) {
  const { enabled = true, intervalMs = OPS_INTERVAL_MS } = options;
  const [state, setState] = useState<OpsState>(EMPTY);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [health, readiness, metrics, audit] = await Promise.all([
        readJson("/api/health"),
        readJson("/api/ready"),
        readJson("/api/ops/metrics"),
        readJson("/api/audit?limit=100"),
      ]);

      if (!mounted.current) return;

      const metricsBody = metrics as Record<string, unknown>;
      const page = parseAuditPage(audit);

      setState((previous) => ({
        ...previous,
        health: parseHealth(health),
        // Hazırlık 503 döndüğünde gövde `detail` içinde gelir.
        readiness: parseReadiness(
          (readiness as Record<string, unknown>).detail ?? readiness,
        ),
        metrics: parseProcessMetrics(metricsBody.process),
        environment: parseEnvironment(metricsBody.environment),
        audit: page.entries,
        auditSummary: page.summary,
        loaded: true,
        error: null,
      }));
    } catch (error) {
      if (!mounted.current) return;
      // Hata sessiz geçilmez: ekran son bilinen veriyi gösterir ama üstünde
      // "okunamadı" yazar. Sessiz kalsaydı kullanıcı eski veriyi güncel sanardı.
      setState((previous) => ({
        ...previous,
        error:
          error instanceof Error ? error.message : "Operasyon verisi okunamadı.",
      }));
    }
  }, []);

  const createBackup = useCallback(async () => {
    const payload = (await postJson("/api/ops/backup")) as Record<string, unknown>;
    if (!mounted.current) return;
    setState((previous) => ({
      ...previous,
      lastBackup: parseBackupSummary(payload.summary),
      lastBackupPayload: payload.backup as Record<string, unknown>,
    }));
    await refresh();
  }, [refresh]);

  const restoreBackup = useCallback(
    async (backup: Record<string, unknown>) => {
      const payload = await postJson("/api/ops/restore", { backup });
      if (!mounted.current) return;
      setState((previous) => ({
        ...previous,
        lastRestore: parseRestoreSummary(payload),
      }));
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refresh]);

  return { ...state, refresh, createBackup, restoreBackup };
}
