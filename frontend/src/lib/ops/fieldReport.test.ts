/**
 * Saha devreye alma raporunun testleri.
 *
 * Savunulan iki kural:
 *
 * 1. Ölçülmeyen alan uydurulmaz — gecikme ölçülmediyse "—" yazar, sıfır değil.
 *    "Gecikme 0 ms" satırı, ölçülmüş ve mükemmel bir bağlantı anlamına gelir.
 * 2. Doğrulanmayan cihaz gizlenmez — rapordan çıkarılsaydı, saha eksiksiz
 *    görünür ve bir cihazın hiç denenmediği fark edilmezdi.
 */

import { describe, expect, it } from "vitest";
import {
  NOT_MEASURED,
  alarmVerdict,
  buildFieldReport,
  deviceRows,
  deviceVerdict,
  formatLatency,
  formatNumber,
  formatPercent,
  formatSpan,
  oeeVerdict,
  persistenceNote,
  summaryItems,
  toFieldDevice,
  unmappedDevices,
  verifiedCount,
  type FieldDevice,
  type FieldReportInput,
} from "./fieldReport";

function device(overrides: Partial<FieldDevice> = {}): FieldDevice {
  return {
    connectionId: "plc-1",
    label: "Hat 1 PLC",
    protocol: "opcua",
    endpoint: "opc.tcp://10.0.0.5:4840",
    verified: true,
    latencyMs: 12.4,
    packets: 120,
    errors: 0,
    mappedMetrics: 3,
    dataAgeMs: 4_000,
    ...overrides,
  };
}

function input(overrides: Partial<FieldReportInput> = {}): FieldReportInput {
  return {
    factoryName: "Pilot Fabrika",
    orgName: "OptiFlow",
    generatedAtLabel: "9 Eylül 2026, 11:00",
    devices: [device()],
    alarms: { raised: 2, active: 1, exercised: true },
    oee: { oee: 0.72, availability: 0.9, performance: 0.85, quality: 0.94, reason: null },
    telemetryRows: 1200,
    historySpanMs: 7_200_000,
    persistenceMode: "database",
    ...overrides,
  };
}

