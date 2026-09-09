/**
 * İzleme verisinin okunması.
 *
 * Bu kanca yalnızca **taşır**: köprü istemcisinden gelen çözümlenmiş veriyi
 * bileşenlere verir. Eşik, karar ya da biçimlendirme burada yoktur; hepsi
 * `lib/monitoring` altındaki saf işlevlerdedir.
 *
 * Neden yoklama, neden akış değil
 * -------------------------------
 * Alarmlar SSE ile değil yoklamayla okunur. "Veri gelmiyor" alarmı doğası
 * gereği hiçbir olay üretmez: susan bir cihaz akışa hiçbir şey yazmaz ve
 * yalnızca olayları dinleyen bir ekran o alarmı hiç görmez. Sunucu her okuma
 * isteğinde kuralları yeniden değerlendirir.
 *
 * Depo neden burada
 * -----------------
 * `UnifiedAlarmStore` sunucudan bağımsız olarak onay durumunu korur: kullanıcı
 * bir alarmı onayladıktan sonra sunucu yanıtı gelene kadar geçen sürede alarm
 * yeniden "açık" görünmemelidir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import {
  EMPTY_ALARM_COUNTS,
  UnifiedAlarmStore,
  type AlarmCounts,
  type HealthScoreView,
  type MonitoringKpi,
  type ProductionStatus,
  type TimelineEntry,
  type UnifiedAlarm,
} from "../../lib/monitoring";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";

/** Varsayılan yoklama aralığı (ms). */
export const POLL_INTERVAL_MS = 10_000;

export interface MonitoringState {
  alarms: UnifiedAlarm[];
  history: UnifiedAlarm[];
  counts: AlarmCounts;
  timeline: TimelineEntry[];
  status: ProductionStatus | null;
  health: HealthScoreView | null;
  /** Live Factory kartlarının okuduğu gerçek KPI seti; okunmadıysa `null`. */
  kpi: MonitoringKpi | null;
  /** Sunucudan hiç yanıt alındı mı? Alınmadıysa ekran "—" gösterir. */
  loaded: boolean;
  error: string | null;
}

const EMPTY_STATE: MonitoringState = {
  alarms: [],
  history: [],
  counts: EMPTY_ALARM_COUNTS,
  timeline: [],
  status: null,
  health: null,
  kpi: null,
  loaded: false,
  error: null,
};

export interface UseMonitoringOptions {
  intervalMs?: number;
  /** Kapalıyken hiç istek yapılmaz; görünmeyen bir ekranı yoklamak israftır. */
  enabled?: boolean;
  /** Vardiyanın planlanan süresi; verilmezse OEE hesaplanmaz. */
  plannedTimeMs?: number;
  /** İdeal çevrim süresi; verilmezse performans hesaplanmaz. */
  idealCycleSeconds?: number;
}

export function useMonitoring(options: UseMonitoringOptions = {}) {
  const {
    intervalMs = POLL_INTERVAL_MS,
    enabled = true,
    plannedTimeMs,
    idealCycleSeconds,
  } = options;

  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }
  const client = clientRef.current;
  const storeRef = useRef(new UnifiedAlarmStore());

  const [state, setState] = useState<MonitoringState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    const [alarmResult, timelineResult, statusResult, healthResult, kpiResult] =
      await Promise.all([
        client.alarms(),
        client.timeline(),
        client.productionStatus(plannedTimeMs, idealCycleSeconds),
        client.healthScore(),
        client.runtimeKpi(),
      ]);

    if (alarmResult.error !== null) {
      // Hata sessiz geçilmez: ekran son bilinen veriyi gösterir ama üstünde
      // "okunamadı" yazar. Sessiz kalsaydı kullanıcı eski veriyi güncel sanardı.
      setState((previous) => ({ ...previous, error: alarmResult.error }));
      return;
    }

    const center = alarmResult.data;
    if (center !== null) {
      storeRef.current.sync(center.active, "runtime");
    }
    const view = storeRef.current.view();

    setState({
      alarms: view.active,
      history: view.history.length > 0 ? view.history : (center?.history ?? []),
      counts: view.counts,
      timeline: timelineResult.data ?? [],
      status: statusResult.data,
      health: healthResult.data,
      kpi: kpiResult.data,
      loaded: true,
      error: null,
    });
  }, [client, plannedTimeMs, idealCycleSeconds]);

  const acknowledge = useCallback(
    async (alarmId: string) => {
      // Önce yerelde işaretlenir: sunucu yanıtı gelene kadar alarm "açık"
      // görünseydi, operatör düğmenin çalışmadığını sanıp yeniden basardı.
      storeRef.current.acknowledge(alarmId, "operatör", Date.now());
      setState((previous) => ({
        ...previous,
        alarms: storeRef.current.view().active,
        counts: storeRef.current.view().counts,
      }));

      await client.acknowledgeAlarm(alarmId);
      await refresh();
    },
    [client, refresh],
  );

  /**
   * Alarmın bildirimini geçici olarak keser.
   *
   * Yerel depoda önden işaretlenmez: susturma sunucuda bir süre hesaplar
   * (`silenced_until_ms`) ve bu süreyi tarayıcıda tahmin etmek, ekranda
   * sunucudakinden farklı bir bitiş anı göstermek olurdu.
   */
  const silence = useCallback(
    async (alarmId: string, durationMs?: number, reason?: string) => {
      await client.silenceAlarm(alarmId, "operatör", durationMs, reason);
      await refresh();
    },
    [client, refresh],
  );

  /** Susturmayı kaldırır; alarm `OPEN` durumuna döner. */
  const unsilence = useCallback(
    async (alarmId: string) => {
      await client.unsilenceAlarm(alarmId);
      await refresh();
    },
    [client, refresh],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return { ...state, refresh, acknowledge, silence, unsilence };
}
