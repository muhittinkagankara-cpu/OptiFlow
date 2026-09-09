/**
 * Canlı cihaz akışının ekran tarafı.
 *
 * Kanca yalnızca **taşır**: SSE karelerini `lib/stream` ayrıştırıcılarına
 * verir, tampona ekler ve bileşene sunar. Eşik, karar ya da biçimlendirme
 * burada yoktur.
 *
 * Neden `EventSource` değil
 * -------------------------
 * `EventSource` `Authorization` başlığı gönderemez; çok kiracılı bir üründe
 * bu, akışın kimlik doğrulanmadan açılması demek olurdu. Bu yüzden akış
 * `fetch` + `ReadableStream` ile okunur — davranış aynıdır, kimlik doğrulama
 * çalışır.
 *
 * Yeniden bağlanma
 * ----------------
 * Kopmada bekleme üstel olarak büyür ve titreşim içerir. Sabit bir bekleme,
 * sunucu yeniden başladığında bütün tarayıcıların aynı saniyede geri
 * dönmesine ve sunucuyu ikinci kez düşürmesine yol açardı.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import {
  EMPTY_BUFFER,
  INITIAL_RECONNECT,
  noteConnected,
  noteDisconnect,
  parseDeviceRow,
  pushRows,
  type DeviceDataRow,
  type LiveStreamFrame,
  type ReconnectState,
  type StreamBufferState,
  type StreamStats,
} from "../../lib/stream";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";

/** Akış ölçümlerinin yoklanma aralığı (ms). */
export const STATS_INTERVAL_MS = 5_000;

export interface LiveStreamState {
  buffer: StreamBufferState;
  stats: StreamStats | null;
  reconnect: ReconnectState;
  /** Akış şu an açık mı? */
  connected: boolean;
  /** Cihazdan en az bir ölçüm alındı mı? */
  hasDeviceData: boolean;
  /** Son gelen OEE güncellemesinin ham gövdesi; gelmediyse `null`. */
  lastOee: Record<string, unknown> | null;
  /** Son gelen üretim güncellemesi. */
  lastProduction: Record<string, unknown> | null;
  /** Son alarm değişimi. */
  lastAlarm: Record<string, unknown> | null;
}

export interface UseLiveStreamOptions {
  enabled?: boolean;
  statsIntervalMs?: number;
  /** Test edilebilirlik için; üretimde `Math.random`. */
  random?: () => number;
}

export function useLiveStream(options: UseLiveStreamOptions = {}) {
  const {
    enabled = true,
    statsIntervalMs = STATS_INTERVAL_MS,
    random = Math.random,
  } = options;

  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }
  const client = clientRef.current;

  const [buffer, setBuffer] = useState<StreamBufferState>(EMPTY_BUFFER);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [reconnect, setReconnect] = useState<ReconnectState>(INITIAL_RECONNECT);
  const [connected, setConnected] = useState(false);
  const [lastOee, setLastOee] = useState<Record<string, unknown> | null>(null);
  const [lastProduction, setLastProduction] = useState<Record<string, unknown> | null>(
    null,
  );
  const [lastAlarm, setLastAlarm] = useState<Record<string, unknown> | null>(null);

  const handleFrame = useCallback((frame: LiveStreamFrame) => {
    if (frame.kind === "device_data") {
      setBuffer((previous) => pushRows(previous, [parseDeviceRow(frame.data)]));
      return;
    }
    if (frame.kind === "oee_update") {
      setLastOee(frame.data);
      return;
    }
    if (frame.kind === "production_update") {
      setLastProduction(frame.data);
      return;
    }
    setLastAlarm(frame.data);
  }, []);

  const refreshStats = useCallback(async () => {
    const result = await client.streamStats();
    if (result.error === null && result.data !== null) {
      setStats(result.data);
    }
  }, [client]);

  /** Ekran açıldığında son ölçümler çekilir; akış beklenmez. */
  const seed = useCallback(async () => {
    const result = await client.deviceData(100);
    const rows = result.data;
    if (result.error === null && rows !== null && rows.length > 0) {
      // Sunucu yeniden eskiye verir; tampon da öyle tutar, bu yüzden ters
      // çevrilerek eklenir.
      setBuffer((previous) => pushRows(previous, [...rows].reverse()));
    }
  }, [client]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stop: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    /*
     * Tek zamanlayıcı kuralı.
     *
     * Bir kopmada hata geri çağrısı birden çok kez tetiklenebilir (istek
     * başarısız olur, okuyucu kapanır). Her biri ayrı bir zamanlayıcı
     * kursaydı denemeler üst üste binerdi: tarayıcıda altı saniyede yedi
     * deneme sayıldığı görüldü, oysa üstel bekleme ile bu sürede en fazla üç
     * deneme olmalıydı.
     */
    const scheduleRetry = (delayMs: number) => {
      if (retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void open();
      }, delayMs);
    };

    const open = async () => {
      if (cancelled) return;

      /*
       * Akışın gerçekten açıldığını yalnızca hata gelmemiş olması söyler.
       * Eskiden `liveStream` döndükten sonra koşulsuz "açık" yazılıyordu ve
       * tarayıcıda görüldü: sunucu kapalıyken rozet "Akış açık" diyordu.
       */
      let failed = false;

      stop = await client.liveStream(
        (frame) => {
          if (cancelled) return;
          setConnected(true);
          setReconnect((previous) => noteConnected(previous));
          handleFrame(frame);
        },
        (message) => {
          if (cancelled) return;
          failed = true;
          setConnected(false);
          setReconnect((previous) => {
            const next = noteDisconnect(previous, message, random);
            scheduleRetry(next.nextDelayMs ?? 1_000);
            return next;
          });
        },
      );

      if (!cancelled && !failed) setConnected(true);
    };

    void seed();
    void refreshStats();
    void open();

    const statsTimer = window.setInterval(() => void refreshStats(), statsIntervalMs);

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      window.clearInterval(statsTimer);
      stop?.();
      setConnected(false);
    };
  }, [client, enabled, handleFrame, random, refreshStats, seed, statsIntervalMs]);

  return {
    buffer,
    stats,
    reconnect,
    connected,
    hasDeviceData: buffer.rows.length > 0,
    lastOee,
    lastProduction,
    lastAlarm,
    refreshStats,
  } satisfies LiveStreamState & { refreshStats: () => Promise<void> };
}

/** Tampondaki satırlar; bileşenlerin okuduğu kısayol. */
export function rowsOf(state: LiveStreamState): DeviceDataRow[] {
  return state.buffer.rows;
}
