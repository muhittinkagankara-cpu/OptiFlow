/**
 * Alarmdan sonraki adım (Sprint 2I-B, Yasa 5).
 *
 * Alarm paneli bugüne kadar bir zincirin yarısıydı: alarma tıklanınca istasyon
 * çekmecesi açılıyor, çekmecede yalnızca "kapat" bulunuyordu. Bu dosya, alarmın
 * **gerçekten** bağlanabileceği bir ekran olup olmadığına karar verir.
 *
 * ## Neden yalnızca kuyruk alarmının eylemi var?
 *
 * Canlı katmanda dört tür alarm üretiliyor (`queue`, `fault`, `scrap`,
 * `setup`). Bunlardan yalnızca biri, üründe **var olan** bir ekrana
 * bağlanabiliyor:
 *
 * - `queue` → kuyruk birikmesi bir kapasite sorusudur ve ürünün bu soruyu
 *   yanıtlayan ekranı Simülasyon'dur. Sonuç ekranının kapanış adımı da aynı
 *   yere gider; iki ekran aynı kısıt için farklı yerlere göndermez.
 * - `fault` → bakım işi. Bakım uçları backend'de var ama canlı bir istasyon
 *   arızasını oraya bağlayan bir akış yok.
 * - `scrap` → kalite işi. Bağlanacak bir ekran yok.
 * - `setup` → bilgi; eylem gerektirmiyor.
 *
 * Bağlanacak güvenilir bir hedefi olmayan alarm için **eylem gösterilmez**.
 * "Makineyi durdur" ya da "Operatöre görev gönder" gibi düğmeler koymak,
 * olmayan bir yeteneği varmış gibi göstermek olurdu — ve sahada bir operatör o
 * düğmeye basıp işin yapıldığını sanabilirdi.
 */

import type { Alarm } from "./types";

export interface LiveAlarmAction {
  /** Düğme yazısı. */
  label: string;
  /** Neden bu ekrana gidiliyor. */
  reason: string;
}

/** Alarm kimliğinin ön ekindeki tür (`queue:s1:480` → `queue`). */
export function alarmKind(alarm: Alarm): string {
  return alarm.id.split(":")[0] ?? "";
}

/**
 * Alarmın sonraki adımı; güvenilir bir hedef yoksa `null`.
 *
 * `null` dönmesi bir eksiklik değil, bilinçli bir karardır: eylemsiz bir
 * çekmece, çalışmayan bir eylemden dürüsttür.
 */
export function alarmAction(alarm: Alarm | null): LiveAlarmAction | null {
  if (alarm === null || alarm.resolvedAtMinutes !== null) {
    return null;
  }

  if (alarmKind(alarm) === "queue") {
    return {
      label: "Simülasyonda modelle",
      reason:
        "Kuyruk birikmesi bir kapasite sorusudur; hattı modelleyip kapasite eklemenin etkisini ölçebilirsiniz.",
    };
  }

  return null;
}