describe("sayı biçimi", () => {
  it("ölçülmemiş sayı tire", () => {
    expect(formatNumber(null)).toBe(NOT_MEASURED);
  });

  it("ölçülmüş sıfır sıfır yazılır", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("binlik ayracı kullanılır", () => {
    expect(formatNumber(1200)).toBe("1.200");
  });

  it("ölçülmemiş gecikme tire", () => {
    // "Gecikme 0 ms" satırı, ölçülmüş ve mükemmel bir bağlantı anlamına gelirdi.
    expect(formatLatency(null)).toBe(NOT_MEASURED);
  });

  it("gecikme yuvarlanır", () => {
    expect(formatLatency(12.4)).toBe("12 ms");
  });

  it("hesaplanmamış oran tire", () => {
    expect(formatPercent(null)).toBe(NOT_MEASURED);
  });

  it("oran yüzdeye çevrilir", () => {
    expect(formatPercent(0.72)).toBe("%72");
  });
});

describe("süre biçimi", () => {
  it("ölçülmemiş süre tire", () => {
    expect(formatSpan(null)).toBe(NOT_MEASURED);
  });

  it("saniye", () => {
    expect(formatSpan(4_000)).toBe("4 sn");
  });

  it("dakika", () => {
    expect(formatSpan(180_000)).toBe("3 dk");
  });

  it("saat", () => {
    expect(formatSpan(7_200_000)).toBe("2 sa");
  });

  it("gün", () => {
    expect(formatSpan(3 * 86_400_000)).toBe("3 gün");
  });
});

describe("cihaz durumu", () => {
  it("doğrulanan cihaz", () => {
    expect(deviceVerdict(device())).toBe("Gerçek doğrulandı");
  });

  it("denenip yanıt alınamayan cihaz", () => {
    expect(deviceVerdict(device({ verified: false, latencyMs: 300 }))).toBe(
      "Denendi, yanıt yok",
    );
  });

  it("hiç denenmemiş cihaz", () => {
    // "Bozuk" ile "hiç bakılmadı" farkını kaybetmek, sahada saatler kaybettirir.
    const bare = device({ verified: false, latencyMs: null, errors: null });
    expect(deviceVerdict(bare)).toBe("Doğrulanmadı");
  });

  it("hata sayacı varsa denendi sayılır", () => {
    const tried = device({ verified: false, latencyMs: null, errors: 2 });
    expect(deviceVerdict(tried)).toBe("Denendi, yanıt yok");
  });

  it("doğrulanan cihaz sayılır", () => {
    expect(verifiedCount([device(), device({ verified: false })])).toBe(1);
  });

  it("eşlemesiz cihaz bulunur", () => {
    expect(unmappedDevices([device({ mappedMetrics: 0 })])).toHaveLength(1);
  });

  it("eşlemeli cihaz listelenmez", () => {
    expect(unmappedDevices([device()])).toEqual([]);
  });
});

describe("cihaz tablosu", () => {
  it("satır dokuz sütun", () => {
    expect(deviceRows([device()])[0]).toHaveLength(9);
  });

  it("protokol büyük harf", () => {
    expect(deviceRows([device()])[0][1]).toBe("OPCUA");
  });

  it("uç adresi yazılır", () => {
    expect(deviceRows([device()])[0][2]).toBe("opc.tcp://10.0.0.5:4840");
  });

  it("doğrulanmayan cihaz satırda kalır", () => {
    const rows = deviceRows([device({ verified: false, latencyMs: null, errors: null })]);
    expect(rows[0][3]).toBe("Doğrulanmadı");
  });

  it("ölçülmeyen gecikme tire yazılır", () => {
    expect(deviceRows([device({ latencyMs: null })])[0][4]).toBe(NOT_MEASURED);
  });

  it("ölçülmeyen paket tire yazılır", () => {
    expect(deviceRows([device({ packets: null })])[0][5]).toBe(NOT_MEASURED);
  });

  it("ölçülmüş sıfır hata sıfır yazılır", () => {
    expect(deviceRows([device({ errors: 0 })])[0][6]).toBe("0");
  });
});

describe("alarm ve OEE", () => {
  it("tetiklenmemiş alarm zinciri uyarır", () => {
    const verdict = alarmVerdict({ raised: 0, active: 0, exercised: false });
    expect(verdict).toContain("doğrulanmadı");
  });

  it("tetiklenmiş zincir sayı verir", () => {
    expect(alarmVerdict({ raised: 3, active: 1, exercised: true })).toContain("3 alarm");
  });

  it("hesaplanamayan OEE nedeni yazar", () => {
    const verdict = oeeVerdict({
      oee: null,
      availability: null,
      performance: null,
      quality: null,
      reason: "Planlanan süre verilmedi",
    });
    expect(verdict).toBe("Planlanan süre verilmedi");
  });

  it("nedensiz hesaplanamayan OEE için varsayılan cümle", () => {
    const verdict = oeeVerdict({
      oee: null,
      availability: null,
      performance: null,
      quality: null,
      reason: null,
    });
    expect(verdict).toContain("hesaplanamadı");
  });

  it("hesaplanan OEE yüzde verir", () => {
    const verdict = oeeVerdict({
      oee: 0.72,
      availability: null,
      performance: null,
      quality: null,
      reason: null,
    });
    expect(verdict).toContain("%72");
  });
});

describe("kalıcılık notu", () => {
  it("veritabanı modunda not yok", () => {
    expect(persistenceNote("database")).toBeNull();
  });

  it("bellek modunda kayıp uyarısı", () => {
    expect(persistenceNote("memory")).toContain("kaybolur");
  });

  it("bilinmeyen modda doğrulanamadı denir", () => {
    expect(persistenceNote("bilinmiyor")).toContain("doğrulanamadı");
  });
});

describe("özet", () => {
  it("dört KPI", () => {
    expect(summaryItems(input())).toHaveLength(4);
  });

  it("tümü doğrulandıysa iyi", () => {
    expect(summaryItems(input())[0].tone).toBe("good");
  });

  it("eksik doğrulama uyarı", () => {
    const items = summaryItems(input({ devices: [device(), device({ verified: false })] }));
    expect(items[0].tone).toBe("warning");
  });

  it("cihaz yoksa uyarı", () => {
    expect(summaryItems(input({ devices: [] }))[0].tone).toBe("warning");
  });

  it("hesaplanmayan OEE tire", () => {
    const items = summaryItems(
      input({
        oee: { oee: null, availability: null, performance: null, quality: null, reason: "x" },
      }),
    );
    expect(items[3].value).toBe(NOT_MEASURED);
  });

  it("tetiklenmemiş alarm tire", () => {
    const items = summaryItems(input({ alarms: { raised: 0, active: 0, exercised: false } }));
    expect(items[2].value).toBe(NOT_MEASURED);
  });
});

describe("rapor belgesi", () => {
  it("dosya adı fabrikayı taşır", () => {
    expect(buildFieldReport(input()).fileName).toContain("Pilot Fabrika");
  });

  it("kapak başlığı", () => {
    expect(buildFieldReport(input()).cover.title).toBe("Saha Devreye Alma Raporu");
  });

  it("kapakta doğrulama oranı", () => {
    const facts = buildFieldReport(input()).cover.facts;
    expect(facts[1].value).toBe("1/1");
  });

  it("cihaz tablosu var", () => {
    const blocks = buildFieldReport(input()).blocks;
    expect(blocks.some((block) => block.kind === "table")).toBe(true);
  });

  it("cihaz yoksa uyarı bloğu eklenir", () => {
    const blocks = buildFieldReport(input({ devices: [] })).blocks;
    const notes = blocks.filter((block) => block.kind === "note");
    expect(notes.length).toBeGreaterThan(0);
  });

  it("eşlemesiz cihaz uyarısı eklenir", () => {
    const blocks = buildFieldReport(input({ devices: [device({ mappedMetrics: 0 })] })).blocks;
    const text = blocks
      .filter((block) => block.kind === "note")
      .map((block) => (block.kind === "note" ? block.text : ""))
      .join(" ");
    expect(text).toContain("eşlemesi yok");
  });

  it("veritabanı modunda kalıcılık uyarısı yok", () => {
    const blocks = buildFieldReport(input()).blocks;
    const text = blocks
      .filter((block) => block.kind === "note")
      .map((block) => (block.kind === "note" ? block.text : ""))
      .join(" ");
    expect(text).not.toContain("kaybolur");
  });

  it("bellek modunda kalıcılık uyarısı var", () => {
    const blocks = buildFieldReport(input({ persistenceMode: "memory" })).blocks;
    const text = blocks
      .filter((block) => block.kind === "note")
      .map((block) => (block.kind === "note" ? block.text : ""))
      .join(" ");
    expect(text).toContain("kaybolur");
  });

  it("imza alanı var", () => {
    const blocks = buildFieldReport(input()).blocks;
    expect(blocks.some((block) => block.kind === "signature")).toBe(true);
  });

  it("ölçüm uyarısı kapakta değil metinde", () => {
    const blocks = buildFieldReport(input()).blocks;
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.kind === "paragraph" && paragraph.text).toContain("—");
  });
});

