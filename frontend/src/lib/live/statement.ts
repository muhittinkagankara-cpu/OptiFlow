/**
 * Canlı hattın açılış cümlesi (Sprint 2I-B, Yasa 1).
 *
 * Ekran bugüne kadar bir kontrol şeridiyle açılıyordu: bağlantı çipi, kaynak
 * seçici, senaryo seçici. Hiçbiri hattın **ne yaptığını** söylemiyordu. Bu
 * dosya o cümleyi kurar.
 *
 * ## Burada hiçbir şey hesaplanmaz
 *
 * Kısıt zaten `bottleneckStationId()` tarafından belirleniyor (kuyruğu
 * diğerlerinin hepsinden uzun olan istasyon; eşitlikte `null`). Cümle o
 * yetkiyi okur, ikinci bir kısıt tanımı üretmez. Kuyruk, istasyon adı ve
 * durum alanlarının hepsi `StationLiveState` içinde ölçülmüş olarak gelir.
 *
 * ## Yazılmayanlar
 *
 * "Kritik", "acil", "performans düştü", "kapasite kaybı" ya da herhangi bir
 * para tutarı **yazılmaz**: canlı durumda bunların hiçbirini destekleyen
 * ölçüm yok. Kısıt bilinmiyorsa cümle bunu açıkça söyler; bir istasyon o role
 * zorlanmaz (Yasa 4).
 */

import { bottleneckStationId } from "./state";
import { STATUS_LABEL, type StationLiveState } from "./types";

export interface LiveStatement {
  /** Ekranın en büyük yazısı. */
  headline: string;
  /** Cümleyi ölçümle destekleyen ikinci satır; yoksa `null`. */
  detail: string | null;
  /**
   * Cümlenin hangi ölçümden geldiği.
   *
   * `constraint`: kısıt yetkisi bir istasyon işaretledi.
   * `fault`: kısıt yok ama en az bir istasyon arızada.
   * `monitoring`: ölçülmüş bir öne çıkan durum yok.
   */
  source: "constraint" | "fault" | "monitoring";
}

/**
 * Canlı durumdan tek cümle üretir.
 *
 * İstasyon yoksa `null` döner ve çağıran hiçbir şey çizmez: henüz hiçbir şey
 * ölçülmemişken "hat izleniyor" demek, olmayan bir akışı varmış gibi
 * göstermek olurdu.
 */
export function liveStatement(
  stations: StationLiveState[],
): LiveStatement | null {
  if (stations.length === 0) {
    return null;
  }

  /* Önce kısıt: hattın çıktısını sınırlayan tek halka, ürünün merkezindeki
     kavramdır ve arızalı bir istasyonun kuyruğu zaten büyüyüp onu kısıt
     hâline getirir. */
  const constraintId = bottleneckStationId(stations);
  const constraint =
    constraintId === null
      ? null
      : (stations.find((s) => s.stationId === constraintId) ?? null);

  if (constraint !== null) {
    return {
      headline: `Şu anda hattı ${constraint.stationName} kısıtlıyor.`,
      detail: `Önünde ${constraint.queue} parça bekliyor · ${STATUS_LABEL[constraint.status]}`,
      source: "constraint",
    };
  }

  /* Kısıt yoksa ölçülmüş ikinci durum arızadır. `status` cihazdan/senaryodan
     gelen bir alandır; burada türetilmez. */
  const faulty = stations.filter((station) => station.status === "fault");
  if (faulty.length > 0) {
    const names = faulty.map((station) => station.stationName).join(", ");
    const first = faulty[0];
    return {
      headline:
        faulty.length === 1
          ? `${first.stationName} istasyonunda arıza var.`
          : `${faulty.length} istasyonda arıza var.`,
      /* Arıza nedeni yalnızca sağlayıcı verdiyse yazılır; uydurulmaz. */
      detail:
        faulty.length === 1 && first.faultReason !== null
          ? first.faultReason
          : names,
      source: "fault",
    };
  }

  return {
    headline: "Canlı hat durumu izleniyor; belirlenmiş bir kısıt yok.",
    detail: null,
    source: "monitoring",
  };
}
