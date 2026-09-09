import { describe, expect, it, vi } from "vitest";
import type { ConnectorSettings } from "../types";
import {
  DEFAULT_POLL_SECONDS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  RestRuntime,
  buildHeaders,
  buildRestRequest,
  byteLength,
  clampTimeout,
  classifyHttp,
  describeNetworkError,
  joinPath,
  parseHeaderLines,
  parseJson,
  pollIntervalMs,
} from "./rest";

const NOW = 1_700_000_000_000;

function settings(overrides: ConnectorSettings = {}): ConnectorSettings {
  return {
    baseUrl: "https://mes.local/api",
    apiKey: null,
    bearer: null,
    refreshSeconds: 30,
    healthPath: "/health",
    headers: null,
    timeoutMs: null,
    ...overrides,
  };
}

/** Sahte yanıt üreten fetch. */
function fakeFetch(
  body: string,
  status = 200,
  captured?: { url?: string; init?: RequestInit },
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (captured) {
      captured.url = url;
      captured.init = init;
    }
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

describe("joinPath", () => {
  it("cift egik cizgi uretmez", () => {
    expect(joinPath("https://a.local/api/", "/health")).toBe(
      "https://a.local/api/health",
    );
  });

  it("egik cizgisiz parcalari birlestirir", () => {
    expect(joinPath("https://a.local/api", "health")).toBe(
      "https://a.local/api/health",
    );
  });
});

describe("clampTimeout", () => {
  it("varsayilani kullanir", () => {
    expect(clampTimeout(null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeout("abc")).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeout(0)).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("alt ve ust sinira ceker", () => {
    expect(clampTimeout(10)).toBe(MIN_TIMEOUT_MS);
    expect(clampTimeout(900_000)).toBe(MAX_TIMEOUT_MS);
  });

  it("aralik icindeki degeri korur", () => {
    expect(clampTimeout(5_000)).toBe(5_000);
  });
});

describe("pollIntervalMs", () => {
  it("saniyeyi milisaniyeye cevirir", () => {
    expect(pollIntervalMs(settings({ refreshSeconds: 15 }))).toBe(15_000);
  });

  it("gecersiz degerde varsayilana doner", () => {
    expect(pollIntervalMs(settings({ refreshSeconds: null }))).toBe(
      DEFAULT_POLL_SECONDS * 1_000,
    );
    expect(pollIntervalMs(settings({ refreshSeconds: -5 }))).toBe(
      DEFAULT_POLL_SECONDS * 1_000,
    );
  });
});

describe("parseHeaderLines", () => {
  it("satirlari basliga cevirir", () => {
    expect(parseHeaderLines("X-Line: 1\nX-Shift: A")).toEqual({
      "X-Line": "1",
      "X-Shift": "A",
    });
  });

  it("bos satirlari ve bozuk girisleri atlar", () => {
    expect(parseHeaderLines("\n  \nbozuk-satir\nX-Ok: 1")).toEqual({ "X-Ok": "1" });
  });

  it("degerdeki iki nokta korunur", () => {
    expect(parseHeaderLines("X-Time: 12:30")).toEqual({ "X-Time": "12:30" });
  });

  it("bos metinde bos nesne doner", () => {
    expect(parseHeaderLines("")).toEqual({});
  });
});

describe("buildHeaders", () => {
  it("varsayilan Accept basligini koyar", () => {
    expect(buildHeaders(settings()).Accept).toBe("application/json");
  });

  it("bearer tokeni Authorization'a yazar", () => {
    expect(buildHeaders(settings({ bearer: "abc123" })).Authorization).toBe(
      "Bearer abc123",
    );
  });

  it("zaten 'Bearer' ile baslayan tokeni ikilemez", () => {
    expect(buildHeaders(settings({ bearer: "Bearer abc" })).Authorization).toBe(
      "Bearer abc",
    );
  });

  it("API anahtarini ayri baslikta gonderir", () => {
    // Cogu MES ucu ikisini farkli ele alir.
    expect(buildHeaders(settings({ apiKey: "k1" }))["X-API-Key"]).toBe("k1");
  });

  it("kullanici basliklari varsayilani ezebilir", () => {
    const headers = buildHeaders(settings({ headers: "Accept: text/plain" }));
    expect(headers.Accept).toBe("text/plain");
  });

  it("token yoksa Authorization yazilmaz", () => {
    expect(buildHeaders(settings()).Authorization).toBeUndefined();
  });
});

describe("buildRestRequest", () => {
  it("saglik ucunu adrese ekler", () => {
    const { request } = buildRestRequest(settings());
    expect(request?.url).toBe("https://mes.local/api/health");
  });

  it("saglik ucu yoksa temel adresi kullanir", () => {
    const { request } = buildRestRequest(settings({ healthPath: null }));
    expect(request?.url).toBe("https://mes.local/api");
  });

  it("adres yoksa istek kurmaz", () => {
    // Hatali adrese gidip zaman asimi beklemek, kullaniciya yanlis umut verirdi.
    const { request, problems } = buildRestRequest(settings({ baseUrl: null }));
    expect(request).toBeNull();
    expect(problems[0].field).toBe("baseUrl");
  });

  it("yanlis semali adresi reddeder", () => {
    const { request, problems } = buildRestRequest(
      settings({ baseUrl: "opc.tcp://plc" }),
    );
    expect(request).toBeNull();
    expect(problems[0].text).toContain("http://");
  });

  it("zaman asimini isteğe tasir", () => {
    const { request } = buildRestRequest(settings({ timeoutMs: 3_000 }));
    expect(request?.timeoutMs).toBe(3_000);
  });

  it("basliklari isteğe tasir", () => {
    const { request } = buildRestRequest(settings({ headers: "X-Line: 2" }));
    expect(request?.headers["X-Line"]).toBe("2");
  });
});

describe("classifyHttp", () => {
  it("2xx basaridir", () => {
    expect(classifyHttp(200).ok).toBe(true);
    expect(classifyHttp(204).ok).toBe(true);
  });

  it("401 ve 403 kimlik sorunudur", () => {
    expect(classifyHttp(401).detail).toContain("kimlik doğrulama");
    expect(classifyHttp(403).ok).toBe(false);
  });

  it("404 adres sorunudur", () => {
    expect(classifyHttp(404).detail).toContain("adres bulunamadı");
  });

  it("5xx sunucu hatasidir", () => {
    expect(classifyHttp(500).detail).toContain("sunucu hatası");
    expect(classifyHttp(503).ok).toBe(false);
  });

  it("408 ve 504 zaman asimi olarak anlatilir", () => {
    expect(classifyHttp(408).detail).toContain("zamanında yanıt vermedi");
    expect(classifyHttp(504).detail).toContain("zamanında yanıt vermedi");
  });

  it("diger kodlar reddedilmis sayilir", () => {
    expect(classifyHttp(418).ok).toBe(false);
  });
});

describe("describeNetworkError", () => {
  it("iptal edilen istegi zaman asimi olarak anlatir", () => {
    const error = new DOMException("aborted", "AbortError");
    expect(describeNetworkError(error)).toContain("Zaman aşımı");
  });

  it("ag hatasinda CORS ihtimalini de yazar", () => {
    // Tarayici CORS ile DNS hatasini ayirt edilemez bicimde bildirir.
    expect(describeNetworkError(new TypeError("failed"))).toContain("CORS");
  });

  it("bilinmeyen hatada mesaji tasir", () => {
    expect(describeNetworkError(new Error("boom"))).toContain("boom");
  });

  it("hata nesnesi olmayan girdide de cumle kurar", () => {
    expect(describeNetworkError("x")).toContain("Bağlantı kurulamadı");
  });
});

describe("byteLength / parseJson", () => {
  it("UTF-8 bayt uzunlugunu olcer", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("ış")).toBe(4);
  });

  it("JSON govdesini cozer", () => {
    expect(parseJson('{"queue":3}')).toEqual({ queue: 3 });
  });

  it("JSON olmayan govdeyi ham birakir", () => {
    expect(parseJson("merhaba")).toBe("merhaba");
  });

  it("bos govde null doner", () => {
    expect(parseJson("   ")).toBeNull();
  });
});

describe("RestRuntime.test", () => {
  it("gercek istemci olarak isaretlidir", () => {
    const runtime = new RestRuntime();
    expect(runtime.isImplemented).toBe(true);
    expect(runtime.kind).toBe("rest");
  });

  it("ayarlar eksikse istek atmaz", async () => {
    const spy = vi.fn();
    const runtime = new RestRuntime(spy as unknown as typeof fetch);
    const probe = await runtime.test(settings({ baseUrl: null }), NOW);

    expect(spy).not.toHaveBeenCalled();
    expect(probe.attempted).toBe(false);
    expect(probe.status).toBe("idle");
    expect(probe.detail).toContain("Temel adres");
  });

  it("basarili yanitta kod, gecikme ve boyut doner", async () => {
    const runtime = new RestRuntime(fakeFetch('{"queue":12}', 200));
    const probe = await runtime.test(settings(), NOW);

    expect(probe.attempted).toBe(true);
    expect(probe.ok).toBe(true);
    expect(probe.status).toBe("connected");
    expect(probe.httpStatus).toBe(200);
    expect(probe.sizeBytes).toBe(12);
    expect(probe.latencyMs).not.toBeNull();
    expect(probe.payload).toEqual({ queue: 12 });
  });

  it("hata kodunda nedenini yazar ve basarisiz sayar", async () => {
    const runtime = new RestRuntime(fakeFetch("", 401));
    const probe = await runtime.test(settings(), NOW);

    expect(probe.ok).toBe(false);
    expect(probe.status).toBe("failed");
    expect(probe.detail).toContain("kimlik doğrulama");
  });

  it("istegi dogru adrese ve basliklarla gonderir", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const runtime = new RestRuntime(fakeFetch("{}", 200, captured));
    await runtime.test(
      settings({ bearer: "tok", headers: "X-Line: 3" }),
      NOW,
    );

    expect(captured.url).toBe("https://mes.local/api/health");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Line"]).toBe("3");
  });

  it("ag hatasinda denendi ama basarisiz doner", async () => {
    const runtime = new RestRuntime((() => {
      throw new TypeError("network");
    }) as unknown as typeof fetch);
    const probe = await runtime.test(settings(), NOW);

    expect(probe.attempted).toBe(true);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("Bağlantı kurulamadı");
  });

  it("zaman asiminda acikca soyler", async () => {
    const runtime = new RestRuntime((() => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch);
    const probe = await runtime.test(settings({ timeoutMs: 1_000 }), NOW);

    expect(probe.detail).toContain("Zaman aşımı");
    expect(probe.status).toBe("failed");
  });

  it("fetch'i globalThis'e bagli cagirir", async () => {
    /*
     * Tarayicida yakalanan hata: `fetch` bagli olmadan sinif alanina konunca
     * `this` sinif ornegi oluyor ve istek "Illegal invocation" ile reddediliyor.
     * Bu test, cagrinin `this` baglamini dogrudan sinar.
     */
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    } as unknown as typeof fetch;

    const probe = await new RestRuntime(strictFetch).test(settings(), NOW);
    expect(probe.ok).toBe(true);
    expect(probe.httpStatus).toBe(200);
  });

  it("verilen ani sonuca yazar", async () => {
    const runtime = new RestRuntime(fakeFetch("{}", 200));
    expect((await runtime.test(settings(), NOW)).atMs).toBe(NOW);
  });
});

