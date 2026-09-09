import { describe, expect, it } from "vitest";
import { defaultSettings } from "./fields";
import {
  SAMPLE_STATIONS,
  sampleConfigs,
  sampleMappings,
  sampleSources,
} from "./fixtures";
import {
  countBySeverity,
  hasBlockingIssue,
  sortIssues,
  validateConnector,
  validateMappings,
  validateSettings,
} from "./validation";
import type { ConnectorSettings, FieldMapping, SourceNode } from "./types";

const SOURCES = sampleSources();

function opcuaSettings(overrides: ConnectorSettings = {}): ConnectorSettings {
  return {
    endpoint: "opc.tcp://192.168.1.10:4840",
    securityPolicy: "Basic256Sha256",
    username: "optiflow",
    password: "gizli",
    nodePrefix: "ns=2;s=Line1",
    ...overrides,
  };
}

function mqttSettings(overrides: ConnectorSettings = {}): ConnectorSettings {
  return {
    broker: "mqtt://192.168.1.20",
    port: 1883,
    topic: "fabrika/#",
    username: null,
    password: null,
    qos: "1",
    tls: false,
    ...overrides,
  };
}

function restSettings(overrides: ConnectorSettings = {}): ConnectorSettings {
  return {
    baseUrl: "https://mes.local/api",
    apiKey: "anahtar",
    bearer: null,
    refreshSeconds: 30,
    healthPath: "/health",
    ...overrides,
  };
}

describe("validateSettings — zorunlu alanlar", () => {
  it("dogru ayarlarda hata cikarmaz", () => {
    expect(validateSettings("opcua", opcuaSettings())).toEqual([]);
  });

  it("bos zorunlu alani hata sayar", () => {
    const issues = validateSettings("opcua", opcuaSettings({ endpoint: null }));
    expect(issues[0].code).toBe("empty_field");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].text).toContain("Endpoint");
  });

  it("bosluktan ibaret metin de bos sayilir", () => {
    const issues = validateSettings("mqtt", mqttSettings({ topic: "   " }));
    expect(issues.some((issue) => issue.code === "empty_field")).toBe(true);
  });

  it("tamamen bos yeni bir ayar tum zorunlu alanlari isaretler", () => {
    const issues = validateSettings("mqtt", defaultSettings("mqtt"));
    const empties = issues.filter((issue) => issue.code === "empty_field");
    // broker, port, topic ve qos zorunlu.
    expect(empties).toHaveLength(4);
  });

  it("istege bagli alanin bosu sorun degildir", () => {
    const issues = validateSettings("opcua", opcuaSettings({ username: null, password: null }));
    expect(issues.some((issue) => issue.code === "empty_field")).toBe(false);
  });
});

describe("validateSettings — sayisal alanlar", () => {
  it("aralik disi portu reddeder", () => {
    const issues = validateSettings("mqtt", mqttSettings({ port: 99_999 }));
    expect(issues.some((issue) => issue.text.includes("en fazla"))).toBe(true);
  });

  it("cok kucuk yenileme araligini reddeder", () => {
    const issues = validateSettings("rest", restSettings({ refreshSeconds: 1 }));
    expect(issues.some((issue) => issue.text.includes("en az"))).toBe(true);
  });

  it("sayi olmayan degeri reddeder", () => {
    const issues = validateSettings("mqtt", mqttSettings({ port: "abc" }));
    expect(issues.some((issue) => issue.text.includes("sayı olmalı"))).toBe(true);
  });

  it("sinirdaki deger kabul edilir", () => {
    const issues = validateSettings("rest", restSettings({ refreshSeconds: 5 }));
    expect(hasBlockingIssue(issues)).toBe(false);
  });
});