describe("köprü bağlantısından cihaz satırı", () => {
  const baglanti = {
    connectionId: "plc-1",
    label: "Hat 1 PLC",
    kind: "opcua",
    endpoint: "opc.tcp://10.0.0.5:4840",
    everVerified: true,
    health: {
      avgLatencyMs: 12.4,
      packets: 120,
      errors: 0,
      lastPacketAtMs: 1_000,
    },
  };

  it("kimlik ve uç taşınır", () => {
    const cihaz = toFieldDevice(baglanti, 2, 5_000);
    expect([cihaz.connectionId, cihaz.endpoint]).toEqual([
      "plc-1",
      "opc.tcp://10.0.0.5:4840",
    ]);
  });

  it("veri yaşı sunucu anına göre hesaplanır", () => {
    expect(toFieldDevice(baglanti, 2, 5_000).dataAgeMs).toBe(4_000);
  });

  it("hiç paket gelmediyse yaş null", () => {
    const sessiz = { ...baglanti, health: { ...baglanti.health, lastPacketAtMs: null } };
    expect(toFieldDevice(sessiz, 2, 5_000).dataAgeMs).toBeNull();
  });

  it("sunucu saati okunmadıysa yaş null", () => {
    // Uydurulmuş bir yaş yazmaktansa "ölçülmedi" demek doğrudur.
    expect(toFieldDevice(baglanti, 2, 0).dataAgeMs).toBeNull();
  });

  it("ölçülmüş sıfır hata korunur", () => {
    expect(toFieldDevice(baglanti, 2, 5_000).errors).toBe(0);
  });

  it("ölçülmeyen gecikme null kalır", () => {
    const olcumsuz = { ...baglanti, health: { ...baglanti.health, avgLatencyMs: null } };
    expect(toFieldDevice(olcumsuz, 2, 5_000).latencyMs).toBeNull();
  });

  it("eşleme sayısı taşınır", () => {
    expect(toFieldDevice(baglanti, 3, 5_000).mappedMetrics).toBe(3);
  });

  it("gelecekteki paket negatif yaş üretmez", () => {
    expect(toFieldDevice(baglanti, 2, 500).dataAgeMs).toBe(0);
  });
});
