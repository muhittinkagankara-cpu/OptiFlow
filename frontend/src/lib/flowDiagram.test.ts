/**
 * Akış/kayıp diyagramının birim testleri.
 *
 * En kritik özellik korunum yasasıdır: **giren = çıkan + kayıplar**. Sankey
 * diyagramı akışı kalınlıkla anlatır; denge bozulduğunda diyagram bir hata
 * göstermez, yalnızca yanlış kalınlıklar çizer ve kullanıcı gerçekte olmayan
 * bir kaybı görür. Bu yüzden korunum hem sistem düzeyinde hem de her düğümde
 * ayrı ayrı sınanır.
 */

import { describe, expect, it } from "vitest";
import { buildFlowDiagram } from "./flowDiagram";
import type {
  Connection,
  SimulationConfig,
  Station,
  StationMetricsResponse,
} from "../types/simulationTypes";
import { INFINITE_CAPACITY } from "../types/simulationTypes";

function station(id: string): Station {
  return {
    id,
    name: id.toUpperCase(),
    num_servers: 1,
    service_time_distribution: { type: "exponential", params: { mean: 2 } },
    buffer_capacity_before: INFINITE_CAPACITY,
    scrap_rate: 0,
  };
}

function config(ids: string[], connections: Connection[]): SimulationConfig {
  return {
    stations: ids.map(station),
    connections,
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 5 } },
      entry_station_id: ids[0],
    },
    simulation_duration_minutes: 10000,
    warmup_period_minutes: 500,
    num_replications: 30,
    random_seed: 42,
  };
}

function link(from: string, to: string, probability = 1): Connection {
  return { from_station_id: from, to_station_id: to, routing_probability: probability };
}

function metrics(
  id: string,
  flow: { entered: number; completed: number; scrapped?: number; rejected?: number },
  isBottleneck = false,
): StationMetricsResponse {
  return {
    station_id: id,
    station_name: id.toUpperCase(),
    utilization: 0.5,
    avg_queue_length: 1,
    avg_wait_time: 1,
    oee: { availability: 0.9, performance: 0.8, quality: 1, oee: 0.72 },
    is_bottleneck: isBottleneck,
    flow: {
      entered: flow.entered,
      completed: flow.completed,
      scrapped: flow.scrapped ?? 0,
      rejected: flow.rejected ?? 0,
    },
  };
}

/** Bir düğümün giren ve çıkan toplamları. */
function balanceOf(
  diagram: NonNullable<ReturnType<typeof buildFlowDiagram>>,
  nodeIndex: number,
): { incoming: number; outgoing: number } {
  const incoming = diagram.links
    .filter((item) => item.target === nodeIndex)
    .reduce((total, item) => total + item.value, 0);
  const outgoing = diagram.links
    .filter((item) => item.source === nodeIndex)
    .reduce((total, item) => total + item.value, 0);
  return { incoming, outgoing };
}

// --------------------------------------------------------------------------- //
// 1. Korunum yasası — kabul kriterinin özü
// --------------------------------------------------------------------------- //

