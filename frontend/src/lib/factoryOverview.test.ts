/**
 * Fabrika geneli özetinin birim testleri — Faz 2.
 *
 * Şartnamenin ölçeklenebilirlik testi burada karşılanır: 20 istasyonlu, 3 hatlı
 * sahte bir sonuçla gruplamanın doğru çalıştığı ve darboğazın hangi hatta
 * olursa olsun bulunduğu doğrulanır. Gerçek bir simülasyon çalıştırmaya gerek
 * yoktur; sınanan şey motorun sayıları değil, o sayıların nasıl özetlendiğidir.
 *
 * Buradaki hatalar sessizdir: bir istasyon yanlış hatta düşerse ekranda hiçbir
 * şey bozuk görünmez, kullanıcı yalnızca yanlış hatta kapasite ekler.
 */

import { describe, expect, it } from "vitest";
import { configLines, summarizeFactory, UNGROUPED_LINE_NAME } from "./factoryOverview";
import type {
  SimulationConfig,
  Station,
  StationMetricsResponse,
} from "../types/simulationTypes";
import { INFINITE_CAPACITY } from "../types/simulationTypes";

function station(id: string, lineName?: string): Station {
  return {
    id,
    name: id.toUpperCase(),
    ...(lineName === undefined ? {} : { line_name: lineName }),
    num_servers: 1,
    service_time_distribution: { type: "exponential", params: { mean: 2 } },
    buffer_capacity_before: INFINITE_CAPACITY,
    scrap_rate: 0,
  };
}

function config(stations: Station[]): SimulationConfig {
  return {
    stations,
    connections: [],
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 5 } },
      entry_station_id: stations[0]?.id ?? "a",
    },
    simulation_duration_minutes: 10000,
    warmup_period_minutes: 500,
    num_replications: 30,
    random_seed: 42,
  };
}

function metrics(
  id: string,
  utilization: number,
  oee = 0.7,
): StationMetricsResponse {
  return {
    station_id: id,
    station_name: id.toUpperCase(),
    utilization,
    avg_queue_length: utilization * 4,
    avg_wait_time: utilization * 6,
    oee: {
      availability: 0.9,
      performance: 0.85,
      quality: 0.98,
      oee,
    },
    is_bottleneck: false,
  };
}

// --------------------------------------------------------------------------- //
// Şartnamenin ölçek senaryosu: 20 istasyon, 3 hat
// --------------------------------------------------------------------------- //

const LINES = ["Kesim Hattı", "Montaj Hattı", "Paketleme Hattı"];

/**
 * 20 istasyonu 3 hatta dağıtır (7 + 7 + 6).
 *
 * Darboğaz bilinçli olarak **ikinci** hatta ve listenin ortasına yerleştirilir:
 * ilk sıradaki ya da ilk hattaki istasyonu darboğaz saymak gibi bir sıralama
 * hatası, darboğaz sona ya da ortaya konmadıkça fark edilmezdi.
 */
function largeFactory(): {
  stations: Station[];
  results: StationMetricsResponse[];
  bottleneckId: string;
} {
  const stations: Station[] = [];
  const results: StationMetricsResponse[] = [];
  const bottleneckId = "istasyon-9";

  for (let index = 0; index < 20; index += 1) {
    const id = `istasyon-${index}`;
    const lineName = LINES[Math.min(Math.floor(index / 7), 2)];
    stations.push(station(id, lineName));
    // Doluluk 0.30 ile 0.68 arasında dolaşır; darboğaz belirgin biçimde üstte.
    const utilization = id === bottleneckId ? 0.89 : 0.3 + (index % 8) * 0.05;
    results.push(metrics(id, utilization, 0.55 + (index % 5) * 0.05));
  }

  return { stations, results, bottleneckId };
}

