/**
 * Store'u React'e bağlayan kanca.
 *
 * `useSyncExternalStore` kullanılır: store React'in dışında yaşar ve olaylar
 * render döngüsünden bağımsız gelir. `useState` + `useEffect` ile yazılsaydı,
 * abone olunmadan önce gelen olaylar kaçırılır ve ekran ilk saniyede eksik
 * kalırdı — gerçek bir WebSocket bağlantısında bu hata her açılışta görünürdü.
 */

import { useSyncExternalStore } from "react";
import type { LiveFactoryStore } from "./store";
import type { LiveFactoryState } from "./types";

export function useLiveFactory(store: LiveFactoryStore): LiveFactoryState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
