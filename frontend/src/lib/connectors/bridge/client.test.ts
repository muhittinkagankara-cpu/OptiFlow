import { describe, expect, it } from "vitest";
import { BRIDGE_NETWORK_ERROR, RUNTIME_PATH, RuntimeBridgeClient } from "./client";

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
    headers: new Headers(),
  } as unknown as Response;
}

function clientWith(
  handler: (call: Call) => Response | Promise<Response>,
  token: string | null = "belirtec",
) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;

  const client = new RuntimeBridgeClient({
    baseUrl: "https://api.ornek.dev",
    getToken: async () => token,
    fetchImpl,
  });
  return { client, calls };
}

describe("adres kurulumu", () => {
  it("uc yolu runtime altinda", () => {
    expect(RUNTIME_PATH).toBe("/api/runtime");
  });

  it("sondaki egik cizgi cogaltilmaz", async () => {
    const calls: Call[] = [];
    const client = new RuntimeBridgeClient({
      baseUrl: "https://api.ornek.dev/",
      getToken: async () => null,
      fetchImpl: (async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
        return jsonResponse({ connections: [] });
      }) as unknown as typeof fetch,
    });
    await client.status();
    expect(calls[0].url).toBe("https://api.ornek.dev/api/runtime/status");
  });
});

describe("kimlik dogrulama", () => {
  it("belirtec basliga konur", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ connections: [] }));
    await client.status();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer belirtec");
  });

  it("oturum yoksa baslik gonderilmez", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ connections: [] }), null);
    await client.status();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("belirtec adrese yazilmaz", async () => {
    // Sorgu dizesine konsaydi tarayici gecmisine ve sunucu gunluklerine gecerdi.
    const { client, calls } = clientWith(() => jsonResponse({ connections: [] }));
    await client.status();
    expect(calls[0].url).not.toContain("belirtec");
  });
});

describe("fetch bagi", () => {
  it("fetch globalThis'e bagli cagrilir", async () => {
    /*
     * SALES-7'de bir sinif alaninda saklanan `fetch`, `this` olarak sinif
     * ornegini aldigi icin tarayicida "Illegal invocation" veriyordu. Bu sahte
     * uygulama, yanlis `this` ile cagrilirsa hata firlatir.
     */
    function picky(this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse({ connections: [] }));
    }

    const client = new RuntimeBridgeClient({
      baseUrl: "https://api.ornek.dev",
      getToken: async () => null,
      fetchImpl: picky as unknown as typeof fetch,
    });

    const result = await client.status();
    expect(result.error).toBeNull();
  });
});

describe("connect", () => {
  it("govde sunucu bicimine cevrilir", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ connection_id: "hat-1" }));
    await client.connect({
      connectionId: "hat-1",
      kind: "opcua",
      label: "PLC",
      endpoint: "opc.tcp://127.0.0.1:4840",
      topics: ["ns=2;i=2"],
      timeoutMs: 3_000,
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.connection_id).toBe("hat-1");
    expect(body.timeout_ms).toBe(3_000);
  });

  it("yanit cozulur", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ connection_id: "hat-1", status: "connected", ever_verified: true }),
    );
    const result = await client.connect({
      connectionId: "hat-1",
      kind: "rest",
      label: "API",
      endpoint: "http://x",
    });
    expect(result.data?.status).toBe("connected");
    expect(result.data?.everVerified).toBe(true);
  });

  it("post yontemi kullanilir", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}));
    await client.connect({
      connectionId: "c",
      kind: "rest",
      label: "l",
      endpoint: "http://x",
    });
    expect(calls[0].init.method).toBe("POST");
  });
});

describe("disconnect", () => {
  it("kimlik govdeye konur", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}));
    await client.disconnect("hat-1");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      connection_id: "hat-1",
      forget: false,
    });
  });

  it("unutma istegi iletilir", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}));
    await client.disconnect("hat-1", true);
    expect(JSON.parse(String(calls[0].init.body)).forget).toBe(true);
  });
});

describe("status ve health", () => {
  it("baglanti listesi cozulur", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ connections: [{ connection_id: "a" }, { connection_id: "b" }] }),
    );
    const result = await client.status();
    expect(result.data).toHaveLength(2);
  });

  it("saglik ozeti cozulur", async () => {
    const { client } = clientWith(() => jsonResponse({ total: 2, avg_latency_ms: null }));
    const result = await client.health();
    expect(result.data?.total).toBe(2);
    expect(result.data?.avgLatencyMs).toBeNull();
  });
});

describe("events", () => {
  it("since sorguya konur", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ events: [] }));
    await client.events(12);
    expect(calls[0].url).toContain("since=12");
  });

  it("baglanti kimligi sorguya konur", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ events: [] }));
    await client.events(0, "hat-1");
    expect(calls[0].url).toContain("connection_id=hat-1");
  });

  it("kimlik verilmezse sorguya konmaz", async () => {
    const { client, calls } = clientWith(() => jsonResponse({ events: [] }));
    await client.events(0);
    expect(calls[0].url).not.toContain("connection_id");
  });

  it("olay sayfasi cozulur", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ events: [{ sequence: 3 }], capacity: 1_000 }),
    );
    const result = await client.events();
    expect(result.data?.events[0].sequence).toBe(3);
  });
});

describe("hata yollari", () => {
  it("sunucu hatasinda detay gosterilir", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ detail: "'yok' kimlikli bağlantı bulunamadı." }, 404),
    );
    const result = await client.disconnect("yok");
    expect(result.data).toBeNull();
    expect(result.error).toContain("bulunamadı");
  });

  it("detay yoksa durum kodu yazilir", async () => {
    const { client } = clientWith(() => jsonResponse({}, 500));
    const result = await client.status();
    expect(result.error).toContain("500");
  });

  it("govde okunamazsa durum kodu yazilir", async () => {
    const { client } = clientWith(
      () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error("bozuk");
          },
        }) as unknown as Response,
    );
    const result = await client.status();
    expect(result.error).toContain("502");
  });

  it("ag hatasinda kullanici mesaji doner", async () => {
    const { client } = clientWith(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await client.status();
    expect(result.error).toBe(BRIDGE_NETWORK_ERROR);
  });

  it("ag hatasinda veri null kalir", async () => {
    const { client } = clientWith(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await client.health()).data).toBeNull();
  });

  it("hata mesaji ne yapilacagini soyler", () => {
    expect(BRIDGE_NETWORK_ERROR).toContain("kontrol edin");
  });
});

describe("stream", () => {
  it("akis acilamazsa hata bildirilir", async () => {
    const mesajlar: string[] = [];
    const { client } = clientWith(() => jsonResponse({}, 503));
    await client.stream(
      () => undefined,
      (message) => mesajlar.push(message),
    );
    expect(mesajlar[0]).toContain("503");
  });

  it("ag hatasinda akis hata bildirir", async () => {
    const mesajlar: string[] = [];
    const { client } = clientWith(() => {
      throw new TypeError("Failed to fetch");
    });
    await client.stream(
      () => undefined,
      (message) => mesajlar.push(message),
    );
    expect(mesajlar[0]).toBe(BRIDGE_NETWORK_ERROR);
  });

  it("akis istegi sse kabul basligi tasir", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}, 503));
    await client.stream(
      () => undefined,
      () => undefined,
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("kapatma islevi doner", async () => {
    const { client } = clientWith(() => jsonResponse({}, 503));
    const stop = await client.stream(
      () => undefined,
      () => undefined,
    );
    expect(typeof stop).toBe("function");
  });
});
