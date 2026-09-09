/**
 * Bağlayıcı üzerinden veri akışı — "Live Simulation Mode".
 *
 * Gerçek bir bağlantı yokken ekranın boş kalması, mimarinin çalışıp
 * çalışmadığını görünmez kılardı. Bu yüzden demo verisi de **bağlayıcıdan
 * geçer**: canlı ekran `LiveDataProvider` görür, bağlayıcı katmanı olayları
 * üretir ve arada hiçbir bileşen kaynağın ne olduğunu bilmez.
 *
 *     Demo senaryo ─▶ ConnectorLiveProvider ─▶ LiveDataProvider sözleşmesi ─▶ Ekran
 *                          (bağlayıcı durumu, gecikme, günlük)
 *
 * Yarın gerçek bir OPC UA istemcisi geldiğinde bu dosyanın yerini o alır;
 * `LiveProductionCenter` ve `useLiveFactory` satırı bile değişmez. Sözleşmenin
 * bugün korunmasının bütün amacı budur.
 */

import type { LiveEvent } from "../live/events";
import type {
  ConnectionStatus,
  LiveDataProvider,
  LiveEventListener,
  StatusListener,
} from "../live/providers";
import { CONNECTOR_LABEL, type ConnectorConfig, type ConnectorStatus } from "./types";

/**
 * Bağlayıcı durumunun canlı sağlayıcı durumuna çevrilmesi.
 *
 * İki sözleşmenin durum kümeleri **birebir aynı değildir** ve olmamalıdır:
 * bağlayıcı katmanı yeniden denemeyi ayrı bir durum olarak izler, canlı ekran
 * için o da bir "bağlanıyor"dur. Çeviriyi tek bir yerde yapmak, iki katmanın
 * birbirinin iç durumlarına bağlanmasını önler.
 */
export function toConnectionStatus(status: ConnectorStatus): ConnectionStatus {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
    case "retrying":
      return "connecting";
    case "failed":
      return "error";
    case "disconnected":
      return "disconnected";
    case "idle":
      return "idle";
  }
}

/**
 * Bir bağlayıcıyı canlı veri sağlayıcısına dönüştürür.
 *
 * İçeride başka bir sağlayıcı taşır (bugün demo senaryo, yarın gerçek istemci)
 * ve onun olaylarını olduğu gibi geçirir. Kendi kattığı tek şey kimliktir:
 * ekranda "Hat 1 PLC (OPC UA)" yazar, "Demo senaryo" değil — kullanıcı verinin
 * hangi bağlantıdan geldiğini görür.
 *
 * `isLive` alanı **iç sağlayıcıdan** gelir. Bağlayıcı adı taşıyor diye demo
 * veriyi canlı ilan etmek, ürünün en tehlikeli yalanı olurdu.
 */
export class ConnectorLiveProvider implements LiveDataProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isLive: boolean;
  readonly isAvailable: boolean;

  private readonly inner: LiveDataProvider;
  private readonly onEvents: ((events: LiveEvent[]) => void) | null;

  constructor(
    config: ConnectorConfig,
    inner: LiveDataProvider,
    onEvents: ((events: LiveEvent[]) => void) | null = null,
  ) {
    this.id = `connector:${config.id}`;
    this.name = `${config.name} (${CONNECTOR_LABEL[config.kind]})`;
    this.description = inner.isLive
      ? `${CONNECTOR_LABEL[config.kind]} bağlantısından canlı okuma.`
      : `Bağlayıcı katmanı üzerinden benzetim verisi; ${CONNECTOR_LABEL[config.kind]} bağlantısı henüz gerçek cihaza gitmiyor.`;
    this.isLive = inner.isLive;
    this.isAvailable = inner.isAvailable;
    this.inner = inner;
    this.onEvents = onEvents;
  }

  get status(): ConnectionStatus {
    return this.inner.status;
  }

  async connect(): Promise<void> {
    await this.inner.connect();
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
  }

  subscribe(cb: LiveEventListener): () => void {
    return this.inner.subscribe((events) => {
      // Bağlayıcı katmanı da olayları görür: sağlık panosundaki "son veri" ve
      // kayıt sayacı buradan beslenir. Ekranın akışına dokunulmaz.
      this.onEvents?.(events);
      cb(events);
    });
  }

  onStatus(cb: StatusListener): () => void {
    return this.inner.onStatus(cb);
  }
}

/**
 * Olay paketinden kaç "kayıt" sayılacağı.
 *
 * Saat vuruşları (`tick`) kayıt sayılmaz: bir saniyede bir gelen boş vuruşu
 * veri saymak, hiç veri gelmeyen bir bağlantıyı sağlıklı gösterirdi.
 */
export function countRecords(events: LiveEvent[]): number {
  return events.filter((item) => item.type !== "tick").length;
}
