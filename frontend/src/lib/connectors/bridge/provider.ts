/**
 * Köprüden beslenen canlı veri sağlayıcısı.
 *
 * `LiveDataProvider` sözleşmesine **hiç dokunmadan** yeni bir kaynak ekler:
 * canlı ekran bu sağlayıcıyı ötekilerden ayırt etmez, aynı arayüzü görür.
 *
 * Durumun anlamı
 * --------------
 * Bu sağlayıcının "bağlı" olması, **sunucu akışının** açık olduğu anlamına
 * gelir; bir PLC'ye bağlanıldığı anlamına gelmez. Cihaz bağlantısının durumu
 * ayrı bir yerde durur (`/api/runtime/status`) ve ekranda ayrı gösterilir.
 * İkisi tek bir göstergeye indirgenseydi, hiçbir cihaz bağlı değilken "canlı
 * üretim bağlı" yazan bir ekran çıkardı.
 *
 * Cihazdan ölçüm gelmediği sürece bu sağlayıcı **hiçbir olay yaymaz**: köprünün
 * yaşam döngüsü olayları (deneme, yeniden deneme) üretim verisi değildir ve
 * canlı akışa girmez.
 */

import { BaseLiveProvider } from "../../live";
import type { LiveEvent } from "../../live";
import type { RuntimeBridgeClient } from "./client";
import {
  CumulativeCounters,
  DEVICE_EVENT_KIND,
  matchStation,
  toLiveEvents,
} from "./mapping";
import type { BridgeEvent } from "./types";

export interface BridgeProviderOptions {
  client: RuntimeBridgeClient;
  /** Modeldeki istasyon kimlikleri. */
  stationIds: string[];
  /** Akışın başlangıç anı; dakika hesabı buna göre yapılır. */
  startedAtMs: number;
  /** Köprü olaylarını (üretim verisi olmayanları da) dinlemek için. */
  onBridgeEvent?: (event: BridgeEvent) => void;
  /** Cihaz ölçümleri; Data Explorer bunları gösterir. */
  onDeviceEvent?: (event: BridgeEvent) => void;
  /** Bağlantı sağlığı olayları (deneme, yeniden deneme, kopma). */
  onHealthEvent?: (event: BridgeEvent) => void;
  /** Çevrilemeyen yükler ve eşleşmeyen alanlar. */
  onDiagnostic?: (event: BridgeEvent) => void;
}

/** Sağlıkla ilgili olay türleri; bağlantının kendi yaşam döngüsüdür. */
const HEALTH_KINDS = new Set([
  "probe",
  "retry",
  "registered",
  "removed",
  "disconnected",
  "stream_started",
  "stream_stopped",
  "stream_refused",
]);

export class BridgeLiveProvider extends BaseLiveProvider {
  readonly id = "bridge";
  readonly name = "Sunucu köprüsü (SSE)";
  readonly description =
    "Veri, sunucudaki runtime köprüsünden SSE ile gelir. Cihaz bağlantısı doğrulanmadıysa akış açık olsa bile üretim olayı gelmez.";
  /** Akan veri gerçek bir cihazdan gelir; benzetim üretilmez. */
  readonly isLive = true;
  readonly isAvailable = true;

  private readonly options: BridgeProviderOptions;
  private stop: (() => void) | null = null;
  /** Cihazdan gelen son ölçümün anı; hiç ölçüm gelmediyse `null`. */
  private lastDeviceAtMs: number | null = null;
  /** Canlı akışa çevrilen olay sayısı. */
  private translated = 0;
  /** Çevrilemeyen cihaz olayı sayısı (eşleşmeyen makine, tanınmayan ölçüm). */
  private untranslated = 0;
  /** Kaç kez yeniden bağlanıldı? */
  private reconnects = 0;
  /** İlk yüklemede kaç makine görüntüsü alındı? */
  private seededMachines = 0;
  /** Yeniden bağlanma zamanlayıcısı. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Kümülatif sayaçların tabanı.
   *
   * Sağlayıcı başına tutulur: kaynak değiştirildiğinde yeni bir sağlayıcı
   * kurulur ve sayaçlar sıfırdan öğrenilir.
   */
  private readonly counters = new CumulativeCounters();

  constructor(options: BridgeProviderOptions) {
    super();
    this.options = options;
  }

  protected open(): void {
    /*
     * `open` eşzamanlı olmak zorunda (taban sınıfın sözleşmesi), akış açmak
     * ise asenkron. Bu yüzden akış arka planda açılır ve kapatma işlevi
     * geldiğinde saklanır. Arada `close` çağrılırsa akış hemen kapatılır —
     * yoksa kapatılmış bir ekran arkada veri almaya devam ederdi.
     */
    let cancelled = false;

    /*
     * Önce son durum çekilir, sonra akış açılır. Sıra tersine olsaydı, akış
     * açıldıktan sonra gelen görüntü eski değerlerle taze olanların üzerine
     * yazabilirdi.
     */
    void this.seedFromSnapshots().then(() => {
      if (cancelled) {
        return;
      }
      void this.options.client
        .stream(
          (event) => this.handle(event),
          (message) => this.fail(message),
        )
        .then((stop) => {
          if (cancelled) {
            stop();
            return;
          }
          this.stop = stop;
        });
    });

    this.stop = () => {
      cancelled = true;
    };
  }

