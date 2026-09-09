/**
 * Tanılama verisinin okunması.
 *
 * Bu kanca yalnızca **taşır**: sunucudan gelen çözümlenmiş raporu bileşene
 * verir. Eşik ve metin `lib/diagnostics` altındaki saf işlevlerdedir.
 *
 * Neden yoklama
 * -------------
 * Tanılama sayaçları olay üretmez; kuyruk derinliği ya da yazma hızı
 * değiştiğinde sunucu kimseye haber vermez. Yalnızca akışı dinleyen bir ekran
 * bu sayıları hiç görmezdi.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeBridgeClient } from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import { EMPTY_DIAGNOSTICS, type DiagnosticsReport } from "../../lib/diagnostics";

/** Varsayılan yoklama aralığı (ms). */
export const DIAGNOSTICS_INTERVAL_MS = 10_000;

export interface DiagnosticsState {
  report: DiagnosticsReport;
  /** Sunucudan hiç yanıt alındı mı? Alınmadıysa ekran "—" gösterir. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: DiagnosticsState = {
  report: EMPTY_DIAGNOSTICS,
  loaded: false,
  loading: false,
  error: null,
};

export interface UseDiagnosticsOptions {
  intervalMs?: number;
  /** Kapalıyken hiç istek yapılmaz; görünmeyen bir ekranı yoklamak israftır. */
  enabled?: boolean;
}

export function useDiagnostics({
  intervalMs = DIAGNOSTICS_INTERVAL_MS,
  enabled = true,
}: UseDiagnosticsOptions = {}) {
  const [state, setState] = useState<DiagnosticsState>(EMPTY);

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
    const result = await client.diagnostics();
    if (result.data === null) {
      // Hatalı yanıtta önceki rapor korunur: ekranın boşalması, sistemin
      // durduğu izlenimi verirdi.
      setState((current) => ({
        ...current,
        loading: false,
        loaded: true,
        error: result.error,
      }));
      return;
    }
    const report = result.data;
    setState({ report, loaded: true, loading: false, error: null });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1_000, intervalMs));
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return { ...state, refresh };
}
