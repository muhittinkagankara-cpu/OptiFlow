/**
 * Akış ve kayıp diyagramının veri hazırlığı.
 *
 * Sankey diyagramı, akışın **kalınlığıyla** anlatır: hatta giren işin ne
 * kadarının sona ulaştığı, ne kadarının yolda kaybolduğu tek bakışta görünür.
 * Bunun çalışması için diyagramın her düğümünde giren miktar çıkan miktara
 * eşit olmalıdır; eşit olmadığında Sankey sessizce yanlış kalınlıklar çizer ve
 * kullanıcı gerçekte olmayan bir kaybı görür.
 *
 * Bu yüzden zincir **ileriye doğru üretilir**: giriş istasyonuna teklif edilen
 * ölçülmüş iş miktarından başlanır ve her istasyonda ölçülmüş red sayısı ile
 * ölçülmüş fire oranı uygulanarak bir sonraki adıma ne geçtiği hesaplanır.
 * Her düğümde denge böylece kurulum gereği sağlanır.
 *
 * Alternatif —her istasyonun ölçülmüş giriş sayısını doğrudan kullanmak—
 * denenmeye değmezdi: ölçüm penceresi ısınma sonrasında başladığı için bir
 * istasyonun "tamamlanan" sayısı "giren" sayısını binde birkaç aşabilir
 * (ısınmada girip pencerede biten parçalar). Bu küçük tutarsızlık diyagramda
 * yoktan var olan ince kayıp dalları olarak görünürdü.
 *
 * İki kayıp türü ayrı tutulur. `rejected` istasyona hiç alınmamış parçadır
 * (tampon doluydu) ve bir kapasite sorununa işaret eder; `scrapped` işlenmiş
 * ama hurdaya ayrılmış parçadır ve bir kalite sorunudur. Tek bir "kayıp"
 * kaleminde toplamak, kullanıcıyı yanlış yere müdahale ettirirdi.
 */

import type {
  SimulationConfig,
  StationMetricsResponse,
} from "../types/simulationTypes";

/** Diyagramdaki bir düğümün türü. */
export type FlowNodeKind = "entry" | "station" | "exit" | "scrap" | "rejected";

export interface FlowNodeItem {
  /** İstasyon kimliği ya da özel düğüm anahtarı. */
  key: string;
  name: string;
  kind: FlowNodeKind;
  /** Yalnızca istasyon düğümlerinde: fabrika darboğazı mı? */
  isBottleneck: boolean;
}

/** Bağlantının ne taşıdığı; renklendirme bunu kullanır. */
export type FlowLinkKind = "flow" | "scrap" | "rejected";

export interface FlowLinkItem {
  /** `nodes` dizisindeki indeksler — Sankey bu biçimi bekler. */
  source: number;
  target: number;
  value: number;
  kind: FlowLinkKind;
}

export interface FlowDiagram {
  nodes: FlowNodeItem[];
  links: FlowLinkItem[];
  /** Hatta giren toplam iş. */
  totalIn: number;
  /** Sistemden çıkan iyi ürün. */
  totalOut: number;
  totalScrapped: number;
  totalRejected: number;
  /**
   * Diyagramın kaç sütun genişliğinde olduğu (giriş ve çıkış dahil).
   *
   * Sankey düğümleri derinliğe göre yatay dizer; uzun bir hat çok sayıda sütun
   * demektir. Çizim alanı sabit kalırsa sütunlar sıkışır ve etiketler üst üste
   * biner. Çağıran taraf bu sayıyı asgari genişlik hesabında kullanır.
   */
  columnCount: number;
  /**
   * Yeniden işleme (geri dönen) bağlantıları çizimden çıkarıldı mı?
   *
   * Sankey döngü çizemez. Böyle bağlantılar sessizce yok sayılırsa diyagram
   * doğru görünür ama modeli eksik anlatır; kullanıcıya bildirilmesi gerekir.
   */
  hasIgnoredRework: boolean;
}

const ENTRY_KEY = "__entry__";
const EXIT_KEY = "__exit__";
const SCRAP_KEY = "__scrap__";
const REJECTED_KEY = "__rejected__";

