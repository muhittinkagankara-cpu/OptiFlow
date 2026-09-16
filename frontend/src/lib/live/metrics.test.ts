/**
 * Canlı ölçüm şeridi eşlemesi (Sprint 2I-B, Yasa 2).
 *
 * Korunan kural: her değer bir sonuç taşır, ama sonucu olmayan metriğe sonuç
 * **uydurulmaz**.
 */

import { describe, expect, it } from "vitest";
import type { LiveTotals, MachineStatus, StationLiveState } from "./types";
import { liveMetrics } from "./metrics";

const istasyon = (
  stationId: string,
  stationName: string,
  queue: number,
  oee = 0.7,
  status: MachineStatus = "running",
): StationLiveState => ({
  stationId,
  stationName,
  status,
  queue,
  completed: 0,
  scrapped: 0,
  oee,
  cycleSeconds: 30,
  machineCount: 1,
  onlineMachines: 1,
  operatorName: null,
  setupProduct: null,
  faultReason: null,
});

const toplam = (patch: Partial<LiveTotals> = {}): LiveTotals => ({
  throughputPerMinute: 1.4,
  oee: 0.74,
  scrapRate: 0.01,
  onlineMachines: 3,
  totalMachines: 3,
  avgCycleSeconds: 45,
  totalCompleted: 120,
  totalQueue: 9,
  activeOperators: 2,
  runningStations: 3,
  openAlarms: 0,
  ...patch,
});

const hat = [
  istasyon("s1", "Kesme", 1, 0.8),
  istasyon("s2", "Torna", 8, 0.62),
];
const bul = (id: string, stations = hat, t = toplam()) =>
  liveMetrics(stations, t).find((m) => m.id === id)!;

describe("dört metrik ve sıraları", () => {
  it("beklenen sırayla üretilir", () => {
    expect(liveMetrics(hat, toplam()).map((m) => m.id)).toEqual([
      "throughput",
      "oee",
      "queue",
      "alarms",
    ]);
  });
});

describe("her değer bir sonuç taşır (Yasa 2)", () => {
  it("throughput kısıt istasyonunu taşır", () => {
    expect(bul("throughput").consequence).toBe("Kısıt Torna");
  });

  it("OEE kısıt istasyonunun kendi OEE'sini taşır", () => {
    expect(bul("oee").consequence).toBe("Torna %62");
  });

  it("kuyruk nerede biriktiğini taşır", () => {
    expect(bul("queue").consequence).toBe("8 parçası Torna önünde");
  });

  it("alarm çalışan istasyon sayısını taşır", () => {
    expect(bul("alarms").consequence).toBe("3/2 istasyon çalışıyor");
  });

  it("arıza varsa alarm satırı arızayı sayar", () => {
    const arizali = [istasyon("s1", "Kesme", 1), istasyon("s2", "Torna", 0, 0.6, "fault")];
    expect(bul("alarms", arizali).consequence).toBe("1 istasyon arızada");
  });
});

describe("kısıt yoksa sonuç uydurulmaz", () => {
  const esit = [istasyon("s1", "Kesme", 3), istasyon("s2", "Torna", 3)];

  it("throughput sonucu boş kalır", () => {
    expect(bul("throughput", esit).consequence).toBeNull();
  });

  it("OEE sonucu boş kalır", () => {
    expect(bul("oee", esit).consequence).toBeNull();
  });

  it("kuyruk sonucu boş kalır", () => {
    expect(bul("queue", esit).consequence).toBeNull();
  });
});

describe("ölçülemeyen değer sıfıra düşmez (Yasa 4)", () => {
  it("throughput ölçülemiyorsa null olur ve nedeni yazılır", () => {
    const m = bul("throughput", hat, toplam({ throughputPerMinute: null }));
    expect(m.value).toBeNull();
    expect(m.emptyReason).toBe("Henüz ölçülecek üretim yok");
  });

  it("OEE ölçülemiyorsa null olur", () => {
    expect(bul("oee", hat, toplam({ oee: null })).value).toBeNull();
  });

  it("ölçülen değerler birimleriyle yazılır", () => {
    expect(bul("throughput").value).toBe("1.4 parça/dk");
    expect(bul("oee").value).toBe("%74");
    expect(bul("queue").value).toBe("9 parça");
  });
});

describe("hesaplanmayan büyüklük eklenmez", () => {
  it("para, kapasite kaybı ya da beklenen kazanç yazılmaz", () => {
    const metin = liveMetrics(hat, toplam())
      .map((m) => `${m.label} ${m.value ?? ""} ${m.consequence ?? ""}`)
      .join(" ");
    expect(metin).not.toMatch(/₺|kapasite kayb|kazanç|kayıp/i);
  });

  it("hiçbir metrik para olarak işaretlenmez", () => {
    expect(liveMetrics(hat, toplam()).some((m) => m.isMoney)).toBe(false);
  });
});
