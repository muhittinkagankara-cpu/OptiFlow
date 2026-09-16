/**
 * Canlı kısıt şeridi eşlemesi (Sprint 2I-B, genişlik kuralı 2I-B.3'te düzeltildi).
 *
 * Korunan kural: **genişlik yalnızca ölçülmüş doluluğu kodlar** (MASTER §15.4).
 * `StationLiveState` doluluk taşımadığı için canlı segmentler eşit genişliktedir
 * (§15.5) ve kuyruk yazıyla taşınır. Kuyruk artık segment genişliğini
 * belirlemez — belirleseydi, ölçülmemiş bir büyüklük ölçülmüş doluluk gibi
 * görünürdü (Yasa 4).
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

describe("segment genişliği ölçülmemiş doluluğu temsil etmez", () => {
  // A) Kuyruklar çok farklı olsa bile segmentler eşit.
  const farkli = [
    istasyon("s1", "Kesme", 0),
    istasyon("s2", "Torna", 1),
    istasyon("s3", "Kaynak", 5),
    istasyon("s4", "Boyama", 10),
  ];

  it("dört farklı kuyruk için dört eşit segment üretir", () => {
    const paylar = liveRailStations(farkli).map((s) => s.share);
    expect(paylar).toHaveLength(4);
    expect(new Set(paylar).size).toBe(1);
  });

  it("uzun kuyruklu istasyon geniş segment kazanmaz", () => {
    const serit = liveRailStations(farkli);
    const bos = serit.find((s) => s.id === "s1")!;
    const dolu = serit.find((s) => s.id === "s4")!;
    expect(dolu.share).toBe(bos.share);
  });

  // B) Hiç kuyruk yokken de eşit.
  it("bütün kuyruklar sıfırken segmentler yine eşit", () => {
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

  // E) Kuyruk değişse bile genişlik değişmez.
  it("kuyruk değiştiğinde pay değişmez", () => {
    const once = liveRailStations([istasyon("s1", "Kesme", 1)]);
    const sonra = liveRailStations([istasyon("s1", "Kesme", 99)]);
    expect(sonra[0].share).toBe(once[0].share);
  });

  // F) Doluluk ölçülmediği için hiçbir segment doluluk genişliği üretmez.
  it("hiçbir segment ölçülmemiş doluluktan pay türetmez", () => {
    // `share` doğrudan `flexGrow` ve dar ekrandaki dolgu çubuğunun yüzdesidir;
    // sıfır olması "doluluk hakkında bir iddia yok" demektir.
    expect(liveRailStations(farkli).every((s) => s.share === 0)).toBe(true);
  });

  it("kuyruk yazıyla taşınmaya devam eder", () => {
    const serit = liveRailStations(farkli);
    expect(serit.find((s) => s.id === "s4")!.value).toBe("10 parça");
    expect(serit.find((s) => s.id === "s1")!.value).toBe("0 parça");
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

  it("kısıt işareti segment genişliğinden bağımsızdır", () => {
    const hat = [istasyon("s1", "Kesme", 2), istasyon("s2", "Torna", 8)];
    const kisit = liveRailStations(hat).find((s) => s.isConstraint)!;
    expect(kisit.share).toBe(0);
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
