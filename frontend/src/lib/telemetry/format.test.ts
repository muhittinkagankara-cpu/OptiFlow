/**
 * Trend metinlerinin testleri.
 *
 * Savunulan kural: ölçülmemiş her değer "—" ile gösterilir. Sıfır
 * gösterilseydi, hiç ölçüm almamış bir etiket "ortalama 0" diye okunurdu.
 */

import { describe, expect, it } from "vitest";
import {
  NOT_MEASURED,
  axisLabel,
  formatClock,
  formatDay,
  formatPercent,
  formatValue,
  originLabel,
  seriesCaption,
  windowLabel,
} from "./format";
import { emptySeries, type TrendBucket, type TrendSeries } from "./types";

function bucket(count = 1): TrendBucket {
  return { startMs: 0, endMs: 1000, count, average: 10, min: 10, max: 10, last: 10 };
}

function series(overrides: Partial<TrendSeries> = {}): TrendSeries {
  return {
    ...emptySeries("TORNA_01", "production_count", "1h"),
    buckets: [bucket(), bucket()],
    totalPoints: 12,
    hasData: true,
    summary: {
      average: 10,
      min: 5,
      max: 15,
      filledBuckets: 2,
      coverage: 1,
      reason: null,
    },
    ...overrides,
  };
}

describe("değer biçimi", () => {
  it("ölçülmemiş değer tire", () => {
    expect(formatValue(null)).toBe(NOT_MEASURED);
  });

  it("ölçülmüş sıfır sıfır yazılır", () => {
    expect(formatValue(0)).toBe("0");
  });

  it("ondalık kısaltılır", () => {
    expect(formatValue(12.345)).toBe("12,3");
  });

  it("basamak sayısı ayarlanır", () => {
    expect(formatValue(12.345, 2)).toBe("12,35");
  });
});

describe("yüzde biçimi", () => {
  it("ölçülmemiş oran tire", () => {
    expect(formatPercent(null)).toBe(NOT_MEASURED);
  });

  it("oran yüzdeye çevrilir", () => {
    expect(formatPercent(0.25)).toBe("%25");
  });

  it("sıfır oran yüzde sıfır", () => {
    expect(formatPercent(0)).toBe("%0");
  });
});

describe("zaman biçimi", () => {
  it("geçersiz an tire", () => {
    expect(formatClock(0)).toBe(NOT_MEASURED);
  });

  it("negatif an tire", () => {
    expect(formatDay(-5)).toBe(NOT_MEASURED);
  });

  it("saat biçimi iki nokta içerir", () => {
    expect(formatClock(Date.UTC(2026, 0, 1, 10, 30))).toContain(":");
  });

  it("gün biçimi gün ve ayı içerir", () => {
    // Ayırıcı çalışma ortamının yerel ayarına göre değişir (nokta ya da eğik
    // çizgi); sınanan şey ayırıcı değil, gün ve ayın yazılmasıdır.
    const text = formatDay(Date.UTC(2026, 0, 15));
    expect(text).toMatch(/15\D+01/);
  });

  it("saatlik pencerede eksen saat gösterir", () => {
    expect(axisLabel(Date.UTC(2026, 0, 1, 10, 30), "1h")).toContain(":");
  });

  it("haftalık pencerede eksen saat göstermez", () => {
    // Haftalık grafikte saat yazsaydı, aynı saat yedi kez tekrarlanır ve
    // hangi günün olduğu anlaşılmazdı.
    expect(axisLabel(Date.UTC(2026, 0, 15), "7d")).not.toContain(":");
  });

  it("günlük pencerede eksen günü gösterir", () => {
    expect(axisLabel(Date.UTC(2026, 0, 15), "24h")).toBe(
      formatDay(Date.UTC(2026, 0, 15)),
    );
  });
});

describe("pencere adı", () => {
  it("saatlik", () => {
    expect(windowLabel("1h")).toBe("Son 1 saat");
  });

  it("günlük", () => {
    expect(windowLabel("24h")).toBe("Son 24 saat");
  });

  it("haftalık", () => {
    expect(windowLabel("7d")).toBe("Son 7 gün");
  });
});

describe("seri açıklaması", () => {
  it("veri yoksa neden yazılır", () => {
    expect(seriesCaption(emptySeries("A", "uretim", "1h"))).toBe("Veri henüz yüklenmedi");
  });

  it("neden yoksa varsayılan cümle", () => {
    const boş = {
      ...emptySeries("A", "uretim", "1h"),
      summary: { ...emptySeries("A", "uretim", "1h").summary, reason: null },
    };
    expect(seriesCaption(boş)).toBe("Bu aralıkta kayıtlı ölçüm yok");
  });

  it("ölçüm sayısı yazılır", () => {
    expect(seriesCaption(series())).toContain("12 ölçüm");
  });

  it("dolu aralık sayısı yazılır", () => {
    expect(seriesCaption(series())).toContain("2/2 aralık dolu");
  });

  it("dışarıda kalan ölçüm söylenir", () => {
    // Sessizce atılan bir ölçüm, eksik grafiğin nedenini gizlerdi.
    expect(seriesCaption(series({ excluded: 4 }))).toContain("4 ölçüm bozuk kalite");
  });

  it("dışarıda kalan yoksa yazılmaz", () => {
    expect(seriesCaption(series())).not.toContain("bozuk kalite");
  });
});

describe("kaynak rozeti", () => {
  it("telemetri kaynağı adlandırılır", () => {
    expect(originLabel("telemetry")).toBe("Kayıtlı telemetri");
  });

  it("bilinmeyen kaynak olduğu gibi yazılır", () => {
    expect(originLabel("bilinmiyor")).toBe("Kaynak: bilinmiyor");
  });
});
