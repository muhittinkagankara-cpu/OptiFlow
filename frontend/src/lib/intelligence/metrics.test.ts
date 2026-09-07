import { describe, expect, it } from "vitest";
import { buildComparison, buildRadarData, waitShare } from "./metrics";
import { report, results, station } from "./fixtures";

function axis(axes: ReturnType<typeof buildRadarData>, name: string) {
  return axes.find((item) => item.axis === name);
}

describe("waitShare", () => {
  it("bekleme payini akis suresine gore verir", () => {
    // İki istasyon x 2 dk bekleme = 4 dk; akis suresi 20 dk → %20
    expect(waitShare(results())).toBeCloseTo(0.2, 6);
  });

  it("bir'in ustune cikmaz", () => {
    const heavy = results({
      avg_flow_time: 3,
      station_metrics: [
        station("s1", "Kesim", 0.5, { avg_wait_time: 10 }),
        station("s2", "Torna", 0.9, { avg_wait_time: 10 }),
      ],
    });
    expect(waitShare(heavy)).toBe(1);
  });

  it("akis suresi sifirsa null doner", () => {
    // Sifira bolup "beklemesiz hat" demek yaniltici olurdu.
    expect(waitShare(results({ avg_flow_time: 0 }))).toBeNull();
  });
});

describe("buildRadarData", () => {
  it("kosum yoksa bos dizi doner", () => {
    // Sifirlarla dolu bir radar, hattin her yonden kotu oldugu izlenimini
    // verirdi.
    expect(buildRadarData(null)).toEqual([]);
  });

  it("alti ekseni sirayla uretir", () => {
    expect(buildRadarData(results()).map((a) => a.axis)).toEqual([
      "OEE",
      "Kararlılık",
      "Denge",
      "Hurda",
      "Kuyruk",
      "Kapasite",
    ]);
  });

  it("her eksen 0-100 arasindadir", () => {
    for (const item of buildRadarData(results())) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
      expect(item.basis.length).toBeGreaterThan(0);
    }
  });

  it("OEE'yi dogrudan tasir", () => {
    expect(axis(buildRadarData(results()), "OEE")?.score).toBe(74);
  });

  it("kapasiteyi teorik sinira gore olceklendirir", () => {
    // 2 / 2.5 = %80
    expect(axis(buildRadarData(results()), "Kapasite")?.score).toBe(80);
  });

  it("kararliligi uc basamakta ifade eder", () => {
    expect(axis(buildRadarData(results()), "Kararlılık")?.score).toBe(100);
    expect(
      axis(buildRadarData(results({ is_stable: false })), "Kararlılık")?.score,
    ).toBe(25);
    expect(
      axis(
        buildRadarData(
          results({
            littles_law_validation: {
              passed: false,
              deviation_pct: 9,
              tolerance_pct: 5,
              replications_checked: 10,
              replications_passed: 3,
            },
          }),
        ),
        "Kararlılık",
      )?.score,
    ).toBe(65);
  });

  it("hurda ekseni ters yonludur", () => {
    // Fire arttikca skor duser.
    const dirty = results({
      station_metrics: [
        station("s1", "Kesim", 0.5, {
          flow: { entered: 100, completed: 70, scrapped: 30, rejected: 0 },
        }),
      ],
    });
    expect(axis(buildRadarData(dirty), "Hurda")?.score).toBe(70);
  });

  it("dengesiz hatta denge skoru duser", () => {
    const unbalanced = results({
      station_metrics: [station("s1", "Kesim", 0.1), station("s2", "Torna", 0.9)],
    });
    expect(axis(buildRadarData(unbalanced), "Denge")?.score).toBe(20);
  });

  it("tek istasyonlu hatti dengeli sayar", () => {
    const single = results({ station_metrics: [station("s1", "Kesim", 0.6)] });
    expect(axis(buildRadarData(single), "Denge")?.score).toBe(100);
  });

  it("akis verisi yoksa hurda ekseni tam puan alir", () => {
    const noFlow = results({
      station_metrics: [
        station("s1", "Kesim", 0.5, {
          flow: { entered: 0, completed: 0, scrapped: 0, rejected: 0 },
        }),
      ],
    });
    expect(axis(buildRadarData(noFlow), "Hurda")?.score).toBe(100);
  });
});

describe("buildComparison", () => {
  it("kosum yoksa bos dizi doner", () => {
    expect(buildComparison(null, null)).toEqual([]);
  });

  it("OEE hedefini en iyi istasyondan alir", () => {
    // Hedef bir tahmin degil; ayni kosumda gozlenmis bir degerdir.
    const rows = buildComparison(results(), null);
    const oee = rows.find((row) => row.id === "oee");
    expect(oee?.current).toBeCloseTo(0.74, 6);
    expect(oee?.target).toBeCloseTo(0.79, 6);
    expect(oee?.targetSource).toContain("en iyi istasyonun");
  });

  it("en iyi istasyon hattan iyi degilse OEE satiri uretmez", () => {
    const flat = results({
      line_oee: 0.9,
      station_metrics: [
        station("s1", "Kesim", 0.5, {
          oee: { availability: 0.9, performance: 0.9, quality: 0.9, oee: 0.7 },
        }),
      ],
    });
    expect(buildComparison(flat, null).map((r) => r.id)).not.toContain("oee");
  });

  it("kapasite hedefi teorik ust sinirdir", () => {
    const capacity = buildComparison(results(), null).find(
      (row) => row.id === "capacity",
    );
    expect(capacity?.current).toBeCloseTo(0.8, 6);
    expect(capacity?.target).toBe(1);
  });

  it("kapasite doluysa satir uretmez", () => {
    const full = results({
      throughput_per_minute: 2.5,
      theoretical_max_throughput_per_minute: 2.5,
    });
    expect(buildComparison(full, null).map((r) => r.id)).not.toContain("capacity");
  });

  it("kayip hedefi kurtarilabilir tutar dusulmus haldir", () => {
    const loss = buildComparison(results(), report()).find(
      (row) => row.id === "loss",
    );
    expect(loss?.current).toBe(1000);
    expect(loss?.target).toBe(200);
    expect(loss?.format).toBe("money");
  });

  it("finans yoksa kayip satiri uretmez", () => {
    expect(buildComparison(results(), null).map((r) => r.id)).not.toContain("loss");
  });

  it("hedef negatife dusmez", () => {
    const overRecoverable = report({ recoverable_loss: 5000 });
    const loss = buildComparison(results(), overRecoverable).find(
      (row) => row.id === "loss",
    );
    expect(loss?.target).toBe(0);
  });
});
