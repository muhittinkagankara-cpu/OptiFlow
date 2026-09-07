/**
 * Sağlayıcı katmanının tek giriş noktası.
 *
 * Bileşenler buradan yalnızca **tipleri** ve katalog bilgisini alır; somut
 * sınıfları canlı ekranın kurulum noktası (`LiveProductionCenter`) örnekler.
 */

import { DemoLiveProvider } from "./DemoLiveProvider";
import { ReplayProvider } from "./ReplayProvider";
import { MESProvider, OPCUAProvider, WebSocketProvider } from "./skeletons";

export * from "./types";
export * from "./base";
export * from "./DemoLiveProvider";
export * from "./ReplayProvider";
export * from "./skeletons";

/** Arayüzde listelenen kaynak. */
export interface ProviderChoice {
  id: string;
  name: string;
  description: string;
  isAvailable: boolean;
}

/**
 * Ekranın kaynak seçicisinde gösterilecek liste.
 *
 * Bağlanmayan sağlayıcılar da listelenir ve "yakında" olarak işaretlenir:
 * hangi kaynakların yolda olduğunu görmek, ürünün nereye gittiğini anlatır.
 * Gizlenselerdi, mimarinin hazır olduğu hiçbir yerden anlaşılmazdı.
 */
export function providerCatalog(): ProviderChoice[] {
  return [
    new DemoLiveProvider([], "normal", 0),
    new ReplayProvider([]),
    new WebSocketProvider(),
    new MESProvider(),
    new OPCUAProvider(),
  ].map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    isAvailable: provider.isAvailable,
  }));
}
