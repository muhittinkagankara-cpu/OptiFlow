/**
 * Kısıt şeridinin canlı veri karşılığı (Sprint 2I-B).
 *
 * Paylaşılan `ConstraintRail` bileşeni **çatallanmadı**; bu dosya yalnızca
 * canlı istasyonları o bileşenin beklediği alanlara çevirir.
 *
 * ## Genişlik neyi kodlar? (Anayasa V4)
 *
 * Şeridin verdiği söz şudur: **en geniş segment kısıttır.** Bu söz ancak
 * genişlik, o varyantta kısıtı belirleyen ölçümle aynı olduğunda doğrudur.
 *
 * Canlı varyantta kısıtı belirleyen ölçüm **kuyruktur**: `bottleneckStationId`
 * kuyruğu diğerlerinin hepsinden uzun olan istasyonu işaretler. `share` bu
 * yüzden kuyruk payıdır.
 *
 * Bu, iki kez tartışılmış bir karardır. Sprint 2I-B.3'te segmentler eşit
 * genişliğe çekilmişti; gerekçe, MASTER §15.4'ün "genişlik her varyantta
 * ölçülmüş doluluğu kodlar" kuralıydı ve `StationLiveState` doluluk taşımıyor.
 * Anayasa V4 kuralı canlı varyant için yeniden yazdı: genişlik **kısıtı
 * belirleyen ölçümü** kodlar; doluluk taşıyan ekranlarda bu doluluktur, canlı
 * ekranda kuyruktur. MASTER §15.4 buna göre güncellendi, böylece iki belge
 * birbiriyle çelişmez.
 *
 * Eşit genişlik yalnızca **kuyruk da yokken** devreye girer: hiç kuyruk yoksa
 * bütün paylar 0 olur ve bileşen taban payıyla (`MIN_GROW`) hepsini eşit
 * çizer. Sıfır kuyruk "ölçülmedi" değil, gerçekten sıfırdır.
 *
 * Doluluk yine de **türetilmez**: `onlineMachines / machineCount` gibi bir
 * oran üretip ona "doluluk" demek, ölçülmemiş bir büyüklüğe ölçülmüş bir ad
 * vermek olurdu (Yasa 4).
 *
 * ## Renk
 *
 * Renk yalnızca **ölçülmüş** istasyon durumundan gelir; yeni bir eşik ya da
 * yeni bir renk sistemi tanımlanmaz. Arıza `fault`, geri kalan çalışma
 * biçimleri `ok`'tur — kuyruk uzunluğu için canlı tarafta tanımlı bir renk
 * eşiği yoktur ve burada icat edilmez. Kısıt zaten üç sinyalle işaretlenir:
 * genişlik, kelepçe ve yazılı "KISIT" etiketi.
 */

import type { ConstraintRailStation } from "../../components/ui/ConstraintRail";
import type { MeasuredState } from "../ui";
import { bottleneckStationId } from "./state";
import type { MachineStatus, StationLiveState } from "./types";

/** Ölçülmüş makine durumunun şerit rengi. */
export function stationState(status: MachineStatus): MeasuredState {
  return status === "fault" ? "fault" : "ok";
}

/**
 * Şerit için canlı istasyon listesi.
 *
 * İstasyon yoksa boş dizi döner ve şerit hiç çizilmez.
 */
export function liveRailStations(
  stations: StationLiveState[],
): ConstraintRailStation[] {
  if (stations.length === 0) {
    return [];
  }

  const constraintId = bottleneckStationId(stations);
  const longest = stations.reduce(
    (max, station) => Math.max(max, station.queue),
    0,
  );

  return stations.map((station) => ({
    id: station.stationId,
    label: station.stationName,
    /* Pay, hattın en uzun kuyruğuna göre okunur. Hiç kuyruk yoksa hepsi 0
       olur ve `ConstraintRail` taban payıyla segmentleri eşitler. */
    share: longest > 0 ? station.queue / longest : 0,
    value: `${station.queue} parça`,
    state: stationState(station.status),
    /* Kısıt yetkisi değişmedi: hâlâ `bottleneckStationId`. */
    isConstraint: station.stationId === constraintId,
  }));
}
