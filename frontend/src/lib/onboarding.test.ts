import { describe, expect, it } from "vitest";
import {
  BUILD_STEPS,
  SECTORS,
  activeStep,
  completedStepCount,
  previewOf,
  recentFactories,
  sectorById,
} from "./onboarding";
import type { Factory, SimulationConfig } from "../types/simulationTypes";
import type { RunHistoryEntry } from "./runHistory";

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    stations: [
      {
        id: "hizli",
        name: "Hızlı İstasyon",
        // 2 sunucu / 2 dk = dakikada 1 parça
        num_servers: 2,
        service_time_distribution: { type: "constant", params: { value: 2 } },
        buffer_capacity_before: -1,
        scrap_rate: 0,
      },
      {
        id: "yavas",
        name: "Yavaş İstasyon",
        // 1 sunucu / 10 dk = dakikada 0.1 parça  → hattın dar halkası
        num_servers: 1,
        service_time_distribution: { type: "constant", params: { value: 10 } },
        buffer_capacity_before: -1,
        scrap_rate: 0,
      },
    ],
    connections: [
      { from_station_id: "hizli", to_station_id: "yavas", routing_probability: 1 },
    ],
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 5 } },
      entry_station_id: "hizli",
    },
    simulation_duration_minutes: 1000,
    warmup_period_minutes: 100,
    num_replications: 10,
    ...overrides,
  };
}

function factory(id: string, name: string): Factory {
  return {
    id,
    name,
    sector: "Tekstil",
    version_count: 2,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
  };
}

function run(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    simulationId: "sim-1",
    factoryId: "f-1",
    factoryName: "Hat A",
    ranAt: "2026-09-04T10:00:00.000Z",
    throughput: 1000,
    oee: 0.8,
    bottleneckName: "Dikiş",
    isStable: true,
    stationCount: 3,
    durationSeconds: 2,
    ...overrides,
  };
}

describe("SECTORS", () => {
  it("bes sektor sunar", () => {
    expect(SECTORS).toHaveLength(5);
    expect(SECTORS.map((sector) => sector.id)).toEqual([
      "metal",
      "gida",
      "tekstil",
      "plastik",
      "genel",
    ]);
  });

  it("her sektorun aciklamasi ve simgesi vardir", () => {
    for (const sector of SECTORS) {
      expect(sector.title.length).toBeGreaterThan(0);
      expect(sector.description.length).toBeGreaterThan(0);
      expect(sector.icon.length).toBeGreaterThan(0);
    }
  });

  it("genel uretimin hazir adimi yoktur", () => {
    // Bos sema ile baslanir; uydurma bir adim zinciri gostermek yaniltici
    // olurdu.
    expect(sectorById("genel")?.stages).toEqual([]);
  });

  it("bilinmeyen kimlikte null doner", () => {
    expect(sectorById(null)).toBeNull();
  });
});

describe("previewOf", () => {
  it("istasyon ve baglanti sayisini verir", () => {
    const preview = previewOf(config());
    expect(preview.stationCount).toBe(2);
    expect(preview.connectionCount).toBe(1);
  });

  it("en yavas istasyonu kaba darbogaz olarak secer", () => {
    // Bir hat, en dar halkasindan hizli akamaz.
    expect(previewOf(config()).slowestStation).toBe("Yavaş İstasyon");
  });

  it("kaba kapasiteyi saatlik olarak verir", () => {
    // 0.1 parca/dk x 60 = 6 parca/saat
    expect(previewOf(config()).roughCapacityPerHour).toBeCloseTo(6, 6);
  });

  it("bos sablonda sayilar sifir, kapasite null olur", () => {
    // "Saatte 0 parca" demek, sifir kapasiteli bir hat kuruldugu izlenimini
    // verirdi.
    const preview = previewOf(null);
    expect(preview.stationCount).toBe(0);
    expect(preview.roughCapacityPerHour).toBeNull();
    expect(preview.slowestStation).toBeNull();
  });

  it("istasyonu olmayan config bos sablon gibi ele alinir", () => {
    expect(previewOf(config({ stations: [] })).roughCapacityPerHour).toBeNull();
  });

  it("islem suresi sifir olan sablonda kapasite gosterilmez", () => {
    // Sonsuz kapasite gercek bir sayi degildir.
    const instant = config({
      stations: [
        {
          id: "ani",
          name: "Anlık",
          num_servers: 1,
          service_time_distribution: { type: "constant", params: { value: 0 } },
          buffer_capacity_before: -1,
          scrap_rate: 0,
        },
      ],
    });
    expect(previewOf(instant).roughCapacityPerHour).toBeNull();
  });
});

describe("completedStepCount", () => {
  it("basta hicbir adim bitmemistir", () => {
    expect(completedStepCount(0)).toBe(0);
  });

  it("esige tam gelindiginde adim bitmis sayilir", () => {
    // Aksi halde cubuk %100'e ulastiginda son adim hala "suruyor" gorunurdu.
    expect(completedStepCount(BUILD_STEPS[0].until)).toBe(1);
    expect(completedStepCount(1)).toBe(BUILD_STEPS.length);
  });

  it("araligin disini kirpar", () => {
    expect(completedStepCount(-5)).toBe(0);
    expect(completedStepCount(9)).toBe(BUILD_STEPS.length);
  });
});

describe("activeStep", () => {
  it("suren adimi dondurur", () => {
    expect(activeStep(0)?.id).toBe("template");
    expect(activeStep(0.5)?.id).toBe("stations");
  });

  it("hepsi bitince null doner", () => {
    expect(activeStep(1)).toBeNull();
  });
});

describe("recentFactories", () => {
  it("fabrikayi kimligine gore kosumla eslestirir", () => {
    const list = recentFactories(
      [factory("f-1", "Hat A")],
      [run({ factoryId: "f-1" })],
    );
    expect(list[0].lastRun?.simulationId).toBe("sim-1");
  });

  it("kimlik yoksa ada gore eslestirir", () => {
    // Bu alan eklenmeden once kaydedilmis kosumlar da rozet gosterebilmeli.
    const eski = run({ factoryId: undefined, factoryName: "Hat A" });
    const list = recentFactories([factory("f-9", "Hat A")], [eski]);
    expect(list[0].lastRun?.simulationId).toBe("sim-1");
  });

  it("eslesme yoksa lastRun null kalir", () => {
    const list = recentFactories([factory("f-2", "Hat B")], [run()]);
    expect(list[0].lastRun).toBeNull();
  });

  it("listeyi sinirlar ve sirayi korur", () => {
    // Backend zaten en son guncelleneni basa koyuyor; burada yeniden
    // siralamak o karari sessizce gecersiz kilardi.
    const list = recentFactories(
      [factory("a", "A"), factory("b", "B"), factory("c", "C"), factory("d", "D")],
      [],
      3,
    );
    expect(list.map((item) => item.factory.id)).toEqual(["a", "b", "c"]);
  });

  it("fabrika yoksa bos dizi doner", () => {
    expect(recentFactories([], [run()])).toEqual([]);
  });
});
