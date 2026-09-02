/**
 * Canvas (React Flow node/edge) <-> backend SimulationConfig dönüşümü.
 *
 * Bu dosya arayüzün en riskli parçasıdır: görsel model ile backend'in beklediği
 * şema arasındaki tek köprüdür ve buradaki bir hata, kullanıcının ekranda
 * gördüğü modelden farklı bir simülasyonun çalışmasına yol açar — üstelik
 * sessizce. Bu nedenle iki yön de (`buildSimulationConfig` ve
 * `buildFlowFromConfig`) birim testleriyle ve gidiş-dönüş (round-trip)
 * testleriyle doğrulanır.
 *
 * Temel değişmez (invariant): **bir istasyon node'unun `node.id` değeri, o
 * istasyonun `station.id` değeriyle aynıdır.** İki ayrı kimlik tutmak, ikisinin
 * zamanla birbirinden ayrılmasına ve bağlantıların yanlış istasyona
 * bağlanmasına açık bir kapı bırakırdı.
 */

import type { Edge, Node } from "reactflow";
import type {
  ArrivalProcess,
  Connection,
  Distribution,
  SimulationConfig,
  Station,
} from "../types/simulationTypes";
import { INFINITE_CAPACITY } from "../types/simulationTypes";

/** Varış (giriş) node'unun sabit kimliği. Canvas'ta yalnızca bir tane bulunur. */
export const ARRIVAL_NODE_ID = "__arrival__";

/** Yerleşim ızgarası: katmanlar arası yatay, aynı katmanda dikey boşluk. */
const LAYER_SPACING_X = 280;
const NODE_SPACING_Y = 150;
const CANVAS_ORIGIN_Y = 240;

/** Yönlendirme olasılıkları toplamı kontrolünde kullanılan tolerans. */
const PROBABILITY_TOLERANCE = 1e-9;

/** Son simülasyondan gelen ve node rengini belirleyen metrikler. */
export interface StationNodeMetrics {
  utilization: number;
  is_bottleneck: boolean;
}

export interface StationNodeData {
  station: Station;
  /** Yalnızca bir simülasyon çalıştıktan sonra dolar. */
  metrics?: StationNodeMetrics;
  /**
   * Kutunun hangi bağlamda çizildiği.
   *
   * Animasyonda kutular yalnızca izlenir; gölge, durum şeridi ve fareyle
   * yükselme gibi süsler oraya aittir. Editörde aynı süsler kutuları
   * sürüklerken gürültü yaratır ve taşıma geri bildirimiyle yarışır, bu yüzden
   * varsayılan olarak kapalıdır.
   */
  presentation?: "editor" | "animation";
}

export interface ArrivalNodeData {
  distribution: Distribution;
}

export type StationFlowNode = Node<StationNodeData, "station">;
export type ArrivalFlowNode = Node<ArrivalNodeData, "arrival">;
export type FlowNode = StationFlowNode | ArrivalFlowNode;

/** Kenar üzerinde taşınan isteğe bağlı yönlendirme olasılığı. */
export interface FlowEdgeData {
  /** 0-1 arası. Verilmezse aynı kaynaktan çıkan yollara eşit dağıtılır. */
  routingProbability?: number;
}

export type FlowEdge = Edge<FlowEdgeData>;

export interface BuildOptions {
  simulation_duration_minutes: number;
  warmup_period_minutes: number;
  num_replications: number;
  random_seed?: number | null;
}

export type BuildResult =
  | { ok: true; config: SimulationConfig; warnings: string[] }
  | { ok: false; errors: string[] };

// --------------------------------------------------------------------------- //
// Tip koruyucular
// --------------------------------------------------------------------------- //

export function isStationNode(node: FlowNode): node is StationFlowNode {
  return node.type === "station";
}

export function isArrivalNode(node: FlowNode): node is ArrivalFlowNode {
  return node.type === "arrival";
}

// --------------------------------------------------------------------------- //
// Canvas -> SimulationConfig
// --------------------------------------------------------------------------- //