describe("RestRuntime yoklama", () => {
  it("baslamadan once calismiyor", () => {
    expect(new RestRuntime(fakeFetch("{}")).isRunning).toBe(false);
  });

  it("baslatinca ilk istegi hemen atar", async () => {
    vi.useFakeTimers();
    const calls: unknown[] = [];
    const runtime = new RestRuntime(fakeFetch('{"queue":1}'));
    runtime.start(settings(), (probe) => calls.push(probe));

    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBeGreaterThan(0);
    runtime.stop();
    vi.useRealTimers();
  });

  it("durdurulunca calismayi biraktigini bildirir", () => {
    vi.useFakeTimers();
    const runtime = new RestRuntime(fakeFetch("{}"));
    runtime.start(settings(), () => undefined);
    expect(runtime.isRunning).toBe(true);
    runtime.stop();
    expect(runtime.isRunning).toBe(false);
    vi.useRealTimers();
  });

  it("ikinci kez baslatmak ikinci zamanlayici kurmaz", () => {
    vi.useFakeTimers();
    const runtime = new RestRuntime(fakeFetch("{}"));
    runtime.start(settings(), () => undefined);
    runtime.start(settings(), () => undefined);
    expect(runtime.isRunning).toBe(true);
    runtime.stop();
    expect(runtime.isRunning).toBe(false);
    vi.useRealTimers();
  });
});
