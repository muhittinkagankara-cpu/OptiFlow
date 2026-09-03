/**
 * Backend'e yapılan HTTP çağrıları.
 *
 * Tek sorumluluğu ağ katmanıdır: istek gönderir, yanıtı çözer ve hataları
 * `ApiError` olarak normalleştirir. Arayüz bileşenleri hiçbir zaman ham fetch
 * hatası veya ham backend metni görmez — `ApiError.userMessages` her zaman
 * kullanıcıya gösterilebilir Türkçe cümleler taşır.
 */

import type {
  ComparisonResponse,
  Factory,
  FactoryCreateRequest,
  FactoryDetail,
  FactorySaveRequest,
  FactoryVersion,
  FactoryVersionSummary,
  InventoryAnalysis,
  InventoryItem,
  MeResponse,
  SimulationConfig,
  SimulationRunResponse,
  SimulationTrace,
  StockoutRiskReport,
  ValidationReportResponse,
} from "../types/simulationTypes";
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  translateErrorDetails,
} from "./errorMessages";
import { getAccessToken } from "./authClient";

/** Geliştirme ortamında kullanılan varsayılan backend adresi. */
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

/**
 * Backend adresi.
 *
 * Derleme sırasında `VITE_API_BASE_URL` ortam değişkeninden okunur; yerelde
 * bu değişken tanımlı olmadığı için varsayılana düşer. Vite ortam
 * değişkenlerini derleme anında koda gömdüğü için, yayına alınmış paket zaten
 * doğru adresi içerir.
 *
 * Boş metin ayrıca denetlenir: tanımsız bir değişken `??` ile varsayılana
 * düşer ama **boş** bir değişken düşmez ve tüm istekler göreli adrese giderek
 * sessizce 404 üretirdi. Sondaki eğik çizgi de temizlenir; aksi hâlde
 * adresler `https://api.example.com//api/simulations/run` biçiminde oluşur.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  DEFAULT_API_BASE_URL;

const SIMULATIONS_PATH = "/api/simulations";
const INVENTORY_PATH = "/api/inventory";
const FACTORIES_PATH = "/api/factories";

/** FastAPI'nin Pydantic doğrulama hatası biçimi. */
interface PydanticErrorItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

/** Normalleştirilmiş API hatası. */
export class ApiError extends Error {
  /** HTTP durum kodu; ağ hatasında 0. */
  readonly status: number;
  /** Backend'den gelen ham mesajlar (günlükleme ve hata ayıklama için). */
  readonly rawDetails: string[];
  /** Kullanıcıya gösterilecek Türkçe mesajlar. */
  readonly userMessages: string[];

  constructor(status: number, rawDetails: string[], userMessages: string[]) {
    super(userMessages[0] ?? GENERIC_ERROR_MESSAGE);
    this.name = "ApiError";
    this.status = status;
    this.rawDetails = rawDetails;
    this.userMessages = userMessages;
  }

  /** Ağ katmanı hatası (backend'e hiç ulaşılamadı). */
  static network(cause: unknown): ApiError {
    const raw = cause instanceof Error ? cause.message : String(cause);
    return new ApiError(0, [raw], [NETWORK_ERROR_MESSAGE]);
  }
}

/** Hata gövdesinden ham mesaj listesini çıkarır. */
function extractRawDetails(body: unknown, status: number): string[] {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;

    if (typeof detail === "string") {
      return [detail];
    }
    if (Array.isArray(detail)) {
      return detail.map((item: PydanticErrorItem) => {
        const location = item.loc?.filter((part) => part !== "body").join(" > ");
        return location ? `${location}: ${item.msg ?? ""}` : (item.msg ?? "");
      });
    }
  }
  return [`HTTP ${status}`];
}

/** Yanıtı çözer; başarısızsa `ApiError` fırlatır. */
async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Gövde JSON değilse ham durum koduyla devam edilir.
  }

  const rawDetails = extractRawDetails(body, response.status);
  throw new ApiError(response.status, rawDetails, translateErrorDetails(rawDetails));
}

/** JSON gövdeli istek gönderir ve ağ hatalarını normalleştirir. */
/**
 * Şu anki oturumun erişim token'ını `Authorization` başlığı olarak döndürür.
 *
 * Oturum yoksa boş bir nesne döner (başlık hiç eklenmez): backend'in kendisi
 * bunu 401 ile reddeder ve hata mesajı zaten kullanıcı dostu bir Türkçe
 * metne çevrilir (bkz. `translateErrorDetails`). Buradan sahte bir hata
 * fırlatmak, aynı durumu iki farklı yerde ele almak olurdu.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      ...init,
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  return parseResponse<T>(response);
}

/**
 * Bir senaryoyu çalıştırır.
 *
 * Simülasyon saniyeler sürebilir; çağıran taraf yükleniyor durumu göstermelidir.
 */