/**
 * Canvas'taki node/edge yapısını backend'in beklediği şemaya çevirir.
 *
 * Yönlendirme olasılıkları şöyle belirlenir: bir istasyondan çıkan kenarların
 * bazılarında açık olasılık verilmişse onlar korunur, kalan olasılık geri kalan
 * kenarlara eşit dağıtılır. Hiçbirinde verilmemişse tümüne eşit pay düşer ve
 * son kenar yuvarlama artığını üstlenir; böylece toplam tam olarak 1.0 olur ve
 * kayan nokta artığı yanlışlıkla "sistemden çıkış olasılığı" gibi yorumlanmaz.
 */
export function buildSimulationConfig(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: BuildOptions,
): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stationNodes = nodes.filter(isStationNode);
  const arrivalNodes = nodes.filter(isArrivalNode);

  if (arrivalNodes.length === 0) {
    errors.push(
      "Modelde bir başlangıç noktası yok. Parçaların sisteme nereden girdiğini gösteren “Varış” kutusunu ekleyin.",
    );
  } else if (arrivalNodes.length > 1) {
    errors.push(
      "Modelde birden fazla başlangıç noktası var. Şu an yalnızca tek bir giriş noktası destekleniyor.",
    );
  }

  if (stationNodes.length === 0) {
    errors.push("Modelde hiç istasyon yok. En az bir iş istasyonu ekleyin.");
  }

  const stationIds = new Set(stationNodes.map((node) => node.id));
  const duplicated = stationNodes
    .map((node) => node.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicated.length > 0) {
    errors.push(
      `Aynı kimliğe sahip birden fazla istasyon var: ${[...new Set(duplicated)].join(", ")}.`,
    );
  }

  // Kenarların uçları gerçekten var olan node'lara bakmalı. Bu normalde React
  // Flow tarafından korunur; elle üretilmiş veya bozulmuş state'e karşı denetim.
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const danglingEdges = edges.filter(
    (edge) => !knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target),
  );
  if (danglingEdges.length > 0) {
    errors.push(
      "Bir bağlantı, artık var olmayan bir istasyona gidiyor. Bağlantıları kontrol edin.",
    );
  }

  const validEdges = edges.filter(
    (edge) => knownNodeIds.has(edge.source) && knownNodeIds.has(edge.target),
  );

  if (validEdges.some((edge) => edge.target === ARRIVAL_NODE_ID)) {
    errors.push(
      "Başlangıç noktasına geri bağlantı yapılamaz; parçalar sisteme yalnızca oradan girer.",
    );
  }

  const arrivalEdges = validEdges.filter((edge) => edge.source === ARRIVAL_NODE_ID);
  if (arrivalNodes.length === 1) {
    if (arrivalEdges.length === 0) {
      errors.push(
        "Başlangıç noktası hiçbir istasyona bağlı değil. Parçaların ilk hangi istasyona gideceğini bağlantı çizerek belirtin.",
      );
    } else if (arrivalEdges.length > 1) {
      errors.push(
        "Başlangıç noktasından birden fazla istasyona bağlantı var. Parçalar sisteme tek bir istasyondan girmelidir.",
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const entryStationId = arrivalEdges[0].target;
  if (!stationIds.has(entryStationId)) {
    return {
      ok: false,
      errors: ["Başlangıç noktası bir istasyona bağlı değil."],
    };
  }

  const connections = buildConnections(
    validEdges.filter((edge) => edge.source !== ARRIVAL_NODE_ID),
    errors,
  );
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const stations = stationNodes.map((node) => normalizeStation(node.data.station, node.id));
  const distributionErrors = stations.flatMap(validateStation);
  if (distributionErrors.length > 0) {
    return { ok: false, errors: distributionErrors };
  }

  warnings.push(...collectReachabilityWarnings(stations, connections, entryStationId));

  const arrivalProcess: ArrivalProcess = {
    distribution: arrivalNodes[0].data.distribution,
    entry_station_id: entryStationId,
  };

  return {
    ok: true,
    warnings,
    config: {
      stations,
      connections,
      arrival_process: arrivalProcess,
      simulation_duration_minutes: options.simulation_duration_minutes,
      warmup_period_minutes: options.warmup_period_minutes,
      num_replications: options.num_replications,
      random_seed: options.random_seed ?? null,
    },
  };
}

/** Kenarları, olasılıkları çözülmüş `Connection` listesine çevirir. */
function buildConnections(stationEdges: FlowEdge[], errors: string[]): Connection[] {
  const bySource = new Map<string, FlowEdge[]>();
  for (const edge of stationEdges) {
    const group = bySource.get(edge.source);
    if (group) {
      group.push(edge);
    } else {
      bySource.set(edge.source, [edge]);
    }
  }

  const connections: Connection[] = [];
  for (const [sourceId, group] of bySource) {
    const explicit = group.filter(
      (edge) => typeof edge.data?.routingProbability === "number",
    );
    const implicit = group.filter(
      (edge) => typeof edge.data?.routingProbability !== "number",
    );

    const explicitTotal = explicit.reduce(
      (total, edge) => total + (edge.data?.routingProbability ?? 0),
      0,
    );
    if (explicitTotal > 1 + PROBABILITY_TOLERANCE) {
      errors.push(
        `“${sourceId}” istasyonundan çıkan yolların toplam olasılığı %100'ü geçemez (şu an %${(explicitTotal * 100).toFixed(0)}).`,
      );
      continue;
    }

    const probabilities = new Map<string, number>();
    for (const edge of explicit) {
      probabilities.set(edge.id, edge.data!.routingProbability!);
    }

    if (implicit.length > 0) {
      const remaining = Math.max(1 - explicitTotal, 0);
      const share = remaining / implicit.length;
      let assigned = 0;
      implicit.forEach((edge, index) => {
        // Son kenar yuvarlama artığını üstlenir; toplam tam 1.0 olur.
        const value = index === implicit.length - 1 ? remaining - assigned : share;
        assigned += value;
        probabilities.set(edge.id, value);
      });
    }

    for (const edge of group) {
      const probability = probabilities.get(edge.id) ?? 0;
      if (probability <= 0) {
        // Olasılığı sıfır olan bir yol backend tarafından reddedilir
        // (routing_probability > 0); bağlantıyı hiç göndermemek doğrusudur.
        continue;
      }
      connections.push({
        from_station_id: edge.source,
        to_station_id: edge.target,
        routing_probability: probability,
      });
    }
  }

  return connections;
}

/** Eksik alanları backend varsayılanlarıyla tamamlar ve kimliği node ile eşler. */
function normalizeStation(station: Station, nodeId: string): Station {
  const normalized: Station = {
    ...station,
    id: nodeId,
    num_servers: Math.max(1, Math.round(station.num_servers)),
    buffer_capacity_before: station.buffer_capacity_before ?? INFINITE_CAPACITY,
    scrap_rate: station.scrap_rate ?? 0,
  };

  // Hat adı boşsa alan hiç gönderilmez. Boş metin göndermek, backend'de
  // "adı boş olan bir hat" grubu yaratır ve arayüzde gruplanmamış
  // istasyonlardan ayırt edilemezdi.
  const lineName = normalized.line_name?.trim();
  if (lineName) {
    normalized.line_name = lineName;
  } else {
    delete normalized.line_name;
  }

  // Arıza modeli backend'de "ya ikisi de ya hiçbiri" kuralına tabidir.
  if (normalized.failure_rate == null || !normalized.repair_time_distribution) {
    delete normalized.failure_rate;
    delete normalized.repair_time_distribution;
  }
  return normalized;
}

/**
 * Backend'e gitmeden yakalanabilecek yaygın parametre hatalarını denetler.
 *
 * Backend zaten aynı kuralları uygular; buradaki denetim ağ turunu beklemeden
 * anında geri bildirim vermek içindir. Kural çoğaltması bilinçli ve dardır:
 * yalnızca parametre panelinde elle girilerek kolayca yapılabilen hatalar.
 */
function validateStation(station: Station): string[] {
  const problems: string[] = [];
  const label = station.name || station.id;
  const { type, params } = station.service_time_distribution;

  const numeric = (key: string): number => Number(params[key]);

  if (type === "triangular") {
    const min = numeric("min");
    const mode = numeric("mode");
    const max = numeric("max");
    if (!(min <= mode && mode <= max)) {
      problems.push(
        `“${label}” istasyonunda süre tahminleri sıralı değil. En hızlı ≤ en olası ≤ en yavaş olmalı (girilen: ${min} / ${mode} / ${max}).`,
      );
    } else if (min === max) {
      problems.push(
        `“${label}” istasyonunda en hızlı ve en yavaş süre aynı. Süre değişkenlik göstermiyorsa “Sabit” seçeneğini kullanın.`,
      );
    }
    if (min < 0) {
      problems.push(`“${label}” istasyonunda süre negatif olamaz.`);
    }
  }

  if (type === "exponential" && !(numeric("mean") > 0)) {
    problems.push(`“${label}” istasyonunda ortalama işlem süresi sıfırdan büyük olmalı.`);
  }
  if (type === "constant" && !(numeric("value") >= 0)) {
    problems.push(`“${label}” istasyonunda işlem süresi negatif olamaz.`);
  }
  if (type === "normal") {
    if (!(numeric("std") > 0)) {
      problems.push(
        `“${label}” istasyonunda sapma sıfırdan büyük olmalı. Süre hiç değişmiyorsa “Sabit” seçeneğini kullanın.`,
      );
    }
    if (!(numeric("mean") >= 0)) {
      problems.push(`“${label}” istasyonunda ortalama işlem süresi negatif olamaz.`);
    }
  }

  if (station.scrap_rate < 0 || station.scrap_rate > 1) {
    problems.push(`“${label}” istasyonunda fire oranı %0 ile %100 arasında olmalı.`);
  }
  if (
    station.buffer_capacity_before !== INFINITE_CAPACITY &&
    station.buffer_capacity_before < 0
  ) {
    problems.push(`“${label}” istasyonunda bekleme alanı kapasitesi negatif olamaz.`);
  }

  return problems;
}

/** Girişten ulaşılamayan istasyonları uyarı olarak bildirir. */
function collectReachabilityWarnings(
  stations: Station[],
  connections: Connection[],
  entryStationId: string,
): string[] {
  const reachable = new Set<string>([entryStationId]);
  const frontier = [entryStationId];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    for (const connection of connections) {
      if (connection.from_station_id === current && !reachable.has(connection.to_station_id)) {
        reachable.add(connection.to_station_id);
        frontier.push(connection.to_station_id);
      }
    }
  }

  const orphans = stations.filter((station) => !reachable.has(station.id));
  if (orphans.length === 0) {
    return [];
  }
  const names = orphans.map((station) => `“${station.name || station.id}”`).join(", ");
  return [
    `${names} istasyonuna hiçbir parça ulaşamıyor. Bağlantısı eksik olabilir; simülasyonda boş kalacak.`,
  ];
}

// --------------------------------------------------------------------------- //
// SimulationConfig -> Canvas
// --------------------------------------------------------------------------- //

/**
 * Backend şemasını canvas node/edge yapısına çevirir (şablon yüklerken).
 *
 * Yerleşim, giriş istasyonundan başlayan bir genişlik öncelikli aramayla
 * katmanlara ayrılır: her katman bir sütun olur, aynı katmandaki istasyonlar
 * dikeyde ortalanır. Ulaşılamayan istasyonlar en sona ayrı bir sütuna konur ki
 * kullanıcı onları görüp bağlantısını kurabilsin.
 */
export function buildFlowFromConfig(config: SimulationConfig): {
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  const layers = computeLayers(config);
  const nodes: FlowNode[] = [
    {
      id: ARRIVAL_NODE_ID,
      type: "arrival",
      position: { x: 0, y: CANVAS_ORIGIN_Y },
      data: { distribution: config.arrival_process.distribution },
    },
  ];

  layers.forEach((layerStationIds, layerIndex) => {
    layerStationIds.forEach((stationId, indexInLayer) => {
      const station = config.stations.find((item) => item.id === stationId);
      if (!station) {
        return;
      }
      const offset = (layerStationIds.length - 1) / 2;
      nodes.push({
        id: station.id,
        type: "station",
        position: {
          x: (layerIndex + 1) * LAYER_SPACING_X,
          y: CANVAS_ORIGIN_Y + (indexInLayer - offset) * NODE_SPACING_Y,
        },
        data: { station },
      });
    });
  });

  const edges: FlowEdge[] = [
    {
      id: `${ARRIVAL_NODE_ID}->${config.arrival_process.entry_station_id}`,
      source: ARRIVAL_NODE_ID,
      target: config.arrival_process.entry_station_id,
      animated: true,
      data: {},
    },
  ];

  for (const connection of config.connections) {
    edges.push({
      id: `${connection.from_station_id}->${connection.to_station_id}`,
      source: connection.from_station_id,
      target: connection.to_station_id,
      data: { routingProbability: connection.routing_probability },
      label:
        connection.routing_probability < 1 - PROBABILITY_TOLERANCE
          ? `%${Math.round(connection.routing_probability * 100)}`
          : undefined,
    });
  }

  return { nodes, edges };
}

/** İstasyonları girişten uzaklıklarına göre katmanlara ayırır. */
function computeLayers(config: SimulationConfig): string[][] {
  const outgoing = new Map<string, string[]>();
  for (const connection of config.connections) {
    const targets = outgoing.get(connection.from_station_id);
    if (targets) {
      targets.push(connection.to_station_id);
    } else {
      outgoing.set(connection.from_station_id, [connection.to_station_id]);
    }
  }

  const layers: string[][] = [];
  const visited = new Set<string>();
  let frontier = config.stations.some(
    (station) => station.id === config.arrival_process.entry_station_id,
  )
    ? [config.arrival_process.entry_station_id]
    : [];

  while (frontier.length > 0) {
    layers.push(frontier);
    frontier.forEach((id) => visited.add(id));

    const next: string[] = [];
    for (const stationId of frontier) {
      for (const target of outgoing.get(stationId) ?? []) {
        // Yeniden işleme döngülerinde geri dönüş kenarı yeni katman açmaz;
        // aksi hâlde yerleşim sonsuza dek sağa doğru uzardı.
        if (!visited.has(target) && !next.includes(target)) {
          next.push(target);
        }
      }
    }
    frontier = next;
  }

  const orphans = config.stations
    .map((station) => station.id)
    .filter((id) => !visited.has(id));
  if (orphans.length > 0) {
    layers.push(orphans);
  }
  return layers;
}

// --------------------------------------------------------------------------- //
// Node oluşturma yardımcıları
// --------------------------------------------------------------------------- //

/**
 * Yeni bir istasyon için, mevcutlarla çakışmayan kimlik üretir.
 *
 * Sayaç mevcut node sayısından değil 1'den başlar: node listesi varış kutusunu
 * ve kullanıcının kendi adlandırdığı istasyonları da içerdiği için, sayıdan
 * türetilen bir başlangıç kullanıcıya anlamsız gelen adlar üretirdi (üç
 * istasyonlu bir modelde "Yeni İstasyon 5" gibi).
 */
export function generateStationId(existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  let index = 1;
  while (taken.has(`istasyon-${index}`)) {
    index += 1;
  }
  return `istasyon-${index}`;
}

/** Makul varsayılanlarla yeni bir istasyon node'u oluşturur. */
export function createStationNode(
  existingIds: Iterable<string>,
  position: { x: number; y: number },
): StationFlowNode {
  const id = generateStationId(existingIds);
  const order = Number(id.split("-")[1] ?? "1");
  return {
    id,
    type: "station",
    position,
    data: {
      station: {
        id,
        name: `Yeni İstasyon ${order}`,
        num_servers: 1,
        service_time_distribution: { type: "normal", params: { mean: 5, std: 1 } },
        buffer_capacity_before: INFINITE_CAPACITY,
        scrap_rate: 0,
      },
    },
  };
}

/** Sıfırdan model kuranlar için: yalnızca varış node'u bulunan boş canvas. */
export function createEmptyFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: [
      {
        id: ARRIVAL_NODE_ID,
        type: "arrival",
        position: { x: 0, y: CANVAS_ORIGIN_Y },
        data: { distribution: { type: "exponential", params: { mean: 5 } } },
      },
    ],
    edges: [],
  };
}


