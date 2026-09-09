import { describe, expect, it } from "vitest";
import { emptyContext, sampleContext } from "./fixtures";
import {
  NO_DATA_MESSAGE,
  confidenceOf,
  groundedNumbers,
  guardAnswer,
  hasAnyData,
  isGrounded,
  noDataAnswer,
  normalizeNumber,
  numericTokens,
  ungroundedNumbers,
} from "./guards";
import type { CopilotAnswer } from "./types";

const CONTEXT = sampleContext();

function answer(text: string): CopilotAnswer {
  return {
    text,
    reasons: ["gerekçe"],
    actions: [],
    confidence: "high",
    sources: ["finance"],
  };
}

describe("normalizeNumber", () => {
  it("binlik ayracini atar", () => {
    expect(normalizeNumber("178.772")).toBe("178772");
  });

  it("ondalik virgulu noktaya cevirir", () => {
    expect(normalizeNumber("84,5")).toBe("84.5");
  });

  it("binlik ve ondalik birlikte", () => {
    expect(normalizeNumber("1.234,56")).toBe("1234.56");
  });

  it("para ve yuzde isaretlerini yok sayar", () => {
    expect(normalizeNumber("₺41.900")).toBe("41900");
    expect(normalizeNumber("%92")).toBe("92");
  });

  it("sondaki sifirlari onemsemez", () => {
    // "42,0" ile "42" ayni sayidir.
    expect(normalizeNumber("42,0")).toBe(normalizeNumber("42"));
  });

  it("sayi olmayan girdide bos doner", () => {
    expect(normalizeNumber("abc")).toBe("");
    expect(normalizeNumber("")).toBe("");
  });
});

describe("numericTokens", () => {
  it("cumledeki tum sayilari cikarir", () => {
    expect(numericTokens("Kayıp ₺84.200, oran %79.")).toEqual(["84200", "79"]);
  });

  it("sayisiz cumlede bos doner", () => {
    expect(numericTokens("Darboğaz Kaynak istasyonu.")).toEqual([]);
  });

  it("orani ve tutari ayri ayri sayar", () => {
    expect(numericTokens("3/5 kaynak bağlı, gecikme 107 ms.")).toEqual([
      "3",
      "5",
      "107",
    ]);
  });
});

describe("groundedNumbers", () => {
  const grounded = groundedNumbers(CONTEXT);

  it("olgularin gosterim degerlerini kapsar", () => {
    expect(grounded.has("178772")).toBe(true);
    expect(grounded.has("92")).toBe(true);
  });

  it("oranlarin yuzde karsiligini da kapsar", () => {
    // Baglamda 0,9 duruyor; cumlede "%90" gecebilir.
    expect(grounded.has("90")).toBe(true);
  });

  it("baglamda olmayan sayiyi kapsamaz", () => {
    expect(grounded.has("999999")).toBe(false);
  });

  it("bos baglamda bos kume doner", () => {
    expect(groundedNumbers(emptyContext()).size).toBe(0);
  });
});

describe("isGrounded / ungroundedNumbers", () => {
  it("baglamdan kurulmus cumleyi gecirir", () => {
    expect(
      isGrounded("Aylık kayıp projeksiyonu ₺178.772.", CONTEXT),
    ).toBe(true);
  });

  it("uydurma sayiyi yakalar", () => {
    // Urunun en tehlikeli hatasi: inandirici ama olculmemis bir rakam.
    expect(isGrounded("Aylık kaybınız ₺240.000.", CONTEXT)).toBe(false);
    expect(ungroundedNumbers("Aylık kaybınız ₺240.000.", CONTEXT)).toEqual([
      "240000",
    ]);
  });

  it("sayisiz cumle her zaman dayanaklidir", () => {
    expect(isGrounded("Darboğaz Kaynak istasyonu.", CONTEXT)).toBe(true);
  });

  it("birden cok uydurma sayiyi listeler", () => {
    expect(
      ungroundedNumbers("Kayıp ₺1.000 ve oran %55.", CONTEXT),
    ).toEqual(["1000", "55"]);
  });

  it("bos baglamda her sayi dayanaksizdir", () => {
    expect(isGrounded("Kayıp ₺5.", emptyContext())).toBe(false);
  });
});

