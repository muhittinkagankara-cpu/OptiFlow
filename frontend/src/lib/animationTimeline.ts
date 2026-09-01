/**
 * Olay izini animasyon zaman çizelgesine çevirir.
 *
 * Backend, ne olduğunu **anlık olaylar** olarak bildirir ("t=8.77'de parça 1
 * kesimde işleme girdi"). Animasyonun ihtiyacı ise farklıdır: herhangi bir
 * `t` anında her parçanın **nerede olduğunu** bilmek gerekir. Bu dosya iki
 * temsil arasındaki köprüdür: olayları, başlangıç ve bitiş zamanı olan
 * "evrelere" (phase) dönüştürür.
 *
 * Mantık bileşenden ayrı tutulur çünkü sessizce yanlış olabilir: bir evrenin
 * bitiş zamanı yanlış hesaplanırsa parçalar ekranda takılı kalır ya da
 * kaybolur, ve bu hata ancak animasyon izlenirken fark edilir. Saf fonksiyon
 * olarak birim testiyle doğrulanabilir.
 */

import type { SimulationEvent, SimulationTrace } from "../types/simulationTypes";

/** Bir parçanın belirli bir zaman aralığındaki durumu. */
export type PhaseKind = "travel" | "queued" | "service" | "blocked";

export interface EntityPhase {
  entityId: string;
  kind: PhaseKind;
  /** Evrenin başladığı simülasyon dakikası. */
  start: number;
  /** Evrenin bittiği an. Parçanın son evresi izin sonuna kadar sürer. */
  end: number;
  /**
   * `travel` evresinde yolculuğun başladığı istasyon; `null` ise parça
   * sisteme dışarıdan giriyordur.
   */
  fromStation: string | null;
  /**
   * `travel` evresinde varılacak istasyon (`null` ise sistemden çıkış).
   * Diğer evrelerde parçanın bulunduğu istasyon.
   */
  toStation: string | null;
}

/** Belirli bir anda ekranda görünen bir parça. */
export interface ActiveEntity {
  entityId: string;
  kind: PhaseKind;
  /** İstasyon kimliği; `travel` evresinde `null`. */
  stationId: string | null;
  fromStation: string | null;
  toStation: string | null;
  /** `travel` evresinde yolun ne kadarının katedildiği (0-1). */
  progress: number;
  /**
   * Parçanın, aynı istasyonda aynı durumu paylaşan parçalar arasındaki sırası
   * (0 = en önde). Kuyruk için bekleme sırası, işlem için hangi paralel
   * makinenin kullanıldığıdır. Üst üste değil yan yana çizilebilmesi için
   * gerekir.
   */
  queueIndex: number;
  /**
   * Aynı gruptaki toplam parça sayısı.
   *
   * Çizim tarafı, işlemdeki parçaları istasyon kutusunun içine ortalayabilmek
   * için grubun kaç kişilik olduğunu bilmek zorundadır; yalnızca sıra numarası
   * verilseydi parçalar kutunun merkezinden sağa doğru kayardı.
   */
  groupSize: number;
}

/**
 * Olay türünün hangi evreyi başlattığı.
 *
 * `queue_exit` bilinçli olarak listede yoktur: motor bu olayı her zaman aynı
 * zaman damgasıyla bir `service_start` olayının hemen öncesinde üretir, yani
 * sıfır uzunlukta bir evre olurdu. Kendi evresi olarak ele alınsaydı, parça
 * bir kare boyunca "hiçbir yerde" görünürdü.
 */
const PHASE_STARTING_EVENTS: Record<string, PhaseKind | null> = {
  arrival: "travel",
  queue_enter: "queued",
  queue_exit: null,
  service_start: "service",
  service_end: "travel",
  blocked: "blocked",
  system_exit: null,
};

/**
 * Olayları parça bazında evrelere böler.
 *
 * Her olay bir evre başlatır ve o evre, aynı parçanın **bir sonraki** olayına
 * kadar sürer. Bir parçanın son olayı `system_exit` ise parça sahneden çıkar;
 * değilse (iz penceresi parçanın ortasında bittiyse) parça izin sonuna kadar
 * son durumunda kalır — aksi hâlde pencere sonuna doğru parçalar sebepsizce
 * yok olurdu.
 */
export function buildPhases(trace: SimulationTrace): EntityPhase[] {
  const byEntity = new Map<string, SimulationEvent[]>();
  for (const event of trace.events) {
    const list = byEntity.get(event.entity_id);
    if (list) {
      list.push(event);
    } else {
      byEntity.set(event.entity_id, [event]);
    }
  }

  const phases: EntityPhase[] = [];
  for (const [entityId, events] of byEntity) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const kind = PHASE_STARTING_EVENTS[event.event_type];
      if (!kind) {
        continue;
      }

      const next = findNextPhaseEvent(events, index);
      const end = next ? next.timestamp : trace.duration_minutes;
      // Sıfır uzunluklu evreler çizilemez ve yalnızca gürültü yaratır
      // (ör. işlem bitişiyle aynı anda gelen blokaj).
      if (end <= event.timestamp) {
        continue;
      }

      phases.push({
        entityId,
        kind,
        start: event.timestamp,
        end,
        fromStation: kind === "travel" ? event.station_id : null,
        toStation: kind === "travel" ? travelDestination(next) : event.station_id,
      });
    }
  }

  phases.sort((first, second) => first.start - second.start);
  return phases;
}

