import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_LATENCY_WINDOW,
  UNVERIFIED,
  buildDiagnostics,
  diagnosticRows,
  emptyDiagnostics,
  formatDuration,
  relative,
  successRate,
  uptimeMs,
} from "./diagnostics";
import { notAttempted, type RuntimeProbe } from "./types";

const NOW = 1_700_000_000_000;

function ok(atMs: number, latencyMs = 40): RuntimeProbe {
  return {
    attempted: true,
    ok: true,
    status: "connected",
    httpStatus: 200,
    latencyMs,
    sizeBytes: 120,
    detail: "HTTP 200 — uç nokta yanıt verdi.",
    payload: { queue: 3 },
    atMs,
  };
}

function fail(atMs: number, detail = "HTTP 500 — sunucu hatası."): RuntimeProbe {
  return {
    attempted: true,
    ok: false,
    status: "failed",
    httpStatus: 500,
    latencyMs: 80,
    sizeBytes: null,
    detail,
    payload: null,
    atMs,
  };
}

describe("emptyDiagnostics", () => {
  const diagnostics = emptyDiagnostics();

  it("hicbir sayaci baslatmaz", () => {
    expect(diagnostics.attempts).toBe(0);
    expect(diagnostics.successes).toBe(0);
    expect(diagnostics.failures).toBe(0);
  });

  it("olculmemis alanlari null birakir", () => {
    // "0 hata" ile "hic denenmedi" ayni ekranda ayni gorunmemeli.
    expect(diagnostics.lastLatencyMs).toBeNull();
    expect(diagnostics.averageLatencyMs).toBeNull();
    expect(diagnostics.lastSuccessAtMs).toBeNull();
    expect(diagnostics.connectedSinceMs).toBeNull();
    expect(diagnostics.lastError).toBeNull();
  });
});

describe("buildDiagnostics", () => {
  it("basarili denemeyi sayar", () => {
    const diagnostics = buildDiagnostics([ok(NOW)]);
    expect(diagnostics.attempts).toBe(1);
    expect(diagnostics.successes).toBe(1);
    expect(diagnostics.failures).toBe(0);
    expect(diagnostics.lastSuccessAtMs).toBe(NOW);
  });

  it("basarisiz denemeyi sayar ve nedenini tutar", () => {
    const diagnostics = buildDiagnostics([fail(NOW)]);
    expect(diagnostics.failures).toBe(1);
    expect(diagnostics.lastError).toContain("sunucu hatası");
  });

  it("denenmemis sonuclari saymaz", () => {
    // OPC UA iskeleti "surekli hata veriyor" gibi gorunmemeli.
    const diagnostics = buildDiagnostics([
      notAttempted("İstemci yok.", NOW),
      notAttempted("İstemci yok.", NOW + 1),
    ]);
    expect(diagnostics.attempts).toBe(0);
    expect(diagnostics.failures).toBe(0);
    expect(diagnostics.lastError).toBeNull();
  });

  it("gecikme ortalamasini yalnizca basarililardan alir", () => {
    const diagnostics = buildDiagnostics([ok(NOW, 40), ok(NOW + 1, 60), fail(NOW + 2)]);
    expect(diagnostics.averageLatencyMs).toBe(50);
  });

  it("son gecikmeyi tutar", () => {
    expect(buildDiagnostics([ok(NOW, 40), ok(NOW + 1, 90)]).lastLatencyMs).toBe(90);
  });

  it("art arda basarisizligi sayar", () => {
    const diagnostics = buildDiagnostics([fail(NOW), fail(NOW + 1), fail(NOW + 2)]);
    expect(diagnostics.consecutiveFailures).toBe(3);
  });

  it("basarili deneme art arda sayaci sifirlar", () => {
    const diagnostics = buildDiagnostics([fail(NOW), fail(NOW + 1), ok(NOW + 2)]);
    expect(diagnostics.consecutiveFailures).toBe(0);
    expect(diagnostics.lastError).toBeNull();
  });

  it("zaman asimini ayri sayar", () => {
    const diagnostics = buildDiagnostics([
      fail(NOW, "Zaman aşımı — uç nokta verilen sürede yanıt vermedi."),
      fail(NOW + 1, "HTTP 500 — sunucu hatası."),
    ]);
    expect(diagnostics.timeouts).toBe(1);
    expect(diagnostics.failures).toBe(2);
  });

  it("baglanti suresi ilk basaridan baslar", () => {
    const diagnostics = buildDiagnostics([ok(NOW), ok(NOW + 5_000)]);
    expect(diagnostics.connectedSinceMs).toBe(NOW);
  });

  it("kopma baglanti suresini sifirlar", () => {
    // "Iki saattir bagli" cumlesi, arada kopma olduysa dogru degildir.
    const diagnostics = buildDiagnostics([ok(NOW), fail(NOW + 1_000)]);
    expect(diagnostics.connectedSinceMs).toBeNull();
  });

  it("kopmadan sonra yeniden baglanma sureyi bastan baslatir", () => {
    const diagnostics = buildDiagnostics([
      ok(NOW),
      fail(NOW + 1_000),
      ok(NOW + 2_000),
    ]);
    expect(diagnostics.connectedSinceMs).toBe(NOW + 2_000);
  });

  it("son deneme anini tutar", () => {
    expect(buildDiagnostics([ok(NOW), fail(NOW + 9)]).lastAttemptAtMs).toBe(NOW + 9);
  });

  it("gecikme penceresini asmaz", () => {
    const probes = Array.from({ length: DIAGNOSTIC_LATENCY_WINDOW + 10 }, (_, index) =>
      ok(NOW + index, 100),
    );
    // Pencere disindaki ornekler ortalamayi bozmamali.
    expect(buildDiagnostics(probes).averageLatencyMs).toBe(100);
  });

  it("bos listede bos tanilama doner", () => {
    expect(buildDiagnostics([])).toEqual(emptyDiagnostics());
  });
});

