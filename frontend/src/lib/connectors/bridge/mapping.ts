/**
 * Köprü olaylarının canlı üretim olaylarına çevrilmesi.
 *
 * `LiveDataProvider` sözleşmesi **değişmez**: canlı ekran bir olay akışı bekler
 * ve nereden geldiğini bilmez. Bu dosya, sunucudan gelen köprü olaylarını o
 * akışa çevirir.
 *
 * Neden çoğu olay çevrilmez
 * -------------------------
 * Köprünün bugün ürettiği olaylar bağlantının **kendi yaşam döngüsüne**
 * aittir: kayıt, deneme, yeniden deneme, kapanma. Bunlar bir istasyonun ne
 * yaptığını söylemez. Bir olayın canlı akışa girebilmesi için cihazdan gelen
 * gerçek bir ölçüm taşıması gerekir: istasyon kimliği ve bir değer.
 *
 * Bu yüzden çevirici, alanları eksik olan her olayı **sessizce atar** ve boş
 * liste döner. Eksik alanları tahmin etseydi (ör. istasyon kimliği yoksa ilk
 * istasyonu seçmek), canlı ekranda hiç olmamış bir üretim görünürdü.
 */

import type { LiveEvent } from "../../live";
import type { BridgeEvent } from "./types";

/** Cihaz ölçümü taşıyan olay türü. */
export const DEVICE_EVENT_KIND = "device_data";

export interface MappingOptions {
  /** Modeldeki istasyon kimlikleri; listede olmayan istasyon yok sayılır. */
  knownStationIds: string[];
  /** Akışın başladığı an; dakika hesabı buna göre yapılır. */
  startedAtMs: number;
  /**
   * Kümülatif sayaçların takipçisi.
   *
   * Cihazların üretim ve fire sayaçları **kümülatiftir** (vardiya başından
   * beri 1240 parça). Canlı ekranın sayacı ise "bağlandığımdan beri" demektir
   * ve gelen her olayı toplar. Takipçi verilmezse bu iki sayaç çevrilmez —
   * tarayıcıda görüldü ki çevrildiğinde ekran, gerçekte 162 parça üretilmişken
   * 4968 gösteriyor.
   */
  counters?: CumulativeCounters;
}

/**
 * Kümülatif sayaçlardan artış çıkarır.
 *
 * İlk okuma artış üretmez: taban bilinmeden kaç parça üretildiği bilinemez ve
 * sayacın tamamını üretim saymak, ekranda hiç olmamış bir patlama gösterirdi.
 * Sayaç geri giderse (vardiya değişimi, PLC yeniden başlatma) artış yine
 * üretilmez; yeni değer taban kabul edilir.
 */
export class CumulativeCounters {
  private readonly last = new Map<string, number>();

  /** Artış; hesaplanamıyorsa `null`. */
  delta(key: string, value: number): number | null {
    const previous = this.last.get(key);
    this.last.set(key, value);

    if (previous === undefined) {
      return null;
    }
    if (value < previous) {
      return null;
    }
    return value - previous;
  }

  /** Bilinen taban değerleri; sorun ararken kullanılır. */
  get trackedCount(): number {
    return this.last.size;
  }

  reset(): void {
    this.last.clear();
  }
}