/**
 * Bir yolculuk evresinin varış noktasını belirler.
 *
 * `system_exit` olayı, parçanın **ayrıldığı** istasyonu taşır; varmak istediği
 * yeri değil. Bu alan olduğu gibi hedef sayılsaydı parça A'dan yine A'ya
 * gidiyormuş gibi çizilir ve sistemden ayrıldığı hiç görünmezdi. Sistemden
 * çıkışta hedef yoktur: parça sahnenin dışına doğru hareket eder.
 */
function travelDestination(next: SimulationEvent | null): string | null {
  if (!next || next.event_type === "system_exit") {
    return null;
  }
  return next.station_id;
}

/** Bir olaydan sonraki, evre sınırı oluşturan ilk olayı bulur. */
function findNextPhaseEvent(
  events: SimulationEvent[],
  index: number,
): SimulationEvent | null {
  for (let next = index + 1; next < events.length; next += 1) {
    if (events[next].event_type !== "queue_exit") {
      return events[next];
    }
  }
  return null;
}

/**
 * Verilen anda ekranda görünen parçaları döndürür.
 *
 * Aynı istasyonu paylaşan parçalar başlangıç zamanına göre sıralanır: önce
 * gelen öne çizilir. Motor FIFO çalıştığı için bu sıra, gerçek hizmet
 * sırasıyla aynıdır.
 */
export function entitiesAt(phases: EntityPhase[], time: number): ActiveEntity[] {
  const active: ActiveEntity[] = [];
  // Aynı istasyonda aynı anda birden fazla parça bulunabilir: kuyrukta
  // bekleyenler ve — istasyonun paralel makinesi varsa — aynı anda işlem
  // görenler. İkisi de gruplanır, çünkü gruplanmayan parçalar tek bir noktaya
  // üst üste çizilir ve kullanıcı üç meşgul makineyi tek parça sanır.
  const groups = new Map<string, EntityPhase[]>();

  for (const phase of phases) {
    // Evreler başlangıca göre sıralı; bu noktadan sonrası gelecekte.
    if (phase.start > time) {
      break;
    }
    if (phase.end <= time) {
      continue;
    }

    if (phase.kind !== "travel" && phase.toStation) {
      // Bloke parçalar da kutunun içinde durur; işlemdekilerle aynı grupta
      // toplanmazsa onların üstüne çizilirler.
      const key = phase.kind === "queued" ? `q:${phase.toStation}` : `s:${phase.toStation}`;
      const group = groups.get(key);
      if (group) {
        group.push(phase);
      } else {
        groups.set(key, [phase]);
      }
      continue;
    }

    active.push({
      entityId: phase.entityId,
      kind: phase.kind,
      stationId: null,
      fromStation: phase.fromStation,
      toStation: phase.toStation,
      progress: clamp((time - phase.start) / (phase.end - phase.start), 0, 1),
      queueIndex: 0,
      groupSize: 1,
    });
  }

  for (const [key, group] of groups) {
    const stationId = key.slice(2);
    group.sort((first, second) => first.start - second.start);
    group.forEach((phase, position) => {
      active.push({
        entityId: phase.entityId,
        kind: phase.kind,
        stationId,
        fromStation: null,
        toStation: stationId,
        progress: 0,
        queueIndex: position,
        groupSize: group.length,
      });
    });
  }

  return active;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * İzin özetini çıkarır: kaç parça, kaç blokaj, en yoğun kuyruk.
 *
 * Animasyonun altında gösterilir; kullanıcı izlemeden önce ne göreceğini bilir.
 */
export interface TraceSummary {
  entityCount: number;
  blockedEvents: number;
  /** Aynı anda kuyrukta en çok parça biriken istasyon. */
  busiestStationId: string | null;
  peakQueueLength: number;
}

export function summarizeTrace(trace: SimulationTrace, phases: EntityPhase[]): TraceSummary {
  const entityCount = new Set(trace.events.map((event) => event.entity_id)).size;
  const blockedEvents = trace.events.filter(
    (event) => event.event_type === "blocked",
  ).length;

  // Kuyruk uzunluğunun tepe noktası, kuyruğa giriş ve çıkışları zaman
  // sırasında tarayarak bulunur; her evre bir giriş ve bir çıkış üretir.
  const deltas: Array<{ time: number; station: string; change: number }> = [];
  for (const phase of phases) {
    if (phase.kind !== "queued" || !phase.toStation) {
      continue;
    }
    deltas.push({ time: phase.start, station: phase.toStation, change: 1 });
    deltas.push({ time: phase.end, station: phase.toStation, change: -1 });
  }
  deltas.sort((first, second) => first.time - second.time);

  const current = new Map<string, number>();
  let peakQueueLength = 0;
  let busiestStationId: string | null = null;
  for (const delta of deltas) {
    const next = (current.get(delta.station) ?? 0) + delta.change;
    current.set(delta.station, next);
    if (next > peakQueueLength) {
      peakQueueLength = next;
      busiestStationId = delta.station;
    }
  }

  return { entityCount, blockedEvents, busiestStationId, peakQueueLength };
}