describe("validateSettings — protokol kurallari", () => {
  it("yanlis semali OPC UA adresini yakalar", () => {
    // En sik yapilan hata; baglanti zaman asimiyla ogrenmek dakikalar alir.
    const issues = validateSettings("opcua", opcuaSettings({ endpoint: "http://plc" }));
    expect(issues.some((issue) => issue.text.includes("opc.tcp://"))).toBe(true);
  });

  it("guvenliksiz ve kimliksiz OPC UA baglantisini uyarir", () => {
    const issues = validateSettings(
      "opcua",
      opcuaSettings({ securityPolicy: "None", username: null }),
    );
    const warning = issues.find((issue) => issue.severity === "warning");
    expect(warning?.text).toContain("herkese açıktır");
  });

  it("yanlis semali broker adresini yakalar", () => {
    const issues = validateSettings("mqtt", mqttSettings({ broker: "192.168.1.20" }));
    expect(issues.some((issue) => issue.text.includes("mqtt://"))).toBe(true);
  });

  it("TLS acikken sifresiz portu uyarir", () => {
    const issues = validateSettings("mqtt", mqttSettings({ tls: true, port: 1883 }));
    expect(issues.some((issue) => issue.text.includes("8883"))).toBe(true);
  });

  it("sifresiz REST adresini uyarir ama engellemez", () => {
    const issues = validateSettings("rest", restSettings({ baseUrl: "http://mes.local" }));
    expect(issues.some((issue) => issue.text.includes("şifresiz"))).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("kimlik dogrulamasiz REST baglantisini uyarir", () => {
    const issues = validateSettings("rest", restSettings({ apiKey: null, bearer: null }));
    expect(issues.some((issue) => issue.text.includes("bearer"))).toBe(true);
  });

  it("gecersiz secim degerini reddeder", () => {
    const issues = validateSettings("mqtt", mqttSettings({ qos: "5" }));
    expect(issues.some((issue) => issue.text.includes("şu değerlerden"))).toBe(
      true,
    );
  });
});

describe("validateMappings", () => {
  const stations = SAMPLE_STATIONS;

  it("eksik alanlari uyari olarak listeler", () => {
    const issues = validateMappings({
      sources: SOURCES,
      mappings: sampleMappings(),
      stations,
    });
    const missing = issues.filter((issue) => issue.code === "missing_node");
    // 3 istasyon x 5 alan = 15; 8 esleme var, 7 eksik.
    expect(missing).toHaveLength(7);
    expect(missing.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("eksik alan uyarisi alani ve istasyonu tasir", () => {
    const issues = validateMappings({
      sources: SOURCES,
      mappings: sampleMappings(),
      stations,
    });
    const missing = issues.find(
      (issue) => issue.stationId === "torna" && issue.field === "cycleTime",
    );
    expect(missing?.text).toContain("Torna");
    expect(missing?.text).toContain("Çevrim süresi");
  });

  it("tip uyusmazligini hata sayar", () => {
    const bad: FieldMapping[] = [
      {
        id: "torna:queue",
        sourceId: "src-mqtt-state",
        stationId: "torna",
        field: "queue",
      },
    ];
    const issues = validateMappings({ sources: SOURCES, mappings: bad, stations });
    const mismatch = issues.find((issue) => issue.code === "type_mismatch");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.text).toContain("string");
  });

  it("var olmayan dugume bagli eslemeyi hata sayar", () => {
    const orphan: FieldMapping[] = [
      { id: "torna:queue", sourceId: "silinmis", stationId: "torna", field: "queue" },
    ];
    const issues = validateMappings({ sources: SOURCES, mappings: orphan, stations });
    const missing = issues.find((issue) => issue.code === "missing_node");
    expect(missing?.severity).toBe("error");
    expect(missing?.mappingId).toBe("torna:queue");
  });

  it("ayni dugumun birden cok alani beslemesini uyarir", () => {
    const doubled: FieldMapping[] = [
      { id: "torna:queue", sourceId: "src-mqtt-queue", stationId: "torna", field: "queue" },
      { id: "torna:scrap", sourceId: "src-mqtt-queue", stationId: "torna", field: "scrap" },
    ];
    const issues = validateMappings({ sources: SOURCES, mappings: doubled, stations });
    const conflict = issues.find((issue) => issue.code === "conflicting_mapping");
    expect(conflict?.severity).toBe("warning");
    expect(conflict?.text).toContain("Kuyruk");
    expect(conflict?.text).toContain("Fire");
  });

  it("farkli istasyonlarda ayni dugum cakisma sayilmaz", () => {
    const shared: FieldMapping[] = [
      { id: "torna:queue", sourceId: "src-mqtt-queue", stationId: "torna", field: "queue" },
      { id: "kesim:queue", sourceId: "src-mqtt-queue", stationId: "kesim", field: "queue" },
    ];
    const issues = validateMappings({ sources: SOURCES, mappings: shared, stations });
    expect(issues.some((issue) => issue.code === "conflicting_mapping")).toBe(
      false,
    );
  });

  it("kullanilmayan dugumu bilgi olarak yazar", () => {
    // "Veri geliyor ama ekranda yok" sikayetinin en sik nedeni budur.
    const issues = validateMappings({
      sources: SOURCES,
      mappings: sampleMappings(),
      stations,
    });
    const unused = issues.filter((issue) => issue.code === "unused_source");
    expect(unused.length).toBeGreaterThan(0);
    expect(unused.every((issue) => issue.severity === "info")).toBe(true);
  });

  it("istasyon yoksa eksik alan uyarisi uretmez", () => {
    const issues = validateMappings({
      sources: SOURCES,
      mappings: sampleMappings(),
      stations: [],
    });
    expect(
      issues.some(
        (issue) => issue.code === "missing_node" && issue.mappingId === null,
      ),
    ).toBe(false);
  });

  it("bos kurulumda hicbir sey uretmez", () => {
    expect(
      validateMappings({ sources: [], mappings: [], stations: [] }),
    ).toEqual([]);
  });

  it("bulgular onem sirasina dizilir", () => {
    const mixed: FieldMapping[] = [
      { id: "torna:queue", sourceId: "src-mqtt-state", stationId: "torna", field: "queue" },
    ];
    const issues = validateMappings({ sources: SOURCES, mappings: mixed, stations });
    const severities = issues.map((issue) => issue.severity);
    const weight = { error: 0, warning: 1, info: 2 } as const;
    const sorted = [...severities].sort((a, b) => weight[a] - weight[b]);
    expect(severities).toEqual(sorted);
  });
});

describe("hasBlockingIssue / countBySeverity / sortIssues", () => {
  it("hata varsa baglanti engellenir", () => {
    const issues = validateSettings("opcua", opcuaSettings({ endpoint: null }));
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("yalnizca uyari varsa engellenmez", () => {
    const issues = validateSettings("rest", restSettings({ baseUrl: "http://mes.local" }));
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("onem sayilarini verir", () => {
    const counts = countBySeverity(
      validateMappings({
        sources: SOURCES,
        mappings: sampleMappings(),
        stations: SAMPLE_STATIONS,
      }),
    );
    expect(counts.warning).toBeGreaterThan(0);
    expect(counts.info).toBeGreaterThan(0);
    expect(counts.error).toBe(0);
  });

  it("siralama girdiyi degistirmez", () => {
    const issues = validateSettings("opcua", opcuaSettings({ endpoint: null }));
    const copy = [...issues];
    sortIssues(issues);
    expect(issues).toEqual(copy);
  });
});

describe("validateConnector", () => {
  it("ayar ve esleme bulgularini birlikte doner", () => {
    const [opcua] = sampleConfigs();
    const broken = {
      ...opcua,
      settings: { ...opcua.settings, endpoint: null },
    };
    const issues = validateConnector(broken, {
      sources: SOURCES,
      mappings: sampleMappings(),
      stations: SAMPLE_STATIONS,
    });
    expect(issues.some((issue) => issue.code === "empty_field")).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("baska baglantinin dugumlerini sinamaz", () => {
    const [opcua] = sampleConfigs();
    const issues = validateConnector(opcua, {
      sources: SOURCES,
      mappings: sampleMappings(),
      stations: SAMPLE_STATIONS,
    });
    expect(
      issues.some((issue) => issue.text.includes("Torna kuyruk")),
    ).toBe(false);
  });

  it("eksik alan uyarisi baglanti bazinda uretilmez", () => {
    // Bir istasyonun kuyrugunu baska bir baglanti besliyor olabilir.
    const [opcua] = sampleConfigs();
    const issues = validateConnector(opcua, {
      sources: SOURCES,
      mappings: sampleMappings(),
      stations: SAMPLE_STATIONS,
    });
    expect(
      issues.some(
        (issue) => issue.code === "missing_node" && issue.mappingId === null,
      ),
    ).toBe(false);
  });

  it("kaynagi olmayan baglanti icin bos doner", () => {
    const erp = sampleConfigs().find((item) => item.kind === "erp");
    const issues = validateConnector(erp!, {
      sources: [] as SourceNode[],
      mappings: [],
      stations: SAMPLE_STATIONS,
    });
    // ERP ornekte hic yapilandirilmamis; yalnizca ayar hatalari cikar.
    expect(issues.every((issue) => issue.code !== "type_mismatch")).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });
});
