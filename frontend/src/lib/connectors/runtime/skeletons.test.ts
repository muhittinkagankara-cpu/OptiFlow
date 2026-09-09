import { describe, expect, it } from "vitest";
import { CONNECTOR_ORDER, type ConnectorSettings } from "../types";
import { implementedKinds, runtimeFor } from "./index";
import { CsvRuntime, ErpRuntime, MqttRuntime, OpcUaRuntime } from "./skeletons";
import { RUNTIME_STATUS_LABEL, notAttempted, probeStatus } from "./types";

const NOW = 1_700_000_000_000;

describe("probeStatus", () => {
  it("denenmemis sonuc asla 'bagli' olamaz", () => {
    // Tek kapi: sahte bir "connected" bu katmanda uretilemez.
    expect(probeStatus(false, true)).toBe("idle");
    expect(probeStatus(false, false)).toBe("idle");
  });

  it("denenmis ve basarili sonuc baglidir", () => {
    expect(probeStatus(true, true)).toBe("connected");
  });

  it("denenmis ve basarisiz sonuc hatadir", () => {
    expect(probeStatus(true, false)).toBe("failed");
  });
});

describe("notAttempted", () => {
  const probe = notAttempted("İstemci yok.", NOW);

  it("denenmedi olarak isaretlenir", () => {
    expect(probe.attempted).toBe(false);
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe("idle");
  });

  it("olculebilir hicbir deger uretmez", () => {
    expect(probe.latencyMs).toBeNull();
    expect(probe.httpStatus).toBeNull();
    expect(probe.sizeBytes).toBeNull();
    expect(probe.payload).toBeNull();
  });

  it("nedeni tasir", () => {
    expect(probe.detail).toBe("İstemci yok.");
  });
});

describe("RUNTIME_STATUS_LABEL", () => {
  it("idle durumu 'Test edilmedi' der", () => {
    // "Bagli degil" demek, denenmis ama basarisiz izlenimi verirdi.
    expect(RUNTIME_STATUS_LABEL.idle).toBe("Test edilmedi");
  });

  it("failed durumu 'Baglanti kurulamadi' der", () => {
    expect(RUNTIME_STATUS_LABEL.failed).toBe("Bağlantı kurulamadı");
  });

  it("her durumun bir etiketi vardir", () => {
    expect(Object.keys(RUNTIME_STATUS_LABEL)).toHaveLength(5);
  });
});

describe("OpcUaRuntime", () => {
  const runtime = new OpcUaRuntime();

  it("gercek istemci tasimadigini soyler", () => {
    expect(runtime.isImplemented).toBe(false);
  });

  it("engeli acikca yazar", () => {
    expect(runtime.blocker).toContain("tarayıcıdan doğrudan konuşulamaz");
  });

  it("test cagrisi deneme yapmaz", async () => {
    const probe = await runtime.test({ endpoint: "opc.tcp://plc:4840" }, NOW);
    expect(probe.attempted).toBe(false);
    expect(probe.detail).toContain("doğrulanmadı");
  });

  it("ayarlar dogru olsa bile 'bagli' demez", async () => {
    const probe = await runtime.test(
      { endpoint: "opc.tcp://plc:4840", securityPolicy: "Basic256Sha256" },
      NOW,
    );
    expect(probe.status).toBe("idle");
    expect(probe.ok).toBe(false);
  });

  it("eksik endpoint'i ayrica bildirir", async () => {
    const probe = await runtime.test({ endpoint: null }, NOW);
    expect(probe.detail).toContain("Endpoint girilmedi");
  });

  it("yanlis semali endpoint'i bildirir", async () => {
    const probe = await runtime.test({ endpoint: "http://plc" }, NOW);
    expect(probe.detail).toContain("opc.tcp://");
  });

  it("guvenlik politikasi None ise uyarir", async () => {
    const probe = await runtime.test(
      { endpoint: "opc.tcp://plc:4840", securityPolicy: "None" },
      NOW,
    );
    expect(probe.detail).toContain("None");
  });
});

describe("MqttRuntime", () => {
  const runtime = new MqttRuntime();

  function mqtt(overrides: ConnectorSettings = {}): ConnectorSettings {
    return {
      broker: "mqtt://broker.local",
      port: 1883,
      topic: "fabrika/#",
      qos: "1",
      tls: false,
      ...overrides,
    };
  }

  it("gercek istemci tasimaz", () => {
    expect(runtime.isImplemented).toBe(false);
  });

  it("WebSocket gereksinimini yazar", () => {
    expect(runtime.blocker).toContain("WebSocket");
  });

  it("dogru ayarlarda bile denemez", async () => {
    const probe = await runtime.test(mqtt(), NOW);
    expect(probe.attempted).toBe(false);
    expect(probe.status).toBe("idle");
  });

  it("eksik broker adresini bildirir", async () => {
    expect((await runtime.test(mqtt({ broker: null }), NOW)).detail).toContain(
      "Broker adresi girilmedi",
    );
  });

  it("yanlis semali broker adresini bildirir", async () => {
    expect(
      (await runtime.test(mqtt({ broker: "192.168.1.5" }), NOW)).detail,
    ).toContain("mqtt://");
  });

  it("gecersiz portu bildirir", async () => {
    expect((await runtime.test(mqtt({ port: 99_999 }), NOW)).detail).toContain(
      "1-65535",
    );
  });

  it("eksik konuyu bildirir", async () => {
    expect((await runtime.test(mqtt({ topic: "" }), NOW)).detail).toContain(
      "Konu (topic) girilmedi",
    );
  });

  it("TLS acikken sifresiz portu uyarir", async () => {
    expect(
      (await runtime.test(mqtt({ tls: true, port: 1883 }), NOW)).detail,
    ).toContain("8883");
  });
});

describe("CsvRuntime / ErpRuntime", () => {
  it("CSV klasor izlemenin neden yapilamadigini yazar", async () => {
    const probe = await new CsvRuntime().test({ folder: "\\\\sunucu\\rapor" }, NOW);
    expect(probe.attempted).toBe(false);
    expect(probe.detail).toContain("kendiliğinden izleyemez");
  });

  it("ERP icin REST kullanmayi onerir", async () => {
    const probe = await new ErpRuntime().test({ baseUrl: "https://erp.local" }, NOW);
    expect(probe.detail).toContain("REST");
  });

  it("eksik ayarlari da bildirir", async () => {
    expect((await new CsvRuntime().test({ folder: null }, NOW)).detail).toContain(
      "klasör girilmedi",
    );
  });
});

describe("runtimeFor", () => {
  it("her protokol icin bir istemci doner", () => {
    for (const kind of CONNECTOR_ORDER) {
      expect(runtimeFor(kind).kind).toBe(kind);
    }
  });

  it("yalnizca REST gercek istemcidir", () => {
    expect(implementedKinds(CONNECTOR_ORDER)).toEqual(["rest"]);
  });

  it("gerceklenmemis istemciler denemez", async () => {
    for (const kind of CONNECTOR_ORDER.filter((item) => item !== "rest")) {
      const probe = await runtimeFor(kind).test({}, NOW);
      expect(probe.attempted).toBe(false);
    }
  });
});
