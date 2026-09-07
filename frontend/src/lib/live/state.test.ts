import { describe, expect, it } from "vitest";
import { formatClock, SHIFT_START_MINUTES } from "./clock";
import { reduceLiveMany } from "./events";
import {
  bottleneckStationId,
  initialLiveState,
  liveTotals,
  seedsFromConfig,
} from "./state";
import { START, seed, seeds, state } from "./fixtures";
import type { SimulationConfig, SimulationResults } from "../../types/simulationTypes";

describe("formatClock", () => {
  it("vardiya basini 08:00 gosterir", () => {
    expect(formatClock(SHIFT_START_MINUTES)).toBe("08:00");
  });

  it("dakikayi iki haneye tamamlar", () => {
    expect(formatClock(14 * 60 + 5)).toBe("14:05");
  });

  it("gun sinirini basa sarar", () => {
    // Gece vardiyasinda "25:30" gibi okunamayan bir saat gorunmemeli.
    expect(formatClock(25 * 60 + 30)).toBe("01:30");
  });

  it("negatif degeri de basa sarar", () => {
    expect(formatClock(-30)).toBe("23:30");
  });
});

describe("initialLiveState", () => {
  it("her makineyi bosta ve cevrimici baslatir", () => {
    const current = initialLiveState(seeds(), START);
    expect(current.stations).toHaveLength(2);
    expect(current.stations[0].status).toBe("idle");
    expect(current.stations[0].onlineMachines).toBe(2);
    expect(current.feed).toEqual([]);
    expect(current.alarms).toEqual([]);
  });

  it("istasyon yoksa bos hat kurar", () => {
    expect(initialLiveState([]).stations).toEqual([]);
  });
});

describe("seedsFromConfig", () => {
  const config = {
    stations: [
      {
        id: "s1",
        name: "Kesim",
        num_servers: 3,
        service_time_distribution: { type: "constant", params: { value: 0.5 } },
        buffer_capacity_before: -1,
        scrap_rate: 0,
      },
      {
        id: "s2",
        name: "",
        num_servers: 0,
        service_time_distribution: { type: "constant", params: { value: 2 } },
        buffer_capacity_before: -1,
        scrap_rate: 0,
      },
    ],
  } as unknown as SimulationConfig;

  it("model yoksa bos doner", () => {
    expect(seedsFromConfig(null, null)).toEqual([]);
  });

  it("cevrim suresini dakikadan saniyeye cevirir", () => {
    // 0,5 dk = 30 sn
    expect(seedsFromConfig(config, null)[0].cycleSeconds).toBe(30);
  });

  it("adsiz istasyona okunur bir ad verir", () => {
    expect(seedsFromConfig(config, null)[1].name).toBe("Adsız istasyon");
  });

  it("makine sayisini en az bire cikarir", () => {
    // Sifir makineli bir istasyon ekranda "0/0 çevrimiçi" diye okunurdu.
    expect(seedsFromConfig(config, null)[1].machineCount).toBe(1);
  });

  it("kosum yoksa OEE sifir kalir", () => {
    expect(seedsFromConfig(config, null)[0].oee).toBe(0);
  });

  it("kosum varsa OEE'yi oradan alir", () => {
    const results = {
      station_metrics: [
        {
          station_id: "s1",
          oee: { availability: 1, performance: 1, quality: 1, oee: 0.72 },
        },
      ],
    } as unknown as SimulationResults;
    expect(seedsFromConfig(config, results)[0].oee).toBe(0.72);
  });
});

describe("bottleneckStationId", () => {
  it("kuyruk yoksa darbogaz da yok", () => {
    expect(bottleneckStationId(state().stations)).toBeNull();
  });

  it("bos hatta null doner", () => {
    expect(bottleneckStationId([])).toBeNull();
  });

  it("en uzun kuyrugu tek basina tasiyan istasyonu secer", () => {
    const after = reduceLiveMany(state(), [
      { type: "queue_changed", atMinutes: START, stationId: "s1", queue: 3 },
      { type: "queue_changed", atMinutes: START, stationId: "s2", queue: 9 },
    ]);
    expect(bottleneckStationId(after.stations)).toBe("s2");
  });

  it("esitlikte darbogaz ilan etmez", () => {
    // Uc istasyonu birden darbogaz gostermek, operatore nereye bakacagini
    // soylemek yerine karari ona geri atardi.
    const after = reduceLiveMany(state(), [
      { type: "queue_changed", atMinutes: START, stationId: "s1", queue: 4 },
      { type: "queue_changed", atMinutes: START, stationId: "s2", queue: 4 },
    ]);
    expect(bottleneckStationId(after.stations)).toBeNull();
  });
});

