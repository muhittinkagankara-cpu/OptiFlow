/**
 * configBuilder birim testleri.
 *
 * Bu dosya arayüzün en kritik mantığını sınar: canvas ile backend şeması
 * arasındaki dönüşüm. Buradaki bir hata sessizdir — kullanıcı ekranda bir model
 * görür, backend başka bir modeli simüle eder. Bu yüzden üç şey test edilir:
 *
 * 1. **Gidiş-dönüş kaybı.** Bir config'i canvas'a çevirip geri döndürdüğümüzde
 *    aynı config çıkmalı. Tek bir alanın düşmesi bile burada yakalanır.
 * 2. **Olasılık dağıtımı.** Birden çok çıkışı olan istasyonlarda toplamın tam
 *    olarak 1.0 olması ve açık verilen olasılıkların korunması.
 * 3. **Hatalı yapılar.** Bağlantısız giriş, eksik istasyon, geçersiz parametre
 *    gibi durumların backend'e gönderilmeden yakalanması.
 */

import { describe, expect, it } from "vitest";
import {
  ARRIVAL_NODE_ID,
  buildFlowFromConfig,
  buildSimulationConfig,
  createEmptyFlow,
  createStationNode,
  generateStationId,
  isStationNode,
  type BuildOptions,
  type FlowEdge,
  type FlowNode,
} from "./configBuilder";
import type { SimulationConfig, Station } from "../types/simulationTypes";
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

function arrivalNode(mean = 3): FlowNode {
  return {
    id: ARRIVAL_NODE_ID,
    type: "arrival",
    position: { x: 0, y: 0 },
    data: { distribution: { type: "exponential", params: { mean } } },
  };
}

function edge(source: string, target: string, probability?: number): FlowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    data: probability === undefined ? {} : { routingProbability: probability },
  };
}

// --------------------------------------------------------------------------- //
// 1. Temel dönüşüm
// --------------------------------------------------------------------------- //

describe("buildSimulationConfig — temel dönüşüm", () => {
  it("düz bir hattı doğru şemaya çevirir", () => {
    const nodes = [arrivalNode(2.5), stationNode("a"), stationNode("b")];
    const edges = [edge(ARRIVAL_NODE_ID, "a"), edge("a", "b")];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.config.arrival_process.entry_station_id).toBe("a");
    expect(result.config.arrival_process.distribution.params.mean).toBe(2.5);
    expect(result.config.connections).toEqual([
      { from_station_id: "a", to_station_id: "b", routing_probability: 1 },
    ]);
    expect(result.config.simulation_duration_minutes).toBe(10000);
    expect(result.config.num_replications).toBe(30);
  });

  it("istasyon kimliğini her zaman node kimliğiyle eşitler", () => {
    // İç veri bozulmuş olsa bile node kimliği kazanmalı; aksi hâlde
    // bağlantılar var olmayan bir istasyona işaret ederdi.
    const broken: FlowNode = {
      id: "gercek-kimlik",
      type: "station",
      position: { x: 0, y: 0 },
      data: { station: station("eski-kimlik") },
    };
    const result = buildSimulationConfig(
      [arrivalNode(), broken],
      [edge(ARRIVAL_NODE_ID, "gercek-kimlik")],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations[0].id).toBe("gercek-kimlik");
  });

  it("arıza modeli yarım bırakılmışsa alanları hiç göndermez", () => {
    // Backend "ya ikisi de ya hiçbiri" kuralı uygular; yarım model 422 döner.
    const node = stationNode("a", { failure_rate: 0.01 });
    const result = buildSimulationConfig(
      [arrivalNode(), node],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations[0]).not.toHaveProperty("failure_rate");
    expect(result.config.stations[0]).not.toHaveProperty("repair_time_distribution");
  });

  it("arıza modeli tamsa korur", () => {
    const node = stationNode("a", {
      failure_rate: 0.01,
      repair_time_distribution: { type: "exponential", params: { mean: 10 } },
    });
    const result = buildSimulationConfig(
      [arrivalNode(), node],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations[0].failure_rate).toBe(0.01);
    expect(result.config.stations[0].repair_time_distribution?.params.mean).toBe(10);
  });
});