describe("buildFlowDiagram — giren = çıkan + kayıplar", () => {
  it("firesiz düz hatta denge kurar", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 1000, completed: 1000 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalIn).toBe(1000);
    expect(diagram.totalOut).toBeCloseTo(1000, 9);
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      9,
    );
  });

  it("fireli hatta denge kurar", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000, scrapped: 100 }),
        metrics("b", { entered: 900, completed: 900, scrapped: 90 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalScrapped).toBeCloseTo(100 + 90, 6);
    expect(diagram.totalOut).toBeCloseTo(810, 6);
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      9,
    );
  });

  it("red (tampon dolu) varken de denge kurar", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000, rejected: 120 }),
        metrics("b", { entered: 1000, completed: 1000, rejected: 50 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    // Hatta teklif edilen iş: giren + giriş istasyonunda reddedilen.
    expect(diagram.totalIn).toBe(1120);
    expect(diagram.totalRejected).toBeCloseTo(170, 6);
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      9,
    );
  });

  it("her istasyon düğümünde giren ile çıkan eşittir", () => {
    // Sistem düzeyinde denge tutup düğüm düzeyinde tutmaması mümkündür; Sankey
    // kalınlıkları düğüm bazında çizdiği için asıl önemli olan budur.
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000, scrapped: 50, rejected: 30 }),
        metrics("b", { entered: 900, completed: 900, scrapped: 120 }),
        metrics("c", { entered: 780, completed: 780, rejected: 40 }),
      ],
      config(["a", "b", "c"], [link("a", "b"), link("b", "c")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;

    diagram.nodes.forEach((node, index) => {
      if (node.kind !== "station") {
        return;
      }
      const { incoming, outgoing } = balanceOf(diagram, index);
      expect(outgoing).toBeCloseTo(incoming, 6);
    });
  });

  it("dallanmalı yönlendirmede de denge korunur", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 600, completed: 600, scrapped: 60 }),
        metrics("c", { entered: 400, completed: 400 }),
      ],
      config(
        ["a", "b", "c"],
        [link("a", "b", 0.6), link("a", "c", 0.4)],
      ),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      9,
    );
    diagram.nodes.forEach((node, index) => {
      if (node.kind !== "station") return;
      const { incoming, outgoing } = balanceOf(diagram, index);
      expect(outgoing).toBeCloseTo(incoming, 6);
    });
  });

  it("kısmi yönlendirmede kalan pay sistemden çıkışa gider", () => {
    // Toplam olasılık 1'in altındaysa fark, hattı terk eden paydır.
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 700, completed: 700 }),
      ],
      config(["a", "b"], [link("a", "b", 0.7)]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalOut).toBeCloseTo(1000, 6);
    expect(diagram.totalIn).toBeCloseTo(diagram.totalOut, 6);
  });
});

// --------------------------------------------------------------------------- //
// 2. Gereksiz dal göstermeme (kabul kriteri 2)
// --------------------------------------------------------------------------- //

describe("buildFlowDiagram — boş dallar", () => {
  it("fire yoksa Fire düğümü hiç oluşturulmaz", () => {
    const diagram = buildFlowDiagram(
      [metrics("a", { entered: 1000, completed: 1000 })],
      config(["a"], []),
    );

    expect(diagram?.nodes.some((node) => node.kind === "scrap")).toBe(false);
    expect(diagram?.links.some((item) => item.kind === "scrap")).toBe(false);
  });

  it("red yoksa Reddedildi düğümü hiç oluşturulmaz", () => {
    const diagram = buildFlowDiagram(
      [metrics("a", { entered: 1000, completed: 1000, scrapped: 10 })],
      config(["a"], []),
    );

    expect(diagram?.nodes.some((node) => node.kind === "rejected")).toBe(false);
  });

  it("ihmal edilebilir küçüklükteki kayıp dalı çizilmez", () => {
    // Yarım parçalık bir dal, diyagramda saç teli kalınlığında bir çizgi olur
    // ve yalnızca gürültü ekler.
    const diagram = buildFlowDiagram(
      [metrics("a", { entered: 1000, completed: 1000, scrapped: 0.2 })],
      config(["a"], []),
    );

    expect(diagram?.nodes.some((node) => node.kind === "scrap")).toBe(false);
  });
});

// --------------------------------------------------------------------------- //
// 3. Yapı ve sıralama
// --------------------------------------------------------------------------- //

