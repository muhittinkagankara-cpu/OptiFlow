/**
 * Tanılama ayrıştırıcısının testleri.
 *
 * Savunulan kural: ölçülemeyen bir ölçüt sıfıra çevrilmez. Sunucu `null`
 * gönderdiyse arayüz de "—" gösterir; eksik bir değeri sıfırla doldurmak,
 * ölçüm yapılmış izlenimi verirdi.
 */

import { describe, expect, it } from "vitest";
import {
  parseCleanup,
  parseContinuity,
  parseDiagnostics,
  parseLevel,
  parseLiveness,
  parseMetric,
  parseMetrics,
  parseStream,
} from "./parse";
import { EMPTY_DIAGNOSTICS } from "./types";

describe("seviye", () => {
  it("tanınan seviye geçer", () => {
    expect(parseLevel("critical")).toBe("critical");
  });

  it("tanınmayan seviye ölçülmedi olur", () => {
    // "Normal"e düşseydi, anlamadığımız bir uyarı sağlıklı görünürdü.
    expect(parseLevel("felaket")).toBe("unknown");
  });

  it("eksik seviye ölçülmedi olur", () => {
    expect(parseLevel(undefined)).toBe("unknown");
  });
});

describe("canlılık", () => {
  it("tanınan durum geçer", () => {
    expect(parseLiveness("stale")).toBe("stale");
  });

  it("tanınmayan durum bilinmiyor olur", () => {
    expect(parseLiveness("kopuk")).toBe("unknown");
  });
});

describe("ölçüt", () => {
  it("ölçülen değer okunur", () => {
    expect(parseMetric({ value: 12.5 }).value).toBe(12.5);
  });

  it("ölçülen sıfır korunur", () => {
    expect(parseMetric({ value: 0 }).value).toBe(0);
  });

  it("ölçülen sıfır ölçülmüş sayılır", () => {
    expect(parseMetric({ value: 0 }).measured).toBe(true);
  });

  it("eksik değer null kalır", () => {
    expect(parseMetric({}).value).toBeNull();
  });

  it("eksik değer ölçülmemiş sayılır", () => {
    expect(parseMetric({}).measured).toBe(false);
  });

  it("sunucunun nedeni korunur", () => {
    expect(parseMetric({ reason: "Kuyruk bilgisi yok" }).reason).toBe("Kuyruk bilgisi yok");
  });

  it("nedensiz ölçülmemiş ölçüte neden yazılır", () => {
    expect(parseMetric({}).reason).toBe("Sunucu bu ölçütü bildirmedi");
  });

  it("ölçülen ölçütte neden kalmaz", () => {
    expect(parseMetric({ value: 5 }).reason).toBeNull();
  });

  it("birim okunur", () => {
    expect(parseMetric({ value: 5, unit: "olay/sn" }).unit).toBe("olay/sn");
  });

  it("birimsiz ölçütte null", () => {
    expect(parseMetric({ value: 5 }).unit).toBeNull();
  });

  it("NaN ölçülmemiş sayılır", () => {
    expect(parseMetric({ value: Number.NaN }).measured).toBe(false);
  });

  it("dizi olmayan ölçüt listesi boş", () => {
    expect(parseMetrics("yok")).toEqual([]);
  });
});

describe("akış", () => {
  it("bağlantı kimliği okunur", () => {
    expect(parseStream({ connector_id: "plc-1" }).connectorId).toBe("plc-1");
  });

  it("veri gelmemişse yaş null", () => {
    expect(parseStream({ connector_id: "plc-1" }).ageMs).toBeNull();
  });

  it("yaş okunur", () => {
    expect(parseStream({ age_ms: 4000 }).ageMs).toBe(4000);
  });

  it("yeniden bağlanma sayısı sayaçtır", () => {
    // Sayaçlarda ölçülmüş sıfır anlamlıdır; eksik alan sıfır olur.
    expect(parseStream({}).reconnects).toBe(0);
  });

  it("kesinti başlangıcı yoksa null", () => {
    expect(parseStream({}).outageStartedMs).toBeNull();
  });

  it("durum etiketi türetilir", () => {
    expect(parseStream({ liveness: "idle" }).livenessLabel).toBe("Veri bekleniyor");
  });

  it("sunucunun etiketi korunur", () => {
    expect(parseStream({ liveness: "idle", liveness_label: "Bekliyor" }).livenessLabel).toBe(
      "Bekliyor",
    );
  });

  it("kesintisizlik yanıtı çözülür", () => {
    expect(parseContinuity({ streams: [{ connector_id: "a" }] })).toHaveLength(1);
  });

  it("boş kesintisizlik yanıtı boş liste", () => {
    expect(parseContinuity(null)).toEqual([]);
  });
});

describe("temizlik sayaçları", () => {
  it("tur sayısı okunur", () => {
    expect(parseCleanup({ runs: 3 }).runs).toBe(3);
  });

  it("hiç çalışmadıysa son tur null", () => {
    expect(parseCleanup({}).lastRunMs).toBeNull();
  });

  it("hata yoksa null", () => {
    expect(parseCleanup({}).lastError).toBeNull();
  });

  it("saklama süresi politikadan okunur", () => {
    expect(parseCleanup({ policy: { retention_days: 30 } }).retentionDays).toBe(30);
  });
});

describe("rapor", () => {
  const payload = {
    at_ms: 1000,
    level: "warning",
    metrics: [{ id: "a", value: 1 }, { id: "b" }],
    streams: [{ connector_id: "plc-1" }],
    measured_count: 1,
    metric_count: 2,
    cleanup: { runs: 1, policy: { retention_days: 30 } },
    telemetry_rows: 12,
    oldest_telemetry_ms: 500,
    persistence_mode: "database",
  };

  it("seviye okunur", () => {
    expect(parseDiagnostics(payload).level).toBe("warning");
  });

  it("ölçütler çözülür", () => {
    expect(parseDiagnostics(payload).metrics).toHaveLength(2);
  });

  it("ölçülen sayısı okunur", () => {
    expect(parseDiagnostics(payload).measuredCount).toBe(1);
  });

  it("sunucu saymadıysa ölçütlerden sayılır", () => {
    const { measured_count: _atılan, ...rest } = payload;
    expect(parseDiagnostics(rest).measuredCount).toBe(1);
  });

  it("satır sayısı okunur", () => {
    expect(parseDiagnostics(payload).telemetryRows).toBe(12);
  });

  it("boş tabloda en eski null", () => {
    expect(parseDiagnostics({ ...payload, oldest_telemetry_ms: null }).oldestTelemetryMs).toBeNull();
  });

  it("kalıcılık modu okunur", () => {
    expect(parseDiagnostics(payload).persistenceMode).toBe("database");
  });

  it("mod bildirilmezse bilinmiyor", () => {
    expect(parseDiagnostics({ at_ms: 1 }).persistenceMode).toBe("bilinmiyor");
  });

  it("boş gövde boş rapor", () => {
    expect(parseDiagnostics(null)).toBe(EMPTY_DIAGNOSTICS);
  });

  it("boş raporun seviyesi ölçülmedi", () => {
    expect(parseDiagnostics(null).level).toBe("unknown");
  });
});
