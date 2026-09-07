/**
 * Sağlayıcıların ortak gövdesi.
 *
 * Abonelik yönetimi, durum yayını ve `connect`/`disconnect` yaşam döngüsü her
 * sağlayıcıda aynıdır; beş yerde ayrı yazılsaydı biri abonelik iptalini
 * unutur ve sızıntı yapardı. Alt sınıflar yalnızca iki şeyi doldurur: akış
 * nasıl açılır (`open`) ve nasıl kapatılır (`close`).
 */

import type { LiveEvent } from "../events";
import type {
  ConnectionStatus,
  LiveDataProvider,
  LiveEventListener,
  StatusListener,
} from "./types";

export abstract class BaseLiveProvider implements LiveDataProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly isLive: boolean;
  abstract readonly isAvailable: boolean;

  private listeners = new Set<LiveEventListener>();
  private statusListeners = new Set<StatusListener>();
  private currentStatus: ConnectionStatus = "idle";

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /** Akışı açar. Alt sınıf burada zamanlayıcı kurar ya da sokete bağlanır. */
  protected abstract open(): void;

  /** Akışı kapatır. Açılan her kaynak burada bırakılmalıdır. */
  protected abstract close(): void;

  async connect(): Promise<void> {
    /*
     * Zaten bağlıyken yeniden bağlanmak sessizce yok sayılır. Yok sayılmasaydı
     * ikinci bir zamanlayıcı kurulur ve olaylar çift işlenirdi — yeniden
     * bağlanma denemelerinin sık olduğu bir ağ ortamında bu, sayaçları
     * sessizce iki katına çıkaran bir hata olurdu.
     */
    if (this.currentStatus === "connected" || this.currentStatus === "connecting") {
      return;
    }

    this.setStatus("connecting");
    try {
      this.open();
      this.setStatus("connected");
    } catch (error) {
      this.setStatus("error", error instanceof Error ? error.message : null);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.currentStatus === "idle" || this.currentStatus === "disconnected") {
      return;
    }
    this.close();
    this.setStatus("disconnected");
  }

  subscribe(cb: LiveEventListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Alt sınıfların olay yayımlamak için çağırdığı kanal. */
  protected emit(events: LiveEvent[]): void {
    if (events.length === 0) {
      return;
    }
    for (const listener of this.listeners) {
      listener(events);
    }
  }

  protected setStatus(status: ConnectionStatus, detail: string | null = null): void {
    this.currentStatus = status;
    for (const listener of this.statusListeners) {
      listener(status, detail);
    }
  }
}

/**
 * Bu sürümde bağlanmayan sağlayıcıların ortak gövdesi.
 *
 * `connect` çağrıldığında açıklayıcı bir hata atar ve durumu `error` yapar.
 * Sessizce hiçbir şey yapmamaları bilinçlidir: bağlanmadığı hâlde bağlanmış
 * görünen bir sağlayıcı, boş ekranı "fabrika duruyor" diye okutur.
 */
export abstract class UnavailableProvider extends BaseLiveProvider {
  readonly isLive = true;
  readonly isAvailable = false;

  protected open(): void {
    throw new Error(
      `${this.name} bu sürümde bağlanmıyor; sözleşme hazır, taşıma katmanı henüz yazılmadı.`,
    );
  }

  protected close(): void {
    // Açılmış bir kaynak yok.
  }
}
