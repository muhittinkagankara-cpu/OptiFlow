/**
 * Trend verisinin okunması.
 *
 * Bu kanca yalnızca **taşır**: köprü istemcisinden gelen çözümlenmiş seriyi
 * bileşene verir. Kova hesabı, ölçek ve metinler `lib/telemetry` altındaki saf
 * işlevlerdedir.
 *
 * Neden otomatik yoklama yok
 * --------------------------
 * Trend ekranı geçmişe bakar; yedi günlük bir pencerede saniyede bir yenilemek
 * hem sunucuya hem tarayıcıya yüktür ve kullanıcıya hiçbir şey kazandırmaz.
 * Yenileme kullanıcının isteğiyle olur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import {
  emptySeries,
  type TelemetryTag,
  type TrendSeries,
  type TrendWindowId,
} from "../../lib/telemetry";

export interface TrendsState {
  tags: TelemetryTag[];
  series: TrendSeries | null;
  /** Sunucudan hiç yanıt alındı mı? Alınmadıysa ekran "—" gösterir. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: TrendsState = {
  tags: [],
  series: null,
  loaded: false,
  loading: false,
  error: null,
};

export interface UseTrendsOptions {
  /** Kapalıyken hiç istek yapılmaz; görünmeyen bir ekranı yoklamak israftır. */
  enabled?: boolean;
}

export function useTrends({ enabled = true }: UseTrendsOptions = {}) {
  const [state, setState] = useState<TrendsState>(EMPTY);
  const [device, setDevice] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<TrendWindowId>("1h");

  const clientRef = useRef<RuntimeBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RuntimeBridgeClient({
      baseUrl: API_BASE_URL,
      getToken: getAccessToken,
    });
  }

  /** Seçim listesini okur ve ilk çifti seçer. */
  const loadTags = useCallback(async () => {
    const client = clientRef.current;
    if (client === null) return;
    const result = await client.telemetryTags();
    if (result.data === null) {
      setState((current) => ({ ...current, error: result.error, loaded: true }));
      return;
    }
    const tags = result.data;
    setState((current) => ({ ...current, tags, loaded: true, error: null }));
    // İlk çift kendiliğinden seçilir: boş bir ekranda kullanıcının hangi
    // etiketi seçeceğini bilmesi gerekmez.
    const first = tags[0];
    if (first !== undefined) {
      setDevice((value) => value ?? first.device);
      setTag((value) => value ?? first.tag);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    const client = clientRef.current;
    if (client === null || device === null || tag === null) return;
    setState((current) => ({ ...current, loading: true }));
    const result = await client.telemetryTrend(device, tag, windowId);
    if (result.data === null) {
      setState((current) => ({
        ...current,
        loading: false,
        loaded: true,
        error: result.error,
        // Hatalı yanıtta önceki seri korunur: ekranın boşalması, veri
        // kaybolmuş izlenimi verirdi.
      }));
      return;
    }
    const series = result.data;
    setState((current) => ({
      ...current,
      series,
      loading: false,
      loaded: true,
      error: null,
    }));
  }, [device, tag, windowId]);

  useEffect(() => {
    if (!enabled) return;
    void loadTags();
  }, [enabled, loadTags]);

  useEffect(() => {
    if (!enabled) return;
    void loadSeries();
  }, [enabled, loadSeries]);

  const select = useCallback((nextDevice: string, nextTag: string) => {
    setDevice(nextDevice);
    setTag(nextTag);
  }, []);

  return {
    ...state,
    device,
    tag,
    windowId,
    /** Seçili çift yoksa boş bir seri; ekran yine de eksenini çizer. */
    view: state.series ?? emptySeries(device ?? "—", tag ?? "—", windowId),
    select,
    setWindowId,
    refresh: loadSeries,
    refreshTags: loadTags,
  };
}
