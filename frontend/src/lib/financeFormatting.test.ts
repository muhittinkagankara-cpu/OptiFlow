/**
 * Finansal biçimlendirmenin birim testleri.
 *
 * Para ekranda yanlış büyüklükte görünürse hiçbir hata mesajı çıkmaz;
 * kullanıcı yalnızca yanlış bir sayı okur ve ona göre karar verir. Kaynak
 * etiketleri de burada kilitlenir: "Tahmin" ile "Hesaplandı" birbirine
 * karışırsa, kestirime dayanan bir rakam sayılmış gibi sunulur.
 */

import { describe, expect, it } from "vitest";
import {
  CURRENCY,
  confidenceLabel,
  confidenceTone,
  formatMoney,
  provenanceHint,
  provenanceLabel,
  provenanceTone,
  rateLabel,
  shareOfTotal,
} from "./financeFormatting";

describe("formatMoney", () => {
  it("para birimiyle ve binlik ayraçla yazar", () => {
    expect(formatMoney(1250)).toBe(`${CURRENCY}1.250`);
    expect(formatMoney(1000000)).toBe(`${CURRENCY}1.000.000`);
  });

  it("kuruş göstermez", () => {
    // Kayip rakamlari kestirim icerir; iki ondalik basamak sahip olunmayan
    // bir kesinligi ima ederdi.
    expect(formatMoney(1250.4)).toBe(`${CURRENCY}1.250`);
    expect(formatMoney(1250.6)).toBe(`${CURRENCY}1.251`);
  });

  it("sıfırı gösterir", () => {
    expect(formatMoney(0)).toBe(`${CURRENCY}0`);
  });

  it("geçersiz sayıda çökmez", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("provenance etiketleri", () => {
  it("her kaynak türü bir yazı taşır", () => {
    expect(provenanceLabel("observed")).toBe("Ölçüldü");
    expect(provenanceLabel("calculated")).toBe("Hesaplandı");
    expect(provenanceLabel("estimated")).toBe("Tahmin");
  });

  it("her kaynak türü bir açıklama taşır", () => {
    // Etiket tek basina yeterli degildir: "Tahmin" yazisi neden daha az
    // guvenilmesi gerektigini soylemez.
    for (const provenance of ["observed", "calculated", "estimated"] as const) {
      expect(provenanceHint(provenance).length).toBeGreaterThan(20);
    }
  });

  it("tahmin, sayımdan görsel olarak da ayrılır", () => {
    expect(provenanceTone("estimated")).not.toBe(provenanceTone("observed"));
    expect(provenanceTone("estimated")).toBe("warning");
  });
});

describe("confidenceLabel / confidenceTone", () => {
  it("yüzdeyi sözel karşılığa çevirir", () => {
    expect(confidenceLabel(0.95)).toBe("Yüksek");
    expect(confidenceLabel(0.7)).toBe("Orta");
    expect(confidenceLabel(0.2)).toBe("Düşük");
  });

  it("sınır değerleri beklendiği gibi sınıflar", () => {
    expect(confidenceLabel(0.85)).toBe("Yüksek");
    expect(confidenceLabel(0.5)).toBe("Orta");
    expect(confidenceLabel(0.49)).toBe("Düşük");
  });

  it("düşük güven en güçlü uyarı tonunu alır", () => {
    expect(confidenceTone(0.2)).toBe("bad");
    expect(confidenceTone(0.95)).toBe("good");
  });

  it("geçersiz değerde çökmez", () => {
    expect(confidenceLabel(Number.NaN)).toBe("—");
    expect(confidenceTone(Number.NaN)).toBe("neutral");
  });
});

describe("rateLabel", () => {
  it("oran adını okunabilir yazıya çevirir", () => {
    expect(rateLabel("machine_cost_per_hour")).toBe("Saatlik makine maliyeti");
    expect(rateLabel("contribution_margin")).toBe("Birim katkı payı");
  });

  it("bilinmeyen adı olduğu gibi bırakır", () => {
    // Ham ad gostermek, bos birakmaktan iyidir: kullanici en azindan hangi
    // alanin eksik oldugunu arayabilir.
    expect(rateLabel("bilinmeyen_oran")).toBe("bilinmeyen_oran");
  });
});

describe("shareOfTotal", () => {
  it("payı yüzde olarak verir", () => {
    expect(shareOfTotal(25, 100)).toBe(25);
    expect(shareOfTotal(1, 4)).toBe(25);
  });

  it("sıfır toplamda sıfır döner", () => {
    // Sifira bolmek NaN uretir ve ekranda "%NaN" yazardi.
    expect(shareOfTotal(10, 0)).toBe(0);
  });

  it("geçersiz değerlerde sıfır döner", () => {
    expect(shareOfTotal(Number.NaN, 100)).toBe(0);
    expect(shareOfTotal(10, Number.NaN)).toBe(0);
  });
});
