/**
 * Canlı ekranın eşikleri (Sprint 2I-B).
 *
 * Bu dosya **yeni bir eşik sistemi tanımlamaz**. `LivePage` içinde bileşenin
 * gövdesine yazılmış tek bir karşılaştırma vardı:
 *
 *     tone={bottleneck.utilization >= 0.85 ? "bad" : "warning"}
 *
 * 0.85 sayısı orada çıplak duruyordu; oysa aynı değer `lib/actionItems`
 * içinde `BOTTLENECK_WARNING` adıyla zaten tanımlı ve gerekçesi yazılı
 * (motorun `CRITICAL_UTILIZATION` eşiğiyle aynı noktada durması gerekiyor).
 * İki yerde iki kopya, birinin değişip ötekinin unutulması demekti.
 *
 * Buradaki işlev aynı karşılaştırmayı **birebir** yapar: davranış değişmedi,
 * yalnızca sabit tek kaynağından okunuyor ve bileşenden çıktı.
 */

import { BOTTLENECK_WARNING } from "../actionItems";
import type { Tone } from "../resultsFormatting";

/**
 * Darboğaz doluluğunun ilerleme çubuğu tonu.
 *
 * Eşiğin üstü "bad", altı "warning" — `LivePage`'in eskiden yaptığının aynısı.
 * Ölçülemeyen bir doluluk için karar verilmez: `null` döner ve çağıran rengi
 * kendisi seçmez, çizmez (Yasa 4).
 */
export function bottleneckTone(utilization: number): Tone | null {
  if (!Number.isFinite(utilization)) {
    return null;
  }
  return utilization >= BOTTLENECK_WARNING ? "bad" : "warning";
}

/** Doluluk uyarı eşiğinde ya da üstünde mi? */
export function isHighUtilization(utilization: number): boolean {
  return Number.isFinite(utilization) && utilization >= BOTTLENECK_WARNING;
}
