/**
 * Başlangıç durumu ve toplu göstergeler.
 *
 * Hat, olayların üzerine uygulanacağı bir zeminle başlar: istasyon adları,
 * makine sayıları ve çevrim süreleri modelden (`SimulationConfig`) okunur; bir
 * koşum varsa OEE de oradan alınır. Bu değerler **uydurulmaz** — modelde ne
 * yazıyorsa ekranda o görünür, çünkü canlı ekranın güvenilirliği ilk kareden
 * itibaren sınanır.
 */

import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import { meanServiceTime } from "../configDefaults";
import { openAlarmCount } from "./alarms";
import { SHIFT_START_MINUTES } from "./clock";
import type { LiveFactoryState, LiveTotals, StationLiveState } from "./types";

/** Bir istasyonun canlı ekrandaki başlangıç künyesi. */
export interface StationSeed {
  id: string;
  name: string;
  machineCount: number;
  cycleSeconds: number;
  /** 0-1 arası; koşum yoksa 0. */
  oee: number;
}

/** Model ve (varsa) koşumdan istasyon künyelerini çıkarır. */
export function seedsFromConfig(
  config: SimulationConfig | null,
  results: SimulationResults | null,
): StationSeed[] {
  if (!config) {
    return [];
  }
  return config.stations.map((station) => {
    const metrics = results?.station_metrics.find(
      (item) => item.station_id === station.id,
    );
    return {
      id: station.id,
      name: station.name || "Adsız istasyon",
      machineCount: Math.max(1, station.num_servers),
      cycleSeconds: Math.round(meanServiceTime(station) * 60),
      oee: metrics?.oee.oee ?? 0,
    };
  });
}

/**
 * Hattın darboğazı — kuyruğu diğerlerinin **hepsinden** uzun olan istasyon.
 *
 * Eşitlikte `null` döner. "En uzun kuyruk" diye bakıp eşit olanları da
 * işaretlemek, üç istasyonu birden darboğaz göstermeye yol açıyordu; oysa
 * darboğaz tanımı gereği tektir — hattı sınırlayan tek halka. Üç turuncu
 * halka, operatöre nereye bakacağını söylemek yerine kararı ona geri atardı.
 */
export function bottleneckStationId(stations: StationLiveState[]): string | null {
  let leader: StationLiveState | null = null;
  let tied = false;

  for (const station of stations) {
    if (leader === null || station.queue > leader.queue) {
      leader = station;
      tied = false;
    } else if (station.queue === leader.queue) {
      tied = true;
    }
  }

  return leader === null || tied || leader.queue === 0 ? null : leader.stationId;
}

/** Vardiyanın başındaki hâl: her makine boşta, kuyruklar boş, sayaçlar sıfır. */
export function initialLiveState(
  seeds: StationSeed[],
  clockMinutes: number = SHIFT_START_MINUTES,
): LiveFactoryState {
  return {
    clockMinutes,
    stations: seeds.map(
      (seed): StationLiveState => ({
        stationId: seed.id,
        stationName: seed.name,
        status: "idle",
        queue: 0,
        completed: 0,
        scrapped: 0,
        oee: seed.oee,
        cycleSeconds: seed.cycleSeconds,
        machineCount: seed.machineCount,
        onlineMachines: seed.machineCount,
        operatorName: null,
        setupProduct: null,
        faultReason: null,
      }),
    ),
    feed: [],
    alarms: [],
    eventCount: 0,
  };
}

/**
 * Üst şeritteki beş gösterge ve sağ paneldeki sayaçlar.
 *
 * Hiçbiri durumda saklanmaz, hepsi buradan türetilir: aynı sayıyı iki yerde
 * tutmak, birinin güncellenmeyi unutması demektir. Ölçülecek şey yokken `null`
 * döner — sıfır göstermek, ölçüm yapılmadığı hâlde bir sonuç bildirmek olurdu.
 */
export function liveTotals(
  state: LiveFactoryState,
  shiftStartMinutes: number = SHIFT_START_MINUTES,
): LiveTotals {
  const stations = state.stations;
  const totalCompleted = stations.reduce((sum, item) => sum + item.completed, 0);
  const totalScrapped = stations.reduce((sum, item) => sum + item.scrapped, 0);
  const totalQueue = stations.reduce((sum, item) => sum + item.queue, 0);
  const handled = totalCompleted + totalScrapped;

  const elapsed = Math.max(0, state.clockMinutes - shiftStartMinutes);

  const cycles = stations.filter((item) => item.cycleSeconds > 0);
  const measured = stations.filter((item) => item.oee > 0);

  return {
    throughputPerMinute: elapsed > 0 ? totalCompleted / elapsed : null,
    /*
     * Ortalamaya yalnızca **ölçülmüş** istasyonlar girer. Bir koşum yokken
     * bütün istasyonların OEE'si sıfırdır ve bunları ortalamak "hat %0
     * verimlilikle çalışıyor" der — oysa henüz hiç ölçüm yapılmamıştır.
     * Gerçekten sıfır OEE ile çalışan bir istasyon zaten hiç üretmiyor
     * demektir, yani o da ölçülmemiş sayılır.
     */
    oee: measured.length > 0
      ? measured.reduce((sum, item) => sum + item.oee, 0) / measured.length
      : null,
    scrapRate: handled > 0 ? totalScrapped / handled : null,
    onlineMachines: stations.reduce((sum, item) => sum + item.onlineMachines, 0),
    totalMachines: stations.reduce((sum, item) => sum + item.machineCount, 0),
    avgCycleSeconds:
      cycles.length > 0
        ? cycles.reduce((sum, item) => sum + item.cycleSeconds, 0) / cycles.length
        : null,
    totalCompleted,
    totalQueue,
    activeOperators: new Set(
      stations
        .map((item) => item.operatorName)
        .filter((name): name is string => name !== null),
    ).size,
    runningStations: stations.filter(
      (item) => item.status === "running" || item.status === "queued",
    ).length,
    openAlarms: openAlarmCount(state.alarms),
  };
}
