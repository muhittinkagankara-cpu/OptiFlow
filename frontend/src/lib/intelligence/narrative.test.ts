import { describe, expect, it } from "vitest";
import { buildCauseChain, buildExecutiveSummary } from "./narrative";
import { demandConstrained, report, results, station } from "./fixtures";

function ids(chain: ReturnType<typeof buildCauseChain>) {
  return chain.map((link) => link.id);
}

describe("buildExecutiveSummary — kosum yok", () => {
  it("kullaniciyi ilk adima yonlendirir", () => {
    const summary = buildExecutiveSummary(null, null);
    expect(summary.headline).toContain("Henüz bir koşum yok");
    expect(summary.focusStation).toBeNull();
    expect(summary.tone).toBe("good");
  });
});

describe("buildExecutiveSummary — darbogaz", () => {
  it("darbogazi ve kayip kapasite payini tek cumlede verir", () => {
    const summary = buildExecutiveSummary(results(), null);
    expect(summary.headline).toContain("Torna");
    // 2 / 2.5 = %80 kullanim → %20 kullanilamiyor
    expect(summary.headline).toContain("%20");
    expect(summary.focusStation).toBe("Torna");
  });

  it("cok dolu darbogazi kritik sayar", () => {
    const summary = buildExecutiveSummary(
      results({
        station_metrics: [station("s1", "Kesim", 0.5), station("s2", "Torna", 0.97)],
      }),
      null,
    );
    expect(summary.tone).toBe("critical");
  });

  it("esik ustundeki ama kritik olmayan darbogazi yuksek sayar", () => {
    expect(buildExecutiveSummary(results(), null).tone).toBe("high");
  });
});

describe("buildExecutiveSummary — kararsiz hat", () => {
  it("kararsizligi darbogazin onune alir", () => {
    // Kararsiz bir hattin uzun vadeli ciktisi zaten guvenilir degildir.
    const summary = buildExecutiveSummary(results({ is_stable: false }), null);
    expect(summary.tone).toBe("critical");
    expect(summary.headline).toContain("kuyruklar sürekli büyüyor");
  });
});

describe("buildExecutiveSummary — dis kisit", () => {
  it("dusuk kullanimda kapasite eklemeye cagirmaz", () => {
    const summary = buildExecutiveSummary(demandConstrained(), null);
    expect(summary.headline).toContain("rahat karşılıyor");
    expect(summary.detail).toContain("gelen talep");
    expect(summary.tone).toBe("good");
  });

  it("dis kisitta finans varsa en pahali istasyona isaret eder", () => {
    const summary = buildExecutiveSummary(demandConstrained(), report());
    expect(summary.focusStation).toBe("Torna");
    expect(summary.tone).toBe("medium");
  });
});

describe("buildCauseChain — kapasite kisiti", () => {
  it("bes halkali zinciri sirayla kurar", () => {
    const chain = buildCauseChain(results(), report());
    expect(ids(chain)).toEqual([
      "utilization",
      "queue",
      "waiting",
      "throughput",
      "loss",
    ]);
  });

  it("her halka olculmus bir deger tasir", () => {
    // Gerekcesiz bir neden-sonuc zinciri, kullanicidan inanc istemek olurdu.
    const chain = buildCauseChain(results(), report());
    for (const link of chain) {
      expect(link.measure).not.toBeNull();
      expect(link.detail.length).toBeGreaterThan(0);
    }
  });

  it("finans yoksa son halka oranlari girmeye cagirir", () => {
    const chain = buildCauseChain(results(), null);
    const last = chain[chain.length - 1];
    expect(last.id).toBe("loss-unknown");
    expect(last.measure).toBeNull();
    expect(last.detail).toContain("maliyet oranlarınızı");
  });

  it("en uzun kuyruklu istasyonu secer", () => {
    const chain = buildCauseChain(
      results({
        station_metrics: [
          station("s1", "Kesim", 0.55, { avg_queue_length: 9, avg_wait_time: 12 }),
          station("s2", "Torna", 0.92, { avg_queue_length: 2 }),
        ],
      }),
      null,
    );
    expect(chain.find((l) => l.id === "queue")?.measure).toContain("Kesim");
  });
});

describe("buildCauseChain — dis kisit", () => {
  it("bos kapasiteyi anlatir, kuyruk zinciri kurmaz", () => {
    // Ayni zincir burada yanlis olurdu: kuyruk yok, bekleme yok.
    const chain = buildCauseChain(demandConstrained(), null);
    expect(ids(chain)).toEqual(["demand", "idle", "quality"]);
  });

  it("kullanilmayan kapasitenin kayip olmadigini soyler", () => {
    const chain = buildCauseChain(demandConstrained(), null);
    expect(chain[1].detail).toContain("kayıp değildir");
  });
});

describe("buildCauseChain — kosum yok", () => {
  it("bos dizi doner", () => {
    expect(buildCauseChain(null, null)).toEqual([]);
  });
});
