import { describe, expect, it } from "vitest";
import {
  SERVER_BRIDGE_KINDS,
  VERDICT_LABEL,
  compatibilityMatrix,
  hasServerBridge,
  matrixSummary,
  verdictFor,
  verifiedCount,
} from "./matrix";
import type { BridgeConnection, BridgeKind } from "./types";

function connection(overrides: Partial<BridgeConnection> = {}): BridgeConnection {
  return {
    connectionId: "c1",
    kind: "rest" as BridgeKind,
    label: "Hat 1",
    endpoint: "http://127.0.0.1/veri",
    port: null,
    username: null,
    hasPassword: false,
    topics: [],
    securityPolicy: "None",
    qos: 1,
    timeoutMs: 5_000,
    maxRetries: 0,
    status: "idle",
    everVerified: false,
    attempt: 0,
    health: {
      avgLatencyMs: null,
      medianLatencyMs: null,
      maxLatencyMs: null,
      samples: 0,
      reconnects: 0,
      packets: 0,
      errors: 0,
      errorRate: null,
      uptimeMs: null,
      lastPacketAtMs: null,
      lastError: null,
    },
    lastProbe: null,
    ...overrides,
  };
}

const verifiedRest = connection({
  status: "connected",
  everVerified: true,
  lastProbe: {
    ok: true,
    latencyMs: 12,
    detail: "uc yanit verdi",
    evidence: "HTTP 200, 24 bayt",
    bytesReceived: 24,
    atMs: 1_700,
  },
});

describe("etiketler", () => {
  it("uc durum tanimli", () => {
    expect(Object.keys(VERDICT_LABEL)).toEqual([
      "verified",
      "simulated",
      "unverified",
    ]);
  });

  it("yalnizca dogrulanan durum gercek der", () => {
    expect(VERDICT_LABEL.verified).toBe("Gerçek doğrulandı");
    expect(VERDICT_LABEL.simulated).toBe("Benzetim");
    expect(VERDICT_LABEL.unverified).toBe("Doğrulanmadı");
  });
});

describe("hasServerBridge", () => {
  it("rest sunucu koprusunde var", () => {
    expect(hasServerBridge("rest")).toBe(true);
  });

  it("opcua sunucu koprusunde var", () => {
    expect(hasServerBridge("opcua")).toBe(true);
  });

  it("mqtt sunucu koprusunde var", () => {
    expect(hasServerBridge("mqtt")).toBe(true);
  });

  it("csv sunucu koprusunde yok", () => {
    expect(hasServerBridge("csv")).toBe(false);
  });

  it("erp sunucu koprusunde yok", () => {
    expect(hasServerBridge("erp")).toBe(false);
  });

  it("koprude uc surucu var", () => {
    expect(SERVER_BRIDGE_KINDS).toHaveLength(3);
  });
});

describe("verdictFor", () => {
  it("hic baglanti yoksa dogrulanmadi", () => {
    // Surucunun var olmasi bir baglantiyi dogrulanmis yapmaz.
    expect(verdictFor("rest", []).verdict).toBe("unverified");
  });

  it("hic baglanti yoksa neden yazilir", () => {
    expect(verdictFor("rest", []).reason).toContain("henüz gerçek bir cihazla");
  });

  it("denenmis ama dogrulanmamis baglanti dogrulanmadi kalir", () => {
    const failed = connection({ status: "failed" });
    const row = verdictFor("rest", [failed]);
    expect(row.verdict).toBe("unverified");
    expect(row.reason).toContain("hiçbir bağlantı doğrulanmadı");
  });

  it("dogrulanmis baglanti gercek sayilir", () => {
    expect(verdictFor("rest", [verifiedRest]).verdict).toBe("verified");
  });

  it("dogrulanmis satirda kanit gorunur", () => {
    expect(verdictFor("rest", [verifiedRest]).evidence).toBe("HTTP 200, 24 bayt");
  });

  it("dogrulanan baglanti sayisi yazilir", () => {
    const row = verdictFor("rest", [verifiedRest, connection({ connectionId: "c2" })]);
    expect(row.verifiedCount).toBe(1);
  });

  it("baska protokolun baglantisi sayilmaz", () => {
    expect(verdictFor("opcua", [verifiedRest]).verdict).toBe("unverified");
  });

  it("benzetim isaretlenen protokol benzetim olur", () => {
    const row = verdictFor("csv", [], { simulated: true });
    expect(row.verdict).toBe("simulated");
    expect(row.reason).toContain("cihazdan gelmiyor");
  });

  it("dogrulama benzetimi yener", () => {
    // Gercek yanit alindiysa satir artik benzetim degildir.
    const row = verdictFor("rest", [verifiedRest], { simulated: true });
    expect(row.verdict).toBe("verified");
  });

  it("koprusuz protokolun nedeni yazilir", () => {
    expect(verdictFor("erp", []).reason).toContain("sürücüsü yok");
  });

  it("tarayici istemcisi isaretlenebilir", () => {
    expect(verdictFor("rest", [], { browserClient: true }).hasBrowserClient).toBe(true);
  });

  it("dogrulanmamis satirda kanit yok", () => {
    expect(verdictFor("rest", [connection({ status: "failed" })]).evidence).toBeNull();
  });

  it("etiket protokol adini tasir", () => {
    expect(verdictFor("opcua", []).label).toBe("OPC UA");
  });
});

describe("compatibilityMatrix", () => {
  it("bes protokol listelenir", () => {
    expect(compatibilityMatrix([])).toHaveLength(5);
  });

  it("sira sabittir", () => {
    expect(compatibilityMatrix([]).map((row) => row.kind)).toEqual([
      "rest",
      "opcua",
      "mqtt",
      "csv",
      "erp",
    ]);
  });

  it("hicbiri denenmediyse hepsi dogrulanmadi", () => {
    expect(compatibilityMatrix([]).every((row) => row.verdict === "unverified")).toBe(
      true,
    );
  });

  it("dogrulanan protokol isaretlenir", () => {
    const rows = compatibilityMatrix([verifiedRest]);
    expect(rows[0].verdict).toBe("verified");
    expect(rows[1].verdict).toBe("unverified");
  });

  it("benzetim listesi uygulanir", () => {
    const rows = compatibilityMatrix([], { simulated: ["csv"] });
    expect(rows.find((row) => row.kind === "csv")?.verdict).toBe("simulated");
  });

  it("tarayici istemcileri isaretlenir", () => {
    const rows = compatibilityMatrix([], { browserClients: ["rest"] });
    expect(rows[0].hasBrowserClient).toBe(true);
  });
});

describe("verifiedCount", () => {
  it("dogrulanan satirlari sayar", () => {
    expect(verifiedCount(compatibilityMatrix([verifiedRest]))).toBe(1);
  });

  it("hicbiri yoksa sifir", () => {
    expect(verifiedCount(compatibilityMatrix([]))).toBe(0);
  });
});

describe("matrixSummary", () => {
  it("hicbiri dogrulanmadiysa acikca soyler", () => {
    expect(matrixSummary(compatibilityMatrix([]))).toContain(
      "hiçbir protokol gerçek bir cihazla doğrulanmadı",
    );
  });

  it("dogrulananlari adiyla yazar", () => {
    const summary = matrixSummary(compatibilityMatrix([verifiedRest]));
    expect(summary).toContain("REST");
    expect(summary).toContain("1 protokol");
  });

  it("benzetim satirlari dogrulanmis sayilmaz", () => {
    const summary = matrixSummary(compatibilityMatrix([], { simulated: ["csv", "erp"] }));
    expect(summary).toContain("hiçbir protokol");
  });
});