// --------------------------------------------------------------------------- //
// Hat / bölüm gruplaması
// --------------------------------------------------------------------------- //

/** Grup kutusunun istasyonların sınır kutusundan taşma payı. */
const GROUP_PADDING = 26;
/** Grup başlığına ayrılan üst boşluk. */
const GROUP_HEADER_HEIGHT = 22;
/**
 * React Flow bir node'u ölçene kadar `width`/`height` tanımsızdır. İlk kare
 * boyunca kutunun sıfır boyutlu çizilmemesi için gerçekçi bir varsayılan
 * kullanılır; ölçüm gelince zaten gerçek değerle değişir.
 */
const ASSUMED_NODE_WIDTH = 224;
const ASSUMED_NODE_HEIGHT = 92;

/**
 * Modelde geçen hat adlarını alfabetik ve tekilleştirilmiş olarak döndürür.
 *
 * Parametre panelindeki otomatik tamamlama bunu kullanır: kullanıcı daha önce
 * yazdığı hattı yeniden yazmak yerine seçebilsin. Elle yazımın tekrarlanması,
 * "Kesim Hattı" ile "Kesim hattı"nın ayrı iki grup olarak görünmesine yol
 * açardı.
 */
export function collectLineNames(nodes: FlowNode[]): string[] {
  const names = new Set<string>();
  for (const node of nodes) {
    if (!isStationNode(node)) {
      continue;
    }
    const name = node.data.station.line_name?.trim();
    if (name) {
      names.add(name);
    }
  }
  return [...names].sort((first, second) => first.localeCompare(second, "tr"));
}

