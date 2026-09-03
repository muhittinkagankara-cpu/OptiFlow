/**
 * Isı haritası sunum yardımcılarının birim testleri.
 *
 * Bu dosyanın sınadığı asıl şey bir davranış değil, bir **sınır**: arayüzün
 * skoru yeniden hesaplamadığı, yalnızca backend'den gelen bandı boyadığı.
 * Eşikler burada tekrar edilseydi, backend'de bir eşik değiştiğinde ekran
 * sessizce yanlış rengi gösterirdi.
 */

import { describe, expect, it } from "vitest";
import {
  bandDot,
  bandLabel,
  bandSurface,
  bandText,
  dominantComponentLabel,
  formatComponentValue,
  formatScore,
  heatById,
  shouldPulse,
} from "./heatmapFormatting";
import type { HeatBand, StationHeat } from "../types/simulationTypes";

const BANDS: HeatBand[] = ["green", "yellow", "orange", "red"];

function heat(overrides: Partial<StationHeat> = {}): StationHeat {
  return {
    station_id: "kesim",
    station_name: "Kesim",
    score: 40,
    band: "yellow",
    components: [],
    total_loss: 1000,
    is_bottleneck: false,
    is_relative: true,
    ...overrides,
  };
}

describe("renk eşlemesi", () => {
  it("her bandın bir dolgu, metin ve nokta rengi vardır", () => {
    for (const band of BANDS) {
      expect(bandSurface(band)).toBeTruthy();
      expect(bandText(band)).toBeTruthy();
      expect(bandDot(band)).toBeTruthy();
    }
  });

  it("dört bandın rengi birbirinden farklıdır", () => {
    const surfaces = new Set(BANDS.map(bandSurface));
    const dots = new Set(BANDS.map(bandDot));
    expect(surfaces.size).toBe(4);
    expect(dots.size).toBe(4);
  });

  it("her bandın bir de yazısı vardır", () => {
    // Renk tek başına bilgi taşımaz; renk körü kullanıcı için yazı şarttır.
    expect(bandLabel("green")).toBe("Düşük");
    expect(bandLabel("yellow")).toBe("Orta");
    expect(bandLabel("orange")).toBe("Yüksek");
    expect(bandLabel("red")).toBe("Kritik");
  });

  it("bandlar sıcaklık sırasına göre farklı yazılar taşır", () => {
    const labels = new Set(BANDS.map(bandLabel));
    expect(labels.size).toBe(4);
  });
});

describe("pulse mantığı", () => {
  it("yalnızca kritik istasyon nabız atar", () => {
    // Hepsi atsaydı hareket bir sinyal olmaktan çıkar, ekran gürültü olurdu.
    expect(shouldPulse("red")).toBe(true);
    expect(shouldPulse("orange")).toBe(false);
    expect(shouldPulse("yellow")).toBe(false);
    expect(shouldPulse("green")).toBe(false);
  });

  it("tam olarak bir band nabız atar", () => {
    expect(BANDS.filter(shouldPulse)).toEqual(["red"]);
  });
});

describe("formatScore", () => {
  it("skoru tam sayıya yuvarlar", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(42.4)).toBe("42");
    expect(formatScore(42.6)).toBe("43");
    expect(formatScore(100)).toBe("100");
  });

  it("geçersiz sayıda çökmez", () => {
    expect(formatScore(Number.NaN)).toBe("—");
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatComponentValue", () => {
  it("kayıp bileşenini para gibi yazar", () => {
    expect(formatComponentValue("loss", 12500)).toBe("12.500");
  });

  it("oran bileşenlerini yüzde olarak yazar", () => {
    expect(formatComponentValue("utilization", 0.87)).toBe("%87");
    expect(formatComponentValue("waiting", 0.5)).toBe("%50");
    expect(formatComponentValue("scrap", 0)).toBe("%0");
  });

  it("geçersiz sayıda çökmez", () => {
    expect(formatComponentValue("loss", Number.NaN)).toBe("—");
  });
});

describe("dominantComponentLabel", () => {
  it("en çok katkı yapan bileşeni seçer", () => {
    const withComponents = heat({
      components: [
        { name: "loss", label: "Finansal kayıp", raw_value: 100, normalized: 0.2, weight: 0.4, contribution: 8 },
        { name: "utilization", label: "Kullanım oranı", raw_value: 0.9, normalized: 0.9, weight: 0.25, contribution: 22.5 },
      ],
    });
    expect(dominantComponentLabel(withComponents)).toBe("Kullanım oranı");
  });

  it("bileşen yoksa null döner", () => {
    expect(dominantComponentLabel(heat({ components: [] }))).toBeNull();
  });

  it("tüm katkılar sıfırsa null döner", () => {
    // Tamamen soğuk bir istasyon için "şu yüzden sıcak" demek anlamsız olurdu.
    const cold = heat({
      components: [
        { name: "loss", label: "Finansal kayıp", raw_value: 0, normalized: 0, weight: 0.4, contribution: 0 },
      ],
    });
    expect(dominantComponentLabel(cold)).toBeNull();
  });
});

describe("heatById", () => {
  it("kimliğe göre istasyonu bulur", () => {
    const list = [heat({ station_id: "a" }), heat({ station_id: "b" })];
    expect(heatById(list, "b")?.station_id).toBe("b");
  });

  it("eşleşmeyen düğümde null döner, çökmez", () => {
    // React Flow düğümleri modelden, ısı listesi koşumdan gelir; eşleşmeyen
    // bir düğüm olabilir ve bu bir çökme sebebi olmamalıdır.
    expect(heatById([heat({ station_id: "a" })], "yok")).toBeNull();
    expect(heatById([], "a")).toBeNull();
  });
});

describe("sınır: arayüz skoru yeniden hesaplamaz", () => {
  it("band doğrudan backend'den gelen değerdir", () => {
    // Skor 90 ama band 'green' olarak gelirse arayüz yine yeşil boyar.
    // Bu bilinçlidir: eşik tek bir yerde, backend'de yaşar.
    const inconsistent = heat({ score: 90, band: "green" });
    expect(bandSurface(inconsistent.band)).toBe(bandSurface("green"));
    expect(shouldPulse(inconsistent.band)).toBe(false);
  });
});
