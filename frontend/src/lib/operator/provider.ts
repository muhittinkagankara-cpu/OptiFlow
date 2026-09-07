/**
 * Olay sağlayıcı soyutlaması.
 *
 * Arayüz görevleri nereden geldiğini bilmez; yalnızca bu sözleşmeyi bilir.
 * Bugün tek uygulama `LocalOperatorProvider`'dır ve veriyi tarayıcıda tutar.
 * Yarın aynı sözleşmeyi uygulayan başkaları eklenebilir:
 *
 * - `MESProvider` — üretim yönetim sisteminin REST ucuna bağlanır.
 * - `WebSocketProvider` — olayları anlık olarak dinler, `subscribe` gerçek
 *   zamanlı akış olur.
 * - `OPCUAProvider` — makine denetleyicisinden doğrudan sayaç okur.
 *
 * Sözleşmenin **eşzamansız** olması bu yüzdendir: kural gereği ağ üzerinden
 * çalışan bir sağlayıcının da sığması gerekir. Yerel sağlayıcı için beklemenin
 * maliyeti yoktur.
 *
 * `isLive` alanı arayüzde bir uyarı şeridine dönüşür. Sahte veriyi gerçekmiş
 * gibi göstermek, hattaki insanın yanlış karar vermesine yol açar; sağlayıcının
 * kendisi canlı olup olmadığını söylemek zorundadır.
 */

import { applyEvent, type OperatorEvent } from "./events";
import { buildDemoTasks } from "./seed";
import type { OperatorTask } from "./types";

export interface OperatorEventProvider {
  /** Arayüzde gösterilecek ad. */
  readonly name: string;
  /** "Bu veriler nereden geliyor?" sorusunun yanıtı. */
  readonly description: string;
  /** Veri gerçek bir üretim sisteminden mi geliyor? */
  readonly isLive: boolean;
  /** Vardiyanın görevleri. */
  listTasks(): Promise<OperatorTask[]>;
  /** Bir saha olayını yayımlar ve güncellenmiş listeyi döner. */
  publish(event: OperatorEvent): Promise<OperatorTask[]>;
  /** Liste değiştiğinde haber verir; dönen işlev aboneliği bitirir. */
  subscribe(listener: (tasks: OperatorTask[]) => void): () => void;
}

/**
 * Tarayıcı belleğinde çalışan sağlayıcı — bu sürümün tek sağlayıcısı.
 *
 * Durum yalnızca bellekte tutulur; sekme kapanınca vardiya sıfırlanır. Bu
 * bilinçlidir: yarım kalmış sahte bir vardiyayı diske yazıp ertesi gün gerçek
 * veri gibi geri okumak, örnek veriyle üretim verisini karıştırmanın en kolay
 * yolu olurdu.
 */
export class LocalOperatorProvider implements OperatorEventProvider {
  readonly name = "Yerel örnek veri";
  readonly description =
    "Görevler bu cihazda üretildi; üretim sistemine bağlanılmadı.";
  readonly isLive = false;

  private tasks: OperatorTask[];
  private listeners = new Set<(tasks: OperatorTask[]) => void>();

  constructor(stationNames: string[] = [], operatorName = "Operatör") {
    this.tasks = buildDemoTasks(stationNames, operatorName);
  }

  async listTasks(): Promise<OperatorTask[]> {
    return this.tasks;
  }

  async publish(event: OperatorEvent): Promise<OperatorTask[]> {
    this.tasks = applyEvent(this.tasks, event);
    for (const listener of this.listeners) {
      listener(this.tasks);
    }
    return this.tasks;
  }

  subscribe(listener: (tasks: OperatorTask[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
