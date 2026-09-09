/**
 * Tanılama metinlerinin testleri.
 *
 * En önemli davranış: hiç veri gelmemiş bir akış "bayat" diye anlatılmaz.
 * İkisini aynı cümleyle söylemek, yeni kurulmuş bir bağlantıyı arızalı
 * gösterirdi.
 */

import { describe, expect, it } from "vitest";
import {
  NOT_MEASURED,
  formatAge,
  historySpanMs,
  levelLabel,
  metricNote,
  metricValue,
  persistenceWarning,
  reportCaption,
  streamCaption,
} from "./format";
import {
  EMPTY_DIAGNOSTICS,
  type DiagnosticMetric,
  type DiagnosticsReport,
  type StreamLiveness,
} from "./types";

function metric(overrides: Partial<DiagnosticMetric> = {}): DiagnosticMetric {
  return {
    id: "throughput",
    label: "Olay verimi",
    value: 12.5,
    unit: "olay/sn",
    level: "ok",
    reason: null,
    measured: true,
    ...overrides,
  };
}

function stream(overrides: Partial<StreamLiveness> = {}): StreamLiveness {
  return {
    connectorId: "plc-1",
    lastDataMs: 1000,
    ageMs: 5000,
    liveness: "live",
    livenessLabel: "Veri akıyor",
    reconnects: 0,
    attempt: 0,
    outageStartedMs: null,
    ...overrides,
  };
}

function report(overrides: Partial<DiagnosticsReport> = {}): DiagnosticsReport {
  return { ...EMPTY_DIAGNOSTICS, atMs: 10_000, metricCount: 8, measuredCount: 3, ...overrides };
}

describe("ölçüt değeri", () => {
  it("ölçülmemiş değer tire", () => {
    expect(metricValue(metric({ value: null }))).toBe(NOT_MEASURED);
  });

  it("birim değere eklenir", () => {
    expect(metricValue(metric())).toBe("12,5 olay/sn");
  });

  it("birimsiz ölçüt yalnızca sayı", () => {
    expect(metricValue(metric({ unit: null }))).toBe("12,5");
  });

  it("büyük sayı yuvarlanır", () => {
    expect(metricValue(metric({ value: 1234.56, unit: null }))).toBe("1.235");
  });

  it("ölçülmüş sıfır sıfır yazılır", () => {
    expect(metricValue(metric({ value: 0, unit: "olay" }))).toBe("0 olay");
  });

  it("ölçülen ölçütün açıklaması boş", () => {
    expect(metricNote(metric())).toBe("");
  });

  it("ölçülmeyen ölçütün nedeni yazılır", () => {
    expect(metricNote(metric({ value: null, reason: "Sayaç yok" }))).toBe("Sayaç yok");
  });
});

describe("seviye adı", () => {
  it("normal", () => {
    expect(levelLabel("ok")).toBe("Normal");
  });

  it("ölçülmedi", () => {
    expect(levelLabel("unknown")).toBe("Ölçülmedi");
  });
});

describe("yaş biçimi", () => {
  it("ölçülmemiş yaş tire", () => {
    expect(formatAge(null)).toBe(NOT_MEASURED);
  });

  it("saniye", () => {
    expect(formatAge(4000)).toBe("4 sn");
  });

  it("dakika", () => {
    expect(formatAge(180_000)).toBe("3 dk");
  });

  it("saat", () => {
    expect(formatAge(7_200_000)).toBe("2 sa");
  });

  it("sıfır saniye", () => {
    expect(formatAge(0)).toBe("0 sn");
  });
});

describe("akış cümlesi", () => {
  it("veri gelmemişse böyle söylenir", () => {
    expect(streamCaption(stream({ ageMs: null }))).toContain("henüz veri gelmedi");
  });

  it("veri gelmemişse bayat denmez", () => {
    expect(streamCaption(stream({ ageMs: null }))).not.toContain("önce");
  });

  it("yaş yazılır", () => {
    expect(streamCaption(stream())).toContain("son veri 5 sn önce");
  });

  it("kopma yoksa yazılmaz", () => {
    expect(streamCaption(stream())).not.toContain("yeniden bağlandı");
  });

  it("kopma varsa yazılır", () => {
    expect(streamCaption(stream({ reconnects: 2 }))).toContain("2 kez yeniden bağlandı");
  });
});

describe("rapor cümlesi", () => {
  it("veri yoksa böyle söylenir", () => {
    expect(reportCaption(EMPTY_DIAGNOSTICS)).toBe("Tanılama verisi henüz yüklenmedi");
  });

  it("kaç ölçütün ölçüldüğü yazılır", () => {
    // Sekiz ölçütten ikisinin ölçüldüğü bir ekranda "her şey normal" demek
    // yanıltıcı olurdu.
    expect(reportCaption(report())).toBe("8 ölçütten 3 tanesi ölçüldü");
  });
});

describe("kalıcılık uyarısı", () => {
  it("veritabanı modunda uyarı yok", () => {
    expect(persistenceWarning("database")).toBeNull();
  });

  it("bellek modunda kayıp uyarısı", () => {
    expect(persistenceWarning("memory")).toContain("kaybolur");
  });

  it("bilinmeyen modda doğrulanamadı denir", () => {
    expect(persistenceWarning("bilinmiyor")).toContain("doğrulanamadı");
  });
});

describe("geçmiş süresi", () => {
  it("tablo boşsa null", () => {
    // "0 gün geçmiş var" demek, boş tabloyu dolu tabloyla aynı gösterirdi.
    expect(historySpanMs(report())).toBeNull();
  });

  it("süre hesaplanır", () => {
    expect(historySpanMs(report({ oldestTelemetryMs: 4_000 }))).toBe(6_000);
  });

  it("an bilinmiyorsa null", () => {
    expect(historySpanMs(report({ atMs: 0, oldestTelemetryMs: 4_000 }))).toBeNull();
  });
});
