/**
 * REST runtime — bu sürümdeki **tek gerçek** bağlantı uygulaması.
 *
 * Gerçek bir HTTP isteği atar: adres, başlıklar, bearer token ve zaman aşımı
 * kullanıcının girdiği ayarlardan gelir. Başarılı bir yanıtta HTTP kodu,
 * ölçülen gecikme ve içerik boyutu döner; başarısızlıkta nedeni yazılır.
 *
 * İstek **yalnızca kullanıcı isterse** atılır: ekran açıldığında ya da ayar
 * yazılırken hiçbir yere gidilmez. Bir fabrika ağında, kullanıcının bilmediği
 * bir anda dışarı çıkan istek kabul edilemez.
 *
 * İstek kurma ve yanıt sınıflandırma **saf** işlevlerdir; ağ çağrısı yalnızca
 * `RestRuntime.test`/`start` içindedir. Böylece başlık birleştirme, token
 * ekleme ve hata metinleri ağ olmadan sınanabilir.
 */

import type { ConnectorSettings } from "../types";
import {
  notAttempted,
  probeStatus,
  type PollingRuntime,
  type RuntimeProbe,
} from "./types";

/** Varsayılan zaman aşımı (ms). */
export const DEFAULT_TIMEOUT_MS = 8_000;

/** Zaman aşımının izin verilen aralığı. */
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 60_000;

/** Varsayılan yoklama aralığı (sn). */
export const DEFAULT_POLL_SECONDS = 30;

export interface RestRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface RequestProblem {
  field: string;
  text: string;
}

/**
 * Ayarları isteğe çevirir.
 *
 * Adres eksik ya da bozuksa istek **kurulmaz**: hatalı bir adrese gidip zaman
 * aşımı beklemek, kullanıcıya sekiz saniye boyunca yanlış bir umut verirdi.
 */
export function buildRestRequest(
  settings: ConnectorSettings,
): { request: RestRequest | null; problems: RequestProblem[] } {
  const problems: RequestProblem[] = [];

  const base = text(settings.baseUrl);
  const path = text(settings.healthPath);

  if (base === "") {
    problems.push({ field: "baseUrl", text: "Temel adres girilmedi." });
  } else if (!/^https?:\/\//i.test(base)) {
    problems.push({
      field: "baseUrl",
      text: "Adres http:// ya da https:// ile başlamalı.",
    });
  }

  const timeoutMs = clampTimeout(settings.timeoutMs);

  let url: string | null = null;
  if (problems.length === 0) {
    try {
      url = new URL(path === "" ? base : joinPath(base, path)).toString();
    } catch {
      problems.push({ field: "baseUrl", text: "Adres çözümlenemedi." });
    }
  }

  if (url === null) {
    return { request: null, problems };
  }

  return {
    request: { url, headers: buildHeaders(settings), timeoutMs },
    problems,
  };
}

/** Temel adres ile yolu tek bir adrese birleştirir. */
export function joinPath(base: string, path: string): string {
  const left = base.replace(/\/+$/, "");
  const right = path.replace(/^\/+/, "");
  return `${left}/${right}`;
}

/**
 * İstek başlıkları.
 *
 * Bearer token varsa `Authorization` başlığı yazılır; API anahtarı ayrı bir
 * başlıkta gider (`X-API-Key`) çünkü çoğu MES ucu ikisini farklı ele alır.
 * Kullanıcının yazdığı serbest başlıklar en sona eklenir ve **öncekileri
 * ezebilir**: uç noktanın beklediği özel bir başlık varsa, ürünün varsayımı
 * ona engel olmamalıdır.
 */
export function buildHeaders(settings: ConnectorSettings): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };

  const bearer = text(settings.bearer);
  if (bearer !== "") {
    headers.Authorization = bearer.toLowerCase().startsWith("bearer ")
      ? bearer
      : `Bearer ${bearer}`;
  }

  const apiKey = text(settings.apiKey);
  if (apiKey !== "") {
    headers["X-API-Key"] = apiKey;
  }

  for (const [key, value] of Object.entries(parseHeaderLines(text(settings.headers)))) {
    headers[key] = value;
  }

  return headers;
}

/**
 * "Anahtar: değer" satırlarını başlık nesnesine çevirir.
 *
 * Satır biçimi bilinçlidir: JSON istemek, formu dolduran bir bakım
 * mühendisinden yazım hatası olmayan JSON beklemek olurdu.
 */
export function parseHeaderLines(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key !== "" && value !== "") {
      headers[key] = value;
    }
  }
  return headers;
}

/** Zaman aşımını aralığa çeker. */
export function clampTimeout(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(numeric)));
}

/** Yoklama aralığı (ms). */
export function pollIntervalMs(settings: ConnectorSettings): number {
  const seconds = Number(settings.refreshSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_POLL_SECONDS * 1_000;
  }
  return Math.max(1, Math.round(seconds)) * 1_000;
}