// --------------------------------------------------------------------------- //
// 2. Yönlendirme olasılıkları
// --------------------------------------------------------------------------- //

describe("buildSimulationConfig — yönlendirme olasılıkları", () => {
  it("olasılık verilmemişse çıkışlara eşit dağıtır ve toplam tam 1.0 olur", () => {
    const nodes = [
      arrivalNode(),
      stationNode("a"),
      stationNode("b"),
      stationNode("c"),
      stationNode("d"),
    ];
    const edges = [
      edge(ARRIVAL_NODE_ID, "a"),
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "d"),
    ];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fromA = result.config.connections.filter((item) => item.from_station_id === "a");
    expect(fromA).toHaveLength(3);
    const total = fromA.reduce((sum, item) => sum + item.routing_probability, 0);
    // Üçe bölmede kayan nokta artığı kalmamalı: son kenar farkı üstlenir.
    expect(total).toBe(1);
  });

  it("açık verilen olasılıkları korur, kalanı diğerlerine dağıtır", () => {
    const nodes = [arrivalNode(), stationNode("a"), stationNode("b"), stationNode("c")];
    const edges = [
      edge(ARRIVAL_NODE_ID, "a"),
      edge("a", "b", 0.7),
      edge("a", "c"),
    ];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byTarget = Object.fromEntries(
      result.config.connections.map((item) => [item.to_station_id, item.routing_probability]),
    );
    expect(byTarget.b).toBeCloseTo(0.7, 10);
    expect(byTarget.c).toBeCloseTo(0.3, 10);
  });

  it("olasılık toplamı 1'i aşarsa hata verir", () => {
    const nodes = [arrivalNode(), stationNode("a"), stationNode("b"), stationNode("c")];
    const edges = [
      edge(ARRIVAL_NODE_ID, "a"),
      edge("a", "b", 0.7),
      edge("a", "c", 0.6),
    ];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("%100");
  });

  it("kısmi olasılık toplamı 1'in altındaysa kalanı sistemden çıkış sayar", () => {
    // Tek çıkışa %60 verilmişse, kalan %40 hattın sonu demektir; backend bunu
    // bu şekilde yorumlar ve toplam 1'i aşmadığı için geçerlidir.
    const nodes = [arrivalNode(), stationNode("a"), stationNode("b")];
    const edges = [edge(ARRIVAL_NODE_ID, "a"), edge("a", "b", 0.6)];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.connections[0].routing_probability).toBe(0.6);
  });

  it("yeniden işleme döngüsünü (geri bağlantı) korur", () => {
    const nodes = [arrivalNode(), stationNode("islem"), stationNode("kalite")];
    const edges = [
      edge(ARRIVAL_NODE_ID, "islem"),
      edge("islem", "kalite"),
      edge("kalite", "islem", 0.2),
    ];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.connections).toContainEqual({
      from_station_id: "kalite",
      to_station_id: "islem",
      routing_probability: 0.2,
    });
  });

  it("olasılığı sıfır olan bağlantıyı hiç göndermez", () => {
    // Backend routing_probability > 0 şartı koyar; sıfırlık bir yol 422 verirdi.
    const nodes = [arrivalNode(), stationNode("a"), stationNode("b")];
    const edges = [edge(ARRIVAL_NODE_ID, "a"), edge("a", "b", 0)];

    const result = buildSimulationConfig(nodes, edges, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.connections).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------- //
// 3. Hatalı yapılar
// --------------------------------------------------------------------------- //

describe("buildSimulationConfig — hatalı yapılar", () => {
  it("başlangıç noktası yoksa hata verir", () => {
    const result = buildSimulationConfig([stationNode("a")], [], OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("başlangıç noktası");
  });

  it("hiç istasyon yoksa hata verir", () => {
    const result = buildSimulationConfig([arrivalNode()], [], OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("hiç istasyon yok");
  });

  it("başlangıç hiçbir istasyona bağlı değilse hata verir", () => {
    const result = buildSimulationConfig([arrivalNode(), stationNode("a")], [], OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("bağlı değil");
  });

  it("başlangıçtan birden fazla istasyona bağlantı varsa hata verir", () => {
    const result = buildSimulationConfig(
      [arrivalNode(), stationNode("a"), stationNode("b")],
      [edge(ARRIVAL_NODE_ID, "a"), edge(ARRIVAL_NODE_ID, "b")],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("tek bir istasyondan");
  });

  it("başlangıca geri bağlantı yapılamaz", () => {
    const result = buildSimulationConfig(
      [arrivalNode(), stationNode("a")],
      [edge(ARRIVAL_NODE_ID, "a"), edge("a", ARRIVAL_NODE_ID)],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("geri bağlantı");
  });

  it("var olmayan node'a giden bağlantıyı yakalar", () => {
    const result = buildSimulationConfig(
      [arrivalNode(), stationNode("a")],
      [edge(ARRIVAL_NODE_ID, "a"), edge("a", "silinmis-istasyon")],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("artık var olmayan");
  });

  it("üçgen dağılımda sıralama bozuksa backend'e gitmeden yakalar", () => {
    const node = stationNode("a", {
      service_time_distribution: { type: "triangular", params: { min: 5, mode: 2, max: 8 } },
    });
    const result = buildSimulationConfig(
      [arrivalNode(), node],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("sıralı değil");
  });

  it("normal dağılımda sapma sıfırsa yakalar", () => {
    const node = stationNode("a", {
      service_time_distribution: { type: "normal", params: { mean: 5, std: 0 } },
    });
    const result = buildSimulationConfig(
      [arrivalNode(), node],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("Sabit");
  });

  it("fire oranı aralık dışındaysa yakalar", () => {
    const node = stationNode("a", { scrap_rate: 1.5 });
    const result = buildSimulationConfig(
      [arrivalNode(), node],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("fire oranı");
  });

  it("ulaşılamayan istasyonu hata değil uyarı olarak bildirir", () => {
    const result = buildSimulationConfig(
      [arrivalNode(), stationNode("a"), stationNode("kopuk")],
      [edge(ARRIVAL_NODE_ID, "a")],
      OPTIONS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("ulaşamıyor");
    // Uyarı, simülasyonun çalışmasını engellememeli.
    expect(result.config.stations).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------- //
// 4. Gidiş-dönüş (round-trip)
// --------------------------------------------------------------------------- //

const TEMPLATES: Array<[string, SimulationConfig]> = [
  ["tekstil", tekstilTemplate],
  ["gida", gidaTemplate],
  ["metal", metalTemplate],
];

describe("buildFlowFromConfig <-> buildSimulationConfig gidiş-dönüş", () => {
  it.each(TEMPLATES)("%s şablonu kayıpsız dönüşür", (_name, config) => {
    const { nodes, edges } = buildFlowFromConfig(config);
    const result = buildSimulationConfig(nodes, edges, {
      simulation_duration_minutes: config.simulation_duration_minutes,
      warmup_period_minutes: config.warmup_period_minutes,
      num_replications: config.num_replications,
      random_seed: config.random_seed,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.stations).toEqual(config.stations);
    expect(result.config.connections).toEqual(config.connections);
    expect(result.config.arrival_process).toEqual(config.arrival_process);
    expect(result.config.simulation_duration_minutes).toBe(
      config.simulation_duration_minutes,
    );
    expect(result.config.warmup_period_minutes).toBe(config.warmup_period_minutes);
    expect(result.config.num_replications).toBe(config.num_replications);
  });

  it.each(TEMPLATES)("%s şablonunda her istasyon bir node olur", (_name, config) => {
    const { nodes, edges } = buildFlowFromConfig(config);

    expect(nodes.filter(isStationNode)).toHaveLength(config.stations.length);
    expect(nodes.filter((node) => node.type === "arrival")).toHaveLength(1);
    // Bağlantılar + varış kenarı
    expect(edges).toHaveLength(config.connections.length + 1);
  });

  it("yerleşimde node'lar üst üste binmez", () => {
    const { nodes } = buildFlowFromConfig(tekstilTemplate);
    const positions = nodes.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(positions).size).toBe(nodes.length);
  });

  it("yeniden işleme döngüsünde yerleşim sonsuz katman üretmez", () => {
    const config: SimulationConfig = {
      stations: [station("islem"), station("kalite")],
      connections: [
        { from_station_id: "islem", to_station_id: "kalite", routing_probability: 1 },
        { from_station_id: "kalite", to_station_id: "islem", routing_probability: 0.3 },
      ],
      arrival_process: {
        distribution: { type: "exponential", params: { mean: 4 } },
        entry_station_id: "islem",
      },
      simulation_duration_minutes: 10000,
      warmup_period_minutes: 500,
      num_replications: 30,
      random_seed: null,
    };

    const { nodes, edges } = buildFlowFromConfig(config);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(3);
  });

  it("ulaşılamayan istasyonu da canvas'a yerleştirir", () => {
    const config: SimulationConfig = {
      stations: [station("a"), station("kopuk")],
      connections: [],
      arrival_process: {
        distribution: { type: "exponential", params: { mean: 4 } },
        entry_station_id: "a",
      },
      simulation_duration_minutes: 10000,
      warmup_period_minutes: 500,
      num_replications: 30,
      random_seed: null,
    };

    const { nodes } = buildFlowFromConfig(config);
    expect(nodes.map((node) => node.id)).toContain("kopuk");
  });

  it("kısmi olasılıklı kenarı etiketler, tam olasılıklıyı etiketlemez", () => {
    const config = gidaTemplate;
    const withPartial: SimulationConfig = {
      ...config,
      connections: [
        { ...config.connections[0], routing_probability: 0.25 },
        config.connections[1],
      ],
    };
    const { edges } = buildFlowFromConfig(withPartial);
    const labelled = edges.filter((item) => item.label !== undefined);

    expect(labelled).toHaveLength(1);
    expect(labelled[0].label).toBe("%25");
  });
});

// --------------------------------------------------------------------------- //
// 5. Node oluşturma yardımcıları
// --------------------------------------------------------------------------- //

describe("node oluşturma yardımcıları", () => {
  it("çakışmayan kimlik üretir", () => {
    const id = generateStationId(["istasyon-1", "istasyon-2"]);
    expect(id).toBe("istasyon-3");
  });

  it("kimlik numarası node sayısından değil 1'den başlar", () => {
    // Varış kutusu ve kullanıcının adlandırdığı istasyonlar sayıyı şişirmemeli:
    // üç istasyonlu bir modelde eklenen kutu "Yeni İstasyon 5" olmamalı.
    const id = generateStationId(["__arrival__", "kesim", "dikis", "kalite"]);
    expect(id).toBe("istasyon-1");
  });

  it("yeni istasyon node'u geçerli varsayılanlarla gelir", () => {
    const node = createStationNode(["a"], { x: 10, y: 20 });
    expect(node.type).toBe("station");
    expect(node.data.station.id).toBe(node.id);
    expect(node.data.station.num_servers).toBeGreaterThanOrEqual(1);
    expect(node.data.station.buffer_capacity_before).toBe(INFINITE_CAPACITY);
  });

  it("yeni eklenen istasyon bağlanınca geçerli config üretir", () => {
    const { nodes, edges } = createEmptyFlow();
    const fresh = createStationNode(
      nodes.map((node) => node.id),
      { x: 300, y: 240 },
    );
    const result = buildSimulationConfig(
      [...nodes, fresh],
      [...edges, edge(ARRIVAL_NODE_ID, fresh.id)],
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.stations).toHaveLength(1);
    expect(result.config.arrival_process.entry_station_id).toBe(fresh.id);
  });

  it("boş canvas yalnızca varış node'u içerir", () => {
    const { nodes, edges } = createEmptyFlow();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("arrival");
    expect(edges).toHaveLength(0);
  });
});
