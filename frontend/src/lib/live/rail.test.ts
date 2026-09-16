/**
 * Canlı kısıt şeridi eşlemesi (Anayasa V4).
 *
 * Korunan kural: **en geniş segment kısıttır.** Genişlik, o varyantta kısıtı
 * belirleyen ölçümü kodlar; canlı ekranda bu kuyruktur (`bottleneckStationId`
 * kuyruğa bakar). Eşit genişlik yalnızca hiç kuyruk yokken devreye girer.
 *
 * Bu kural iki kez tartışıldı: 2I-B.3 segmentleri eşitlemişti, V4 kararı canlı
 * varyant için yeniden yazdı ve MASTER §15.4 buna göre güncellendi.
 */

import { describe, expect, it } from "vitest";
import type { MachineStatus, StationLiveState } from "./types";
import { liveRailStations, stationState } from "./rail";

const istasyon = (
  stationId: string,
  stationName: string,
  queue: number,
  status: MachineStatus = "running",
): StationLiveState => ({
  stationId,
  stationName,
  status,
  queue,
  completed: 0,
  scrapped: 0,
  oee: 0.7,
  cycleSeconds: 30,
  machineCount: 1,
  onlineMachines: 1,
  operatorName: null,
  setupProduct: null,
  faultReason: null,
});

describe("genişlik, kısıtı belirleyen ölçümü kodlar", () => {
  const farkli = [
    istasyon("s1", "Kesme", 0),
    istasyon("s2", "Torna", 1),
    istasyon("s3", "Kaynak", 5),
    istasyon("s4", "Boyama", 10),
  ];

  it("en uzun kuyruk tam paya sahiptir", () => {
    expect(liveRailStations(farkli).find((s) => s.id === "s4")!.share).toBe(1);
  });

  it("diğer paylar en uzun kuyruğa göre okunur", () => {
    const serit = liveRailStations(farkli);
    expect(serit.find((s) => s.id === "s3")!.share).toBeCloseTo(0.5);
    expect(serit.find((s) => s.id === "s2")!.share).toBeCloseTo(0.1);
    expect(serit.find((s) => s.id === "s1")!.share).toBe(0);
  });

  it("en geniş segment kısıt olarak işaretlenir", () => {
    // Şeridin verdiği söz budur; genişlik ile kısıt aynı ölçümden gelmeli.
    const serit = liveRailStations(farkli);
    const enGenis = [...serit].sort((a, b) => b.share - a.share)[0];
    expect(enGenis.isConstraint).toBe(true);
  });

  it("kuyruk değişince pay da değişir", () => {
    const hat = (q: number) => [istasyon("s1", "Kesme", q), istasyon("s2", "Torna", 10)];
    expect(liveRailStations(hat(1))[0].share).toBeCloseTo(0.1);
    expect(liveRailStations(hat(5))[0].share).toBeCloseTo(0.5);
  });

  it("kuyruk yazıyla da taşınmaya devam eder", () => {
    const serit = liveRailStations(farkli);
    expect(serit.find((s) => s.id === "s4")!.value).toBe("10 parça");
    expect(serit.find((s) => s.id === "s1")!.value).toBe("0 parça");
  });

  it("doluluk türetilmez — pay yalnızca kuyruktan gelir", () => {
    // İki istasyon aynı kuyruğa ama farklı makine sayısına sahip; paylar eşit
    // kalmalı. Eşit kalmazsa bir yerde doluluk uydurulmuş demektir.
    const a = { ...istasyon("s1", "Kesme", 4), machineCount: 1, onlineMachines: 1 };
    const b = { ...istasyon("s2", "Torna", 4), machineCount: 4, onlineMachines: 2 };
    const serit = liveRailStations([a, b]);
    expect(serit[0].share).toBe(serit[1].share);
  });
});

describe("kuyruk da yoksa eşit genişliğe düşülür", () => {
  it("bütün kuyruklar sıfırken paylar eşitlenir", () => {
    const bos = [
      istasyon("s1", "Kesme", 0),
      istasyon("s2", "Torna", 0),
      istasyon("s3", "Kaynak", 0),
      istasyon("s4", "Boyama", 0),
    ];
    const paylar = liveRailStations(bos).map((s) => s.share);
    expect(paylar).toHaveLength(4);
    expect(new Set(paylar).size).toBe(1);
  });

  it("eşit genişlikteyken kısıt da işaretlenmez", () => {
    const bos = [istasyon("s1", "Kesme", 0), istasyon("s2", "Torna", 0)];
    expect(liveRailStations(bos).some((s) => s.isConstraint)).toBe(false);
  });
});

describe("kısıt yetkisi değişmedi", () => {
  // C) En uzun kuyruk hâlâ kısıt olarak işaretlenir — yalnızca genişlikle değil.
  it("en uzun kuyruklu istasyon kısıt olarak işaretlenir", () => {
    const hat = [
      istasyon("s1", "Kesme", 2),
      istasyon("s2", "Torna", 8),
      istasyon("s3", "Kaynak", 0),
    ];
    const serit = liveRailStations(hat);
    expect(serit.filter((s) => s.isConstraint).map((s) => s.id)).toEqual(["s2"]);
  });

  it("kuyruklar eşitken kısıt yoktur", () => {
    const esit = [istasyon("s1", "Kesme", 3), istasyon("s2", "Torna", 3)];
    expect(liveRailStations(esit).some((s) => s.isConstraint)).toBe(false);
  });

  it("hiç kuyruk yokken kısıt işaretlenmez ama satırlar kalır", () => {
    const bos = [istasyon("s1", "Kesme", 0), istasyon("s2", "Torna", 0)];
    const serit = liveRailStations(bos);
    expect(serit).toHaveLength(2);
    expect(serit.some((s) => s.isConstraint)).toBe(false);
  });

  it("istasyon sırası ve sayısı korunur", () => {
    const hat = [
      istasyon("s1", "Kesme", 2),
      istasyon("s2", "Torna", 8),
      istasyon("s3", "Kaynak", 0),
    ];
    expect(liveRailStations(hat).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("renk yalnızca ölçülmüş durumdan gelir", () => {
  it("arıza fault'tur", () => {
    expect(stationState("fault")).toBe("fault");
  });

  it("diğer çalışma biçimleri ok'tur — yeni eşik icat edilmez", () => {
    for (const status of ["running", "idle", "queued", "setup"] as const) {
      expect(stationState(status)).toBe("ok");
    }
  });

  it("uzun kuyruk tek başına rengi değiştirmez", () => {
    const hat = [istasyon("s1", "Kesme", 99), istasyon("s2", "Torna", 0)];
    expect(liveRailStations(hat)[0].state).toBe("ok");
  });

  // D) Arıza durumu şeritte korunur.
  it("arızalı istasyon fault durumunu şeritte taşır", () => {
    const hat = [
      istasyon("s1", "Kesme", 1),
      istasyon("s2", "Torna", 0, "fault"),
    ];
    const serit = liveRailStations(hat);
    expect(serit.find((s) => s.id === "s2")!.state).toBe("fault");
    expect(serit.find((s) => s.id === "s1")!.state).toBe("ok");
  });
});

describe("istasyon yokken şerit çizilmez", () => {
  it("boş liste boş döner", () => {
    expect(liveRailStations([])).toEqual([]);
  });
});
