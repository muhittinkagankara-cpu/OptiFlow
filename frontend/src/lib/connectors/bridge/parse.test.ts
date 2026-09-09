import { describe, expect, it } from "vitest";
import {
  numberOr,
  numberOrNull,
  parseConnection,
  parseConnections,
  parseEvent,
  parseEventPage,
  parseHealth,
  parseKind,
  parseLevel,
  parseProbe,
  parseStatus,
  parseSummary,
  stringOrNull,
  toRequestBody,
} from "./parse";

describe("numberOrNull", () => {
  it("sayiyi korur", () => {
    expect(numberOrNull(12.5)).toBe(12.5);
  });

  it("olculmus sifiri korur", () => {
    // "0 ms gecikme" ile "gecikme olculmedi" ayni sey degildir.
    expect(numberOrNull(0)).toBe(0);
  });

  it("null degeri null birakir", () => {
    expect(numberOrNull(null)).toBeNull();
  });

  it("eksik alani null yapar", () => {
    expect(numberOrNull(undefined)).toBeNull();
  });

  it("NaN olculmemis sayilir", () => {
    expect(numberOrNull(Number.NaN)).toBeNull();
  });

  it("sonsuzu olculmemis sayar", () => {
    expect(numberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("metni null yapar", () => {
    expect(numberOrNull("12")).toBeNull();
  });
});

describe("numberOr", () => {
  it("sayac icin varsayilan kullanilir", () => {
    expect(numberOr(undefined, 0)).toBe(0);
  });

  it("gelen sayi korunur", () => {
    expect(numberOr(7, 0)).toBe(7);
  });
});

describe("stringOrNull", () => {
  it("metni korur", () => {
    expect(stringOrNull("hata")).toBe("hata");
  });

  it("bos metni null yapar", () => {
    expect(stringOrNull("")).toBeNull();
  });

  it("sayiyi null yapar", () => {
    expect(stringOrNull(5)).toBeNull();
  });
});

describe("parseKind", () => {
  it("bilinen turu korur", () => {
    expect(parseKind("opcua")).toBe("opcua");
  });

  it("bilinmeyen turu rest sayar", () => {
    expect(parseKind("modbus")).toBe("rest");
  });
});

describe("parseStatus", () => {
  it("bilinen durumu korur", () => {
    expect(parseStatus("connected")).toBe("connected");
  });

  it("bilinmeyen durum test edilmedi olur", () => {
    // Bilinmeyen bir degerin "baglandi" okunmasi sozlesmenin en tehlikeli
    // ihlali olurdu.
    expect(parseStatus("belirsiz")).toBe("idle");
  });

  it("eksik durum test edilmedi olur", () => {
    expect(parseStatus(undefined)).toBe("idle");
  });
});

describe("parseLevel", () => {
  it("bilinen seviyeyi korur", () => {
    expect(parseLevel("critical")).toBe("critical");
  });

  it("bilinmeyen seviye bilgi olur", () => {
    expect(parseLevel("acil")).toBe("info");
  });
});

describe("parseHealth", () => {
  it("bos gövdede olculer null", () => {
    const health = parseHealth(undefined);
    expect(health.avgLatencyMs).toBeNull();
    expect(health.uptimeMs).toBeNull();
    expect(health.errorRate).toBeNull();
  });

  it("bos gövdede sayaclar sifir", () => {
    const health = parseHealth(undefined);
    expect(health.packets).toBe(0);
    expect(health.errors).toBe(0);
  });

  it("gelen olculeri okur", () => {
    const health = parseHealth({
      avg_latency_ms: 12.5,
      median_latency_ms: 10,
      max_latency_ms: 90,
      samples: 3,
      packets: 4,
      errors: 1,
      error_rate: 0.2,
      uptime_ms: 5_000,
      last_packet_at_ms: 1_700,
      last_error: "kapali",
    });
    expect(health.avgLatencyMs).toBe(12.5);
    expect(health.samples).toBe(3);
    expect(health.lastError).toBe("kapali");
  });

  it("son hata yoksa null", () => {
    expect(parseHealth({ last_error: null }).lastError).toBeNull();
  });
});

describe("parseProbe", () => {
  it("null deneme null kalir", () => {
    expect(parseProbe(null)).toBeNull();
  });

  it("eksik deneme null kalir", () => {
    expect(parseProbe(undefined)).toBeNull();
  });

  it("basarili denemeyi okur", () => {
    const probe = parseProbe({
      ok: true,
      latency_ms: 8,
      detail: "uc yanit verdi",
      evidence: "HTTP 200",
      bytes_received: 12,
      at_ms: 1_700,
    });
    expect(probe?.ok).toBe(true);
    expect(probe?.evidence).toBe("HTTP 200");
  });

  it("kanit yoksa null", () => {
    expect(parseProbe({ ok: false, detail: "kapali" })?.evidence).toBeNull();
  });

  it("ok alani eksikse basarisiz sayilir", () => {
    // Belirsiz bir yanit basari sayilmaz.
    expect(parseProbe({ detail: "?" })?.ok).toBe(false);
  });

  it("olculmeyen gecikme null kalir", () => {
    expect(parseProbe({ ok: true, detail: "x" })?.latencyMs).toBeNull();
  });
});

describe("parseConnection", () => {
  const raw = {
    connection_id: "hat-1",
    kind: "opcua",
    label: "PLC 1",
    endpoint: "opc.tcp://127.0.0.1:4840",
    port: 4840,
    username: "op",
    has_password: true,
    topics: ["ns=2;i=2", 5],
    security_policy: "None",
    qos: 1,
    timeout_ms: 3_000,
    max_retries: 2,
    status: "connected",
    ever_verified: true,
    attempt: 0,
    health: { packets: 2 },
    last_probe: { ok: true, detail: "ok", evidence: "42" },
  };

  it("kimlik ve turu okur", () => {
    const connection = parseConnection(raw);
    expect(connection.connectionId).toBe("hat-1");
    expect(connection.kind).toBe("opcua");
  });

  it("parola alani gelmez, varligi bilinir", () => {
    expect(parseConnection(raw).hasPassword).toBe(true);
    expect(JSON.stringify(parseConnection(raw))).not.toContain("password\":\"");
  });

  it("metin olmayan konulari suzer", () => {
    expect(parseConnection(raw).topics).toEqual(["ns=2;i=2"]);
  });

  it("dogrulama isareti okunur", () => {
    expect(parseConnection(raw).everVerified).toBe(true);
  });

  it("bos gövde cokmeden okunur", () => {
    const connection = parseConnection({});
    expect(connection.status).toBe("idle");
    expect(connection.everVerified).toBe(false);
    expect(connection.lastProbe).toBeNull();
  });

  it("liste gövdesi okunur", () => {
    expect(parseConnections({ connections: [raw, raw] })).toHaveLength(2);
  });

  it("liste yoksa bos doner", () => {
    expect(parseConnections({})).toEqual([]);
  });
});

describe("parseSummary", () => {
  it("bos gövdede gecikme null", () => {
    expect(parseSummary({}).avgLatencyMs).toBeNull();
  });

  it("bos gövdede sayaclar sifir", () => {
    expect(parseSummary({}).total).toBe(0);
  });

  it("gelen ozeti okur", () => {
    const summary = parseSummary({
      total: 3,
      connected: 1,
      failed: 2,
      verified_ever: 1,
      avg_latency_ms: 11,
      buffered_events: 9,
      at_ms: 1_700,
    });
    expect(summary.connected).toBe(1);
    expect(summary.verifiedEver).toBe(1);
    expect(summary.avgLatencyMs).toBe(11);
  });
});

describe("parseEvent", () => {
  it("olayi okur", () => {
    const event = parseEvent({
      sequence: 4,
      connection_id: "hat-1",
      kind: "probe",
      level: "info",
      message: "yanit verdi",
      at_ms: 1_700,
      data: { latency_ms: 5 },
    });
    expect(event.sequence).toBe(4);
    expect(event.data.latency_ms).toBe(5);
  });

  it("bos gövdede tur bilinmiyor olur", () => {
    expect(parseEvent({}).kind).toBe("unknown");
  });

  it("veri alani sozluk degilse boslanir", () => {
    expect(parseEvent({ data: "x" }).data).toEqual({});
  });
});

describe("parseEventPage", () => {
  it("olaylari okur", () => {
    const page = parseEventPage({
      events: [{ sequence: 1 }],
      buffered: 1,
      capacity: 1_000,
      dropped_before: null,
    });
    expect(page.events).toHaveLength(1);
    expect(page.capacity).toBe(1_000);
  });

  it("kayip yoksa null kalir", () => {
    expect(parseEventPage({}).droppedBefore).toBeNull();
  });

  it("kayip bildirilirse okunur", () => {
    // Eksik araligi sessizce atlamak "hic hata olmadi" sanilmasina yol acar.
    expect(parseEventPage({ dropped_before: 12 }).droppedBefore).toBe(12);
  });
});

describe("toRequestBody", () => {
  it("alan adlarini sunucu bicimine cevirir", () => {
    const body = toRequestBody({
      connectionId: "hat-1",
      kind: "mqtt",
      label: "Broker",
      endpoint: "broker.local",
      port: 1883,
      topics: ["a/b"],
      qos: 2,
      timeoutMs: 4_000,
      maxRetries: 1,
    });
    expect(body.connection_id).toBe("hat-1");
    expect(body.timeout_ms).toBe(4_000);
    expect(body.max_retries).toBe(1);
  });

  it("verilmeyen alanlar varsayilanlarla gider", () => {
    const body = toRequestBody({
      connectionId: "c",
      kind: "rest",
      label: "l",
      endpoint: "http://x",
    });
    expect(body.topics).toEqual([]);
    expect(body.security_policy).toBe("None");
    expect(body.max_retries).toBe(0);
  });

  it("parola gövdeye konur ama yanitta donmez", () => {
    // Parola sunucuya gitmek zorundadir; donus yolunda maskelenir.
    expect(toRequestBody({
      connectionId: "c",
      kind: "rest",
      label: "l",
      endpoint: "http://x",
      password: "gizli",
    }).password).toBe("gizli");
  });
});
