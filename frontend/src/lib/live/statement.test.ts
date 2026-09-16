/**
 * Canlı hattın açılış cümlesi (Sprint 2I-B).
 *
 * Korunan kural: cümle **seçilir, üretilmez**. Kısıt yetkisi
 * `bottleneckStationId` olmaya devam eder; burada ikinci bir kısıt tanımı
 * yoktur ve desteklenmeyen hiçbir iddia yazılmaz.
 */

import { describe, expect, it } from "vitest";
import type { MachineStatus, StationLiveState } from "./types";
import { liveStatement } from "./statement";

const istasyon = (
  stationId: string,
  stationName: string,
  queue: number,
  status: MachineStatus = "running",
  faultReason: string | null = null,
): StationLiveState => ({
  stationId,
  stationName,
  status,
  queue,
  completed: 10,
  scrapped: 0,
  oee: 0.75,
  cycleSeconds: 40,
  machineCount: 1,
  onlineMachines: 1,
  operatorName: null,
  setupProduct: null,
  faultReason,
});

describe("kısıt varken", () => {
  const hat = [
    istasyon("s1", "Kesme", 1),
    istasyon("s2", "Torna", 7),
    istasyon("s3", "Kaynak", 2),
  ];

  it("kısıtı adıyla söyler", () => {
    expect(liveStatement(hat)!.headline).toBe(
      "Şu anda hattı Torna kısıtlıyor.",
    );
  });

  it("cümleyi ölçülmüş kuyrukla destekler", () => {
    expect(liveStatement(hat)!.detail).toContain("7 parça");
  });

  it("kaynağını kısıt olarak işaretler", () => {
    expect(liveStatement(hat)!.source).toBe("constraint");
  });

  it("kısıt yetkisi değişince cümle de değişir — ikinci tanım yok", () => {
    const baska = [
      istasyon("s1", "Kesme", 9),
      istasyon("s2", "Torna", 2),
    ];
    expect(liveStatement(baska)!.headline).toContain("Kesme");
  });
});

describe("kısıt yokken", () => {
  it("kuyruklar eşitse bir istasyon kısıt ilan edilmez", () => {
    const esit = [istasyon("s1", "Kesme", 4), istasyon("s2", "Torna", 4)];
    const cumle = liveStatement(esit)!;
    expect(cumle.source).toBe("monitoring");
    expect(cumle.headline).toBe(
      "Canlı hat durumu izleniyor; belirlenmiş bir kısıt yok.",
    );
  });

  it("hiç kuyruk yoksa kısıt yazılmaz", () => {
    const bos = [istasyon("s1", "Kesme", 0), istasyon("s2", "Torna", 0)];
    expect(liveStatement(bos)!.source).toBe("monitoring");
  });

  it("nötr cümle ikinci satır uydurmaz", () => {
    const bos = [istasyon("s1", "Kesme", 0), istasyon("s2", "Torna", 0)];
    expect(liveStatement(bos)!.detail).toBeNull();
  });
});

describe("arıza durumu", () => {
  it("kısıt yokken tek arıza adıyla söylenir", () => {
    const hat = [
      istasyon("s1", "Kesme", 0),
      istasyon("s2", "Torna", 0, "fault", "Kayış koptu"),
    ];
    const cumle = liveStatement(hat)!;
    expect(cumle.headline).toBe("Torna istasyonunda arıza var.");
    expect(cumle.source).toBe("fault");
  });

  it("arıza nedeni yalnızca sağlayıcı verdiyse yazılır", () => {
    const hat = [
      istasyon("s1", "Kesme", 0),
      istasyon("s2", "Torna", 0, "fault", "Kayış koptu"),
    ];
    expect(liveStatement(hat)!.detail).toBe("Kayış koptu");
  });

  it("neden verilmemişse uydurulmaz", () => {
    const hat = [
      istasyon("s1", "Kesme", 0),
      istasyon("s2", "Torna", 0, "fault", null),
    ];
    expect(liveStatement(hat)!.detail).toBe("Torna");
  });

  it("birden çok arıza sayılır", () => {
    const hat = [
      istasyon("s1", "Kesme", 0, "fault"),
      istasyon("s2", "Torna", 0, "fault"),
    ];
    expect(liveStatement(hat)!.headline).toBe("2 istasyonda arıza var.");
  });

  it("kısıt varsa arıza cümlenin önüne geçmez", () => {
    // Arızalı istasyonun kuyruğu zaten büyüyüp onu kısıt yapar; iki cümle
    // yarışmaz.
    const hat = [
      istasyon("s1", "Kesme", 9),
      istasyon("s2", "Torna", 0, "fault"),
    ];
    expect(liveStatement(hat)!.source).toBe("constraint");
  });
});

describe("veri yokken hiçbir şey uydurulmaz", () => {
  it("istasyon yoksa cümle de yok", () => {
    expect(liveStatement([])).toBeNull();
  });
});

describe("desteklenmeyen iddia yazılmaz", () => {
  it("hiçbir dalda kritik/acil/para dili kullanılmaz", () => {
    const durumlar = [
      liveStatement([istasyon("s1", "Kesme", 9), istasyon("s2", "Torna", 1)]),
      liveStatement([istasyon("s1", "Kesme", 0, "fault")]),
      liveStatement([istasyon("s1", "Kesme", 0), istasyon("s2", "Torna", 0)]),
    ];
    for (const durum of durumlar) {
      const metin = `${durum!.headline} ${durum!.detail ?? ""}`;
      expect(metin).not.toMatch(/kritik|acil|kapasite kayb|performans düştü|₺/i);
    }
  });
});
