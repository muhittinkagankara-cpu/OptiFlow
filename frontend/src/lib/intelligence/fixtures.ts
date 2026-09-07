/**
 * Testlerin paylaştığı koşum ve rapor kurucuları.
 *
 * Beş modülün testleri de aynı biçimde koşum verisi kuruyor; her dosyada
 * yeniden yazılsaydı, şemaya bir alan eklendiğinde beş yerde birden
 * güncellenmesi gerekirdi.
 */

import type {
  FinancialReport,
  SimulationResults,
  StationMetricsResponse,
} from "../../types/simulationTypes";

export function station(
  id: string,
  name: string,
  utilization: number,
  overrides: Partial<StationMetricsResponse> = {},
): StationMetricsResponse {
  return {
    station_id: id,
    station_name: name,
    utilization,
    avg_queue_length: 1,
    avg_wait_time: 2,
    oee: { availability: 0.9, performance: 0.9, quality: 0.98, oee: 0.79 },
    is_bottleneck: false,
    flow: { entered: 100, completed: 98, scrapped: 1, rejected: 1 },
    ...overrides,
  };
}

export function results(
  overrides: Partial<SimulationResults> = {},
): SimulationResults {
  return {
    total_throughput: 1000,
    confidence_interval_95: [980, 1020],
    station_metrics: [
      station("s1", "Kesim", 0.55),
      station("s2", "Torna", 0.92),
    ],
    bottleneck_station_id: "s2",
    littles_law_validation: {
      passed: true,
      deviation_pct: 1,
      tolerance_pct: 5,
      replications_checked: 10,
      replications_passed: 10,
    },
    num_replications: 30,
    is_stable: true,
    avg_wip: 12,
    avg_flow_time: 20,
    throughput_per_minute: 2,
    line_oee: 0.74,
    theoretical_max_throughput_per_minute: 2.5,
    ...overrides,
  };
}

export function report(
  overrides: Partial<FinancialReport> = {},
): FinancialReport {
  return {
    impact: {
      downtime_loss: 400,
      waiting_loss: 300,
      scrap_loss: 200,
      opportunity_loss: 100,
      total_loss: 1000,
      confidence: 0.8,
      data_completeness: 1,
      components: [],
      missing_inputs: [],
      notes: [],
    },
    stations: [
      {
        station_id: "s2",
        station_name: "Torna",
        downtime_loss: 300,
        waiting_loss: 200,
        scrap_loss: 100,
        opportunity_loss: 100,
        total_loss: 700,
        is_bottleneck: true,
      },
      {
        station_id: "s1",
        station_name: "Kesim",
        downtime_loss: 100,
        waiting_loss: 100,
        scrap_loss: 100,
        opportunity_loss: 0,
        total_loss: 300,
        is_bottleneck: false,
      },
    ],
    suggestions: [
      {
        station_id: "s2",
        station_name: "Torna",
        dominant_loss: "downtime_loss",
        recoverable_amount: 300,
        action: "Önleyici bakım önceliğini bu istasyona verin.",
        rationale: "Toplam kaybın %43'ü arıza kaleminden geliyor.",
      },
    ],
    recoverable_loss: 800,
    daily_loss: 500,
    window_minutes: 1000,
    heat: [],
    top_loss_stations: [],
    ...overrides,
  };
}

/** Kısıtın dışarıda olduğu koşum: hiçbir istasyon dolu değil. */
export function demandConstrained(): SimulationResults {
  return results({
    station_metrics: [
      station("s1", "Kesim", 0.3),
      station("s2", "Torna", 0.45),
    ],
    throughput_per_minute: 1,
    theoretical_max_throughput_per_minute: 2.5,
  });
}
