/**
 * Rapor testlerinin paylaştığı kurucular.
 *
 * `lib/intelligence/fixtures` üzerine kurulur: iki katman aynı koşum şemasını
 * kullanıyor ve ikinci bir kurucu yazmak, şemaya bir alan eklendiğinde iki
 * yerde güncelleme gerektirirdi.
 */

import { report as financeReport, results as runResults } from "../intelligence/fixtures";
import type {
  FinancialReport,
  SimulationConfig,
  SimulationRunResponse,
} from "../../types/simulationTypes";
import type { ReportContext } from "./types";

/** Sabit tarih: rapor başlıkları ve dosya adları sınanabilir olsun. */
export const GENERATED_AT = new Date("2026-09-04T14:32:00");

export function config(): SimulationConfig {
  return {
    stations: [
      {
        id: "s1",
        name: "Kesim",
        line_name: "Hat A",
        num_servers: 2,
        service_time_distribution: { type: "constant", params: { value: 0.5 } },
        buffer_capacity_before: -1,
        scrap_rate: 0.01,
      },
      {
        id: "s2",
        name: "Torna",
        line_name: "Hat A",
        num_servers: 1,
        service_time_distribution: { type: "constant", params: { value: 1.2 } },
        buffer_capacity_before: -1,
        scrap_rate: 0.02,
      },
    ],
    connections: [
      { from_station_id: "s1", to_station_id: "s2", routing_probability: 1 },
    ],
    arrival_process: {
      distribution: { type: "constant", params: { value: 0.6 } },
      entry_station_id: "s1",
    },
    simulation_duration_minutes: 480,
    warmup_period_minutes: 60,
    num_replications: 30,
  } as unknown as SimulationConfig;
}

export function runResponse(
  overrides: Partial<SimulationRunResponse> = {},
): SimulationRunResponse {
  return {
    simulation_id: "sim-123",
    results: runResults(),
    duration_seconds: 4.2,
    warnings: [],
    ...overrides,
  } as unknown as SimulationRunResponse;
}

export function context(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    factoryName: "Yıldız Metal Hattı",
    generatedAt: GENERATED_AT,
    config: config(),
    result: runResponse(),
    report: financeReport(),
    orgName: "Yıldız Metal A.Ş.",
    ...overrides,
  };
}

/** Koşumu da finansı da olmayan bağlam. */
export function emptyContext(): ReportContext {
  return context({ config: null, result: null, report: null });
}

export function reportWith(
  overrides: Partial<FinancialReport> = {},
): FinancialReport {
  return financeReport(overrides);
}
