/**
 * Envanter biçimlendirmesinin birim testleri.
 *
 * Buradaki hatalar sessizdir: bir durumun yanlış renge eşlenmesi ekranda hata
 * göstermez, yalnızca kullanıcıyı yanlış zamanda sipariş vermeye ya da
 * vermemeye iter. Backend'in "sonsuz yerine -1" işaret değeri de burada tek
 * yerde çözülür; kaçarsa ekranda "-1 gün" görünür.
 */

import { describe, expect, it } from "vitest";
import {
  formatDays,
  formatProbability,
  formatQuantity,
  riskTone,
  serviceLevelLabel,
  statusLabel,
  statusTone,
} from "./inventoryFormatting";

describe("statusTone / statusLabel", () => {
  it("her durum bir renk ve bir yazı taşır", () => {
    // Renk tek başına bilgi taşımaz; renk körü kullanıcı için yazı şarttır.
    expect(statusTone("critical")).toBe("bad");
    expect(statusTone("warning")).toBe("warning");
    expect(statusTone("ok")).toBe("good");

    expect(statusLabel("critical")).toBe("Sipariş ver");
    expect(statusLabel("warning")).toBe("Yaklaşıyor");
    expect(statusLabel("ok")).toBe("Yeterli");
  });

  it("kritik durum en güçlü tonu alır", () => {
    expect(statusTone("critical")).not.toBe(statusTone("ok"));
    expect(statusTone("critical")).not.toBe(statusTone("warning"));
  });
});

describe("formatDays", () => {
  it("gün sayısını yuvarlayarak yazar", () => {
    expect(formatDays(12.4)).toBe("12 gün");
    expect(formatDays(12.6)).toBe("13 gün");
  });

  it("bir günden kısa süreyi sayı olarak yazmaz", () => {
    // "0 gün" kullanıcıya "bugün biter" demez; belirsiz kalır.
    expect(formatDays(0.4)).toBe("1 günden az");
    expect(formatDays(0)).toBe("1 günden az");
  });

  it("backend'in -1 işaret değerini çözer", () => {
    // Talep sıfırken sonsuz gün yeter; JSON sonsuz taşıyamadığı için -1 gelir.
    expect(formatDays(-1)).toBe("—");
  });

  it("sayı olmayan değerde çökmez", () => {
    expect(formatDays(Number.NaN)).toBe("—");
    expect(formatDays(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("miktarı birimiyle yazar", () => {
    expect(formatQuantity(1250, "metre")).toBe("1.250 metre");
  });

  it("ondalık basamak sayısı verilebilir", () => {
    expect(formatQuantity(12.34, "kg", 1)).toBe("12,3 kg");
  });

  it("geçersiz sayıda çökmez", () => {
    expect(formatQuantity(Number.NaN, "adet")).toBe("—");
  });
});

describe("formatProbability", () => {
  it("oranı yüzdeye çevirir", () => {
    expect(formatProbability(0)).toBe("%0");
    expect(formatProbability(0.375)).toBe("%38");
    expect(formatProbability(1)).toBe("%100");
  });
});

describe("riskTone", () => {
  it("sıfır risk iyi, her risk en az uyarıdır", () => {
    // Stok tükenmesi üretimi tamamen durdurur; küçük bir ihtimal bile
    // görmezden gelinemez.
    expect(riskTone(0)).toBe("good");
    expect(riskTone(0.05)).toBe("warning");
  });

  it("belirgin risk kırmızıya geçer", () => {
    expect(riskTone(0.2)).toBe("bad");
    expect(riskTone(0.9)).toBe("bad");
  });

  it("geçersiz değerde nötr kalır", () => {
    expect(riskTone(Number.NaN)).toBe("neutral");
  });
});

describe("serviceLevelLabel", () => {
  it("oranı yüzde etiketine çevirir", () => {
    expect(serviceLevelLabel(0.9)).toBe("%90");
    expect(serviceLevelLabel(0.95)).toBe("%95");
    expect(serviceLevelLabel(0.99)).toBe("%99");
  });
});
