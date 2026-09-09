/**
 * Testlerin ve ekranın paylaştığı örnek doğrulama verisi.
 *
 * Dört istasyonluk küçük bir hat: modeldeki servis süreleri ve sahadan
 * ölçülmüş değerler bilinçli olarak birbirinden **biraz** ayrıdır. Tam
 * örtüşen bir örnek, doğruluk motorunun çalıştığını değil, yalnızca aynı
 * sayıyı iki kere yazdığını gösterirdi.
 */

import type {
  SimulationConfig,
  SimulationResults,
  Station,
  StationMetricsResponse,
} from "../../types/simulationTypes";
import type { RealDataSet, ValidationSnapshot } from "./types";

const DURATION_MINUTES = 10_000;
const WARMUP_MINUTES = 500;

/** Gözlem penceresi: ısınma sonrası kalan süre. */
export const FIXTURE_WINDOW_MINUTES = DURATION_MINUTES - WARMUP_MINUTES;

function station(
  id: string,
  name: string,
  serviceMinutes: number,
  servers = 1,
): Station {
  return {
    id,
    name,
    num_servers: servers,
    service_time_distribution: {
      type: "constant",
      params: { value: serviceMinutes },
    },
    buffer_capacity_before: -1,
    scrap_rate: 0.02,
  };
}

export function sampleConfig(): SimulationConfig {
  return {
    stations: [
      station("kesim", "Kesim", 1.5),
      station("torna", "Torna", 2.4),
      station("kaynak", "Kaynak", 3),
      station("montaj", "Montaj", 2, 2),
    ],
    connections: [
      { from_station_id: "kesim", to_station_id: "torna", routing_probability: 1 },
      { from_station_id: "torna", to_station_id: "kaynak", routing_probability: 1 },
      { from_station_id: "kaynak", to_station_id: "montaj", routing_probability: 1 },
    ],
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 3.2 } },
      entry_station_id: "kesim",
    },
    simulation_duration_minutes: DURATION_MINUTES,
    warmup_period_minutes: WARMUP_MINUTES,
    num_replications: 30,
  };
}

function metrics(
  id: string,
  name: string,
  waitMinutes: number,
  completed: number,
  scrapped: number,
  overrides: Partial<StationMetricsResponse> = {},
): StationMetricsResponse {
  return {
    station_id: id,
    station_name: name,
    utilization: 0.7,
    avg_queue_length: 1.2,
    avg_wait_time: waitMinutes,
    oee: { availability: 0.92, performance: 0.88, quality: 0.98, oee: 0.79 },
    is_bottleneck: id === "kaynak",
    flow: {
      entered: completed + scrapped,
      completed,
      scrapped,
      rejected: 0,
    },
    ...overrides,
  };
}

export function sampleResults(): SimulationResults {
  return {
    total_throughput: 2_850,
    confidence_interval_95: [2_780, 2_920],
    station_metrics: [
      metrics("kesim", "Kesim", 0.8, 2_960, 60),
      metrics("torna", "Torna", 2.4, 2_900, 59),
      metrics("kaynak", "Kaynak", 6.5, 2_860, 58),
      metrics("montaj", "Montaj", 1.1, 2_850, 57),
    ],
    bottleneck_station_id: "kaynak",
    littles_law_validation: {
      passed: true,
      deviation_pct: 1.4,
      tolerance_pct: 5,
      replications_checked: 30,
      replications_passed: 30,
    },
    num_replications: 30,
    is_stable: true,
    avg_wip: 4.2,
    avg_flow_time: 19.8,
    throughput_per_minute: 2_850 / FIXTURE_WINDOW_MINUTES,
    line_oee: 0.79,
    theoretical_max_throughput_per_minute: 0.33,
  };
}

/**
 * Bir vardiyada sahadan toplanmış örnek ölçüm.
 *
 * Montaj bilerek boş bırakılmıştır: gerçek bir doğrulamada hiçbir zaman tüm
 * istasyonlar ölçülmez ve ürünün eksik veriyle ne yaptığı örnekte de görünmelidir.
 */
export function sampleRealData(measuredAt: Date): RealDataSet {
  return {
    shiftMinutes: 480,
    measuredAt: measuredAt.toISOString(),
    stations: [
      {
        stationId: "kesim",
        stationName: "Kesim",
        cycleTimeMinutes: 1.6,
        producedUnits: 148,
        waitMinutes: 0.9,
        scrapUnits: 3,
        operatorCount: 1,
        machineCount: 1,
      },
      {
        stationId: "torna",
        stationName: "Torna",
        cycleTimeMinutes: 2.9,
        producedUnits: 142,
        waitMinutes: 3.4,
        scrapUnits: 4,
        operatorCount: 1,
        machineCount: 1,
      },
      {
        stationId: "kaynak",
        stationName: "Kaynak",
        cycleTimeMinutes: 3.1,
        producedUnits: 140,
        waitMinutes: 7.2,
        scrapUnits: 5,
        operatorCount: 2,
        machineCount: 1,
      },
      {
        stationId: "montaj",
        stationName: "Montaj",
        cycleTimeMinutes: null,
        producedUnits: null,
        waitMinutes: null,
        scrapUnits: null,
        operatorCount: null,
        machineCount: null,
      },
    ],
  };
}

/** Örnek CSV içeriği; yükleme akışının testinde ve şablonda kullanılır. */
export const SAMPLE_CSV = [
  "İstasyon;Gerçek çevrim süresi (dk);Gerçek üretim (adet);Gerçek bekleme (dk);Fire (adet);Operatör;Makine",
  "Kesim;1,6;148;0,9;3;1;1",
  "Torna;2,9;142;3,4;4;1;1",
  "Kaynak;3,1;140;7,2;5;2;1",
].join("\n");

/** Geçmiş ölçümler; trend çizgisinin örneği. */
export function sampleTimeline(now: Date): ValidationSnapshot[] {
  const daysAgo = (days: number): string => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return date.toISOString();
  };

  return [
    {
      id: "val-1",
      factoryId: null,
      factoryName: "Örnek Hat",
      measuredAt: daysAgo(30),
      overallAccuracy: 0.81,
      confidenceScore: 0.58,
      confidenceLevel: "low",
      measuredStationCount: 2,
      stationCount: 4,
    },
    {
      id: "val-2",
      factoryId: null,
      factoryName: "Örnek Hat",
      measuredAt: daysAgo(14),
      overallAccuracy: 0.88,
      confidenceScore: 0.69,
      confidenceLevel: "medium",
      measuredStationCount: 3,
      stationCount: 4,
    },
    {
      id: "val-3",
      factoryId: null,
      factoryName: "Örnek Hat",
      measuredAt: daysAgo(3),
      overallAccuracy: 0.94,
      confidenceScore: 0.82,
      confidenceLevel: "high",
      measuredStationCount: 4,
      stationCount: 4,
    },
  ];
}