/** Canvas'ta bir hattı çevreleyen arka plan kutusu. */
export interface LineGroupBox {
  lineName: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  stationIds: string[];
}

/**
 * Aynı hatta bağlı istasyonları çevreleyen kutuları hesaplar.
 *
 * Kutular, istasyonların **sınır kutusundan** türetilir; istasyonlar React
 * Flow'un `parentNode` mekanizmasıyla kutuya bağlanmaz. Bağlansaydı alt
 * node'ların konumları gruba göre göreli hâle gelirdi ve konumları mutlak
 * varsayan her yer (yerleşim, animasyon) sessizce bozulurdu. Buradaki kutu
 * yalnızca arkada duran bir çizimdir; taşıma ve seçme davranışı değişmez.
 *
 * Hat adı girilmemiş istasyonlar hiçbir kutuya girmez: kullanıcı gruplama
 * istemediyse arayüz gruplama göstermemelidir.
 */
export function buildLineGroups(nodes: FlowNode[]): LineGroupBox[] {
  const byLine = new Map<string, StationFlowNode[]>();
  for (const node of nodes) {
    if (!isStationNode(node)) {
      continue;
    }
    const lineName = node.data.station.line_name?.trim();
    if (!lineName) {
      continue;
    }
    const group = byLine.get(lineName);
    if (group) {
      group.push(node);
    } else {
      byLine.set(lineName, [node]);
    }
  }

  const boxes: LineGroupBox[] = [];
  for (const [lineName, group] of byLine) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of group) {
      const width = node.width ?? ASSUMED_NODE_WIDTH;
      const height = node.height ?? ASSUMED_NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + width);
      maxY = Math.max(maxY, node.position.y + height);
    }

    boxes.push({
      lineName,
      position: {
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
      },
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
      stationIds: group.map((node) => node.id),
    });
  }

  // Adı sabit sırada tutmak, her renderda kutuların yeniden sıralanmasını ve
  // React'in gereksiz yere DOM'u değiştirmesini önler.
  boxes.sort((first, second) => first.lineName.localeCompare(second.lineName, "tr"));
  return boxes;
}
