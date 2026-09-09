/**
 * Saha kabul raporunun testleri.
 *
 * Savunulan kural: **doğrulanmayan hiçbir satır gizlenmez.** Denenmemiş bir
 * protokol rapordan çıkarılsaydı, müşteri eksiksiz bir belge imzalar ve
 * eksiklik aylar sonra ortaya çıkardı.
 */

import { describe, expect, it } from "vitest";
import {
  NOT_MEASURED,
  acceptanceAlarmVerdict,
  buildAcceptanceReport,
  acceptanceDeviceRows,
  acceptanceDeviceVerdict,
  formatInstallDate,
  formatLatency,
  formatPercent,
  protocolRows,
  protocolVerdict,
  acceptanceSummaryItems,
  verifiedDevices,
  verifiedProtocols,
  type AcceptanceDevice,
  type AcceptanceInput,
  type ProtocolCheck,
} from "./acceptanceReport";

function cihaz(overrides: Partial<AcceptanceDevice> = {}): AcceptanceDevice {
  return {
    label: "Hat 1 PLC",
    protocol: "opcua",
    endpoint: "opc.tcp://10.0.0.5:4840",
    verified: true,
    latencyMs: 12.4,
    machineLabel: "FREZE-01",
    ...overrides,
  };
}

function protokol(overrides: Partial<ProtocolCheck> = {}): ProtocolCheck {
  return { protocol: "opcua", verified: true, detail: "Düğüm okundu", ...overrides };
}

function girdi(overrides: Partial<AcceptanceInput> = {}): AcceptanceInput {
  return {
    customer: "Pilot A.Ş.",
    factoryName: "Pilot Fabrika",
    installedAtMs: Date.UTC(2026, 8, 10),
    generatedAtLabel: "10 Eylül 2026, 09:00",
    devices: [cihaz()],
    protocols: [protokol()],
    alarms: { raised: 3, exercised: true },
    oee: 0.72,
    licenseTier: "Büyüme",
    checklistReady: true,
    checklistSummary: "Kurulum tamamlandı; on adımın tamamı doğrulandı.",
    ...overrides,
  };
}

describe("biçimler", () => {
  it("hesaplanmamış oran tire", () => {
    expect(formatPercent(null)).toBe(NOT_MEASURED);
  });

  it("oran yüzdeye çevrilir", () => {
    expect(formatPercent(0.72)).toBe("%72");
  });

  it("ölçülmemiş gecikme tire", () => {
    expect(formatLatency(null)).toBe(NOT_MEASURED);
  });

  it("gecikme yuvarlanır", () => {
    expect(formatLatency(12.4)).toBe("12 ms");
  });

  it("bilinmeyen kurulum tarihi tire", () => {
    expect(formatInstallDate(null)).toBe(NOT_MEASURED);
  });

  it("sıfır tarih tire", () => {
    expect(formatInstallDate(0)).toBe(NOT_MEASURED);
  });

  it("kurulum tarihi yazılır", () => {
    expect(formatInstallDate(Date.UTC(2026, 8, 10))).toContain("2026");
  });
});

describe("protokol durumu", () => {
  it("doğrulanan protokol", () => {
    expect(protocolVerdict(protokol())).toBe("Gerçek doğrulandı");
  });

  it("denenip doğrulanamayan protokol", () => {
    expect(protocolVerdict(protokol({ verified: false }))).toBe(
      "Denendi, doğrulanamadı",
    );
  });

  it("hiç denenmemiş protokol", () => {
    // "Denendi ama olmadı" ile "hiç denenmedi" aynı kelimeyle anlatılsaydı,
    // müşteri olmayan bir arızanın peşine düşerdi.
    expect(protocolVerdict(protokol({ verified: null }))).toBe("Doğrulanmadı");
  });

  it("doğrulanan protokol sayılır", () => {
    const liste = [protokol(), protokol({ verified: false }), protokol({ verified: null })];
    expect(verifiedProtocols(liste)).toBe(1);
  });

  it("protokol satırı üç sütun", () => {
    expect(protocolRows([protokol()])[0]).toHaveLength(3);
  });

  it("kanıtsız protokolde tire yazılır", () => {
    expect(protocolRows([protokol({ detail: null })])[0][2]).toBe(NOT_MEASURED);
  });

  it("doğrulanmayan protokol satırda kalır", () => {
    expect(protocolRows([protokol({ verified: null })])).toHaveLength(1);
  });
});

describe("cihaz tablosu", () => {
  it("doğrulanan cihaz", () => {
    expect(acceptanceDeviceVerdict(cihaz())).toBe("Gerçek doğrulandı");
  });

  it("doğrulanmayan cihaz", () => {
    expect(acceptanceDeviceVerdict(cihaz({ verified: false }))).toBe("Doğrulanmadı");
  });

  it("doğrulanan cihaz sayılır", () => {
    expect(verifiedDevices([cihaz(), cihaz({ verified: false })])).toBe(1);
  });

  it("satır altı sütun", () => {
    expect(acceptanceDeviceRows([cihaz()])[0]).toHaveLength(6);
  });

  it("saha etiketi yazılır", () => {
    expect(acceptanceDeviceRows([cihaz()])[0][1]).toBe("FREZE-01");
  });

  it("etiketsiz cihazda tire", () => {
    expect(acceptanceDeviceRows([cihaz({ machineLabel: null })])[0][1]).toBe(NOT_MEASURED);
  });

  it("protokol büyük harf", () => {
    expect(acceptanceDeviceRows([cihaz()])[0][2]).toBe("OPCUA");
  });

  it("doğrulanmayan cihaz satırda kalır", () => {
    expect(acceptanceDeviceRows([cihaz({ verified: false })])[0][4]).toBe("Doğrulanmadı");
  });
});

