/**
 * Ekranı açan durum cümlesi (Yasa 1).
 *
 * Command Center bir selamlamayla değil, bir **tespitle** açılır. Cümle
 * tümüyle ölçülmüş veriden kurulur: kısıt istasyonunun adı ve doluluğu
 * `bottleneckSummary` çıktısından gelir, hattın kapasite kullanımı
 * `capacityShare`'den. İkisi de mevcut iş kurallarıdır ve burada
 * değiştirilmez.
 *
 * Kısıt bilinmiyorsa cümle **uydurulmaz**: ekran bunu söyler ve kullanıcıyı
 * ölçümü üretecek adıma götürür (Yasa 4).
 */

import type { SimulationResults } from "../../types/simulationTypes";
import { bottleneckSummary, capacityShare } from "../dashboardMetrics";
import type { FactoryStatement } from "./types";

/** Yüzdeyi Türkçe biçimde yazar. */
function percent(ratio: number): string {
  return `%${Math.round(ratio * 100)}`;
}

/**
 * Durum cümlesini üretir.
 *
 * Üç hâl vardır ve üçü de dürüsttür:
 * 1. Koşum yok → ölçüm yapılmadığı söylenir, sihirbaza yönlendirilir.
 * 2. Koşum var ama kısıt belirlenemedi → cümle kurulmaz, neden yazılır.
 * 3. Kısıt var → adı ve doluluğuyla birlikte söylenir.
 */
export function factoryStatement(
  results: SimulationResults | null,
): FactoryStatement {
  if (results === null) {
    return {
      headline: "Hattınız henüz ölçülmedi.",
      detail:
        "Bir model kurup çalıştırdığınızda kısıt, çıktı ve kayıp burada görünür.",
      action: { label: "Simülasyona git", target: "simulation" },
    };
  }

  const bottleneck = bottleneckSummary(results);
  if (bottleneck === null) {
    // Koşum var ama darboğaz istasyonu sonuçlarla eşleşmedi. Bir istasyon adı
    // uydurmak, kullanıcıyı yanlış makineye yönlendirirdi.
    return {
      headline: "Kısıt istasyonu belirlenemedi.",
      detail:
        "Koşum tamamlandı ama darboğaz istasyonu sonuç verisiyle eşleşmedi.",
      action: { label: "Sonucu aç", target: "simulation" },
    };
  }

  const capacity = capacityShare(results);
  return {
    headline: `Bugün hattınızı ${bottleneck.name} sınırlıyor.`,
    detail:
      capacity === null
        ? `${bottleneck.name} zamanının ${percent(bottleneck.utilization)}'ini işlemde geçiriyor; hattın çıktısını bu istasyon belirliyor.`
        : `${bottleneck.name} zamanının ${percent(bottleneck.utilization)}'ini işlemde geçiriyor; hat teorik kapasitesinin ${percent(capacity)}'inde çalışıyor.`,
    action: null,
  };
}
