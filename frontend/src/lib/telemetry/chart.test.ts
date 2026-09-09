/**
 * Grafik geometrisinin testleri.
 *
 * En önemli davranış: boş kova için nokta üretilmez ve çizgi orada kesilir.
 * İki dolu kovayı düz bir çizgiyle birleştirmek, olmayan bir ölçümü varmış
 * gibi göstermek olurdu.
 */

import { describe, expect, it } from "vitest";
import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  gapRatio,
  pathOf,
  pointsOf,
  scaleOf,
  segmentsOf,
  seriesPaths,
} from "./chart";
import { emptySeries, type TrendBucket } from "./types";

function bucket(overrides: Partial<TrendBucket> = {}): TrendBucket {
  return {
    startMs: 0,
    endMs: 1000,
    count: 1,
    average: 10,
    min: 10,
    max: 10,
    last: 10,
    ...overrides,
  };
}

const EMPTY = bucket({ count: 0, average: null, min: null, max: null, last: null });

describe("ölçek", () => {
  it("veri yoksa null döner", () => {
    expect(scaleOf([EMPTY]).min).toBeNull();
  });

  it("boş listede aralık null", () => {
    expect(scaleOf([]).span).toBeNull();
  });

  it("en düşük ve en yüksek bulunur", () => {
    const scale = scaleOf([bucket({ average: 5 }), bucket({ average: 15 })]);
    expect([scale.min, scale.max]).toEqual([5, 15]);
  });

  it("tek değerde aralık sıfır", () => {
    expect(scaleOf([bucket({ average: 7 })]).span).toBe(0);
  });

  it("boş kovalar ölçeğe girmez", () => {
    const scale = scaleOf([bucket({ average: 5 }), EMPTY]);
    expect(scale.max).toBe(5);
  });
});

describe("noktalar", () => {
  it("boş kova için nokta üretilmez", () => {
    expect(pointsOf([EMPTY])).toEqual([]);
  });

  it("dolu kova nokta üretir", () => {
    expect(pointsOf([bucket()])).toHaveLength(1);
  });

  it("nokta sayısı kova sayısından az olabilir", () => {
    // Nokta sayısını kova sayısına eşitlemek, olmayan ölçümleri uydurmak olurdu.
    expect(pointsOf([bucket(), EMPTY, bucket()])).toHaveLength(2);
  });

  it("nokta kovanın sırasını taşır", () => {
    const points = pointsOf([EMPTY, bucket()]);
    expect(points[0].index).toBe(1);
  });

  it("ilk nokta sol kenarda", () => {
    const points = pointsOf([bucket({ average: 5 }), bucket({ average: 10 })]);
    expect(points[0].x).toBeCloseTo(CHART_PADDING.left);
  });

  it("son nokta sağ kenarda", () => {
    const points = pointsOf([bucket({ average: 5 }), bucket({ average: 10 })]);
    expect(points[1].x).toBeCloseTo(CHART_WIDTH - CHART_PADDING.right);
  });

  it("yüksek değer yukarıda çizilir", () => {
    // SVG'de y aşağı doğru büyür; yüksek değerin y'si küçük olmalıdır.
    const points = pointsOf([bucket({ average: 1 }), bucket({ average: 100 })]);
    expect(points[1].y).toBeLessThan(points[0].y);
  });

  it("tek değerde çizgi ortadan geçer", () => {
    const points = pointsOf([bucket({ average: 7 }), bucket({ average: 7 })]);
    const middle = CHART_PADDING.top + (CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom) / 2;
    expect(points[0].y).toBeCloseTo(middle);
  });

  it("boş listede nokta yok", () => {
    expect(pointsOf([])).toEqual([]);
  });

  it("nokta değeri taşır", () => {
    expect(pointsOf([bucket({ average: 42 })])[0].value).toBe(42);
  });

  it("nokta zaman aralığını taşır", () => {
    const point = pointsOf([bucket({ startMs: 5, endMs: 9 })])[0];
    expect([point.startMs, point.endMs]).toEqual([5, 9]);
  });
});

describe("parçalar", () => {
  it("kesintisiz noktalar tek parça", () => {
    expect(segmentsOf(pointsOf([bucket(), bucket()]))).toHaveLength(1);
  });

  it("boşluk yeni parça başlatır", () => {
    expect(segmentsOf(pointsOf([bucket(), EMPTY, bucket()]))).toHaveLength(2);
  });

  it("boş noktalarda parça yok", () => {
    expect(segmentsOf([])).toEqual([]);
  });

  it("tek nokta da parça olur", () => {
    expect(segmentsOf(pointsOf([bucket()]))).toHaveLength(1);
  });
});

describe("yol", () => {
  it("boş parça boş yol", () => {
    expect(pathOf({ points: [] })).toBe("");
  });

  it("tek nokta M ile başlar", () => {
    expect(pathOf({ points: pointsOf([bucket()]) })).toMatch(/^M /);
  });

  it("iki nokta L içerir", () => {
    const path = pathOf({ points: pointsOf([bucket({ average: 1 }), bucket({ average: 2 })]) });
    expect(path).toContain(" L ");
  });

  it("veri olmayan seride yol yok", () => {
    expect(seriesPaths(emptySeries("A", "uretim", "1h"))).toEqual([]);
  });

  it("boşluklu seride iki yol", () => {
    const series = { ...emptySeries("A", "uretim", "1h"), buckets: [bucket(), EMPTY, bucket()] };
    expect(seriesPaths(series)).toHaveLength(2);
  });
});

describe("boşluk oranı", () => {
  it("kova yoksa null", () => {
    // Bölünecek bir şey olmadığında "%0 boşluk" demek yanlış olurdu.
    expect(gapRatio([])).toBeNull();
  });

  it("hepsi doluysa sıfır", () => {
    expect(gapRatio([bucket(), bucket()])).toBe(0);
  });

  it("yarısı boşsa yarım", () => {
    expect(gapRatio([bucket(), EMPTY])).toBe(0.5);
  });

  it("hepsi boşsa bir", () => {
    expect(gapRatio([EMPTY, EMPTY])).toBe(1);
  });
});