  protected close(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stop?.();
    this.stop = null;
  }

  /**
   * Cihazdan ölçüm geldi mi?
   *
   * Akışın açık olması yetmez: ekran "Gerçek Veri" yazabilmek için gerçekten
   * bir ölçüm almış olmalıdır.
   */
  get hasDeviceData(): boolean {
    return this.lastDeviceAtMs !== null;
  }

  get lastDeviceEventAtMs(): number | null {
    return this.lastDeviceAtMs;
  }

  /** Çevrilen ve çevrilemeyen cihaz olaylarının sayısı. */
  get translationCounts(): { translated: number; untranslated: number } {
    return { translated: this.translated, untranslated: this.untranslated };
  }

  /** Kaç kez yeniden bağlanıldı? Sıfır, hiç kopmadığı anlamına gelir. */
  get reconnectCount(): number {
    return this.reconnects;
  }

  /** İlk yüklemede kaç makinenin son durumu alındı? */
  get seededMachineCount(): number {
    return this.seededMachines;
  }

  /**
   * Sunucudaki son durumu okuyup ekrana yansıtır.
   *
   * Ekran açıldığında geçmiş olayları yeniden oynatmak gerekmez: her makinenin
   * son bilinen değeri tek istekte gelir. Yalnızca **modelde karşılığı olan**
   * makineler yansıtılır; ötekiler eşleme uyarısına düşer.
   *
   * Üretim sayacı bilinçli olarak yansıtılmaz: cihaz sayacı kümülatiftir
   * (vardiya başından beri 1240 parça) ve canlı ekranın üretim sayacı
   * "bağlandığımdan beri" anlamına gelir. İkisini toplamak, ekranda hiç
   * üretilmemiş binlerce parça göstermek olurdu.
   */
  async seedFromSnapshots(): Promise<number> {
    const result = await this.options.client.live();
    if (result.error !== null || result.data === null) {
      return 0;
    }

    const events: LiveEvent[] = [];
    let seeded = 0;

    for (const machine of result.data.machines) {
      const stationId = matchStation(machine.machineId, this.options.stationIds);
      if (stationId === null) {
        continue;
      }
      seeded += 1;

      if (machine.queueLength !== null) {
        events.push({
          type: "queue_changed",
          atMinutes: 0,
          stationId,
          queue: Math.round(machine.queueLength),
        });
      }
      if (machine.oee !== null) {
        events.push({ type: "oee_sampled", atMinutes: 0, stationId, oee: machine.oee });
      }
      if (machine.status === "down") {
        events.push({
          type: "machine_fault",
          atMinutes: 0,
          stationId,
          reason: "Cihaz duruş bildirdi",
        });
      } else if (machine.status === "running") {
        events.push({ type: "machine_repaired", atMinutes: 0, stationId });
      }
    }

    this.seededMachines = seeded;
    if (events.length > 0) {
      this.emit(events);
    }
    return seeded;
  }

  private handle(event: BridgeEvent): void {
    this.options.onBridgeEvent?.(event);

    if (event.kind === "diagnostic") {
      this.options.onDiagnostic?.(event);
      return;
    }

    if (HEALTH_KINDS.has(event.kind)) {
      this.options.onHealthEvent?.(event);
      return;
    }

    if (event.kind !== DEVICE_EVENT_KIND) {
      return;
    }

    this.options.onDeviceEvent?.(event);
    this.lastDeviceAtMs = event.atMs;

    const live: LiveEvent[] = toLiveEvents(event, {
      knownStationIds: this.options.stationIds,
      startedAtMs: this.options.startedAtMs,
      counters: this.counters,
    });

    if (live.length > 0) {
      this.translated += 1;
      this.emit(live);
      return;
    }

    /*
     * Ölçüm geldi ama canlı ekrana çevrilemedi: makine modelde yok ya da
     * ölçüm türünün ekranda karşılığı yok. Sayaç tutulur ve arayüz bunu
     * eşleme uyarısı olarak gösterir — sessizce atmak, "veri geliyor ama
     * ekran değişmiyor" sorusunu yanıtsız bırakırdı.
     */
    this.untranslated += 1;
  }

  /**
   * Akış koptuğunda yeniden bağlanır.
   *
   * Gecikme üstel olarak büyür ve bir tavanla sınırlanır: kapalı bir sunucuya
   * saniyede onlarca kez bağlanmaya çalışmak, sorunu büyütmekten başka işe
   * yaramaz. Deneme sayısı sınırsızdır çünkü bir üretim ekranının kendiliğinden
   * geri gelmesi beklenir; her deneme kullanıcıya durum olarak yansır.
   */
  private fail(message: string): void {
    this.setStatus("error", message);

    if (this.retryTimer !== null) {
      return;
    }

    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnects, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.reconnects += 1;
      this.setStatus("connecting", `Yeniden bağlanılıyor (${this.reconnects}. deneme).`);
      this.open();
    }, delayMs);
  }
}