export function runSimulation(config: SimulationConfig): Promise<SimulationRunResponse> {
  return request<SimulationRunResponse>(`${SIMULATIONS_PATH}/run`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

/** Daha önce çalıştırılmış bir simülasyonun analitik doğrulama raporunu getirir. */
export function getValidationReport(
  simulationId: string,
): Promise<ValidationReportResponse> {
  return request<ValidationReportResponse>(
    `${SIMULATIONS_PATH}/${simulationId}/validation-report`,
  );
}

/**
 * Birden çok senaryoyu karşılaştırır.
 *
 * Backend senaryoları bu uçta yeniden çalıştırır. Bu gereklidir: iki sonucun
 * farkının istatistiksel olarak anlamlı olup olmadığını söyleyebilmek için her
 * senaryonun replikasyonlar arası standart sapması gerekir ve `/run` yanıtı bu
 * bilgiyi taşımaz. Kaydedilmiş iki `/run` sonucunu arayüzde karşılaştırmak,
 * yalnızca ortalamaları kıyaslamak olurdu — hangi farkın gerçek olduğunu
 * söyleyemezdik.
 */
export function compareSimulations(
  configs: SimulationConfig[],
): Promise<ComparisonResponse> {
  return request<ComparisonResponse>(`${SIMULATIONS_PATH}/compare`, {
    method: "POST",
    body: JSON.stringify(configs),
  });
}

/**
 * Backend'in ayakta olup olmadığını kontrol eder.
 *
 * OpenAPI şeması her FastAPI uygulamasında bulunduğu için ayrı bir sağlık ucu
 * eklemeye gerek kalmadan kullanılabilir.
 */
/**
 * Doğrulanmış kullanıcının kimliğini ve organizasyonunu getirir.
 *
 * Oturum açtıktan sonra ana uygulamayı göstermeden önce bir kez çağrılır.
 * Backend, kullanıcının henüz organizasyonu yoksa (ilk giriş) bu çağrı
 * sırasında kendiliğinden kurar; ayrı bir "organizasyon oluştur" adımı yoktur.
 */
export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

export async function isBackendReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/openapi.json`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Bir koşumun animasyon için olay izini getirir.
 *
 * Backend izi saklamaz; aynı tohumla yeniden üretir. Bu yüzden çağrı birkaç
 * saniye sürebilir ve yalnızca kullanıcı animasyonu istediğinde yapılmalıdır.
 */
export function getSimulationTrace(simulationId: string): Promise<SimulationTrace> {
  return request<SimulationTrace>(`${SIMULATIONS_PATH}/${simulationId}/trace`);
}


// --------------------------------------------------------------------------- //
// Envanter
// --------------------------------------------------------------------------- //
//
// Envanter uçları üretim simülasyonundan bağımsızdır; hiçbiri bir koşum
// gerektirmez. Yalnızca stok tükenme riski, isteğe bağlı olarak bir koşum
// kimliği alıp üretim kaybını da hesaplar.

export function listInventoryItems(): Promise<InventoryItem[]> {
  return request<InventoryItem[]>(`${INVENTORY_PATH}/items`);
}

export function getInventoryItem(itemId: string): Promise<InventoryItem> {
  return request<InventoryItem>(`${INVENTORY_PATH}/items/${encodeURIComponent(itemId)}`);
}

export function createInventoryItem(item: InventoryItem): Promise<InventoryItem> {
  return request<InventoryItem>(`${INVENTORY_PATH}/items`, {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updateInventoryItem(
  itemId: string,
  item: InventoryItem,
): Promise<InventoryItem> {
  return request<InventoryItem>(`${INVENTORY_PATH}/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify(item),
  });
}

/**
 * Kalemi siler.
 *
 * Sunucu 204 döndürür; gövde yoktur ve `parseResponse` JSON beklediği için
 * burada ayrı ele alınır.
 */
export async function deleteInventoryItem(itemId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}${INVENTORY_PATH}/items/${encodeURIComponent(itemId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      },
    );
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Gövde JSON değilse ham durum koduyla devam edilir.
    }
    const rawDetails = extractRawDetails(body, response.status);
    throw new ApiError(response.status, rawDetails, translateErrorDetails(rawDetails));
  }
}

