/**
 * `LiveFactoryStore` — canlı durumun tek sahibi.
 *
 * Neden bir store
 * ---------------
 * Canlı ekranda dört ayrı bölge (akış diyagramı, üst şerit, olay akışı, alarm
 * merkezi) **aynı** durumu okur. Durum bir bileşenin `useState`'inde dursaydı,
 * her olay bütün ağacı yeniden render eder ve olay mantığı bileşenin içine
 * sızardı. Store, olay işlemeyi React'ten ayırır: sağlayıcı olay yayımlar,
 * store indirgeyiciyi çağırır, React yalnızca sonucu okur
 * (`useSyncExternalStore`).
 *
 * Store'un kendisi React'ten habersizdir; bu yüzden testlerde doğrudan
 * kullanılabilir ve ileride bir WebSocket bağlantısı doğrudan `dispatch`
 * çağırabilir.
 */

import { reduceLive, reduceLiveMany, type LiveEvent } from "./events";
import type { LiveFactoryState } from "./types";

export class LiveFactoryStore {
  private state: LiveFactoryState;
  private listeners = new Set<() => void>();

  constructor(initial: LiveFactoryState) {
    this.state = initial;
  }

  getState = (): LiveFactoryState => this.state;

  /**
   * Bir ya da birden çok olayı uygular.
   *
   * Dizi hâlinde verilen olaylar **tek** bildirimle sonuçlanır: yüz olay aynı
   * anda geldiğinde yüz kez render etmek, tarayıcıyı kilitlerdi. Bu, gerçek
   * bir OPC UA aboneliğinin toplu paket göndermesi durumunda da doğru
   * davranıştır.
   */
  dispatch = (event: LiveEvent | LiveEvent[]): void => {
    const next = Array.isArray(event)
      ? reduceLiveMany(this.state, event)
      : reduceLive(this.state, event);

    // Tanınmayan istasyon gibi durumlarda indirgeyici aynı nesneyi döner;
    // bildirim göndermek gereksiz bir render turu olurdu.
    if (next === this.state) {
      return;
    }
    this.state = next;
    this.emit();
  };

  /** Durumu baştan kurar (senaryo değiştirildiğinde). */
  reset = (initial: LiveFactoryState): void => {
    this.state = initial;
    this.emit();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
