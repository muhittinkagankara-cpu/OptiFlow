/**
 * Yerleşim dönüşümlerinin ve kaydedilmemiş değişiklik hesabının birim testleri.
 *
 * Buradaki hatalar sessizdir ve pahalıdır. Yerleşim yanlış çıkarılırsa
 * kullanıcı fabrikayı kaydeder, sayfayı yeniler ve yirmi kutunun yeniden
 * otomatik yerleşime dizildiğini görür — kaydettiğini sandığı iş kaybolmuştur.
 * Kaydedilmemiş değişiklik hesabı yanlışsa ya sürekli "değişiklik var" yazar ve
 * gösterge anlamını yitirir, ya da hiç yazmaz ve kullanıcı kaydetmeden çıkar.
 */

import { describe, expect, it } from "vitest";
import {
  applyLayout,
  canonicalize,
  extractLayout,
  hasUnsavedChanges,
} from "./factoryModel";
import { ARRIVAL_NODE_ID } from "./configBuilder";
import type { FlowNode } from "./configBuilder";
import type { SimulationConfig, Station } from "../types/simulationTypes";

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    id,
    name: id,
    num_servers: 1,
    service_time_distribution: { type: "exponential", params: { mean: 2 } },
    buffer_capacity_before: -1,
    scrap_rate: 0,
    ...overrides,
  };
}

function stationNode(id: string, x: number, y: number): FlowNode {
  return {
    id,
    type: "station",
    position: { x, y },
    data: { station: station(id) },
  } as FlowNode;
}

function arrivalNode(x: number, y: number): FlowNode {
  return {
    id: ARRIVAL_NODE_ID,
    type: "arrival",
    position: { x, y },
    data: { distribution: { type: "exponential", params: { mean: 4 } } },
  } as FlowNode;
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    stations: [station("kesim"), station("montaj")],
    connections: [
      { from_station_id: "kesim", to_station_id: "montaj", routing_probability: 1 },
    ],
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 4 } },
      entry_station_id: "kesim",
    },
    simulation_duration_minutes: 1000,
    warmup_period_minutes: 100,
    num_replications: 30,
    random_seed: 42,
    ...overrides,
  };
}

describe("extractLayout", () => {
  it("istasyon ve varış kutularının konumunu alır", () => {
    const layout = extractLayout([
      arrivalNode(-260, 100),
      stationNode("kesim", 0, 100),
      stationNode("montaj", 320, 100),
    ]);

    expect(layout.stations).toEqual({
      kesim: { x: 0, y: 100 },
      montaj: { x: 320, y: 100 },
    });
    expect(layout.arrival).toEqual({ x: -260, y: 100 });
  });

  it("varış kutusu yoksa alanı hiç yazmaz", () => {
    // `undefined` ile "hiç verilmemiş" backend'de aynı şeydir; alanı boş
    // bırakmak, yokluğu açıkça belirtmekten daha az bilgi taşımaz.
    const layout = extractLayout([stationNode("kesim", 10, 20)]);
    expect(layout.arrival).toBeUndefined();
  });

  it("hat grup kutularını dışarıda bırakır", () => {
    // Grup kutuları state'te tutulmaz, her renderda istasyonların konumundan
    // türetilir. Kaydedilselerdi bir istasyon taşındığında kutu eski yerinde
    // kalır ve iki temsil sessizce ayrışırdı.
    const withGroup = [
      stationNode("kesim", 0, 100),
      { id: "hat:Ana Hat", type: "lineGroup", position: { x: -20, y: 60 }, data: {} },
    ] as FlowNode[];

    expect(Object.keys(extractLayout(withGroup).stations)).toEqual(["kesim"]);
  });

  it("yirmi istasyonun konumunu eksiksiz taşır", () => {
    // Gerçek bir fabrika ölçeğinde sınanır: kayıp tek bir kutu bile,
    // kullanıcının elle yerleştirdiği bir şeyin kaybolması demektir.
    const nodes = Array.from({ length: 20 }, (_, index) =>
      stationNode(`s${index}`, index * 37, index * 13),
    );
    const layout = extractLayout(nodes);

    expect(Object.keys(layout.stations)).toHaveLength(20);
    expect(layout.stations.s19).toEqual({ x: 19 * 37, y: 19 * 13 });
  });
});

