/**
 * "Fabrika Sağlığı" — koşumdan okunan sağlık göstergeleri.
 *
 * Her gösterge simülasyonun **zaten döndürdüğü** bir alandan gelir; burada yeni
 * bir ölçüm yapılmaz. Amaç, sonuç ekranındaki ayrıntılı tabloları okumadan
 * hattın genel durumunu tek bakışta vermektir.
 *
 * Her göstergenin bir "tonu" vardır (iyi / uyarı / kötü) ama ton tek başına
 * bilgi taşımaz: kart her zaman değeri de yazar. Renk körü bir kullanıcı için
 * yalnızca renkle anlatılan bir sağlık göstergesi hiçbir şey söylemezdi.
 */

import type { SimulationResults } from "../types/simulationTypes";
import { flowTotals, REJECT_WARNING, SCRAP_WARNING } from "./actionItems";

export type HealthTone = "good" | "warning" | "bad";

export interface HealthIndicator {
  id: string;
  label: string;
  value: string;
  tone: HealthTone;
  hint: string;
}

/**
 * İstasyon dolulukları arasındaki fark (0-1).
 *
 * Dengeli bir hatta istasyonlar birbirine yakın doludur. Büyük fark, bazı
 * istasyonların boş beklerken bir tanesinin tıkandığını gösterir — kapasitenin
 * yanlış dağıtıldığının işaretidir.
 *
 * Tek istasyonlu bir hatta fark tanımsızdır ve `null` döner; sıfır dönmek
 * "mükemmel dengeli" gibi okunurdu.
 */
export function utilizationSpread(results: SimulationResults): number | null {
  const values = results.station_metrics.map((station) => station.utilization);
  if (values.length < 2) {
    return null;
  }
  return Math.max(...values) - Math.min(...values);
}

/** Dengesizliğin uyarı sayıldığı fark. */
export const SPREAD_WARNING = 0.4;

/**
 * Sağlık göstergelerini üretir.
 *
 * Koşum yoksa boş dizi döner; çağıran taraf bunun yerine bir boş durum
 * gösterir. Sıfırlarla dolu bir sağlık paneli, hattın gerçekten sıfır fire
 * ürettiği izlenimini verirdi.
 */
export function buildHealthIndicators(
  results: SimulationResults | null,
): HealthIndicator[] {
  if (!results) {
    return [];
  }

  const indicators: HealthIndicator[] = [
    {
      id: "stability",
      label: "Kararlılık",
      value: results.is_stable ? "Kararlı" : "Kararsız",
      tone: results.is_stable ? "good" : "bad",
      hint: "Kuyruklar sınırsız büyümüyorsa hat kararlıdır.",
    },
    {
      id: "validation",
      label: "Doğrulama",
      value: results.littles_law_validation.passed ? "Geçti" : "Geçmedi",
      tone: results.littles_law_validation.passed ? "good" : "warning",
      hint: "Little Yasası, koşumun kendi içinde tutarlı olup olmadığını denetler.",
    },
  ];

  const totals = flowTotals(results);
  if (totals.entered > 0) {
    const scrapRate = totals.scrapped / totals.entered;
    indicators.push({
      id: "scrap",
      label: "Fire oranı",
      value: `%${(scrapRate * 100).toFixed(1)}`,
      tone: scrapRate > SCRAP_WARNING ? "warning" : "good",
      hint: "İşlenmiş ama hurdaya ayrılmış parçaların payı.",
    });

    const rejectRate = totals.rejected / totals.entered;
    indicators.push({
      id: "rejected",
      label: "Tampon reddi",
      value: `%${(rejectRate * 100).toFixed(1)}`,
      tone: rejectRate > REJECT_WARNING ? "warning" : "good",
      hint: "Tampon dolu olduğu için istasyona hiç giremeyen parçaların payı.",
    });
  }

  const spread = utilizationSpread(results);
  if (spread !== null) {
    indicators.push({
      id: "balance",
      label: "Hat dengesi",
      value: `%${Math.round(spread * 100)} fark`,
      tone: spread > SPREAD_WARNING ? "warning" : "good",
      hint: "En dolu ve en boş istasyon arasındaki doluluk farkı; küçük olması dengeli bir hat demektir.",
    });
  }

  indicators.push({
    id: "replications",
    label: "Tekrar",
    value: `${results.num_replications}×`,
    tone: results.num_replications >= 20 ? "good" : "warning",
    hint: "Sonuç bu kadar bağımsız koşumun ortalamasıdır; daha çok tekrar, daha dar güven aralığı demektir.",
  });

  return indicators;
}