describe("liveTotals", () => {
  it("hicbir sey olmadan olculemeyenleri null birakir", () => {
    // Sifir throughput gostermek, olcum yapilmadigi halde sonuc bildirmek
    // olurdu.
    const totals = liveTotals(state());
    expect(totals.throughputPerMinute).toBeNull();
    expect(totals.scrapRate).toBeNull();
    expect(totals.totalCompleted).toBe(0);
  });

  it("istasyon yoksa OEE ve cevrim null olur", () => {
    const totals = liveTotals(initialLiveState([]));
    expect(totals.oee).toBeNull();
    expect(totals.avgCycleSeconds).toBeNull();
    expect(totals.totalMachines).toBe(0);
  });

  it("hic OEE olculmemisse null doner, sifir degil", () => {
    // Kosum yokken butun istasyonlarin OEE'si sifirdir; bunlari ortalamak
    // "hat %0 verimlilikle calisiyor" der — oysa hic olcum yapilmamistir.
    const current = state([
      seed("s1", "Kesim", { oee: 0 }),
      seed("s2", "Torna", { oee: 0 }),
    ]);
    expect(liveTotals(current).oee).toBeNull();
  });

  it("ortalamaya yalnizca olculmus istasyonlar girer", () => {
    const current = state([
      seed("s1", "Kesim", { oee: 0.9 }),
      seed("s2", "Torna", { oee: 0 }),
    ]);
    expect(liveTotals(current).oee).toBeCloseTo(0.9, 6);
  });

  it("throughput'u gecen sureye boler", () => {
    const after = reduceLiveMany(state(), [
      { type: "part_completed", atMinutes: START + 10, stationId: "s1", quantity: 40 },
      { type: "tick", atMinutes: START + 10 },
    ]);
    expect(liveTotals(after).throughputPerMinute).toBeCloseTo(4, 6);
  });

  it("fire oranini islenen toplam uzerinden verir", () => {
    const after = reduceLiveMany(state(), [
      { type: "part_completed", atMinutes: START + 1, stationId: "s1", quantity: 90 },
      { type: "part_scrapped", atMinutes: START + 1, stationId: "s1", quantity: 10 },
    ]);
    expect(liveTotals(after).scrapRate).toBeCloseTo(0.1, 6);
  });

  it("cevrimici makineleri arizadan sonra dusurur", () => {
    const after = reduceLiveMany(state(), [
      { type: "machine_fault", atMinutes: START, stationId: "s1", reason: "Rulman" },
    ]);
    const totals = liveTotals(after);
    expect(totals.totalMachines).toBe(4);
    expect(totals.onlineMachines).toBe(3);
    expect(totals.openAlarms).toBe(1);
  });

  it("ayni operatoru iki kez saymaz", () => {
    const after = reduceLiveMany(state(), [
      {
        type: "operator_assigned",
        atMinutes: START,
        stationId: "s1",
        operatorName: "Ayşe",
      },
      {
        type: "operator_assigned",
        atMinutes: START,
        stationId: "s2",
        operatorName: "Ayşe",
      },
    ]);
    expect(liveTotals(after).activeOperators).toBe(1);
  });

  it("kuyruktaki istasyonu da calisan sayar", () => {
    const after = reduceLiveMany(state(), [
      { type: "station_started", atMinutes: START, stationId: "s1" },
      { type: "queue_changed", atMinutes: START, stationId: "s1", queue: 12 },
      { type: "station_started", atMinutes: START, stationId: "s2" },
    ]);
    expect(liveTotals(after).runningStations).toBe(2);
  });

  it("cevrim suresi sifir olan istasyonu ortalamaya katmaz", () => {
    // Sifirlari ortalamaya katmak, gercek cevrim suresini yariya dusururdu.
    const current = state([
      seed("s1", "Kesim", { cycleSeconds: 60 }),
      seed("s2", "Torna", { cycleSeconds: 0 }),
    ]);
    expect(liveTotals(current).avgCycleSeconds).toBe(60);
  });
});
