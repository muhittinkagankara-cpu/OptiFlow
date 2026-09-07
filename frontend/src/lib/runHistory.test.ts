import { describe, expect, it } from "vitest";
import {
  MAX_RUN_HISTORY,
  addEntry,
  entryFromResult,
  isValidEntry,
  parseHistory,
  relativeTime,
  type RunHistoryEntry,
} from "./runHistory";
import type {
  SimulationConfig,
  SimulationRunResponse,
} from "../types/simulationTypes";

function entry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    simulationId: "sim-1",
    factoryId: "f-1",
    factoryName: "Hat A",
    ranAt: "2026-09-04T10:00:00.000Z",
    throughput: 1000,
    oee: 0.74,
    bottleneckName: "Dikiş",
    isStable: true,
    stationCount: 3,
    durationSeconds: 2.5,
    ...overrides,
  };
}

const config: SimulationConfig = {
  stations: [
    {
      id: "s1",
      name: "Kesim",
      num_servers: 1,
      service_time_distribution: { type: "constant", params: { value: 5 } },
      buffer_capacity_before: -1,
      scrap_rate: 0,
    },
    {
      id: "s2",
      name: "Dikiş",
      num_servers: 2,
      service_time_distribution: { type: "constant", params: { value: 4 } },
      buffer_capacity_before: -1,
      scrap_rate: 0,
    },
  ],
  connections: [],
  arrival_process: {
    distribution: { type: "exponential", params: { mean: 6 } },
    entry_station_id: "s1",
  },
  simulation_duration_minutes: 1000,
  warmup_period_minutes: 100,
  num_replications: 10,
};

const runResponse: SimulationRunResponse = {
  simulation_id: "sim-42",
  status: "completed",
  master_seed: 1,
  duration_seconds: 3.2,
  warnings: [],
  headline: "test",
  results: {
    total_throughput: 1234,
    confidence_interval_95: [1200, 1268],
    station_metrics: [
      {
        station_id: "s2",
        station_name: "Dikiş",
        utilization: 0.91,
        avg_queue_length: 3,
        avg_wait_time: 5,
        oee: { availability: 0.9, performance: 0.9, quality: 0.98, oee: 0.79 },
        is_bottleneck: true,
        flow: { entered: 100, completed: 95, scrapped: 3, rejected: 2 },
      },
    ],
    bottleneck_station_id: "s2",
    littles_law_validation: {
      passed: true,
      deviation_pct: 1,
      tolerance_pct: 5,
      replications_checked: 10,
      replications_passed: 10,
    },
    num_replications: 10,
    is_stable: true,
    avg_wip: 10,
    avg_flow_time: 20,
    throughput_per_minute: 1.2,
    line_oee: 0.81,
    theoretical_max_throughput_per_minute: 1.5,
  },
};

describe("entryFromResult", () => {
  it("kosum yanitindan ozet uretir", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const result = entryFromResult(
      runResponse,
      config,
      { id: "f-42", name: "Hat A" },
      now,
    );

    expect(result.simulationId).toBe("sim-42");
    expect(result.factoryId).toBe("f-42");
    expect(result.factoryName).toBe("Hat A");
    expect(result.throughput).toBe(1234);
    expect(result.oee).toBeCloseTo(0.81, 6);
    expect(result.bottleneckName).toBe("Dikiş");
    expect(result.stationCount).toBe(2);
    expect(result.ranAt).toBe(now.toISOString());
  });

  it("fabrika yoksa kimlik ve ad null kalir", () => {
    // Kayitli bir fabrikadan alinmamis kosum icin ad uydurulmaz.
    const result = entryFromResult(runResponse, config, null);
    expect(result.factoryName).toBeNull();
    expect(result.factoryId).toBeNull();
  });
});

describe("addEntry", () => {
  it("yeni kaydi basa koyar", () => {
    const list = addEntry([entry({ simulationId: "a" })], entry({ simulationId: "b" }));
    expect(list.map((item) => item.simulationId)).toEqual(["b", "a"]);
  });

  it("ayni kosumu iki kez listelemez", () => {
    const list = addEntry(
      [entry({ simulationId: "a", throughput: 1 })],
      entry({ simulationId: "a", throughput: 2 }),
    );
    expect(list).toHaveLength(1);
    expect(list[0].throughput).toBe(2);
  });

  it("listeyi ust sinirda kirpar", () => {
    let list: RunHistoryEntry[] = [];
    for (let index = 0; index < MAX_RUN_HISTORY + 5; index += 1) {
      list = addEntry(list, entry({ simulationId: `sim-${index}` }));
    }
    expect(list).toHaveLength(MAX_RUN_HISTORY);
    // En yeni kayit basta durur.
    expect(list[0].simulationId).toBe(`sim-${MAX_RUN_HISTORY + 4}`);
  });
});

describe("isValidEntry", () => {
  it("gecerli kaydi kabul eder", () => {
    expect(isValidEntry(entry())).toBe(true);
  });

  it("factoryId tasimayan eski kaydi kabul eder", () => {
    // Bu alan eklenmeden once yazilmis kayitlar zorunlu kilinsaydi
    // dogrulamadan gecemez ve gecmis sessizce silinirdi.
    const eski = { ...entry() };
    delete (eski as { factoryId?: unknown }).factoryId;
    expect(isValidEntry(eski)).toBe(true);
  });

  it("eksik ya da bozuk kaydi reddeder", () => {
    expect(isValidEntry(null)).toBe(false);
    expect(isValidEntry("metin")).toBe(false);
    expect(isValidEntry({ ...entry(), simulationId: "" })).toBe(false);
    expect(isValidEntry({ ...entry(), throughput: "cok" })).toBe(false);
    expect(isValidEntry({ ...entry(), oee: Number.NaN })).toBe(false);
  });
});

describe("parseHistory", () => {
  it("bos ya da bozuk girdide bos dizi doner", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{bozuk json")).toEqual([]);
    expect(parseHistory('{"dizi":"degil"}')).toEqual([]);
  });

  it("bozuk kayitlari atar, saglamlari korur", () => {
    // Tek bozuk bir kayit tum paneli cokertmemeli.
    const raw = JSON.stringify([entry({ simulationId: "iyi" }), { bozuk: true }]);
    const parsed = parseHistory(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].simulationId).toBe("iyi");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");

  it("bir dakikanin altini 'az once' der", () => {
    expect(relativeTime("2026-09-04T11:59:30.000Z", now)).toBe("az önce");
  });

  it("dakika ve saati yazar", () => {
    expect(relativeTime("2026-09-04T11:30:00.000Z", now)).toBe("30 dk önce");
    expect(relativeTime("2026-09-04T09:00:00.000Z", now)).toBe("3 saat önce");
  });

  it("bir gunu asanlari tarihe cevirir", () => {
    // "37 saat önce" okunabilir bir ifade degildir.
    const result = relativeTime("2026-09-01T12:00:00.000Z", now);
    expect(result).not.toContain("saat");
  });

  it("gecersiz tarihte tire doner", () => {
    expect(relativeTime("tarih-degil", now)).toBe("—");
  });
});
