/**
 * Sonuç sayfası açılış cümlesinin seçimi (Sprint 2G-B).
 *
 * Testlerin koruduğu kural tek: cümle **seçilir, üretilmez**. Motorun yazdığı
 * cümle varsa o kullanılır; yoksa sayfanın zaten yazdığı kısıt cümlesine
 * düşülür; ikisi de yoksa hiçbir şey uydurulmaz.
 */

import { describe, expect, it } from "vitest";
import {
  backendHeadline,
  bottleneckHeadline,
  resultsStatement,
} from "./statement";

describe("motor cümlesi", () => {
  it("dolu cümle olduğu gibi kullanılır", () => {
    expect(backendHeadline("Hat kararsız; kuyruklar büyüyor.")).toBe(
      "Hat kararsız; kuyruklar büyüyor.",
    );
  });

  it("baştaki ve sondaki boşluk kırpılır", () => {
    expect(backendHeadline("  Torna hattı sınırlıyor.  ")).toBe(
      "Torna hattı sınırlıyor.",
    );
  });

  it("boş cümle kullanılmaz", () => {
    expect(backendHeadline("")).toBeNull();
  });

  it("yalnızca boşluktan oluşan cümle kullanılmaz", () => {
    // Ekranın en büyük yazısının boş görünmesi, sıfır bilgi taşıması demekti.
    expect(backendHeadline("   ")).toBeNull();
    expect(backendHeadline("\n\t ")).toBeNull();
  });

  it("eksik alan çökmez", () => {
    expect(backendHeadline(null)).toBeNull();
    expect(backendHeadline(undefined)).toBeNull();
  });
});

describe("kısıt cümlesi (yedek)", () => {
  it("sayfanın zaten yazdığı cümlenin aynısıdır", () => {
    expect(bottleneckHeadline("Torna")).toBe(
      "Hattınızın çıktısını Torna belirliyor.",
    );
  });

  it("istasyon adı yoksa cümle uydurulmaz", () => {
    // Uydurulmuş bir istasyon adı kullanıcıyı yanlış makineye yönlendirirdi.
    expect(bottleneckHeadline(null)).toBeNull();
    expect(bottleneckHeadline("")).toBeNull();
    expect(bottleneckHeadline("  ")).toBeNull();
  });
});

describe("açılış cümlesinin seçimi", () => {
  it("motor cümlesi varsa o kullanılır", () => {
    const s = resultsStatement("Hat kararsız.", "Torna")!;
    expect(s.headline).toBe("Hat kararsız.");
    expect(s.source).toBe("engine");
  });

  it("motor cümlesi boşsa kısıt cümlesine düşülür", () => {
    const s = resultsStatement("", "Torna")!;
    expect(s.headline).toBe("Hattınızın çıktısını Torna belirliyor.");
    expect(s.source).toBe("bottleneck");
  });

  it("motor cümlesi yalnızca boşluksa da kısıt cümlesine düşülür", () => {
    expect(resultsStatement("   ", "Torna")?.source).toBe("bottleneck");
  });

  it("ikisi de yoksa cümle uydurulmaz", () => {
    expect(resultsStatement(null, null)).toBeNull();
    expect(resultsStatement("  ", "")).toBeNull();
  });

  it("öneri, kazanan ya da para dili üretmez", () => {
    // Bu katman yalnızca seçim yapar; yeni bir iddia eklemez.
    const s = resultsStatement(null, "Torna")!;
    expect(s.headline).not.toMatch(/öner|kazanan|tavsiye|₺|yapay zekâ/i);
  });

  it("motor cümlesini yeniden yazmaz", () => {
    const gelen = "Üretim 778 birim; kısıt Torna.";
    expect(resultsStatement(gelen, "Kesme")!.headline).toBe(gelen);
  });
});
