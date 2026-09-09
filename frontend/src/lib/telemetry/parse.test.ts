/**
 * Trend ayrıştırıcısının testleri.
 *
 * Savunulan kural: boş bir kovanın ortalaması `null` kalır. Sıfıra
 * çevrilseydi, cihazın kapalı olduğu saatler grafikte "üretim sıfıra düştü"
 * gibi görünür ve gerçek bir duruşla veri boşluğu ayırt edilemezdi.
 */

import { describe, expect, it } from "vitest";
import {
  parseBucket,
  parseBuckets,
  parseSeries,
  parseSummary,
  parseTags,
  parseWindowId,
} from "./parse";

describe("pencere kimliği", () => {
  it("tanınan pencereyi geçirir", () => {
    expect(parseWindowId("24h")).toBe("24h");
  });

  it("tanınmayan pencere null olur", () => {
    // Varsayılana düşseydi, yedi günlük veri isteyen kullanıcı bir saatlik
    // grafiğe bakardı.
    expect(parseWindowId("30d")).toBeNull();
  });

  it("eksik pencere null olur", () => {
    expect(parseWindowId(undefined)).toBeNull();
  });

  it("sayı pencere olmaz", () => {
    expect(parseWindowId(24)).toBeNull();
  });
});

describe("kova", () => {
  it("dolu kovanın ortalaması okunur", () => {
    expect(parseBucket({ average: 12.5 }).average).toBe(12.5);
  });

  it("ölçülmemiş ortalama null kalır", () => {
    expect(parseBucket({ count: 0 }).average).toBeNull();
  });

  it("ölçülmüş sıfır korunur", () => {
    expect(parseBucket({ average: 0, count: 3 }).average).toBe(0);
  });

  it("NaN ölçülmemiş sayılır", () => {
    expect(parseBucket({ average: Number.NaN }).average).toBeNull();
  });

  it("sonsuz ölçülmemiş sayılır", () => {
    expect(parseBucket({ average: Number.POSITIVE_INFINITY }).average).toBeNull();
  });

  it("sayım eksikse sıfır olur", () => {
    expect(parseBucket({}).count).toBe(0);
  });

  it("başlangıç ve bitiş okunur", () => {
    const bucket = parseBucket({ start_ms: 100, end_ms: 200 });
    expect([bucket.startMs, bucket.endMs]).toEqual([100, 200]);
  });

  it("son değer okunur", () => {
    expect(parseBucket({ last: 9 }).last).toBe(9);
  });

  it("en düşük ve en yüksek okunur", () => {
    const bucket = parseBucket({ min: 1, max: 7 });
    expect([bucket.min, bucket.max]).toEqual([1, 7]);
  });

  it("dizi olmayan kova listesi boş olur", () => {
    expect(parseBuckets("kova")).toEqual([]);
  });

  it("kova listesi çevrilir", () => {
    expect(parseBuckets([{ count: 1 }, { count: 2 }])).toHaveLength(2);
  });
});

describe("özet", () => {
  it("ortalama okunur", () => {
    expect(parseSummary({ average: 30, filled_buckets: 2 }).average).toBe(30);
  });

  it("veri yoksa ortalama null", () => {
    expect(parseSummary({}).average).toBeNull();
  });

  it("veri yoksa neden yazılır", () => {
    expect(parseSummary({}).reason).toBe("Bu aralıkta kayıtlı ölçüm yok");
  });

  it("sunucunun nedeni korunur", () => {
    expect(parseSummary({ reason: "Cihaz kapalıydı" }).reason).toBe("Cihaz kapalıydı");
  });

  it("dolu özet için neden yazılmaz", () => {
    expect(parseSummary({ filled_buckets: 3, average: 5 }).reason).toBeNull();
  });

  it("kapsama oranı okunur", () => {
    expect(parseSummary({ coverage: 0.25, filled_buckets: 1 }).coverage).toBe(0.25);
  });

  it("kapsama ölçülmemişse null", () => {
    expect(parseSummary({}).coverage).toBeNull();
  });
});

describe("seri", () => {
  const payload = {
    device: "TORNA_01",
    tag: "production_count",
    window: "24h",
    label: "Son 24 saat",
    buckets: [{ count: 1, average: 5 }],
    total_points: 1,
    has_data: true,
    summary: { average: 5, filled_buckets: 1 },
    excluded: 0,
    start_ms: 1000,
    end_ms: 2000,
    origin: "telemetry",
  };

  it("cihaz okunur", () => {
    expect(parseSeries(payload).device).toBe("TORNA_01");
  });

  it("etiket okunur", () => {
    expect(parseSeries(payload).tag).toBe("production_count");
  });

  it("pencere okunur", () => {
    expect(parseSeries(payload).window).toBe("24h");
  });

  it("tanınmayan pencerede saatlik varsayılana düşer", () => {
    // Ayrıştırıcı çökmez; ekranda hangi pencerenin gösterildiği etiketten
    // okunur.
    expect(parseSeries({ ...payload, window: "30d" }).window).toBe("1h");
  });

  it("kaynak olduğu gibi taşınır", () => {
    expect(parseSeries(payload).origin).toBe("telemetry");
  });

  it("bilinmeyen kaynak telemetri sayılmaz", () => {
    expect(parseSeries({ ...payload, origin: undefined }).origin).toBe("bilinmiyor");
  });

  it("veri yoksa hasData false", () => {
    expect(parseSeries({ ...payload, has_data: false }).hasData).toBe(false);
  });

  it("dışarıda kalan ölçüm sayılır", () => {
    expect(parseSeries({ ...payload, excluded: 3 }).excluded).toBe(3);
  });

  it("boş gövde çökmez", () => {
    expect(parseSeries(null).device).toBe("bilinmiyor");
  });

  it("boş gövdede kova yok", () => {
    expect(parseSeries(null).buckets).toEqual([]);
  });
});

describe("etiket listesi", () => {
  it("çiftler okunur", () => {
    const tags = parseTags({ tags: [{ device: "A", tag: "uretim" }] });
    expect(tags).toEqual([{ device: "A", tag: "uretim" }]);
  });

  it("eksik alanlı çift atılır", () => {
    expect(parseTags({ tags: [{ device: "A" }] })).toEqual([]);
  });

  it("dizi olmayan gövde boş liste", () => {
    expect(parseTags({ tags: "yok" })).toEqual([]);
  });

  it("boş gövde boş liste", () => {
    expect(parseTags(null)).toEqual([]);
  });
});
