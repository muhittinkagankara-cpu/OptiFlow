/**
 * Canvas yerleşimi ile kalıcı fabrika sürümü arasındaki dönüşümler.
 *
 * Editörün doğruluk kaynağı canvas'tır: `buildSimulationConfig` node/edge
 * yapısını backend şemasına çevirir. Ancak bu çeviri **kayıplıdır** — kutuların
 * konumu şemada yoktur. Yirmi istasyonluk bir modelde yerleşim, kullanıcının
 * harcadığı emeğin büyük bölümüdür; yalnızca `SimulationConfig` saklansaydı
 * fabrika her açılışta otomatik yerleşime sıfırlanır ve yapılan tüm düzenleme
 * kaybolurdu.
 *
 * Bu modül eksik yarıyı taşır: canvas'tan yerleşimi çıkarır (`extractLayout`)
 * ve kaydedilmiş yerleşimi geri uygular (`applyLayout`). Ayrıca kaydedilmemiş
 * değişiklik göstergesini besleyen karşılaştırmayı sağlar (`hasUnsavedChanges`).
 *
 * Yerleşim uygulanırken **hiçbir şey zorunlu değildir**: kaydedilmiş yerleşimde
 * bulunmayan bir istasyon otomatik yerleşimdeki yerinde kalır, artık modelde
 * olmayan bir kimlik yok sayılır. Yerleşimi katı biçimde ele almak, sunuma ait
 * bir ayrıntının modeli açılamaz hâle getirmesi demek olurdu.
 */

import type {
  FactoryLayout,
  NodePosition,
  SimulationConfig,
} from "../types/simulationTypes";
import { ARRIVAL_NODE_ID, isArrivalNode, isStationNode } from "./configBuilder";
import type { FlowNode } from "./configBuilder";

/**
 * Canvas'taki kutu konumlarını kalıcı yerleşime çevirir.
 *
 * Yalnızca istasyon ve varış kutuları alınır. Hat grup kutuları bilinçli olarak
 * dışarıda bırakılır: onlar state'te tutulmaz, her renderda istasyonların
 * konumundan türetilir. Kaydedilselerdi, bir istasyon taşındığında kutu eski
 * yerinde kalır ve iki temsil sessizce ayrışırdı.
 */
export function extractLayout(nodes: FlowNode[]): FactoryLayout {
  const stations: Record<string, NodePosition> = {};
  let arrival: NodePosition | null = null;

  for (const node of nodes) {
    if (isStationNode(node)) {
      stations[node.id] = { x: node.position.x, y: node.position.y };
    } else if (isArrivalNode(node)) {
      arrival = { x: node.position.x, y: node.position.y };
    }
  }

  return arrival ? { stations, arrival } : { stations };
}

/**
 * Kaydedilmiş yerleşimi otomatik yerleşimin üzerine uygular.
 *
 * Eşleşen her kutu kaydedilmiş konumuna taşınır; eşleşmeyen kutular olduğu yerde
 * kalır. Böylece kullanıcı bir istasyon ekleyip kaydetmeden sayfayı yenilerse
 * bile model açılır — yeni istasyon otomatik yerleşimdeki yerinde görünür.
 */
export function applyLayout(
  nodes: FlowNode[],
  layout: FactoryLayout | null | undefined,
): FlowNode[] {
  if (!layout) {
    return nodes;
  }

  return nodes.map((node): FlowNode => {
    if (node.id === ARRIVAL_NODE_ID) {
      return layout.arrival ? { ...node, position: { ...layout.arrival } } : node;
    }
    const saved = layout.stations?.[node.id];
    return saved ? { ...node, position: { ...saved } } : node;
  });
}

/**
 * İki değeri, anahtar sırasından bağımsız olarak karşılaştırılabilir bir metne
 * çevirir.
 *
 * Backend'deki `compute_snapshot_hash` ile aynı ilkeye dayanır: nesne anahtarları
 * sıralanır. Sıralanmasaydı, hiç değişmemiş bir model yalnızca alanları farklı
 * sırada geldiği için "değişmiş" görünür ve kaydedilmemiş değişiklik göstergesi
 * sürekli yanıp sönerdi.
 *
 * Değeri boş olan alanlar (`null` ve `undefined`) atılır. Bu, karşılaştırmanın
 * doğru çalışması için **zorunludur**: backend'deki her isteğe bağlı alan
 * `Optional[X] = None` olarak tanımlıdır ve Pydantic yanıtta hepsini açıkça
 * `null` olarak döndürür, oysa canvas'tan kurulan model bu alanları hiç
 * içermez. İkisi aynı modeldir; ayrı sayılsalardı kaydetmenin hemen ardından
 * "kaydedilmemiş değişiklikler var" yazmaya devam eder ve gösterge hiçbir
 * zaman temizlenmezdi.
 *
 * Bu şemada anlam kaybı yoktur: hiçbir alanda "boş bırakıldı" ile "verilmedi"
 * farklı şeyler ifade etmez.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined && item !== null) {
        result[key] = normalize(item);
      }
    }
    return result;
  }
  return value;
}

/** Kaydedilmiş sürümün, karşılaştırma için saklanan hâli. */
export interface SavedSnapshot {
  config: SimulationConfig;
  layout: FactoryLayout | null;
}

/**
 * Canvas'ın o anki hâli, en son kaydedilenden farklı mı?
 *
 * Karşılaştırma backend'in özet hesabıyla aynı kapsamı kullanır: hem model hem
 * yerleşim. Yalnızca model karşılaştırılsaydı, kullanıcı kutuları taşıyıp
 * çıktığında "kaydedilmemiş değişiklik var" uyarısı gelmez ve taşıma işi sessizce
 * kaybolurdu.
 *
 * Hiç kaydedilmemiş bir fabrika (snapshot yok) her zaman "değişmiş" sayılır:
 * kaydedilecek bir şey vardır.
 */
export function hasUnsavedChanges(
  current: SavedSnapshot,
  saved: SavedSnapshot | null,
): boolean {
  if (!saved) {
    return true;
  }
  return (
    canonicalize(current.config) !== canonicalize(saved.config) ||
    canonicalize(current.layout) !== canonicalize(saved.layout)
  );
}

// --------------------------------------------------------------------------- //
// Son açılan fabrikanın hatırlanması
// --------------------------------------------------------------------------- //
//
// `localStorage`'a **yalnızca kimlik** yazılır, modelin kendisi değil. Model bir
// iş verisidir: kullanıcının diğer cihazından da görünmeli, bir iş arkadaşıyla
// paylaşılabilmelidir. Tarayıcıya kopyalansaydı iki kopya sessizce ayrışır ve
// hangisinin doğru olduğu belirsizleşirdi. Kimlik ise yalnızca "en son neredeydim"
// bilgisidir ve kaybolması bir şey kaybettirmez.

const LAST_FACTORY_KEY = "optiflow.lastFactoryId";

/** En son açılan fabrikanın kimliğini hatırlar. */
export function rememberFactory(factoryId: string | null): void {
  try {
    if (factoryId) {
      window.localStorage.setItem(LAST_FACTORY_KEY, factoryId);
    } else {
      window.localStorage.removeItem(LAST_FACTORY_KEY);
    }
  } catch {
    // Gizli sekmede ve depolama kapalıyken yazma hata verir. Hatırlama bir
    // kolaylıktır; başarısız olması uygulamayı durdurmamalıdır.
  }
}

/** En son açılan fabrikanın kimliğini okur. */
export function recallFactory(): string | null {
  try {
    return window.localStorage.getItem(LAST_FACTORY_KEY);
  } catch {
    return null;
  }
}
