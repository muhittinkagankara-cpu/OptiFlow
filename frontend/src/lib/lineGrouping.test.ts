/**
 * Hat / bölüm gruplamasının birim testleri — Fabrika geneli özet, Faz 1.
 *
 * Gruplama görsel bir katmandır, ama sessizce yanlış olabilir: bir istasyon
 * yanlış hatta düşerse kullanıcı fabrikasını yanlış okur ve bunu fark etmesi
 * için her kutuyu tek tek saymasi gerekir. İki şey ayrı ayrı sınanır:
 *
 * 1. `line_name` alanının canvas ile backend şeması arasında kayıpsız ve
 *    normalleştirilmiş (kırpılmış, boşsa hiç gönderilmemiş) taşınması.
 * 2. Kutuların doğru istasyonları kapsaması ve hat adı girilmemiş modellerde
 *    hiç kutu üretmemesi — kabul kriterinin özü budur.
 */

import { describe, expect, it } from "vitest";
import {
  ARRIVAL_NODE_ID,
  buildFlowFromConfig,
  buildLineGroups,
  buildSimulationConfig,
  collectLineNames,
  type BuildOptions,
  type FlowEdge,
  type FlowNode,
} from "./configBuilder";
import type { Station } from "../types/simulationTypes";
import { INFINITE_CAPACITY } from "../types/simulationTypes";
import { gidaTemplate, metalTemplate, tekstilTemplate } from "../templates";

const OPTIONS: BuildOptions = {
  simulation_duration_minutes: 10000,
  warmup_period_minutes: 500,
  num_replications: 30,
  random_seed: 42,
};

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    id,
    name: id.toUpperCase(),
    num_servers: 1,
    service_time_distribution: { type: "exponential", params: { mean: 2 } },
    buffer_capacity_before: INFINITE_CAPACITY,
    scrap_rate: 0,
    ...overrides,
  };
}

function stationNode(id: string, overrides: Partial<Station> = {}): FlowNode {
  return {
    id,
    type: "station",
    position: { x: 0, y: 0 },
    data: { station: station(id, overrides) },
  };
}

/** Konumu ve ölçülmüş boyutu belli bir istasyon — kutu geometrisi testleri için. */
function placedStation(
  id: string,
  position: { x: number; y: number },
  lineName?: string,
): FlowNode {
  const base = stationNode(id, lineName === undefined ? {} : { line_name: lineName });
  return { ...base, position, width: 200, height: 80 };
}

function arrivalNode(mean = 3): FlowNode {
  return {
    id: ARRIVAL_NODE_ID,
    type: "arrival",
    position: { x: 0, y: 0 },
    data: { distribution: { type: "exponential", params: { mean } } },
  };
}

function edge(source: string, target: string): FlowEdge {
  return { id: `${source}->${target}`, source, target, data: {} };
}

// --------------------------------------------------------------------------- //
// 1. Alanın şemaya taşınması
// --------------------------------------------------------------------------- //