describe("alarm testi", () => {
  it("tetiklenmemiş zincir uyarır", () => {
    expect(acceptanceAlarmVerdict({ raised: 0, exercised: false })).toContain("doğrulanmadı");
  });

  it("tetiklenmiş zincir sayı verir", () => {
    expect(acceptanceAlarmVerdict({ raised: 3, exercised: true })).toContain("3 alarm");
  });
});

describe("özet", () => {
  it("dört KPI", () => {
    expect(acceptanceSummaryItems(girdi())).toHaveLength(4);
  });

  it("tümü doğrulandıysa iyi", () => {
    expect(acceptanceSummaryItems(girdi())[0].tone).toBe("good");
  });

  it("eksik doğrulamada uyarı", () => {
    const items = acceptanceSummaryItems(girdi({ devices: [cihaz(), cihaz({ verified: false })] }));
    expect(items[0].tone).toBe("warning");
  });

  it("cihaz yoksa uyarı", () => {
    expect(acceptanceSummaryItems(girdi({ devices: [] }))[0].tone).toBe("warning");
  });

  it("hesaplanmayan OEE tire", () => {
    expect(acceptanceSummaryItems(girdi({ oee: null }))[2].value).toBe(NOT_MEASURED);
  });

  it("eksik kurulum uyarı", () => {
    expect(acceptanceSummaryItems(girdi({ checklistReady: false }))[3].tone).toBe("warning");
  });

  it("kurulum özeti ipucunda", () => {
    expect(acceptanceSummaryItems(girdi())[3].hint).toContain("tamamlandı");
  });
});

describe("rapor belgesi", () => {
  it("dosya adı müşteriyi taşır", () => {
    expect(buildAcceptanceReport(girdi()).fileName).toContain("Pilot A.Ş.");
  });

  it("kapak başlığı", () => {
    expect(buildAcceptanceReport(girdi()).cover.title).toBe("Saha Kabul Raporu");
  });

  it("kapakta kurulum tarihi", () => {
    expect(buildAcceptanceReport(girdi()).cover.facts[0].value).toContain("2026");
  });

  it("kapakta protokol oranı", () => {
    expect(buildAcceptanceReport(girdi()).cover.facts[2].value).toBe("1/1");
  });

  it("imza alanı var", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    expect(blocks.some((block) => block.kind === "signature")).toBe(true);
  });

  it("imza alanında iki taraf var", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    const imza = blocks.find((block) => block.kind === "signature");
    expect(imza?.kind === "signature" && imza.parties).toHaveLength(2);
  });

  it("müşteri yetkilisi imzalar", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    const imza = blocks.find((block) => block.kind === "signature");
    const roller = imza?.kind === "signature" ? imza.parties.map((p) => p.role) : [];
    expect(roller).toContain("Müşteri yetkilisi");
  });

  it("cihaz yoksa uyarı bloğu", () => {
    const blocks = buildAcceptanceReport(girdi({ devices: [] })).blocks;
    const metin = blocks
      .filter((block) => block.kind === "note")
      .map((block) => (block.kind === "note" ? block.text : ""))
      .join(" ");
    expect(metin).toContain("imzalanamaz");
  });

  it("eksik kurulumda uyarı bloğu", () => {
    // Rapor imzalansa bile kurulum eksik sayılır.
    const blocks = buildAcceptanceReport(girdi({ checklistReady: false })).blocks;
    const metin = blocks
      .filter((block) => block.kind === "note")
      .map((block) => (block.kind === "note" ? block.text : ""))
      .join(" ");
    expect(metin).toContain("eksik sayılır");
  });

  it("tamamlanan kurulumda uyarı yok", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    expect(blocks.filter((block) => block.kind === "note")).toHaveLength(0);
  });

  it("kurulum bilgileri tablosu var", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    const tablolar = blocks.filter((block) => block.kind === "table");
    expect(tablolar.length).toBeGreaterThanOrEqual(4);
  });

  it("lisans planı raporda", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    const metin = JSON.stringify(blocks);
    expect(metin).toContain("Büyüme");
  });

  it("lisanssız kurulumda tire yazılır", () => {
    const blocks = buildAcceptanceReport(girdi({ licenseTier: null })).blocks;
    const tablo = blocks.find(
      (block) => block.kind === "table" && block.columns[0] === "Alan",
    );
    const satırlar = tablo?.kind === "table" ? tablo.rows : [];
    expect(satırlar[3][1]).toBe(NOT_MEASURED);
  });

  it("açıklama gizlenmediğini söyler", () => {
    const blocks = buildAcceptanceReport(girdi()).blocks;
    const paragraf = blocks.find((block) => block.kind === "paragraph");
    expect(paragraf?.kind === "paragraph" && paragraf.text).toContain("gizlenmemiş");
  });
});
