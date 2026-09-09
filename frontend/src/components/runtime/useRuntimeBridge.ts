/**
 * Runtime köprüsünün ekran durumu.
 *
 * Kanca yalnızca sunucuyla konuşur ve sonucu bileşenlere verir; hiçbir karar
 * burada verilmez — durum çevirisi, matris ve olay yorumu `lib/connectors/bridge`
 * altındaki saf işlevlerdedir.
 *
 * SSE akışı **kullanıcı isteyince** açılır. Sayfa açılır açılmaz açılsaydı,
 * köprüyü hiç kullanmayan bir kullanıcının tarayıcısı sunucuda kalıcı bir
 * bağlantı tutardı.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RuntimeBridgeClient,
  compatibilityMatrix,
  feedStatus,
  parseDevicePage,
  type BridgeConnectRequest,
  type BridgeConnection,
  type BridgeEvent,
  type BridgeSummary,
  type DevicePage,
  type FeedVerdict,
  type RuntimeDashboard,
  type MatrixRow,
} from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";

/** Ekranda tutulan en fazla olay; tampon sunucudadır, bu yalnızca görünüm. */
const MAX_VISIBLE_EVENTS = 200;

/** Sunucudan yanit gelmeden onceki bos cihaz sayfasi. */
const EMPTY_DEVICES: DevicePage = parseDevicePage({});

export interface RuntimeBridgeState {
  connections: BridgeConnection[];
  summary: BridgeSummary | null;
  events: BridgeEvent[];
  matrix: MatrixRow[];
  /** Cihaz verisi: olcumler, makine goruntuleri, tanilama ve akislar. */
  devices: DevicePage;
  /** Canli uretim ekranindaki verinin kaynagi. */
  feed: FeedVerdict;
  /** Runtime panosu: kurtarma, olay hizi, kalicilik. */
  dashboard: RuntimeDashboard | null;
  error: string | null;
  isLoading: boolean;
  isStreaming: boolean;
}

export function useRuntimeBridge() {
  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }
  const client = clientRef.current;

  const [connections, setConnections] = useState<BridgeConnection[]>([]);
  const [summary, setSummary] = useState<BridgeSummary | null>(null);
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [devices, setDevices] = useState<DevicePage>(EMPTY_DEVICES);
  const [dashboard, setDashboard] = useState<RuntimeDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isStreaming, setStreaming] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [statusResult, healthResult] = await Promise.all([
      client.status(),
      client.health(),
    ]);
    setLoading(false);

    if (statusResult.error !== null) {
      setError(statusResult.error);
      return;
    }
    setError(null);
    setConnections(statusResult.data ?? []);
    setSummary(healthResult.data);
  }, [client]);

  const loadEvents = useCallback(async () => {
    const result = await client.events(0);
    if (result.error === null && result.data !== null) {
      /* Sunucu eskiden yeniye verir; ekranda en yeni üstte durur. */
      setEvents([...result.data.events].reverse().slice(0, MAX_VISIBLE_EVENTS));
    }
  }, [client]);

  /** Cihaz verisini sunucudan okur (Data Explorer ve besleme durumu). */
  const loadDevices = useCallback(async () => {
    const result = await client.devices(200);
    if (result.error === null && result.data !== null) {
      setDevices(result.data);
    }
  }, [client]);

  /** Runtime panosunu okur (kurtarma, olay hizi, kalicilik). */
  const loadDashboard = useCallback(async () => {
    const result = await client.dashboard();
    if (result.error === null && result.data !== null) {
      setDashboard(result.data);
    }
  }, [client]);

  /**
   * Diskteki baglantilari ve goruntuleri geri yukler.
   *
   * Akislar kendiliginden baslatilmaz: akis baslatmak cihaza gercek istek
   * gonderir ve bunu kullanici istemelidir.
   */
  const recover = useCallback(async () => {
    const result = await client.recover(false);
    if (result.error !== null) {
      setError(result.error);
      return null;
    }
    await refresh();
    await loadDevices();
    await loadDashboard();
    return result.data;
  }, [client, refresh, loadDevices, loadDashboard]);

  /** Bir baglanti icin surekli veri akisini baslatir. */
  const subscribe = useCallback(
    async (
      connectionId: string,
      options: { intervalMs?: number; knownMachineIds?: string[] } = {},
    ) => {
      const result = await client.subscribe(connectionId, options);
      if (result.error !== null) {
        setError(result.error);
        return null;
      }
      if (result.data !== null && !result.data.started && result.data.reason !== null) {
        /*
         * Akis acilmadi ama sunucu nedenini soyledi; bu bir ag hatasi degil,
         * urunun bilincli reddi (or. dogrulanmamis baglanti). Kullaniciya
         * aynen gosterilir.
         */
        setError(result.data.reason);
      }
      await loadDevices();
      return result.data;
    },
    [client, loadDevices],
  );

  const unsubscribe = useCallback(
    async (connectionId: string) => {
      await client.unsubscribe(connectionId);
      await loadDevices();
    },
    [client, loadDevices],
  );

  const connect = useCallback(
    async (request: BridgeConnectRequest) => {
      setLoading(true);
      const result = await client.connect(request);
      setLoading(false);
      if (result.error !== null) {
        setError(result.error);
        return null;
      }
      setError(null);
      await refresh();
      await loadEvents();
      await loadDevices();
      return result.data;
    },
    [client, refresh, loadEvents, loadDevices],
  );

  const disconnect = useCallback(
    async (connectionId: string, forget = false) => {
      await client.disconnect(connectionId, forget);
      await refresh();
      await loadEvents();
    },
    [client, refresh, loadEvents],
  );

  const startStream = useCallback(async () => {
    if (stopRef.current !== null) {
      return;
    }
    const stop = await client.stream(
      (event) => {
        setEvents((current) => [event, ...current].slice(0, MAX_VISIBLE_EVENTS));
      },
      (message) => {
        setError(message);
        setStreaming(false);
      },
    );
    stopRef.current = stop;
    setStreaming(true);
  }, [client]);

  const stopStream = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setStreaming(false);
  }, []);

  /* Ekran kapanırken akış da kapanır; yoksa sunucuda bir abone kalırdı. */
  useEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    void refresh();
    void loadEvents();
    void loadDevices();
    void loadDashboard();
  }, [refresh, loadEvents, loadDevices, loadDashboard]);

  const state: RuntimeBridgeState = {
    connections,
    summary,
    events,
    matrix: compatibilityMatrix(connections, {
      // Tarayıcı tarafında yalnızca REST'in gerçek istemcisi var (SALES-7).
      browserClients: ["rest"],
      // CSV ve ERP bu sürümde yalnızca örnek veriyle çalışır.
      simulated: ["csv", "erp"],
    }),
    devices,
    dashboard,
    feed: feedStatus({
      streams: devices.streams,
      /*
       * Bu ekran benzetim uretmez; benzetim karari canli uretim ekranindaki
       * kaynak secimine aittir. Burada yalnizca gercek akislara bakilir.
       */
      simulatedProvider: false,
      anyVerifiedConnection: connections.some((connection) => connection.everVerified),
    }),
    error,
    isLoading,
    isStreaming,
  };

  return {
    state,
    refresh,
    loadEvents,
    loadDevices,
    loadDashboard,
    recover,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    startStream,
    stopStream,
  };
}
