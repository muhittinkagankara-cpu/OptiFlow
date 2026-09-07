/**
 * Canlı veri sağlayıcı sözleşmesi.
 *
 * Bu dosyanın tek işi, arayüzü verinin **kaynağından** yalıtmaktır. Hiçbir
 * bileşen `DemoLiveProvider` ya da `ReplayProvider` tipini bilmez; hepsi
 * yalnızca `LiveDataProvider` görür. Yarın OPC-UA, MQTT ya da bir MES ucu
 * eklendiğinde değişen tek şey bu klasördeki bir dosya olacak — ekranların
 * hiçbiri yeniden yazılmayacak.
 *
 * Bağlantı yaşam döngüsü açıkça modellenir (`connect` / `disconnect` /
 * `status`). Gerçek bir ağ bağlantısında "bağlanıyor", "koptu" ve "hata"
 * durumları kullanıcıya gösterilmek zorundadır: sessizce boş kalan bir ekran,
 * duran bir fabrikadan ayırt edilemez.
 */

import type { LiveEvent } from "../events";

/** Bağlantının o anki hâli. */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  idle: "Bağlanmadı",
  connecting: "Bağlanıyor",
  connected: "Bağlı",
  disconnected: "Bağlantı kesildi",
  error: "Hata",
};

export type LiveEventListener = (events: LiveEvent[]) => void;
export type StatusListener = (status: ConnectionStatus, detail: string | null) => void;

/**
 * Tüm canlı veri kaynaklarının uyduğu sözleşme.
 *
 * `subscribe` ve `onStatus` abonelikten çıkma işlevi döner; bileşenler bunu
 * `useEffect` temizliğinde çağırır. Abonelik iptali olmasaydı, ekran değişince
 * eski dinleyiciler birikirdi.
 */
export interface LiveDataProvider {
  readonly id: string;
  /** Arayüzde gösterilecek ad. */
  readonly name: string;
  /** "Bu veriler nereden geliyor?" sorusunun yanıtı. */
  readonly description: string;
  /** Veri gerçek bir üretim sisteminden mi geliyor? */
  readonly isLive: boolean;
  /** Bu sürümde bağlanabiliyor mu? */
  readonly isAvailable: boolean;
  readonly status: ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(cb: LiveEventListener): () => void;
  onStatus(cb: StatusListener): () => void;
}

/**
 * Oynatma denetimleri — yalnızca kayıttan çalan sağlayıcılarda bulunur.
 *
 * Ayrı bir arayüz olması bilinçlidir: oynatma çubuğu "bu sağlayıcı `Replay`
 * mı?" diye **sormaz**, "bu sağlayıcı oynatma denetimi sunuyor mu?" diye
 * sorar (`asReplayControls`). Böylece yarın kaydı sunucudan çalan başka bir
 * sağlayıcı eklendiğinde aynı çubuk hiç değişmeden onunla da çalışır.
 */
export interface ReplayControls {
  readonly durationMs: number;
  readonly positionMs: number;
  readonly speed: ReplaySpeed;
  readonly isPlaying: boolean;
  setSpeed(speed: ReplaySpeed): void;
  play(): void;
  pause(): void;
  /** Kaydın verilen anına atlar ve o ana kadarki olayları yeniden uygular. */
  seek(positionMs: number): void;
  onProgress(cb: () => void): () => void;
  /**
   * Atlamadan hemen önce durumun sıfırlanması gerektiğini duyurur.
   *
   * Ayrı bir kanal olması bilinçlidir: olay akışına "sıfırla" diye bir olay
   * koymak, aynı akışı dinleyen alarm ve sayaç mantığını kayıt oynatmaya özel
   * bir duruma bulaştırırdı.
   */
  onReset(cb: () => void): () => void;
}

/** Desteklenen oynatma hızları. */
export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * Sağlayıcı oynatma denetimi sunuyorsa onu döner, sunmuyorsa `null`.
 *
 * Tip kontrolü `instanceof` ile değil, yeteneğin varlığıyla yapılır: bileşen
 * somut sınıfı içe aktarmak zorunda kalsaydı, sözleşmenin tek noktada durması
 * anlamını yitirirdi.
 */
export function asReplayControls(
  provider: LiveDataProvider,
): ReplayControls | null {
  const candidate = provider as unknown as Partial<ReplayControls>;
  return typeof candidate.seek === "function" &&
    typeof candidate.setSpeed === "function" &&
    typeof candidate.onProgress === "function" &&
    typeof candidate.onReset === "function"
    ? (candidate as ReplayControls)
    : null;
}
