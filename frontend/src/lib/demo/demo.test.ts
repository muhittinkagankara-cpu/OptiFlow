import { describe, expect, it } from "vitest";
import {
  DEMO_DURATION_MS,
  PHASES,
  PHASE_COUNT,
  PHASE_DURATION_MS,
  PHASE_LIST,
  demoProgress,
  nextPhase,
  phaseAt,
  phaseProgress,
  phaseStartMs,
  scenarioForPhase,
  startedAtForPhase,
  type DemoPhase,
} from "./timeline";
import {
  DEMO_FACTORY_NAME,
  DEMO_WINDOW_MINUTES,
  demoComparison,
  demoConfig,
  demoReport,
  demoResults,
  demoRun,
  demoRunHistory,
  demoSnapshot,
} from "./dataset";

const NOW = new Date("2026-09-04T10:00:00Z");
const ALL: DemoPhase[] = [1, 2, 3, 4, 5];

/* -------------------------------------------------------------------------- */

describe("demo zaman çizelgesi", () => {
  it("her dakika bir sonraki asamaya gecer", () => {
    expect(phaseAt(0)).toBe(1);
    expect(phaseAt(PHASE_DURATION_MS - 1)).toBe(1);
    expect(phaseAt(PHASE_DURATION_MS)).toBe(2);
    expect(phaseAt(PHASE_DURATION_MS * 2)).toBe(3);
    expect(phaseAt(PHASE_DURATION_MS * 3)).toBe(4);
    expect(phaseAt(PHASE_DURATION_MS * 4)).toBe(5);
  });

  it("sure dolunca son asamada kalir, basa donmez", () => {
    // Donseydi sunum yapan kisi konusurken ekran sessizce ilk dakikaya doner
    // ve anlattigi seyle celisirdi.
    expect(phaseAt(DEMO_DURATION_MS)).toBe(5);
    expect(phaseAt(DEMO_DURATION_MS * 4)).toBe(5);
  });

  it("gecersiz ve negatif surede ilk asamaya duser", () => {
    expect(phaseAt(-1000)).toBe(1);
    expect(phaseAt(Number.NaN)).toBe(1);
  });

  it("bes asamanin hepsinin metni vardir", () => {
    expect(PHASE_LIST).toHaveLength(PHASE_COUNT);
    for (const phase of ALL) {
      const info = PHASES[phase];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(0);
      expect(info.focus.length).toBeGreaterThan(0);
    }
  });

  it("ilerleme 0 ile 1 arasinda kalir", () => {
    expect(demoProgress(-5)).toBe(0);
    expect(demoProgress(DEMO_DURATION_MS / 2)).toBeCloseTo(0.5, 6);
    expect(demoProgress(DEMO_DURATION_MS * 3)).toBe(1);
  });

  it("asama ici ilerleme her asamada sifirdan baslar", () => {
    expect(phaseProgress(PHASE_DURATION_MS)).toBe(0);
    expect(phaseProgress(PHASE_DURATION_MS * 1.5)).toBeCloseTo(0.5, 6);
  });

  it("asamaya atlamak baslangic anini kaydirir", () => {
    // Tek dogruluk kaynagi gecen suredir; asama ayri bir duruma yazilmaz.
    const now = 1_000_000;
    const startedAt = startedAtForPhase(now, 4);
    expect(phaseAt(now - startedAt)).toBe(4);
    expect(startedAt).toBe(now - phaseStartMs(4));
  });

  it("atladiktan sonra sayac dogru yerden akmaya devam eder", () => {
    const now = 500_000;
    const startedAt = startedAtForPhase(now, 3);
    // Bir dakika daha gecince dorde gecmeli.
    expect(phaseAt(now + PHASE_DURATION_MS - startedAt)).toBe(4);
  });

  it("her asama gercek bir canli senaryoya eslenir", () => {
    // Ayri bir demo senaryosu yazilsaydi ziyaretci urunun gercek
    // ReplayProvider'ini degil, ona benzeyen ikinci bir seyi gorurdu.
    const known = ["normal", "bottleneck", "fault", "handoff", "setup"];
    for (const phase of ALL) {
      expect(known).toContain(scenarioForPhase(phase));
    }
    // Anlati: once normal, sonra darbogaz, sonra ariza.
    expect(scenarioForPhase(1)).toBe("normal");
    expect(scenarioForPhase(2)).toBe("bottleneck");
    expect(scenarioForPhase(3)).toBe("fault");
  });

  it("son asamadan sonraki asama basa doner", () => {
    expect(nextPhase(1)).toBe(2);
    expect(nextPhase(5)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("demo veri kümesi", () => {
  it("hazir metal fabrikasini kullanir", () => {
    const config = demoConfig();
    expect(config.stations.map((item) => item.name)).toEqual([
      "Kesme",
      "Torna",
      "Kaynak",
      "Boyama",
    ]);
    expect(config.simulation_duration_minutes).toBe(DEMO_WINDOW_MINUTES);
  });

  it("deterministiktir", () => {
    for (const phase of ALL) {
      expect(demoResults(phase)).toEqual(demoResults(phase));
      expect(demoReport(phase)).toEqual(demoReport(phase));
    }
  });

  it("her asamada dort istasyon ve tek darbogaz vardir", () => {
    for (const phase of ALL) {
      const results = demoResults(phase);
      expect(results.station_metrics).toHaveLength(4);
      const flagged = results.station_metrics.filter((item) => item.is_bottleneck);
      expect(flagged).toHaveLength(1);
      expect(results.bottleneck_station_id).toBe(flagged[0].station_id);
    }
  });

  it("hat OEE'si istasyon ortalamasiyla tutar", () => {
    // Ekranlar arasi celiski, bir demoda en cabuk fark edilen hatadir.
    for (const phase of ALL) {
      const results = demoResults(phase);
      const mean =
        results.station_metrics.reduce((sum, item) => sum + item.oee.oee, 0) /
        results.station_metrics.length;
      expect(results.line_oee).toBeCloseTo(mean, 2);
    }
  });

  it("akis suresi Little Yasasi ile tutarlidir", () => {
    // W = L / λ; dogrulama paneli kendi verimizde "gecmedi" dememeli.
    for (const phase of ALL) {
      const results = demoResults(phase);
      expect(results.avg_flow_time).toBeCloseTo(
        results.avg_wip / results.throughput_per_minute,
        0,
      );
    }
  });

  it("akis sayilari kendi icinde tutarlidir", () => {
    for (const phase of ALL) {
      for (const station of demoResults(phase).station_metrics) {
        const { entered, completed, scrapped, rejected } = station.flow;
        expect(completed + scrapped + rejected).toBe(entered);
      }
    }
  });

  it("OEE bilesenlerinin carpimi OEE'yi verir", () => {
    for (const phase of ALL) {
      for (const station of demoResults(phase).station_metrics) {
        const { availability, performance, quality, oee } = station.oee;
        expect(oee).toBeCloseTo(availability * performance * quality, 2);
      }
    }
  });

  describe("anlatı", () => {
    it("birinci dakikada hat kararli ve kuyruk kisadir", () => {
      const results = demoResults(1);
      expect(results.is_stable).toBe(true);
      const torna = station(results, "torna");
      expect(torna.avg_queue_length).toBeLessThan(4);
      expect(torna.utilization).toBeLessThan(0.85);
    });

    it("ikinci dakikada Torna kuyrugu buyur", () => {
      expect(station(demoResults(2), "torna").avg_queue_length).toBeGreaterThan(
        station(demoResults(1), "torna").avg_queue_length,
      );
      expect(station(demoResults(2), "torna").utilization).toBeGreaterThan(
        station(demoResults(1), "torna").utilization,
      );
    });

    it("ucuncu dakikada hat kararsiz olur ve uyari cikar", () => {
      const run = demoRun(3);
      expect(run.results.is_stable).toBe(false);
      expect(run.warnings.length).toBeGreaterThan(0);
      expect(station(run.results, "torna").utilization).toBeGreaterThan(0.95);
    });

    it("dorduncu dakikada oneri belirir, oncesinde belirmez", () => {
      for (const phase of [1, 2, 3] as DemoPhase[]) {
        expect(demoReport(phase).suggestions).toHaveLength(0);
      }
      const suggestions = demoReport(4).suggestions;
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].station_name).toBe("Torna");
      expect(suggestions[0].recoverable_amount).toBeGreaterThan(0);
    });

    it("besinci dakikada hat toparlanir", () => {
      const before = demoResults(4);
      const after = demoResults(5);
      expect(after.throughput_per_minute).toBeGreaterThan(before.throughput_per_minute);
      expect(after.is_stable).toBe(true);
      expect(station(after, "torna").avg_queue_length).toBeLessThan(
        station(before, "torna").avg_queue_length,
      );
    });

    it("kayip, kuyruk buyudukce artar", () => {
      // Sabit bir tutar yazilsaydi kayip ile hattin hali arasindaki bag
      // kopardi.
      expect(demoReport(3).impact.total_loss).toBeGreaterThan(
        demoReport(1).impact.total_loss,
      );
      expect(demoReport(5).impact.total_loss).toBeLessThan(
        demoReport(4).impact.total_loss,
      );
    });
  });

  describe("ısı haritası", () => {
    it("her istasyon icin bir hucre uretir ve sicaktan soguga siralar", () => {
      const heat = demoReport(3).heat;
      expect(heat).toHaveLength(4);
      for (let i = 1; i < heat.length; i += 1) {
        expect(heat[i].score).toBeLessThanOrEqual(heat[i - 1].score);
      }
      expect(heat[0].score).toBe(100);
    });

    it("en cok kaybeden listesini tutara gore doldurur", () => {
      // Bos birakilsaydi Finans ekrani "maliyet oranlari girilmedi" bos
      // durumunu gosterirdi.
      const top = demoReport(3).top_loss_stations;
      expect(top.length).toBeGreaterThan(0);
      for (let i = 1; i < top.length; i += 1) {
        expect(top[i].total_loss).toBeLessThanOrEqual(top[i - 1].total_loss);
      }
    });
  });

  describe("koşum geçmişi", () => {
    it("asama sayisi kadar kayit uretir, en yeni onde", () => {
      const history = demoRunHistory(4, NOW);
      expect(history).toHaveLength(4);
      expect(history[0].simulationId).toBe("demo-run-4");
      expect(new Date(history[0].ranAt).getTime()).toBeGreaterThan(
        new Date(history[1].ranAt).getTime(),
      );
    });

    it("demo fabrikasinin adini tasir", () => {
      for (const entry of demoRunHistory(5, NOW)) {
        expect(entry.factoryName).toBe(DEMO_FACTORY_NAME);
        expect(entry.simulationId.startsWith("demo-run-")).toBe(true);
      }
    });
  });

  describe("önce/sonra karşılaştırması", () => {
    it("yalnizca son asamada uretilir", () => {
      for (const phase of [1, 2, 3, 4] as DemoPhase[]) {
        expect(demoSnapshot(phase, NOW).comparison).toBeNull();
      }
      expect(demoSnapshot(5, NOW).comparison).not.toBeNull();
    });

    it("dort satirin hepsi iyilesme gosterir", () => {
      const rows = demoComparison();
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.improved)).toBe(true);
    });

    it("degerler demonun kendi verisinden okunur", () => {
      const rows = demoComparison();
      const throughput = rows.find((row) => row.label === "Çıktı");
      // Dorduncu asama 1,19 → besinci asama 1,87
      expect(throughput?.before).toContain("1,19");
      expect(throughput?.after).toContain("1,87");
    });
  });

  it("anlik goruntu butun ekranlarin ihtiyaci olan veriyi tasir", () => {
    const snapshot = demoSnapshot(3, NOW);
    expect(snapshot.config.stations).toHaveLength(4);
    expect(snapshot.run.results.station_metrics).toHaveLength(4);
    expect(snapshot.report.heat.length).toBeGreaterThan(0);
    expect(snapshot.runHistory.length).toBeGreaterThan(0);
  });
});

function station(
  results: ReturnType<typeof demoResults>,
  id: string,
): ReturnType<typeof demoResults>["station_metrics"][number] {
  const found = results.station_metrics.find((item) => item.station_id === id);
  if (!found) {
    throw new Error(`İstasyon bulunamadı: ${id}`);
  }
  return found;
}