describe("guardAnswer", () => {
  it("dayanakli yaniti oldugu gibi birakir", () => {
    const original = answer("Aylık kayıp projeksiyonu ₺178.772.");
    expect(guardAnswer(original, CONTEXT)).toBe(original);
  });

  it("uydurma sayili yaniti gostermez", () => {
    const guarded = guardAnswer(answer("Aylık kaybınız ₺240.000."), CONTEXT);
    expect(guarded.text).toContain(NO_DATA_MESSAGE);
    expect(guarded.confidence).toBe("none");
    expect(guarded.sources).toEqual([]);
  });

  it("engellenen yanitin nedenini yazar", () => {
    const guarded = guardAnswer(answer("Kayıp ₺240.000."), CONTEXT);
    expect(guarded.reasons[0]).toContain("240000");
    expect(guarded.reasons[1]).toContain("tahmin etmez");
  });

  it("eylem kartlarini korur", () => {
    const withAction: CopilotAnswer = {
      ...answer("Kayıp ₺240.000."),
      actions: [
        { id: "a", label: "Finans'a git", view: "finance", reason: "test" },
      ],
    };
    expect(guardAnswer(withAction, CONTEXT).actions).toHaveLength(1);
  });
});

describe("confidenceOf", () => {
  it("kaynak yoksa 'veri yok' der", () => {
    expect(confidenceOf([], CONTEXT)).toBe("none");
  });

  it("uc katman ve dolu baglamda yuksek guven", () => {
    expect(
      confidenceOf(["simulation", "finance", "heatmap"], CONTEXT),
    ).toBe("high");
  });

  it("iki katmanda orta guven", () => {
    expect(confidenceOf(["simulation", "finance"], CONTEXT)).toBe("medium");
  });

  it("tek katman ve zayif baglamda dusuk guven", () => {
    const thin = {
      ...emptyContext(),
      sections: emptyContext().sections.map((section, index) =>
        index === 0
          ? { ...section, available: true, missingReason: null }
          : section,
      ),
    };
    expect(confidenceOf(["simulation"], thin)).toBe("low");
  });

  it("tek katman ama dolu baglamda orta guven", () => {
    expect(confidenceOf(["finance"], CONTEXT)).toBe("medium");
  });
});

describe("noDataAnswer", () => {
  it("eksik katmanin nedenini gerekce yapar", () => {
    const result = noDataAnswer(CONTEXT, ["inventory"]);
    expect(result.text).toBe(NO_DATA_MESSAGE);
    expect(result.reasons[0]).toContain("Envanter analizi yapılmadı");
    expect(result.confidence).toBe("none");
  });

  it("birden cok eksik katmani listeler", () => {
    expect(noDataAnswer(CONTEXT, ["inventory", "crm"]).reasons).toHaveLength(2);
  });

  it("katman verilmezse genel gerekce yazar", () => {
    expect(noDataAnswer(CONTEXT, []).reasons[0]).toContain("hiçbir ölçüm");
  });

  it("eylem kartlarini tasir", () => {
    const result = noDataAnswer(CONTEXT, ["inventory"], [
      { id: "a", label: "Envanteri aç", view: "inventory", reason: "test" },
    ]);
    expect(result.actions).toHaveLength(1);
  });
});

describe("hasAnyData", () => {
  it("dolu baglamda dogru", () => {
    expect(hasAnyData(CONTEXT)).toBe(true);
  });

  it("bos baglamda yanlis", () => {
    expect(hasAnyData(emptyContext())).toBe(false);
  });
});
