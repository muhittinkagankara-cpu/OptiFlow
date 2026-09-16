/**
 * Canlı eşikler (Sprint 2I-B).
 *
 * Bu testler yeni bir davranış tarif etmez: `LivePage` içinde çıplak duran
 * `utilization >= 0.85` karşılaştırmasının saf işleve **birebir** taşındığını
 * kayda geçirir.
 */

import { describe, expect, it } from "vitest";
import { BOTTLENECK_WARNING } from "../actionItems";
import { bottleneckTone, isHighUtilization } from "./thresholds";

describe("eşik tek kaynaktan okunur", () => {
  it("uyarı eşiği actionItems'taki değerdir", () => {
    expect(BOTTLENECK_WARNING).toBe(0.85);
  });
});

describe("darboğaz tonu — eski davranış korunur", () => {
  it("eşiğin üstü bad", () => {
    expect(bottleneckTone(0.92)).toBe("bad");
  });

  it("eşiğin tam üstünde de bad", () => {
    expect(bottleneckTone(0.85)).toBe("bad");
  });

  it("eşiğin altı warning", () => {
    expect(bottleneckTone(0.84)).toBe("warning");
  });

  it("ölçülemeyen doluluk için renk seçilmez", () => {
    expect(bottleneckTone(Number.NaN)).toBeNull();
  });
});

describe("isHighUtilization", () => {
  it("eşikte ve üstünde true", () => {
    expect(isHighUtilization(0.85)).toBe(true);
    expect(isHighUtilization(1)).toBe(true);
  });

  it("altında false", () => {
    expect(isHighUtilization(0.5)).toBe(false);
  });

  it("ölçülemeyen değer false", () => {
    expect(isHighUtilization(Number.NaN)).toBe(false);
  });
});