describe("applyLayout", () => {
  it("kaydedilmiş konumları geri uygular", () => {
    const auto = [arrivalNode(0, 240), stationNode("kesim", 280, 240)];
    const restored = applyLayout(auto, {
      stations: { kesim: { x: 111, y: 222 } },
      arrival: { x: -50, y: 10 },
    });

    expect(restored[0].position).toEqual({ x: -50, y: 10 });
    expect(restored[1].position).toEqual({ x: 111, y: 222 });
  });

  it("yerleşim yoksa otomatik yerleşimi bozmaz", () => {
    const auto = [stationNode("kesim", 280, 240)];
    expect(applyLayout(auto, null)).toBe(auto);
    expect(applyLayout(auto, undefined)).toBe(auto);
  });

  it("yerleşimde bulunmayan istasyon yerinde kalır", () => {
    // Kullanıcı bir istasyon ekleyip kaydetmeden sayfayı yenilerse model yine
    // açılmalıdır; yeni kutu otomatik yerleşimdeki yerinde görünür.
    const auto = [stationNode("kesim", 280, 240), stationNode("yeni", 560, 240)];
    const restored = applyLayout(auto, { stations: { kesim: { x: 5, y: 5 } } });

    expect(restored[0].position).toEqual({ x: 5, y: 5 });
    expect(restored[1].position).toEqual({ x: 560, y: 240 });
  });

  it("modelde olmayan kimlikleri yok sayar", () => {
    // Kullanıcı bir istasyonu sildiğinde yerleşimde eski kimlik kalabilir. Bunu
    // hata saymak, sunuma ait bir ayrıntının modeli açılamaz hâle getirmesi
    // demek olurdu.
    const auto = [stationNode("kesim", 280, 240)];
    const restored = applyLayout(auto, {
      stations: { kesim: { x: 1, y: 2 }, silinmis: { x: 900, y: 900 } },
    });

    expect(restored).toHaveLength(1);
    expect(restored[0].position).toEqual({ x: 1, y: 2 });
  });

  it("varış konumu verilmemişse varış kutusuna dokunmaz", () => {
    const auto = [arrivalNode(0, 240)];
    const restored = applyLayout(auto, { stations: {} });
    expect(restored[0].position).toEqual({ x: 0, y: 240 });
  });

  it("gidiş-dönüş konumları korur", () => {
    const original = [
      arrivalNode(-260, 100),
      stationNode("kesim", 0, 100),
      stationNode("montaj", 320, 100),
    ];
    const reset = [
      arrivalNode(0, 240),
      stationNode("kesim", 280, 240),
      stationNode("montaj", 560, 240),
    ];

    const restored = applyLayout(reset, extractLayout(original));
    expect(restored.map((node) => node.position)).toEqual(
      original.map((node) => node.position),
    );
  });
});

describe("canonicalize", () => {
  it("anahtar sırasından etkilenmez", () => {
    // Sıralanmasaydı, hiç değişmemiş bir model yalnızca alanları farklı sırada
    // geldiği için "değişmiş" görünür ve gösterge sürekli yanıp sönerdi.
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("dizi sırasını korur", () => {
    // İstasyon sırası anlamlıdır; sıralanması modeli değiştirirdi.
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("boş alanları atar", () => {
    // Backend her isteğe bağlı alanı yanıtta açıkça `null` döndürür; canvas'tan
    // kurulan model ise o alanları hiç içermez. İkisi aynı modeldir.
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
    expect(canonicalize({ a: 1, b: null })).toBe(canonicalize({ a: 1 }));
  });

  it("backend'in null'lı yanıtını canvas'ın modeliyle eşitler", () => {
    // Gerçek durum: kaydetmenin ardından backend `line_name`, `failure_rate` ve
    // `repair_time_distribution` alanlarını `null` olarak geri döndürür.
    // Eşitlenmeselerdi "kaydedilmemiş değişiklikler var" göstergesi kaydetmeden
    // sonra hiç temizlenmez ve anlamını yitirirdi.
    const fromCanvas = { id: "kesim", name: "Kesim", num_servers: 1 };
    const fromBackend = {
      id: "kesim",
      name: "Kesim",
      line_name: null,
      num_servers: 1,
      failure_rate: null,
      repair_time_distribution: null,
    };

    expect(canonicalize(fromCanvas)).toBe(canonicalize(fromBackend));
  });

  it("iç içe nesneleri de sıralar", () => {
    expect(canonicalize({ x: { p: 1, q: 2 } })).toBe(
      canonicalize({ x: { q: 2, p: 1 } }),
    );
  });

  it("boş değeri sıfırdan ve boş metinden ayırır", () => {
    // Atılan yalnızca `null` ve `undefined`'dır. Sıfır ile boş metin gerçek
    // değerlerdir: bir tampon kapasitesinin sıfır olması ile hiç verilmemiş
    // olması farklı şeylerdir.
    expect(canonicalize({ a: null })).not.toBe(canonicalize({ a: 0 }));
    expect(canonicalize({ a: null })).not.toBe(canonicalize({ a: "" }));
  });
});

describe("hasUnsavedChanges", () => {
  const layout = { stations: { kesim: { x: 0, y: 0 } } };

  it("hiç kaydedilmemiş model her zaman değişmiş sayılır", () => {
    expect(hasUnsavedChanges({ config: config(), layout }, null)).toBe(true);
  });

  it("aynı model ve yerleşim değişmemiş sayılır", () => {
    const saved = { config: config(), layout };
    expect(hasUnsavedChanges({ config: config(), layout }, saved)).toBe(false);
  });

  it("alan sırası değişikliği değişiklik sayılmaz", () => {
    const saved = { config: config(), layout };
    const reordered = Object.fromEntries(
      Object.entries(config()).reverse(),
    ) as unknown as SimulationConfig;

    expect(hasUnsavedChanges({ config: reordered, layout }, saved)).toBe(false);
  });

  it("modeldeki değişikliği yakalar", () => {
    const saved = { config: config(), layout };
    const changed = config({
      stations: [station("kesim", { num_servers: 4 }), station("montaj")],
    });

    expect(hasUnsavedChanges({ config: changed, layout }, saved)).toBe(true);
  });

  it("yalnızca kutu taşımayı da değişiklik sayar", () => {
    // Sayılmasaydı, kullanıcı kutuları düzenleyip çıktığında hiçbir uyarı
    // almaz ve taşıma işi sessizce kaybolurdu.
    const saved = { config: config(), layout };
    const moved = { stations: { kesim: { x: 500, y: 0 } } };

    expect(hasUnsavedChanges({ config: config(), layout: moved }, saved)).toBe(true);
  });

  it("yerleşim yokluğu ile boş yerleşimi ayırır", () => {
    const saved = { config: config(), layout: null };
    expect(
      hasUnsavedChanges({ config: config(), layout: { stations: {} } }, saved),
    ).toBe(true);
  });
});
