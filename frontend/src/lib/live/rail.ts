/**
 * Kısıt şeridinin canlı veri karşılığı (Sprint 2I-B).
 *
 * Paylaşılan `ConstraintRail` bileşeni **çatallanmadı**; bu dosya yalnızca
 * canlı istasyonları o bileşenin beklediği alanlara çevirir.
 *
 * ## Segmentler neden eşit genişlikte? (Sprint 2I-B.3)
 *
 * Şeridin görsel dilinde **genişlik tek bir şeyi kodlar: ölçülmüş doluluk**
 * (MASTER §15.4). Bu kural varyanttan bağımsızdır; şeridin değeri tam olarak
 * dört ekranda aynı şeyi söylemesinden gelir.
 *
 * `StationLiveState` doluluk taşımıyor. 2I-B'de genişliği kuyruktan almıştım:
 * "en geniş segment kısıttır" sözünü korumak için doğru göründü, ama yanlıştı
 * — kuyruk doluluk değildir ve kuyruğu genişliğe çevirmek, ölçülmemiş bir
 * büyüklüğü ölçülmüş doluluk gibi göstermek anlamına geliyordu. Sekiz parçalık
 * bir kuyruk, o istasyonun %100 dolu olduğunu söylemez.
 *
 * MASTER §15.5'in bu duruma verdiği yanıt uygulandı: **doluluk ölçülmemişse
 * segmentler eşit genişlikte çizilir.** `share` bu yüzden her istasyonda 0'dır
 * — bileşen taban payını (`MIN_GROW`) uygulayınca segmentler eşitlenir ve dar
 * ekrandaki dolgu çubuğu boş kalır: ölçülmeyen doluluk için hiçbir şey iddia
 * edilmez (Yasa 4).
 *
 * Kuyruk kaybolmaz; **yazıyla** taşınır (`value`) ve kısıt yetkisi hâlâ ona
 * bakar. Yani kuyruk ölçüm olarak durur, genişlik olarak durmaz.
 *
 * Doluluk türetilmez: `onlineMachines / machineCount` ya da kuyruktan,
 * çevrimden, throughput'tan bir oran üretip ona "doluluk" demek, ölçülmemiş
 * bir büyüklüğe ölçülmüş bir ad vermek olurdu.
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

  return stations.map((station) => ({
    id: station.stationId,
    label: station.stationName,
    /* Doluluk ölçülmüyor: pay her istasyonda 0, segmentler eşit genişlikte
       (MASTER §15.5). Kuyruk `value` alanında yazıyla taşınır. */
    share: 0,
    value: `${station.queue} parça`,
    state: stationState(station.status),
    /* Kısıt yetkisi değişmedi: hâlâ `bottleneckStationId`. */
    isConstraint: station.stationId === constraintId,
  }));
}