describe("line_name — şemaya taşınması", () => {
  it("hat adını backend şemasına aktarır", () => {
    const nodes = [
      arrivalNode(),
      stationNode("a", { line_name: "Kesim Hattı" }),
      stationNode("b", { line_name: "Montaj Hattı" }),
    ];
    const result = buildSimulationConfig(
      nodes,
      [edge(ARRIVAL_NODE_ID, "a"), edge("a", "b")],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations[0].line_name).toBe("Kesim Hattı");
    expect(result.config.stations[1].line_name).toBe("Montaj Hattı");
  });

  it("hat adının baştaki ve sondaki boşluklarını kırpar", () => {
    // Kırpılmasaydı "Kesim" ile " Kesim " ayrı iki grup olurdu ve kullanıcı
    // aradaki farkı ekranda göremezdi.
    const nodes = [arrivalNode(), stationNode("a", { line_name: "  Kesim Hattı  " })];
    const result = buildSimulationConfig(nodes, [edge(ARRIVAL_NODE_ID, "a")], OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations[0].line_name).toBe("Kesim Hattı");
  });

  it("boş hat adını hiç göndermez", () => {
    // Boş metin backend'de "adı boş olan bir hat" grubu yaratır ve arayüzde
    // gruplanmamış istasyonlardan ayırt edilemezdi.
    const nodes = [
      arrivalNode(),
      stationNode("a", { line_name: "   " }),
      stationNode("b", { line_name: "" }),
    ];
    const result = buildSimulationConfig(
      nodes,
      [edge(ARRIVAL_NODE_ID, "a"), edge("a", "b")],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("line_name" in result.config.stations[0]).toBe(false);
    expect("line_name" in result.config.stations[1]).toBe(false);
  });

  it("hat adı verilmeyen model alanı hiç taşımaz", () => {
    const nodes = [arrivalNode(), stationNode("a")];
    const result = buildSimulationConfig(nodes, [edge(ARRIVAL_NODE_ID, "a")], OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("line_name" in result.config.stations[0]).toBe(false);
  });

  it("hat adı gidiş-dönüşte korunur", () => {
    const nodes = [arrivalNode(), stationNode("a", { line_name: "Kesim Hattı" })];
    const built = buildSimulationConfig(nodes, [edge(ARRIVAL_NODE_ID, "a")], OPTIONS);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const flow = buildFlowFromConfig(built.config);
    const rebuilt = buildSimulationConfig(flow.nodes, flow.edges, OPTIONS);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.config.stations[0].line_name).toBe("Kesim Hattı");
  });
});

// --------------------------------------------------------------------------- //
// 2. Otomatik tamamlama listesi
// --------------------------------------------------------------------------- //

describe("collectLineNames", () => {
  it("tekilleştirir ve alfabetik sıralar", () => {
    const nodes = [
      arrivalNode(),
      stationNode("a", { line_name: "Montaj Hattı" }),
      stationNode("b", { line_name: "Kesim Hattı" }),
      stationNode("c", { line_name: "Montaj Hattı" }),
    ];
    expect(collectLineNames(nodes)).toEqual(["Kesim Hattı", "Montaj Hattı"]);
  });

  it("boş ve yalnızca boşluktan oluşan adları atar", () => {
    const nodes = [
      arrivalNode(),
      stationNode("a", { line_name: "" }),
      stationNode("b", { line_name: "   " }),
      stationNode("c"),
    ];
    expect(collectLineNames(nodes)).toEqual([]);
  });

  it("varış node'unu görmezden gelir", () => {
    expect(collectLineNames([arrivalNode()])).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// 3. Grup kutuları
// --------------------------------------------------------------------------- //

describe("buildLineGroups", () => {
  it("hat adı girilmemişse hiç kutu üretmez", () => {
    // Kabul kriteri: kullanıcı gruplama istemediyse gruplama gösterilmez.
    const nodes = [arrivalNode(), stationNode("a"), stationNode("b")];
    expect(buildLineGroups(nodes)).toEqual([]);
  });

  it("aynı hattaki istasyonları tek kutuda toplar", () => {
    const nodes = [
      arrivalNode(),
      placedStation("a", { x: 100, y: 100 }, "Kesim Hattı"),
      placedStation("b", { x: 400, y: 100 }, "Kesim Hattı"),
    ];
    const groups = buildLineGroups(nodes);

    expect(groups).toHaveLength(1);
    expect(groups[0].lineName).toBe("Kesim Hattı");
    expect([...groups[0].stationIds].sort()).toEqual(["a", "b"]);
  });

  it("kutu, hattaki tüm istasyonları kapsar", () => {
    const nodes = [
      placedStation("a", { x: 100, y: 100 }, "Kesim Hattı"),
      placedStation("b", { x: 400, y: 300 }, "Kesim Hattı"),
    ];
    const [box] = buildLineGroups(nodes);

    // Sol üst köşe en soldaki/en üstteki istasyondan önce başlamalı.
    expect(box.position.x).toBeLessThan(100);
    expect(box.position.y).toBeLessThan(100);
    // Sağ alt köşe en sağdaki (400+200) ve en alttaki (300+80) istasyonu geçmeli.
    expect(box.position.x + box.width).toBeGreaterThan(600);
    expect(box.position.y + box.height).toBeGreaterThan(380);
  });

  it("farklı hatları ayrı kutulara koyar ve karıştırmaz", () => {
    const nodes = [
      placedStation("a", { x: 0, y: 0 }, "Kesim Hattı"),
      placedStation("b", { x: 800, y: 0 }, "Montaj Hattı"),
      placedStation("c", { x: 1200, y: 0 }, "Montaj Hattı"),
    ];
    const groups = buildLineGroups(nodes);

    expect(groups.map((group) => group.lineName)).toEqual([
      "Kesim Hattı",
      "Montaj Hattı",
    ]);
    expect(groups[0].stationIds).toEqual(["a"]);
    expect([...groups[1].stationIds].sort()).toEqual(["b", "c"]);
  });

  it("gruplanmamış istasyonu hiçbir kutuya almaz", () => {
    const nodes = [
      placedStation("a", { x: 0, y: 0 }, "Kesim Hattı"),
      placedStation("b", { x: 300, y: 0 }),
    ];
    const groups = buildLineGroups(nodes);

    expect(groups).toHaveLength(1);
    expect(groups[0].stationIds).toEqual(["a"]);
  });

  it("ölçülmemiş node'lar için de geçerli bir kutu üretir", () => {
    // React Flow ilk karede boyutu bildirmez; kutu sıfır boyutlu çizilmemeli.
    const nodes = [
      stationNode("a", { line_name: "Kesim Hattı" }),
      stationNode("b", { line_name: "Kesim Hattı" }),
    ];
    const [box] = buildLineGroups(nodes);

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("hat adını kırparak eşleştirir", () => {
    const nodes = [
      placedStation("a", { x: 0, y: 0 }, "Kesim Hattı"),
      placedStation("b", { x: 300, y: 0 }, "  Kesim Hattı  "),
    ];
    const groups = buildLineGroups(nodes);

    expect(groups).toHaveLength(1);
    expect([...groups[0].stationIds].sort()).toEqual(["a", "b"]);
  });

  it("20 istasyonlu 3 hatlı modeli doğru gruplar", () => {
    // Şartnamenin hedeflediği gerçek fabrika ölçeği.
    const lines = ["Kesim Hattı", "Montaj Hattı", "Paketleme Hattı"];
    const nodes: FlowNode[] = [arrivalNode()];
    for (let index = 0; index < 20; index += 1) {
      const lineName = lines[index % lines.length];
      nodes.push(
        placedStation(`istasyon-${index}`, { x: index * 260, y: 0 }, lineName),
      );
    }

    const groups = buildLineGroups(nodes);
    expect(groups).toHaveLength(3);
    expect(groups.reduce((total, group) => total + group.stationIds.length, 0)).toBe(20);
    // Hiçbir istasyon iki kutuda birden görünmemeli.
    const seen = new Set(groups.flatMap((group) => group.stationIds));
    expect(seen.size).toBe(20);
  });
});

// --------------------------------------------------------------------------- //
// 4. Geriye dönük uyumluluk
// --------------------------------------------------------------------------- //

describe("hazır şablonlar — geriye dönük uyumluluk", () => {
  it("üç şablon da hat adı taşımaz ve gruplama üretmez", () => {
    // Kabul kriteri 1: line_name girilmeden oluşturulan mevcut modeller hiç
    // bozulmadan çalışmaya devam etmeli.
    for (const template of [gidaTemplate, metalTemplate, tekstilTemplate]) {
      const flow = buildFlowFromConfig(template);
      expect(collectLineNames(flow.nodes)).toEqual([]);
      expect(buildLineGroups(flow.nodes)).toEqual([]);

      const rebuilt = buildSimulationConfig(flow.nodes, flow.edges, OPTIONS);
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) return;
      for (const item of rebuilt.config.stations) {
        expect("line_name" in item).toBe(false);
      }
    }
  });
});
