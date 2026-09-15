/**
 * Kısıt şeridinin veri modeli (MASTER §15).
 *
 * Şerit istasyonları sonuç verisinden okur; sıra, koşumun döndürdüğü sıradır.
 * Hiçbir istasyon, oran ya da durum üretilmez — hepsi `station_metrics`
 * içinde ölçülmüş olarak gelir.
 */

import type { SimulationResults } from "../../types/simulationTypes";
/*
 * Eşikler `lib/actionItems`'tan **içe aktarılır**, burada yeniden
 * tanımlanmaz. İkinci bir eşik seti, aynı istasyon için şeritte bir renk,
 * yapılacaklar listesinde başka bir renk demek olurdu.
 */
import { BOTTLENECK_CRITICAL, BOTTLENECK_WARNING } from "../actionItems";
import type { MeasuredState } from "../ui";
import type { RailStation } from "./types";

/** Doluluğu ölçülmüş durum rengine çevirir. */
export function utilizationState(utilization: number): MeasuredState {
  if (utilization >= BOTTLENECK_CRITICAL) {
    return "fault";
  }
  if (utilization >= BOTTLENECK_WARNING) {
    return "warn";
  }
  return "ok";
}

/**
 * Şerit için istasyon listesi.
 *
 * Koşum yoksa boş dizi döner ve şerit hiç çizilmez; boş bir şerit çizmek,
 * ölçülmemiş bir hattı ölçülmüş gibi gösterirdi.
 */
export function railStations(
  results: SimulationResults | null,
): RailStation[] {
  if (results === null) {
    return [];
  }
  return results.station_metrics.map((station) => ({
    id: station.station_id,
    label: station.station_name,
    share: station.utilization,
    value: `%${Math.round(station.utilization * 100)}`,
    state: utilizationState(station.utilization),
    isConstraint: station.station_id === results.bottleneck_station_id,
  }));
}