/** Sıfır sayılacak kadar küçük akış; kılcal dallar diyagramı okunmaz kılar. */
const NEGLIGIBLE = 0.5;

/**
 * İstasyonları girişten uzaklıklarına göre sıralar.
 *
 * Sankey soldan sağa akar ve döngü kaldırmaz. Sıralama, hangi bağlantının
 * "ileri" hangisinin "geri" (yeniden işleme) olduğunu belirlemek için de
 * kullanılır: hedefi kaynağından daha yakın olan bağlantı geriye dönüyordur.
 */
function depthByStation(config: SimulationConfig): Map<string, number> {
  const successors = new Map<string, string[]>();
  for (const connection of config.connections) {
    const list = successors.get(connection.from_station_id);
    if (list) {
      list.push(connection.to_station_id);
    } else {
      successors.set(connection.from_station_id, [connection.to_station_id]);
    }
  }

  const depth = new Map<string, number>();
  const entry = config.arrival_process.entry_station_id;
  const queue: string[] = [];
  if (config.stations.some((station) => station.id === entry)) {
    depth.set(entry, 0);
    queue.push(entry);
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentDepth = depth.get(current) ?? 0;
    for (const next of successors.get(current) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }

  // Girişten ulaşılamayan istasyonlar sona konur; hiç parça almadıkları için
  // diyagramda da akışsız görünmeleri doğrudur.
  let fallback = depth.size;
  for (const station of config.stations) {
    if (!depth.has(station.id)) {
      depth.set(station.id, fallback);
      fallback += 1;
    }
  }
  return depth;
}

/**
 * İstasyon metriklerinden Sankey diyagramını üretir.
 *
 * İstasyon yoksa ya da hatta hiç iş girmemişse `null` döner; boş bir diyagram
 * çizmek kullanıcıya bir şey anlatmaz.
 */
export function buildFlowDiagram(
  stations: StationMetricsResponse[],
  config: SimulationConfig,
): FlowDiagram | null {
  if (stations.length === 0) {
    return null;
  }

  const metricsById = new Map(stations.map((station) => [station.station_id, station]));
  const depth = depthByStation(config);
  const ordered = [...stations].sort(
    (first, second) =>
      (depth.get(first.station_id) ?? 0) - (depth.get(second.station_id) ?? 0),
  );

  const entryId = config.arrival_process.entry_station_id;
  const entryMetrics = metricsById.get(entryId) ?? ordered[0];
  // Hatta teklif edilen iş: giriş istasyonuna giren + tamponu dolu olduğu için
  // hiç alınamayan parçalar.
  const totalIn = entryMetrics.flow.entered + entryMetrics.flow.rejected;
  if (totalIn <= 0) {
    return null;
  }

  // --- İleriye doğru akış üretimi ---
  const inflow = new Map<string, number>();
  inflow.set(entryMetrics.station_id, totalIn);

  const forwarded = new Map<string, number>();
  const scrapped = new Map<string, number>();
  const rejected = new Map<string, number>();
  let hasIgnoredRework = false;

  for (const station of ordered) {
    const incoming = inflow.get(station.station_id) ?? 0;
    const flow = station.flow;

    // Red sayısı ölçülmüştür ama gelen akıştan büyük olamaz; aksi hâlde
    // düğümden çıkan miktar girenden fazla olur ve denge bozulurdu.
    const rejectedHere = Math.min(Math.max(flow.rejected, 0), incoming);
    const accepted = incoming - rejectedHere;

    // Fire, sayı olarak değil **oran** olarak taşınır: gelen akış üretilirken
    // ölçülmüş sayıdan sapmış olabilir, oran ise ölçekten bağımsızdır.
    const scrapFraction =
      flow.completed > 0 ? Math.min(Math.max(flow.scrapped / flow.completed, 0), 1) : 0;
    const scrappedHere = accepted * scrapFraction;
    const forwardedHere = accepted - scrappedHere;

    rejected.set(station.station_id, rejectedHere);
    scrapped.set(station.station_id, scrappedHere);
    forwarded.set(station.station_id, forwardedHere);

    // İleri bağlantılar arasında yönlendirme olasılığına göre paylaştır.
    const stationDepth = depth.get(station.station_id) ?? 0;
    const outgoing = config.connections.filter(
      (connection) => connection.from_station_id === station.station_id,
    );
    let forwardShare = 0;
    for (const connection of outgoing) {
      const targetDepth = depth.get(connection.to_station_id) ?? 0;
      if (targetDepth <= stationDepth) {
        // Yeniden işleme döngüsü: Sankey çizemez, akış sistemden çıkmış sayılır.
        hasIgnoredRework = true;
        continue;
      }
      forwardShare += connection.routing_probability;
      inflow.set(
        connection.to_station_id,
        (inflow.get(connection.to_station_id) ?? 0) +
          forwardedHere * connection.routing_probability,
      );
    }
    // Kalan pay sistemden çıkıştır (hattın sonu ya da açık uçlu yönlendirme).
    inflow.set(
      EXIT_KEY,
      (inflow.get(EXIT_KEY) ?? 0) + forwardedHere * Math.max(1 - forwardShare, 0),
    );
  }

  // --- Düğümler ---
  const totalScrapped = sum([...scrapped.values()]);
  const totalRejected = sum([...rejected.values()]);
  const totalOut = inflow.get(EXIT_KEY) ?? 0;

  const nodes: FlowNodeItem[] = [
    { key: ENTRY_KEY, name: "İş Girişi", kind: "entry", isBottleneck: false },
    ...ordered.map((station) => ({
      key: station.station_id,
      name: station.station_name,
      kind: "station" as const,
      isBottleneck: station.is_bottleneck,
    })),
    { key: EXIT_KEY, name: "Tamamlanan", kind: "exit", isBottleneck: false },
  ];

  // Kayıp düğümleri yalnızca gerçekten kayıp varsa eklenir; boş bir "Fire"
  // kutusu, olmayan bir sorunu varmış gibi gösterirdi.
  if (totalScrapped > NEGLIGIBLE) {
    nodes.push({ key: SCRAP_KEY, name: "Fire", kind: "scrap", isBottleneck: false });
  }
  if (totalRejected > NEGLIGIBLE) {
    nodes.push({
      key: REJECTED_KEY,
      name: "Reddedildi",
      kind: "rejected",
      isBottleneck: false,
    });
  }

  const indexOf = new Map(nodes.map((node, index) => [node.key, index]));
  const links: FlowLinkItem[] = [];
  const push = (from: string, to: string, value: number, kind: FlowLinkKind) => {
    const source = indexOf.get(from);
    const target = indexOf.get(to);
    if (source === undefined || target === undefined || value <= NEGLIGIBLE) {
      return;
    }
    links.push({ source, target, value, kind });
  };

  push(ENTRY_KEY, entryMetrics.station_id, totalIn, "flow");

  for (const station of ordered) {
    const id = station.station_id;
    push(id, SCRAP_KEY, scrapped.get(id) ?? 0, "scrap");
    push(id, REJECTED_KEY, rejected.get(id) ?? 0, "rejected");

    const stationDepth = depth.get(id) ?? 0;
    const forwardedHere = forwarded.get(id) ?? 0;
    let forwardShare = 0;
    for (const connection of config.connections) {
      if (connection.from_station_id !== id) {
        continue;
      }
      if ((depth.get(connection.to_station_id) ?? 0) <= stationDepth) {
        continue;
      }
      forwardShare += connection.routing_probability;
      push(
        id,
        connection.to_station_id,
        forwardedHere * connection.routing_probability,
        "flow",
      );
    }
    push(id, EXIT_KEY, forwardedHere * Math.max(1 - forwardShare, 0), "flow");
  }

  // Giriş ve çıkış düğümleri de birer sütun kaplar.
  const deepest = ordered.reduce(
    (highest, station) => Math.max(highest, depth.get(station.station_id) ?? 0),
    0,
  );

  return {
    nodes,
    links,
    columnCount: deepest + 3,
    totalIn,
    totalOut,
    totalScrapped,
    totalRejected,
    hasIgnoredRework,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
