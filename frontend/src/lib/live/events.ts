/**
 * Canlı olaylar ve bunları hattın durumuna uygulayan saf indirgeyici.
 *
 * Sahada olan her şey bir **olaydır**: makine başladı, kuyruk büyüdü, parça
 * bitti, arıza oldu, setup'a girildi. Durumu doğrudan değiştirmek yerine olay
 * üretmek bu sprintin asıl işidir — bugün olayları `DemoLiveProvider` üretiyor,
 * yarın OPC UA, Modbus TCP, MQTT ya da bir MES ucu üretecek ve `reduceLive`
 * satırı bile değişmeyecek.
 *
 * Zaman dışarıdan verilir (`atMinutes`). Saat burada okunsaydı işlev saf
 * olmaktan çıkar, testler çalıştıkları saate göre farklı sonuç verirdi.
 *
 * Tanınmayan istasyon kimliği hata değildir: durum sessizce olduğu gibi döner.
 * Gerçek bir MES bağlantısında başka bir hatta ait olay gelmesi olağandır ve
 * ekranın bu yüzden çökmemesi gerekir.
 */

import {
  QUEUE_WARNING,
  SCRAP_WARNING,
  ALARM_LIMIT,
  hasOpenAlarm,
  makeAlarm,
  queueAlarmFor,
  resolveAlarms,
} from "./alarms";
import type {
  Alarm,
  AlarmLevel,
  FeedEntry,
  LiveFactoryState,
  StationLiveState,
} from "./types";

/**
 * Akışta tutulan en fazla satır sayısı.
 *
 * Yüz satır, bir vardiyanın son yarım saatini kapsar ve kaydırılarak
 * okunabilir. Sınırsız bırakılsaydı sekiz saatlik bir vardiya on binlerce
 * satır biriktirir, bellek ve render maliyeti sürekli büyürdü.
 */
export const FEED_LIMIT = 100;

export type LiveEvent =
  | { type: "tick"; atMinutes: number }
  | {
      type: "station_started";
      atMinutes: number;
      stationId: string;
      operatorName?: string | null;
    }
  | { type: "station_idled"; atMinutes: number; stationId: string }
  | {
      type: "part_completed";
      atMinutes: number;
      stationId: string;
      quantity: number;
    }
  | {
      type: "part_scrapped";
      atMinutes: number;
      stationId: string;
      quantity: number;
    }
  | { type: "queue_changed"; atMinutes: number; stationId: string; queue: number }
  | {
      type: "machine_fault";
      atMinutes: number;
      stationId: string;
      reason: string;
    }
  | { type: "machine_repaired"; atMinutes: number; stationId: string }
  | {
      type: "setup_started";
      atMinutes: number;
      stationId: string;
      product: string;
    }
  | { type: "setup_finished"; atMinutes: number; stationId: string }
  | {
      type: "operator_assigned";
      atMinutes: number;
      stationId: string;
      operatorName: string;
    }
  | { type: "operator_released"; atMinutes: number; stationId: string }
  | { type: "oee_sampled"; atMinutes: number; stationId: string; oee: number };

/* -------------------------------------------------------------------------- */

/** Bir olayı duruma uygular ve **yeni** bir durum döner. */
export function reduceLive(
  state: LiveFactoryState,
  event: LiveEvent,
): LiveFactoryState {
  const clockMinutes = Math.max(state.clockMinutes, event.atMinutes);

  if (event.type === "tick") {
    return { ...state, clockMinutes, eventCount: state.eventCount + 1 };
  }

  const index = state.stations.findIndex(
    (station) => station.stationId === event.stationId,
  );
  if (index === -1) {
    // Başka bir hatta ait olay: sessizce geçilir, ekran çökmez.
    return state;
  }

  const before = state.stations[index];
  const outcome = applyToStation(before, event, state.alarms);

  const stations = [...state.stations];
  stations[index] = outcome.station;

  const feed = outcome.entry
    ? [outcome.entry, ...state.feed].slice(0, FEED_LIMIT)
    : state.feed;

  return {
    clockMinutes,
    stations,
    feed,
    alarms: outcome.alarms.slice(0, ALARM_LIMIT),
    eventCount: state.eventCount + 1,
  };
}

