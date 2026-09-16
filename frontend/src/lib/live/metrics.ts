/**
 * Canlı ölçüm şeridi (Sprint 2I-B, Yasa 2).
 *
 * Çıplak metrik yasaktır: her değer bir **sonuç** satırı taşır. Ama sonuç da
 * uydurulmaz — ölçülmüş bir karşılığı olmayan metriğin sonuç satırı `null`
 * kalır ve `MetricGroup` o satıra hiçbir şey yazmaz (Yasa 4).
 *
 * ## Hangi sonuç nereden geliyor?
 *
 * - **Throughput** → kısıt istasyonu. Hattın çıktısını sınırlayan halkanın adı,
 *   çıktı rakamının doğrudan sonucudur.
 * - **OEE** → kısıt istasyonunun kendi OEE'si. Hat ortalaması tek başına
 *   nereye bakılacağını söylemez.
 * - **Kuyruk** → kuyruğun nerede biriktiği (kısıt istasyonu ve payı).
 * - **Açık alarm** → kaç istasyonda açık olduğu.
 *
 * Kısıt yoksa bu satırların hiçbiri yazılmaz; bir istasyon o role zorlanmaz.
 *
 * ## Yazılmayanlar
 *
 * "Kapasite kaybı", "finansal kayıp", "beklenen kazanç" gibi büyüklükler canlı
 * durumda hesaplanmıyor ve burada üretilmez.
 *
 * ## Benzetim / gerçek ayrımı
 *
 * Bu dosya **kaynak etiketi yazmaz**. Verinin nereden geldiği ekranın en
 * üstündeki kalıcı köken şeridinde ve `LiveKpiPanel`'in kendi kart altı
 * etiketlerinde zaten söyleniyor; üçüncü bir yerde tekrar etmek, ayrışma
 * riskini artırmaktan başka bir şey yapmazdı.
 */

import type { MetricItem } from "../../components/ui/MetricGroup";
import { formatDecimal } from "../resultsFormatting";
import { bottleneckStationId } from "./state";
import type { LiveTotals, StationLiveState } from "./types";

/** Ölçülemeyen değer "—" olur; sıfıra düşürülmez. */
function measured(
  value: number | null,
  render: (value: number) => string,
): string | null {
  return value !== null && Number.isFinite(value) ? render(value) : null;
}

export function liveMetrics(
  stations: StationLiveState[],
  totals: LiveTotals,
): MetricItem[] {
  const constraintId = bottleneckStationId(stations);
  const constraint =
    constraintId === null
      ? null
      : (stations.find((s) => s.stationId === constraintId) ?? null);

  const alarmStations = new Set(
    stations.filter((station) => station.status === "fault").map((s) => s.stationId),
  );

  return [
    {
      id: "throughput",
      label: "Throughput",
      value: measured(
        totals.throughputPerMinute,
        (v) => `${formatDecimal(v, 1)} parça/dk`,
      ),
      consequence:
        constraint === null ? null : `Kısıt ${constraint.stationName}`,
      emptyReason: "Henüz ölçülecek üretim yok",
    },
    {
      id: "oee",
      label: "Hat OEE",
      value: measured(totals.oee, (v) => `%${Math.round(v * 100)}`),
      /* Kısıt istasyonunun kendi OEE'si; hat ortalaması nereye bakılacağını
         söylemez. Değer istasyonun ölçülmüş alanından gelir. */
      consequence:
        constraint === null
          ? null
          : `${constraint.stationName} %${Math.round(constraint.oee * 100)}`,
      emptyReason: "İstasyon yok",
    },
    {
      id: "queue",
      label: "Kuyruk",
      value: `${totals.totalQueue} parça`,
      consequence:
        constraint === null
          ? null
          : `${constraint.queue} parçası ${constraint.stationName} önünde`,
    },
    {
      id: "alarms",
      label: "Açık alarm",
      value: `${totals.openAlarms}`,
      consequence:
        alarmStations.size > 0
          ? `${alarmStations.size} istasyon arızada`
          : `${totals.runningStations}/${stations.length} istasyon çalışıyor`,
    },
  ];
}
