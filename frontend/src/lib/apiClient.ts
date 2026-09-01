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
  SimulationConfig,
  SimulationRunResponse,
  SimulationTrace,
  ValidationReportResponse,
} from "../types/simulationTypes";
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  translateErrorDetails,
} from "./errorMessages";

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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
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
