/**
 * Sonuç sayfası kapanış adımı (Sprint 2G-E).
 *
 * Korunan kural: kapanış bir **öneri değildir**. Ölçülmüş kısıt bilgisini
 * cümleye çevirir ve var olan bir ekrana götürür; kazanç, artış ya da kazanan
 * senaryo iddia etmez.
 */

import { describe, expect, it } from "vitest";
import { resultsClosing } from "./closing";

describe("kapanış adımı — bağlam", () => {
  it("kısıt istasyonunu adıyla anar", () => {
    const c = resultsClosing("Torna");
    expect(c.text).toContain("Torna");
    expect(c.text).toContain("kısıtı olarak ölçüldü");
  });

  it("kısıt bilinmiyorsa istasyon uydurulmaz", () => {
    const c = resultsClosing(null);
    expect(c.text).toContain("belirlenemedi");
    expect(c.text).not.toMatch(/Torna|istasyonu olarak ölçüldü/);
  });

  it("boş ya da boşluk ad da uydurma üretmez", () => {
    expect(resultsClosing("").text).toContain("belirlenemedi");
    expect(resultsClosing("   ").text).toContain("belirlenemedi");
    expect(resultsClosing(undefined).text).toContain("belirlenemedi");
  });
});

describe("kapanış adımı — uydurma iddia yok", () => {
  const metinler = [
    resultsClosing("Torna").text,
    resultsClosing(null).text,
  ];

  it("para iddiası üretmez", () => {
    metinler.forEach((t) => expect(t).not.toMatch(/₺|\bTL\b|kazan[ıi]r/i));
  });

  it("üretim artışı vaat etmez", () => {
    metinler.forEach((t) => expect(t).not.toMatch(/%\d|artar|artış|iyileş/i));
  });

  it("kazanan senaryo ya da yapay zekâ dili üretmez", () => {
    metinler.forEach((t) =>
      expect(t).not.toMatch(/kazanan|öneri|tavsiye|yapay zekâ|AI\b/i),
    );
  });

  it("aciliyet ya da kutlama dili üretmez", () => {
    metinler.forEach((t) =>
      expect(t).not.toMatch(/hemen|acele|tebrikler|harika|mükemmel/i),
    );
  });

  it("cümlede hiç sayı geçmez", () => {
    // Her sayı bir ölçüm iddiasıdır; kapanış yeni ölçüm getirmez.
    metinler.forEach((t) => expect(t.match(/\d/)).toBeNull());
  });
});

describe("kapanış adımı — eylem", () => {
  it("var olan editör eylemini kullanır", () => {
    expect(resultsClosing("Torna").actionLabel).toBe("Modeli düzenle");
  });

  it("kısıt olsun olmasın aynı geçerli eylemi verir", () => {
    // Modeli açmak koşum sonrası her zaman geçerli ve var olan adımdır.
    expect(resultsClosing(null).actionLabel).toBe(
      resultsClosing("Torna").actionLabel,
    );
  });
});