describe("successRate / uptimeMs", () => {
  it("basari oranini hesaplar", () => {
    expect(successRate(buildDiagnostics([ok(NOW), fail(NOW + 1)]))).toBe(0.5);
  });

  it("hic deneme yoksa oran bostur", () => {
    expect(successRate(emptyDiagnostics())).toBeNull();
  });

  it("baglanti suresini hesaplar", () => {
    const diagnostics = buildDiagnostics([ok(NOW)]);
    expect(uptimeMs(diagnostics, NOW + 60_000)).toBe(60_000);
  });

  it("bagli degilken sure bostur", () => {
    expect(uptimeMs(emptyDiagnostics(), NOW)).toBeNull();
  });

  it("negatif sure sifira cekilir", () => {
    expect(uptimeMs(buildDiagnostics([ok(NOW)]), NOW - 5_000)).toBe(0);
  });
});

describe("diagnosticRows", () => {
  it("hic deneme yokken her satir 'Dogrulanmadi' der", () => {
    const rows = diagnosticRows(emptyDiagnostics(), NOW);
    expect(rows.every((row) => row.value === null)).toBe(true);
    expect(rows.every((row) => row.fallback === UNVERIFIED)).toBe(true);
  });

  it("yedi satir uretir", () => {
    expect(diagnosticRows(emptyDiagnostics(), NOW)).toHaveLength(7);
  });

  it("olculen degerleri yazar", () => {
    const rows = diagnosticRows(buildDiagnostics([ok(NOW, 42)]), NOW + 1_000);
    const ping = rows.find((row) => row.label.includes("Ping"));
    expect(ping?.value).toBe("42 ms");
  });

  it("hata sayisini toplamla birlikte yazar", () => {
    const rows = diagnosticRows(buildDiagnostics([ok(NOW), fail(NOW + 1)]), NOW + 2);
    expect(rows.find((row) => row.label === "Hata sayısı")?.value).toBe("1 / 2");
  });

  it("son basarili istegi goreli yazar", () => {
    const rows = diagnosticRows(buildDiagnostics([ok(NOW)]), NOW + 60_000);
    expect(rows.find((row) => row.label.includes("Son başarılı"))?.value).toBe(
      "1 dk önce",
    );
  });

  it("baglanti suresini yazar", () => {
    const rows = diagnosticRows(buildDiagnostics([ok(NOW)]), NOW + 120_000);
    expect(rows.find((row) => row.label === "Bağlantı süresi")?.value).toBe("2 dk");
  });

  it("kopmus baglantida sure 'Dogrulanmadi' olur", () => {
    const rows = diagnosticRows(
      buildDiagnostics([ok(NOW), fail(NOW + 1_000)]),
      NOW + 2_000,
    );
    expect(rows.find((row) => row.label === "Bağlantı süresi")?.value).toBeNull();
  });
});

describe("relative / formatDuration", () => {
  it("yakin zamani 'az once' yazar", () => {
    expect(relative(NOW, NOW + 1_000)).toBe("az önce");
  });

  it("gelecek zamani da 'az once' sayar", () => {
    expect(relative(NOW + 5_000, NOW)).toBe("az önce");
  });

  it("saniye, dakika ve saat yazar", () => {
    expect(relative(NOW, NOW + 30_000)).toBe("30 sn önce");
    expect(relative(NOW, NOW + 300_000)).toBe("5 dk önce");
    expect(relative(NOW, NOW + 7_200_000)).toBe("2 sa önce");
  });

  it("sureyi okunur yazar", () => {
    expect(formatDuration(45_000)).toBe("45 sn");
    expect(formatDuration(300_000)).toBe("5 dk");
    expect(formatDuration(3_900_000)).toBe("1 sa 5 dk");
  });
});