export function analyzeInventoryItem(
  itemId: string,
  serviceLevel: number,
): Promise<InventoryAnalysis> {
  const query = new URLSearchParams({ service_level: String(serviceLevel) });
  return request<InventoryAnalysis>(
    `${INVENTORY_PATH}/analyze/${encodeURIComponent(itemId)}?${query}`,
    { method: "POST" },
  );
}

export interface StockoutRiskOptions {
  horizonDays?: number;
  /** Üretim etkisi için okunacak koşum; verilmezse etki hesaplanmaz. */
  simulationId?: string | null;
  randomSeed?: number;
}

export function getStockoutRisk(
  itemId: string,
  options: StockoutRiskOptions = {},
): Promise<StockoutRiskReport> {
  const query = new URLSearchParams();
  if (options.horizonDays !== undefined) {
    query.set("horizon_days", String(options.horizonDays));
  }
  if (options.simulationId) {
    query.set("simulation_id", options.simulationId);
  }
  if (options.randomSeed !== undefined) {
    query.set("random_seed", String(options.randomSeed));
  }
  const suffix = query.toString() ? `?${query}` : "";
  return request<StockoutRiskReport>(
    `${INVENTORY_PATH}/stockout-risk/${encodeURIComponent(itemId)}${suffix}`,
    { method: "POST" },
  );
}


// --------------------------------------------------------------------------- //
// Fabrikalar
// --------------------------------------------------------------------------- //
//
// Fabrika modeli artık backend'de yaşar. Sayfa yenilendiğinde kaybolan tek şey
// "hangi fabrikadaydım" bilgisidir ve o da `factoryModel.recallFactory` ile
// hatırlanır; modelin kendisi buradan yeniden yüklenir.

export function listFactories(): Promise<Factory[]> {
  return request<Factory[]>(FACTORIES_PATH);
}

export function getFactory(factoryId: string): Promise<FactoryDetail> {
  return request<FactoryDetail>(`${FACTORIES_PATH}/${encodeURIComponent(factoryId)}`);
}

export function createFactory(payload: FactoryCreateRequest): Promise<FactoryDetail> {
  return request<FactoryDetail>(FACTORIES_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Fabrikayı kaydeder.
 *
 * Model gönderildiğinde backend, içeriğin özetini güncel sürümünkiyle
 * karşılaştırır: aynıysa yeni sürüm oluşmaz ve var olan sürüm geri döner.
 * Yani "Kaydet" düğmesine iki kez basmak sürüm geçmişini kirletmez.
 */
export function saveFactory(
  factoryId: string,
  payload: FactorySaveRequest,
): Promise<FactoryDetail> {
  return request<FactoryDetail>(`${FACTORIES_PATH}/${encodeURIComponent(factoryId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/**
 * Fabrikayı siler.
 *
 * Sunucu 204 döndürür; gövde yoktur ve `parseResponse` JSON beklediği için
 * envanter silmede olduğu gibi burada da ayrı ele alınır.
 */
export async function deleteFactory(factoryId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}${FACTORIES_PATH}/${encodeURIComponent(factoryId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      },
    );
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Gövde JSON değilse ham durum koduyla devam edilir.
    }
    const rawDetails = extractRawDetails(body, response.status);
    throw new ApiError(response.status, rawDetails, translateErrorDetails(rawDetails));
  }
}

export function listFactoryVersions(
  factoryId: string,
): Promise<FactoryVersionSummary[]> {
  return request<FactoryVersionSummary[]>(
    `${FACTORIES_PATH}/${encodeURIComponent(factoryId)}/versions`,
  );
}

export function getFactoryVersion(
  factoryId: string,
  versionId: string,
): Promise<FactoryVersion> {
  return request<FactoryVersion>(
    `${FACTORIES_PATH}/${encodeURIComponent(factoryId)}/versions/${encodeURIComponent(versionId)}`,
  );
}

/**
 * Kayıtlı bir fabrikanın güncel sürümünü çalıştırır.
 *
 * `runSimulation` ile aynı hesabı yapar; tek farkı sonucun hangi fabrika
 * sürümünden üretildiğinin kaydedilmesidir. Bu sayede aylar sonra bakıldığında
 * sonucun hangi modelden geldiği kesin olarak bilinir.
 */
export function runFactorySimulation(
  factoryId: string,
): Promise<SimulationRunResponse> {
  return request<SimulationRunResponse>(
    `${FACTORIES_PATH}/${encodeURIComponent(factoryId)}/run`,
    { method: "POST" },
  );
}