function minutesSince(atMs: number, startedAtMs: number): number {
  return Math.max(0, (atMs - startedAtMs) / 60_000);
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function numberField(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Olayın taşıdığı makine kimliğini modeldeki istasyona eşler.
 *
 * Karşılaştırma büyük/küçük harfe duyarsızdır: PLC "TORNA_01" yazar, modelde
 * "torna_01" durur. Eşleşme yoksa `null` döner ve olay canlı akışa girmez —
 * bunun yerine eşleme uyarısı üretilir (bkz. `unmappedMachines`).
 */
export function matchStation(
  machineId: string,
  knownStationIds: string[],
): string | null {
  const target = machineId.trim().toLocaleLowerCase("tr-TR");
  return (
    knownStationIds.find(
      (station) => station.trim().toLocaleLowerCase("tr-TR") === target,
    ) ?? null
  );
}

/**
 * Ölçüm tabanlı cihaz olayını canlı olaylara çevirir.
 *
 * Sunucu boru hattı her ölçümü ayrı bir olay olarak gönderir
 * (`{machine_id, metric, value}`). Ölçüm türü canlı ekranın olay türüne burada
 * eşlenir; tanınmayan bir ölçüm **sessizce atılmaz**, çeviri yapılamadığı için
 * boş liste döner ve eşleme doğrulaması bunu ayrıca bildirir.
 */
function fromMetricEvent(
  event: BridgeEvent,
  options: MappingOptions,
): LiveEvent[] {
  const machineId = stringField(event.data, "machine_id");
  const metric = stringField(event.data, "metric");
  if (machineId === null || metric === null) {
    return [];
  }

  const stationId = matchStation(machineId, options.knownStationIds);
  if (stationId === null) {
    return [];
  }

  const atMinutes = minutesSince(event.atMs, options.startedAtMs);
  const numeric = numberField(event.data, "value");
  const text = stringField(event.data, "value");

  if (metric === "production_count" && numeric !== null) {
    /*
     * Kümülatif sayaçtan artış çıkarılır. Takipçi yoksa hiçbir şey üretilmez:
     * mutlak değeri üretim saymak, ekranda hiç olmamış parçalar gösterirdi.
     *
     * Anahtar **kaynağı da içerir**. Tarayıcıda görüldü: aynı istasyona iki
     * bağlantı (OPC UA 1100, MQTT 200) yazdığında tek anahtarlı takipçi her
     * geçişte yüzlerce parçalık sahte artış üretiyordu. Her kaynak kendi
     * sayacıyla ölçülür; iki kaynağın aynı metriği bildirmesi ayrıca uyarı
     * olarak gösterilir.
     */
    const delta =
      options.counters?.delta(
        `${stationId}::${event.connectionId}::production`,
        numeric,
      ) ?? null;
    return delta !== null && delta > 0
      ? [{ type: "part_completed", atMinutes, stationId, quantity: Math.round(delta) }]
      : [];
  }
  if (metric === "scrap_count" && numeric !== null) {
    const delta =
      options.counters?.delta(`${stationId}::${event.connectionId}::scrap`, numeric) ??
      null;
    return delta !== null && delta > 0
      ? [{ type: "part_scrapped", atMinutes, stationId, quantity: Math.round(delta) }]
      : [];
  }
  if (metric === "queue_length" && numeric !== null && numeric >= 0) {
    return [{ type: "queue_changed", atMinutes, stationId, queue: Math.round(numeric) }];
  }
  if (metric === "oee" && numeric !== null && numeric >= 0 && numeric <= 1) {
    return [{ type: "oee_sampled", atMinutes, stationId, oee: numeric }];
  }
  if (metric === "machine_status" && text !== null) {
    /*
     * Duruş bir arıza olayına, çalışma bir onarım olayına çevrilir: canlı
     * ekranın durum modeli budur. Bilinmeyen bir durum çevrilmez — "bilinmiyor"
     * için bir olay üretmek, ekranda olmayan bir değişiklik gösterirdi.
     */
    if (text === "down") {
      return [
        { type: "machine_fault", atMinutes, stationId, reason: "Cihaz duruş bildirdi" },
      ];
    }
    if (text === "running") {
      return [{ type: "machine_repaired", atMinutes, stationId }];
    }
    if (text === "setup") {
      return [{ type: "setup_started", atMinutes, stationId, product: "—" }];
    }
    return [];
  }

  return [];
}

/**
 * Tek bir köprü olayını canlı olaylara çevirir.
 *
 * İki biçim desteklenir: sunucu boru hattının ölçüm tabanlı olayları
 * (`metric` alanı taşır) ve doğrudan alan taşıyan eski biçim. İkisinin de
 * ortak kuralı aynıdır — eksik alan tahmin edilmez, çevrilemeyen olay boş
 * liste döndürür.
 */
export function toLiveEvents(
  event: BridgeEvent,
  options: MappingOptions,
): LiveEvent[] {
  if (event.kind !== DEVICE_EVENT_KIND) {
    return [];
  }

  if (typeof event.data.metric === "string") {
    return fromMetricEvent(event, options);
  }

  const stationId = stringField(event.data, "station_id");
  if (stationId === null || !options.knownStationIds.includes(stationId)) {
    return [];
  }

  const atMinutes = minutesSince(event.atMs, options.startedAtMs);
  const events: LiveEvent[] = [];

  const produced = numberField(event.data, "produced");
  if (produced !== null && produced > 0) {
    events.push({
      type: "part_completed",
      atMinutes,
      stationId,
      quantity: Math.round(produced),
    });
  }

  const scrapped = numberField(event.data, "scrapped");
  if (scrapped !== null && scrapped > 0) {
    events.push({
      type: "part_scrapped",
      atMinutes,
      stationId,
      quantity: Math.round(scrapped),
    });
  }

  const queue = numberField(event.data, "queue");
  if (queue !== null && queue >= 0) {
    events.push({ type: "queue_changed", atMinutes, stationId, queue: Math.round(queue) });
  }

  const oee = numberField(event.data, "oee");
  if (oee !== null && oee >= 0 && oee <= 1) {
    events.push({ type: "oee_sampled", atMinutes, stationId, oee });
  }

  const fault = stringField(event.data, "fault");
  if (fault !== null) {
    events.push({ type: "machine_fault", atMinutes, stationId, reason: fault });
  }

  if (event.data.repaired === true) {
    events.push({ type: "machine_repaired", atMinutes, stationId });
  }

  return events;
}

/** Olay listesini toplu çevirir. */
export function toLiveEventStream(
  events: BridgeEvent[],
  options: MappingOptions,
): LiveEvent[] {
  return events.flatMap((event) => toLiveEvents(event, options));
}

/**
 * Bir köprü olayının kullanıcıya gösterilecek özeti.
 *
 * Canlı akışa girmeyen olaylar da (deneme, yeniden deneme) bir yerde
 * görünmelidir: bağlantının neden veri getirmediği çoğu zaman buradadır.
 */
export function describeBridgeEvent(event: BridgeEvent): string {
  const evidence = event.data.evidence;
  if (typeof evidence === "string" && evidence !== "") {
    return `${event.message} — ${evidence}`;
  }
  return event.message;
}

/** Olayın taşıdığı ölçülen gecikme; yoksa `null`. */
export function latencyOf(event: BridgeEvent): number | null {
  return numberField(event.data, "latency_ms");
}

/**
 * Canlı akışa giremeyen makineler.
 *
 * Verisi gelen ama modelde karşılığı olmayan bir makine sessizce geçilmez:
 * "sistem çalışıyor ama ekranda hiçbir şey değişmiyor" şikâyetinin en sık
 * nedeni budur ve arayüz bunu uyarı olarak gösterir.
 */
export function unmappedMachines(
  events: BridgeEvent[],
  knownStationIds: string[],
): string[] {
  const unmatched = new Set<string>();
  for (const event of events) {
    if (event.kind !== DEVICE_EVENT_KIND) {
      continue;
    }
    const machineId = stringField(event.data, "machine_id");
    if (machineId !== null && matchStation(machineId, knownStationIds) === null) {
      unmatched.add(machineId);
    }
  }
  return [...unmatched].sort();
}