/** Olay dizisini sırayla uygular. */
export function reduceLiveMany(
  state: LiveFactoryState,
  events: LiveEvent[],
): LiveFactoryState {
  return events.reduce(reduceLive, state);
}

/* -------------------------------------------------------------------------- */

interface StationOutcome {
  station: StationLiveState;
  alarms: Alarm[];
  entry: FeedEntry | null;
}

function applyToStation(
  station: StationLiveState,
  event: Exclude<LiveEvent, { type: "tick" }>,
  alarms: Alarm[],
): StationOutcome {
  const at = event.atMinutes;

  switch (event.type) {
    case "station_started": {
      const next: StationLiveState = {
        ...station,
        // Arızalı ya da setup'taki bir makine "başladı" olayıyla üretime
        // dönmez; önce arıza giderilmeli ya da setup bitmelidir. Aksi hâlde
        // ekran, duran bir makineyi çalışıyor gösterirdi.
        status: station.status === "fault" || station.status === "setup"
          ? station.status
          : station.queue >= QUEUE_WARNING
            ? "queued"
            : "running",
        operatorName: event.operatorName ?? station.operatorName,
      };
      return {
        station: next,
        alarms,
        entry: feed(at, station, `${station.stationName} başladı.`, "info"),
      };
    }

    case "station_idled":
      return {
        station: { ...station, status: station.status === "fault" ? "fault" : "idle" },
        alarms,
        entry: feed(at, station, `${station.stationName} durdu.`, "info"),
      };

    case "part_completed": {
      const quantity = Math.max(0, Math.trunc(event.quantity));
      if (quantity === 0) {
        return { station, alarms, entry: null };
      }
      return {
        station: { ...station, completed: station.completed + quantity },
        alarms,
        entry: feed(
          at,
          station,
          `${station.stationName}: ${quantity} parça tamamlandı.`,
          "info",
        ),
      };
    }

    case "part_scrapped": {
      const quantity = Math.max(0, Math.trunc(event.quantity));
      if (quantity === 0) {
        return { station, alarms, entry: null };
      }
      const next = { ...station, scrapped: station.scrapped + quantity };
      const handled = next.completed + next.scrapped;
      const rate = handled > 0 ? next.scrapped / handled : 0;

      let nextAlarms = alarms;
      if (rate >= SCRAP_WARNING && !hasOpenAlarm(alarms, station.stationId, "scrap")) {
        nextAlarms = [
          makeAlarm(
            "scrap",
            "warning",
            at,
            station,
            `Fire oranı %${Math.round(rate * 100)}'e çıktı.`,
          ),
          ...alarms,
        ];
      }

      return {
        station: next,
        alarms: nextAlarms,
        entry: feed(
          at,
          station,
          `${station.stationName}: ${quantity} parça hurdaya ayrıldı.`,
          "warning",
        ),
      };
    }

    case "queue_changed": {
      const queue = Math.max(0, Math.trunc(event.queue));
      const grew = queue > station.queue;
      const next: StationLiveState = {
        ...station,
        queue,
        /*
         * Kuyruk durumu yalnızca üretim yapabilen bir makinede anlamlıdır:
         * arızalı ya da setup'taki bir istasyonun önünde kuyruk birikmesi
         * beklenen bir şeydir ve onu "kuyruk" rengine boyamak, asıl sorunu
         * (arızayı) ekrandan silerdi.
         */
        status:
          station.status === "fault" || station.status === "setup"
            ? station.status
            : queue >= QUEUE_WARNING
              ? "queued"
              : station.status === "queued"
                ? "running"
                : station.status,
      };

      const nextAlarms = queueAlarmFor(alarms, station, queue, at);

      return {
        station: next,
        alarms: nextAlarms,
        entry: feed(
          at,
          station,
          grew
            ? `${station.stationName} kuyruğu ${queue} parçaya çıktı.`
            : `${station.stationName} kuyruğu ${queue} parçaya indi.`,
          queue >= QUEUE_WARNING ? "warning" : "info",
        ),
      };
    }

    case "machine_fault": {
      const next: StationLiveState = {
        ...station,
        status: "fault",
        faultReason: event.reason,
        onlineMachines: Math.max(0, station.onlineMachines - 1),
      };
      const nextAlarms = hasOpenAlarm(alarms, station.stationId, "fault")
        ? alarms
        : [
            makeAlarm("fault", "critical", at, station, `Arıza: ${event.reason}`),
            ...alarms,
          ];
      return {
        station: next,
        alarms: nextAlarms,
        entry: feed(
          at,
          station,
          `${station.stationName} arızalandı: ${event.reason}`,
          "critical",
        ),
      };
    }

    case "machine_repaired": {
      const next: StationLiveState = {
        ...station,
        // Onarımdan sonra makine boşta bekler; üretime dönüşü ayrı bir
        // "başladı" olayı bildirir. Doğrudan "çalışıyor" yazmak, operatör
        // henüz tezgâha dönmemişken üretim varmış gibi gösterirdi.
        status: "idle",
        faultReason: null,
        onlineMachines: Math.min(station.machineCount, station.onlineMachines + 1),
      };
      return {
        station: next,
        alarms: resolveAlarms(alarms, station.stationId, "fault", at),
        entry: feed(at, station, `${station.stationName} arızası giderildi.`, "info"),
      };
    }

    case "setup_started":
      return {
        station: { ...station, status: "setup", setupProduct: event.product },
        alarms: hasOpenAlarm(alarms, station.stationId, "setup")
          ? alarms
          : [
              makeAlarm(
                "setup",
                "info",
                at,
                station,
                `${event.product} için setup başladı.`,
              ),
              ...alarms,
            ],
        entry: feed(
          at,
          station,
          `${station.stationName}: ${event.product} setup'ı başladı.`,
          "info",
        ),
      };

    case "setup_finished":
      return {
        station: {
          ...station,
          status: station.queue >= QUEUE_WARNING ? "queued" : "running",
          setupProduct: null,
        },
        alarms: resolveAlarms(alarms, station.stationId, "setup", at),
        entry: feed(at, station, `${station.stationName} setup'ı tamamlandı.`, "info"),
      };

    case "operator_assigned":
      return {
        station: { ...station, operatorName: event.operatorName },
        alarms,
        entry: feed(
          at,
          station,
          `${event.operatorName}, ${station.stationName} istasyonuna geçti.`,
          "info",
        ),
      };

    case "operator_released":
      return {
        station: { ...station, operatorName: null },
        alarms,
        entry: feed(
          at,
          station,
          `${station.stationName} operatörsüz kaldı.`,
          "warning",
        ),
      };

    case "oee_sampled":
      // Ölçüm olayı akışa yazılmaz: OEE saniyede bir örneklenir ve her
      // örneği satır yapmak, akışı okunmaz bir sayı yığınına çevirirdi.
      return {
        station: { ...station, oee: clamp01(event.oee) },
        alarms,
        entry: null,
      };
  }
}

function feed(
  atMinutes: number,
  station: StationLiveState,
  text: string,
  level: AlarmLevel,
): FeedEntry {
  return {
    // Kimlik olay sırasından değil, içerikten türer; aynı dakikada aynı
    // istasyonda iki farklı olay olabildiği için metin de kimliğe girer.
    id: `${atMinutes}:${station.stationId}:${text}`,
    atMinutes,
    stationId: station.stationId,
    stationName: station.stationName,
    text,
    level,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
