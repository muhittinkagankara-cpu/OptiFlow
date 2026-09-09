/**
 * Kurulum durumunun tek sahibi.
 *
 * Kurulum verisi üç ekranda birden görünür: sihirbaz, makine envanteri ve
 * dashboard kartları. Her biri kendi kopyasını tutsaydı, envanterde eklenen bir
 * makine dashboard'daki puanı değiştirmezdi.
 *
 * Hook yalnızca durumu taşır ve kalıcılığı yönetir; hesapların tamamı
 * `lib/onboarding-enterprise` içindedir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { recallTimeline } from "../../lib/validation";
import {
  buildChecklist,
  buildReadiness,
  recallConnectorSnapshot,
  recallState,
  rememberState,
  type EnterpriseState,
  type ReadinessSignals,
} from "../../lib/onboarding-enterprise";

export interface EnterpriseSetupInput {
  /** Açık bir simülasyon koşumu var mı? */
  hasSimulationRun: boolean;
  /** Sunucuda kayıtlı fabrika sayısı. */
  savedFactoryCount: number;
}

export function useEnterpriseSetup(input: EnterpriseSetupInput) {
  const [state, setState] = useState<EnterpriseState>(() => recallState());

  useEffect(() => {
    rememberState(state);
  }, [state]);

  /*
   * Bağlayıcı ve doğrulama verisi kendi ekranlarında yaşıyor; burada **son
   * kaydedilmiş** hâlleri okunur. Canlı bir bağlantı gibi sunulmaz — bağlayıcı
   * kartları benzetim rozetini kendileri taşır.
   */
  const connectorSnapshot = useMemo(() => recallConnectorSnapshot(), []);
  const validationCount = useMemo(() => recallTimeline().length, []);

  const signals: ReadinessSignals = useMemo(
    () => ({
      hasSimulationRun: input.hasSimulationRun,
      savedFactoryCount: input.savedFactoryCount,
      validationCount,
      connectorCount: connectorSnapshot.connectorCount,
      connectedCount: connectorSnapshot.connectedCount,
    }),
    [
      connectorSnapshot.connectedCount,
      connectorSnapshot.connectorCount,
      input.hasSimulationRun,
      input.savedFactoryCount,
      validationCount,
    ],
  );

  const report = useMemo(() => buildReadiness(state, signals), [state, signals]);
  const checklist = useMemo(() => buildChecklist(report), [report]);

  /** İlk rapor indirildiğinde kilometre taşını işaretler. */
  const markReportDownloaded = useCallback((atMs: number) => {
    setState((current) =>
      current.milestones.firstReportAtMs !== null
        ? current
        : {
            ...current,
            milestones: { ...current.milestones, firstReportAtMs: atMs },
          },
    );
  }, []);

  const markSetupCompleted = useCallback((atMs: number) => {
    setState((current) => ({
      ...current,
      milestones: { ...current.milestones, setupCompletedAtMs: atMs },
    }));
  }, []);

  return {
    state,
    setState,
    signals,
    report,
    checklist,
    connectorSnapshot,
    markReportDownloaded,
    markSetupCompleted,
  };
}