/**
 * HTTP kodunu sonuca çevirir.
 *
 * 2xx başarı; 401/403 kimlik, 404 adres, 5xx sunucu sorunudur. Kullanıcıya
 * "istek başarısız" demek yerine hangi tarafın düzeltilmesi gerektiğini
 * söylemek, kurulum süresini kısaltan en ucuz iyileştirmedir.
 */
export function classifyHttp(status: number): { ok: boolean; detail: string } {
  if (status >= 200 && status < 300) {
    return { ok: true, detail: `HTTP ${status} — uç nokta yanıt verdi.` };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      detail: `HTTP ${status} — kimlik doğrulama reddedildi; token ya da API anahtarını kontrol edin.`,
    };
  }
  if (status === 404) {
    return {
      ok: false,
      detail: "HTTP 404 — adres bulunamadı; temel adres ve sağlık ucu yolunu kontrol edin.",
    };
  }
  if (status === 408 || status === 504) {
    return { ok: false, detail: `HTTP ${status} — uç nokta zamanında yanıt vermedi.` };
  }
  if (status >= 500) {
    return { ok: false, detail: `HTTP ${status} — sunucu hatası; uç nokta çalışmıyor olabilir.` };
  }
  return { ok: false, detail: `HTTP ${status} — istek reddedildi.` };
}

/**
 * Ağ hatasını okunur bir nedene çevirir.
 *
 * Tarayıcı, CORS ve DNS hatalarını aynı `TypeError` ile bildirir; ikisini
 * ayırmak mümkün değildir ve kullanıcıya ikisini birden söylemek, sahada en
 * çok zaman kazandıran açıklamadır.
 */
export function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Zaman aşımı — uç nokta verilen sürede yanıt vermedi.";
  }
  if (error instanceof TypeError) {
    return "Bağlantı kurulamadı — adres yanlış olabilir, sunucu kapalı olabilir ya da tarayıcı CORS nedeniyle isteği engellemiş olabilir.";
  }
  return error instanceof Error
    ? `Bağlantı kurulamadı: ${error.message}`
    : "Bağlantı kurulamadı.";
}

/* -------------------------------------------------------------------------- */

/**
 * REST runtime istemcisi.
 *
 * `fetch` dışarıdan verilebilir; testler ağ olmadan çalışsın diye. Varsayılan
 * değer tarayıcının kendi `fetch`'idir.
 */
export class RestRuntime implements PollingRuntime {
  readonly kind = "rest" as const;
  readonly name = "REST";
  readonly isImplemented = true;
  readonly description =
    "Gerçek HTTP isteği atar. İstek yalnızca siz test ettiğinizde ya da yoklamayı başlattığınızda gönderilir.";

  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    /*
     * `fetch` **globalThis'e bağlanarak** saklanır. Bağlanmadan bir sınıf alanına
     * konduğunda çağrı sırasında `this` sınıf örneği olur ve tarayıcı isteği
     * "Illegal invocation" ile reddeder — bu, tarayıcı doğrulamasında yakalanan
     * ve testlerde görünmeyen bir hataydı: sahte fetch'ler `this`'e bakmadığı
     * için birim testleri geçiyordu.
     */
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  async test(settings: ConnectorSettings, nowMs: number): Promise<RuntimeProbe> {
    const { request, problems } = buildRestRequest(settings);

    if (request === null) {
      return notAttempted(
        problems.map((problem) => problem.text).join(" ") ||
          "Ayarlar eksik olduğu için istek gönderilmedi.",
        nowMs,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const started = performance.now();

    try {
      const response = await this.fetchImpl(request.url, {
        method: "GET",
        headers: request.headers,
        signal: controller.signal,
      });

      const body = await response.text();
      const latencyMs = Math.round(performance.now() - started);
      const { ok, detail } = classifyHttp(response.status);

      return {
        attempted: true,
        ok,
        status: probeStatus(true, ok),
        httpStatus: response.status,
        latencyMs,
        sizeBytes: byteLength(body),
        detail: `${detail} (${latencyMs} ms, ${byteLength(body)} bayt)`,
        payload: parseJson(body),
        atMs: nowMs,
      };
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        status: "failed",
        httpStatus: null,
        latencyMs: Math.round(performance.now() - started),
        sizeBytes: null,
        detail: describeNetworkError(error),
        payload: null,
        atMs: nowMs,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Yoklamayı başlatır.
   *
   * İlk istek hemen atılır: kullanıcı "başlat" dedikten sonra ilk veriyi
   * yoklama aralığı kadar beklemek, bağlantının çalışmadığı izlenimi verirdi.
   */
  start(
    settings: ConnectorSettings,
    onPayload: (probe: RuntimeProbe) => void,
  ): void {
    this.stop();
    const tick = (): void => {
      void this.test(settings, Date.now()).then(onPayload);
    };
    tick();
    this.timer = setInterval(tick, pollIntervalMs(settings));
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

/* -------------------------------------------------------------------------- */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** UTF-8 bayt uzunluğu; içerik boyutu bunun üzerinden raporlanır. */
export function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** Gövdeyi JSON'a çevirir; çevrilemezse ham metni döndürür. */
export function parseJson(body: string): unknown {
  if (body.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