describe("buildFlowDiagram — yapı", () => {
  it("istasyonları girişten uzaklığa göre sıralar", () => {
    // Metrikler ters sırada verilse bile diyagram akış yönünde olmalı.
    const diagram = buildFlowDiagram(
      [
        metrics("c", { entered: 1000, completed: 1000 }),
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 1000, completed: 1000 }),
      ],
      config(["a", "b", "c"], [link("a", "b"), link("b", "c")]),
    );

    const names = diagram?.nodes
      .filter((node) => node.kind === "station")
      .map((node) => node.key);
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("giriş ve çıkış düğümlerini ekler", () => {
    const diagram = buildFlowDiagram(
      [metrics("a", { entered: 1000, completed: 1000 })],
      config(["a"], []),
    );

    expect(diagram?.nodes[0].kind).toBe("entry");
    expect(diagram?.nodes.some((node) => node.kind === "exit")).toBe(true);
  });

  it("darboğaz istasyonunu işaretler", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 1000, completed: 1000 }, true),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    const marked = diagram?.nodes.filter((node) => node.isBottleneck);
    expect(marked).toHaveLength(1);
    expect(marked?.[0].key).toBe("b");
  });

  it("bağlantı indeksleri düğüm dizisinin sınırları içinde kalır", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000, scrapped: 100, rejected: 50 }),
        metrics("b", { entered: 900, completed: 900 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    for (const item of diagram.links) {
      expect(item.source).toBeGreaterThanOrEqual(0);
      expect(item.target).toBeLessThan(diagram.nodes.length);
      expect(item.source).not.toBe(item.target);
    }
  });
});

// --------------------------------------------------------------------------- //
// 4. Yeniden işleme döngüleri ve uç durumlar
// --------------------------------------------------------------------------- //

describe("buildFlowDiagram — döngüler ve uç durumlar", () => {
  it("geri dönen bağlantıyı çizmez ama bunu bildirir", () => {
    // Sankey döngü çizemez. Sessizce atmak diyagramı doğru gösterip modeli
    // eksik anlatırdı.
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 1000, completed: 1000 }),
      ],
      config(["a", "b"], [link("a", "b"), link("b", "a", 0.2)]),
    );

    expect(diagram?.hasIgnoredRework).toBe(true);
    expect(diagram?.links.some((item) => item.source > item.target)).toBe(false);
  });

  it("döngü yoksa bildirim yapılmaz", () => {
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 1000, completed: 1000 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram?.hasIgnoredRework).toBe(false);
  });

  it("istasyon yoksa diyagram üretmez", () => {
    expect(buildFlowDiagram([], config(["a"], []))).toBeNull();
  });

  it("hiç iş girmemişse diyagram üretmez", () => {
    // Boş bir diyagram kullanıcıya hiçbir şey anlatmaz.
    const diagram = buildFlowDiagram(
      [metrics("a", { entered: 0, completed: 0 })],
      config(["a"], []),
    );
    expect(diagram).toBeNull();
  });

  it("red sayısı gelen akıştan büyükse akışla sınırlanır", () => {
    // Aksi hâlde düğümden çıkan miktar girenden fazla olur ve Sankey negatif
    // kalınlık çizmeye çalışırdı.
    const diagram = buildFlowDiagram(
      [
        metrics("a", { entered: 1000, completed: 1000 }),
        metrics("b", { entered: 10, completed: 10, rejected: 99999 }),
      ],
      config(["a", "b"], [link("a", "b")]),
    );

    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      6,
    );
    expect(diagram.totalOut).toBeGreaterThanOrEqual(0);
  });

  it("20 istasyonlu hatta da denge korunur", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `s${index}`);
    const connections = ids.slice(0, -1).map((id, index) => link(id, ids[index + 1]));
    const rows = ids.map((id, index) =>
      metrics(id, {
        entered: 1000,
        completed: 1000,
        scrapped: index % 4 === 0 ? 30 : 0,
      }),
    );

    const diagram = buildFlowDiagram(rows, config(ids, connections));
    expect(diagram).not.toBeNull();
    if (!diagram) return;
    expect(diagram.totalIn).toBeCloseTo(
      diagram.totalOut + diagram.totalScrapped + diagram.totalRejected,
      6,
    );
    diagram.nodes.forEach((node, index) => {
      if (node.kind !== "station") return;
      const { incoming, outgoing } = balanceOf(diagram, index);
      expect(outgoing).toBeCloseTo(incoming, 6);
    });
  });
});