describe("summarizeFactory — 20 istasyon, 3 hat", () => {
  it("istasyonları üç hatta doğru dağıtır", () => {
    const { stations, results, bottleneckId } = largeFactory();
    const summary = summarizeFactory(results, config(stations), bottleneckId);

    expect(summary.lineCount).toBe(3);
    expect(summary.stationCount).toBe(20);
    expect(summary.lines.map((line) => line.lineName)).toEqual(LINES);
    expect(summary.lines.map((line) => line.stations.length)).toEqual([7, 7, 6]);
  });

  it("hiçbir istasyonu iki hatta birden koymaz ve hiçbirini düşürmez", () => {
    const { stations, results, bottleneckId } = largeFactory();
    const summary = summarizeFactory(results, config(stations), bottleneckId);

    const seen = summary.lines.flatMap((line) =>
      line.stations.map((item) => item.station_id),
    );
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it("genel darboğazı hangi hatta olursa olsun bulur", () => {
    const { stations, results, bottleneckId } = largeFactory();
    const summary = summarizeFactory(results, config(stations), bottleneckId);

    expect(summary.bottleneck?.station_id).toBe(bottleneckId);
    expect(summary.bottleneckLineName).toBe("Montaj Hattı");
  });

  it("darboğazı yalnızca kendi hattında işaretler", () => {
    const { stations, results, bottleneckId } = largeFactory();
    const summary = summarizeFactory(results, config(stations), bottleneckId);

    const marked = summary.lines.filter((line) => line.hasFactoryBottleneck);
    expect(marked).toHaveLength(1);
    expect(marked[0].lineName).toBe("Montaj Hattı");
  });

  it("her hat için kendi en yoğun istasyonunu bulur", () => {
    const { stations, results, bottleneckId } = largeFactory();
    const summary = summarizeFactory(results, config(stations), bottleneckId);

    for (const line of summary.lines) {
      const highest = Math.max(...line.stations.map((item) => item.utilization));
      expect(line.bottleneck.utilization).toBe(highest);
    }
  });

  it("20 istasyonlu modelde gruplama arayüzünü açar", () => {
    const { stations, results, bottleneckId } = largeFactory();
    expect(summarizeFactory(results, config(stations), bottleneckId).isGrouped).toBe(
      true,
    );
  });
});

// --------------------------------------------------------------------------- //
// Küçük modeller bozulmamalı (kabul kriteri 3)
// --------------------------------------------------------------------------- //

describe("summarizeFactory — hat adı olmayan küçük modeller", () => {
  const stations = [station("a"), station("b"), station("c")];
  const results = [metrics("a", 0.8), metrics("b", 0.5), metrics("c", 0.6)];

  it("tüm istasyonları tek bir 'Genel' grubuna koyar", () => {
    const summary = summarizeFactory(results, config(stations), "a");

    expect(summary.lineCount).toBe(1);
    expect(summary.lines[0].lineName).toBe(UNGROUPED_LINE_NAME);
    expect(summary.lines[0].isUngrouped).toBe(true);
    expect(summary.lines[0].stations).toHaveLength(3);
  });

  it("gruplama arayüzünü açmaz", () => {
    // Kabul kriteri: tek grup varsa kart/akordeon gösterilmez, düz tabloya
    // düşülür — üç istasyonda gruplama hiçbir bilgi eklemez.
    expect(summarizeFactory(results, config(stations), "a").isGrouped).toBe(false);
  });

  it("darboğazı yine de doğru bildirir", () => {
    const summary = summarizeFactory(results, config(stations), "a");
    expect(summary.bottleneck?.station_id).toBe("a");
    expect(summary.bottleneckLineName).toBe(UNGROUPED_LINE_NAME);
  });

  it("hepsi aynı hatta konmuşsa da gruplama arayüzünü açmaz", () => {
    const single = [
      station("a", "Tek Hat"),
      station("b", "Tek Hat"),
      station("c", "Tek Hat"),
    ];
    expect(summarizeFactory(results, config(single), "a").isGrouped).toBe(false);
  });
});

// --------------------------------------------------------------------------- //
// Karışık durumlar
// --------------------------------------------------------------------------- //

describe("summarizeFactory — karışık ve uç durumlar", () => {
  it("hat adı olan ve olmayan istasyonlar bir arada olabilir", () => {
    const stations = [station("a", "Kesim Hattı"), station("b"), station("c")];
    const results = [metrics("a", 0.8), metrics("b", 0.5), metrics("c", 0.6)];
    const summary = summarizeFactory(results, config(stations), "a");

    expect(summary.lineCount).toBe(2);
    // Adsız grup her zaman sonda durur: adı olan hatlar kullanıcının bilinçli
    // olarak tanımladığı yapıdır.
    expect(summary.lines[0].lineName).toBe("Kesim Hattı");
    expect(summary.lines[1].lineName).toBe(UNGROUPED_LINE_NAME);
  });

  it("hat adındaki baştaki ve sondaki boşlukları yok sayar", () => {
    const stations = [station("a", "Kesim Hattı"), station("b", "  Kesim Hattı  ")];
    const results = [metrics("a", 0.8), metrics("b", 0.5)];
    const summary = summarizeFactory(results, config(stations), "a");

    expect(summary.lineCount).toBe(1);
    expect(summary.lines[0].stations).toHaveLength(2);
  });

  it("yalnızca boşluktan oluşan hat adını gruplanmamış sayar", () => {
    const stations = [station("a", "   ")];
    const results = [metrics("a", 0.8)];
    const summary = summarizeFactory(results, config(stations), "a");

    expect(summary.lines[0].lineName).toBe(UNGROUPED_LINE_NAME);
  });

  it("backend'in darboğaz kimliği listede yoksa en yoğun istasyona düşer", () => {
    // Sessizce darboğazsız kalmaktansa doğruya yakın bir cevap vermek yeğdir.
    const stations = [station("a"), station("b")];
    const results = [metrics("a", 0.4), metrics("b", 0.9)];
    const summary = summarizeFactory(results, config(stations), "bilinmeyen");

    expect(summary.bottleneck?.station_id).toBe("b");
  });

  it("boş istasyon listesinde çökmez", () => {
    const summary = summarizeFactory([], config([station("a")]), "a");

    expect(summary.bottleneck).toBeNull();
    expect(summary.bottleneckLineName).toBeNull();
    expect(summary.lineCount).toBe(0);
    expect(summary.isGrouped).toBe(false);
    expect(summary.averageOee).toBe(0);
  });

  it("ortalamaları istasyon sayısına göre hesaplar", () => {
    const stations = [station("a", "Hat A"), station("b", "Hat A"), station("c", "Hat B")];
    const results = [
      metrics("a", 0.4, 0.6),
      metrics("b", 0.6, 0.8),
      metrics("c", 0.9, 0.9),
    ];
    const summary = summarizeFactory(results, config(stations), "c");

    const hatA = summary.lines.find((line) => line.lineName === "Hat A");
    expect(hatA?.averageOee).toBeCloseTo(0.7, 10);
    expect(hatA?.averageUtilization).toBeCloseTo(0.5, 10);
    // Fabrika ortalaması tüm istasyonlar üzerinden alınır, hat ortalamalarının
    // ortalaması değil; hatlar farklı sayıda istasyon taşıyabilir.
    expect(summary.averageOee).toBeCloseTo((0.6 + 0.8 + 0.9) / 3, 10);
  });

  it("hattın en yoğun istasyonunu en düşük OEE'ye göre seçmez", () => {
    // Aç kalan istasyon düşük OEE gösterir ama kısıt değildir; bu ayrım motor
    // tarafında bir kez hataya yol açmıştı.
    const stations = [station("hizli", "Hat A"), station("darbogaz", "Hat A")];
    const results = [metrics("hizli", 0.2, 0.3), metrics("darbogaz", 0.85, 0.9)];
    const summary = summarizeFactory(results, config(stations), "darbogaz");

    expect(summary.lines[0].bottleneck.station_id).toBe("darbogaz");
  });
});

// --------------------------------------------------------------------------- //
// Animasyon sekmeleri
// --------------------------------------------------------------------------- //

describe("configLines", () => {
  it("hatları ve istasyon kimliklerini çıkarır", () => {
    const stations = [
      station("a", "Kesim Hattı"),
      station("b", "Montaj Hattı"),
      station("c", "Kesim Hattı"),
    ];
    const lines = configLines(config(stations));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ lineName: "Kesim Hattı", stationIds: ["a", "c"] });
    expect(lines[1]).toEqual({ lineName: "Montaj Hattı", stationIds: ["b"] });
  });

  it("hat adı yoksa tek bir 'Genel' hat döndürür", () => {
    // Çağıran taraf tek hatta sekme göstermez.
    const lines = configLines(config([station("a"), station("b")]));

    expect(lines).toHaveLength(1);
    expect(lines[0].lineName).toBe(UNGROUPED_LINE_NAME);
    expect(lines[0].stationIds).toEqual(["a", "b"]);
  });

  it("adsız grubu sona koyar", () => {
    const stations = [station("a"), station("b", "Kesim Hattı")];
    const lines = configLines(config(stations));

    expect(lines.map((line) => line.lineName)).toEqual([
      "Kesim Hattı",
      UNGROUPED_LINE_NAME,
    ]);
  });

  it("20 istasyonlu modelde her istasyonu tam olarak bir hatta koyar", () => {
    const { stations } = largeFactory();
    const lines = configLines(config(stations));

    expect(lines).toHaveLength(3);
    const ids = lines.flatMap((line) => line.stationIds);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
});
