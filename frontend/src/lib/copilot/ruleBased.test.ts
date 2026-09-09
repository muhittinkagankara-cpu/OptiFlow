import { describe, expect, it } from "vitest";
import { emptyContext, sampleContext } from "./fixtures";
import { NO_DATA_MESSAGE, isGrounded } from "./guards";
import {
  RuleBasedProvider,
  actionFor,
  answerQuestion,
  detectIntent,
} from "./ruleBased";
import type { FactoryContext } from "./types";

const CONTEXT = sampleContext();
const EMPTY = emptyContext();

/** Belirli bir katmanı bağlamdan düşürür. */
function without(context: FactoryContext, ...sources: string[]): FactoryContext {
  return {
    ...context,
    sections: context.sections.map((section) =>
      sources.includes(section.source)
        ? { ...section, available: false, facts: [], missingReason: "Test için kaldırıldı." }
        : section,
    ),
  };
}

describe("detectIntent", () => {
  it("darbogaz sorusunu tanir", () => {
    expect(detectIntent("Bugünkü darboğazı açıkla.")).toBe("bottleneck");
    expect(detectIntent("Hat neden yavaş?")).toBe("bottleneck");
  });

  it("kayip sorusunu tanir", () => {
    expect(detectIntent("Neden kayıp oluşuyor?")).toBe("loss");
    expect(detectIntent("Bu ay ne kadar para kaybettim?")).toBe("loss");
  });

  it("yatirim sorusunu tanir", () => {
    expect(detectIntent("Hangi istasyona yatırım yapmalıyım?")).toBe("investment");
  });

  it("fire sorusunu kayiptan ayirir", () => {
    // "Fire neden artti?" hem "neden" hem "fire" tasir; asil konu firedir.
    expect(detectIntent("Fire neden arttı?")).toBe("scrap");
  });

  it("dogrulama sorusunu tanir", () => {
    expect(detectIntent("Model gerçek üretimle ne kadar uyumlu?")).toBe("validation");
  });

  it("canli ve envanter sorularini tanir", () => {
    expect(detectIntent("Şu an kaç alarm var?")).toBe("live");
    expect(detectIntent("Stok durumu nedir?")).toBe("inventory");
  });

  it("baglanti sorusunu tanir", () => {
    expect(detectIntent("MQTT bağlantısı çalışıyor mu?")).toBe("connectors");
  });

  it("taninmayan soruyu genel ozete yollar", () => {
    expect(detectIntent("Merhaba")).toBe("summary");
  });

  it("buyuk harf ve Turkce karakterden etkilenmez", () => {
    expect(detectIntent("DARBOĞAZ NEREDE?")).toBe("bottleneck");
  });
});

describe("answerQuestion — darboğaz", () => {
  const result = answerQuestion("Bugünkü darboğazı açıkla.", CONTEXT);

  it("darbogazi ve dolulugunu soyler", () => {
    expect(result.text).toContain("Kaynak");
    expect(result.text).toContain("%92");
  });

  it("isi haritasiyla ortustugunu belirtir", () => {
    expect(result.text).toContain("Isı haritası");
  });

  it("parasal etkiyi finanstan alir", () => {
    expect(result.text).toContain("₺41.900");
  });

  it("gerekcelerini yazar", () => {
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some((reason) => reason.includes("Kaynak"))).toBe(true);
  });

  it("eylem kartlari uretir", () => {
    const views = result.actions.map((action) => action.view);
    expect(views).toContain("finance");
    expect(views).toContain("live");
  });

  it("uc katmandan beslendigi icin yuksek guven verir", () => {
    expect(result.confidence).toBe("high");
    expect(result.sources).toContain("simulation");
    expect(result.sources).toContain("finance");
  });

  it("kosum yoksa veri yok der", () => {
    const answer = answerQuestion("Darboğaz nerede?", EMPTY);
    expect(answer.text).toBe(NO_DATA_MESSAGE);
    expect(answer.confidence).toBe("none");
  });

  it("darbogaz ile en sicak istasyon farkliysa bunu soyler", () => {
    const shifted: FactoryContext = {
      ...CONTEXT,
      sections: CONTEXT.sections.map((section) =>
        section.source === "heatmap"
          ? {
              ...section,
              facts: section.facts.map((item) =>
                item.key === "hottest_station"
                  ? { ...item, display: "Torna" }
                  : item,
              ),
            }
          : section,
      ),
    };
    const answer = answerQuestion("Darboğaz nerede?", shifted);
    expect(answer.text).toContain("farklı yerlerde");
  });
});

describe("answerQuestion — kayıp", () => {
  const result = answerQuestion("Neden kayıp oluşuyor?", CONTEXT);

  it("toplam ve aylik kaybi yazar", () => {
    expect(result.text).toContain("₺84.200");
    expect(result.text).toContain("₺178.772");
  });

  it("en buyuk kalemi ve tutarini yazar", () => {
    expect(result.text).toContain("bekleme kaybı");
    expect(result.text).toContain("₺39.800");
  });

  it("kurtarilabilir payi soyler", () => {
    expect(result.text).toContain("₺31.400");
  });

  it("veri dolulugunu gerekce yapar", () => {
    expect(result.reasons.some((reason) => reason.includes("%80"))).toBe(true);
  });

  it("finans yoksa veri yok der ve nedenini gosterir", () => {
    const answer = answerQuestion("Kayıp nerede?", without(CONTEXT, "finance"));
    expect(answer.text).toBe(NO_DATA_MESSAGE);
    expect(answer.reasons[0]).toContain("Test için kaldırıldı");
  });

  it("finansa goturen eylem karti verir", () => {
    expect(result.actions.some((action) => action.view === "finance")).toBe(true);
  });
});

describe("answerQuestion — yatırım", () => {
  const result = answerQuestion("Hangi istasyona yatırım yapmalıyım?", CONTEXT);

  it("en cok kaybettiren istasyonu onerir", () => {
    expect(result.text).toContain("Kaynak");
    expect(result.text).toContain("₺41.900");
  });

  it("finans onerisini aktarir", () => {
    expect(result.text).toContain("ikinci vardiya");
  });

  it("darbogaz ayni istasyonsa etkisini vurgular", () => {
    expect(result.text).toContain("darboğazı olduğu için");
  });

  it("model dogrulugunu karara katar", () => {
    expect(result.text).toContain("%90");
    expect(result.reasons.some((reason) => reason.includes("Model doğruluğu"))).toBe(
      true,
    );
  });

  it("darbogaz baska istasyondaysa uyarir", () => {
    const shifted: FactoryContext = {
      ...CONTEXT,
      sections: CONTEXT.sections.map((section) =>
        section.source === "simulation"
          ? {
              ...section,
              facts: section.facts.map((item) =>
                item.key === "bottleneck_name"
                  ? { ...item, display: "Kesim" }
                  : item,
              ),
            }
          : section,
      ),
    };
    const answer = answerQuestion("Hangi istasyona yatırım yapmalıyım?", shifted);
    expect(answer.text).toContain("önce oradaki kısıt açılmalıdır");
  });

  it("finans yoksa veri yok der", () => {
    expect(
      answerQuestion("Nereye yatırım yapayım?", without(CONTEXT, "finance", "heatmap"))
        .text,
    ).toBe(NO_DATA_MESSAGE);
  });
});

describe("answerQuestion — fire", () => {
  const result = answerQuestion("Fire neden arttı?", CONTEXT);

  it("en yuksek fireli istasyonu ve orani verir", () => {
    expect(result.text).toContain("Torna");
    expect(result.text).toContain("%3,4");
  });

  it("dogrulamayla capraz okur", () => {
    expect(result.text).toContain("sapan istasyon");
    expect(result.actions.some((action) => action.view === "validation")).toBe(true);
  });

  it("kosum yoksa veri yok der", () => {
    expect(answerQuestion("Fire neden arttı?", EMPTY).text).toBe(NO_DATA_MESSAGE);
  });
});

describe("answerQuestion — doğrulama, canlı, envanter, bağlantı", () => {
  it("dogrulama sonucunu ozetler", () => {
    const result = answerQuestion("Model ne kadar uyumlu?", CONTEXT);
    expect(result.text).toContain("%90");
    expect(result.text).toContain("3/4");
  });

  it("canli veri yoksa nedenini soyler", () => {
    const result = answerQuestion("Şu an kaç alarm var?", CONTEXT);
    expect(result.text).toBe(NO_DATA_MESSAGE);
    expect(result.reasons[0]).toContain("Canlı üretim akışı açık değil");
  });

  it("envanter verisi yoksa nedenini soyler", () => {
    const result = answerQuestion("Stok durumu nedir?", CONTEXT);
    expect(result.reasons[0]).toContain("Envanter analizi yapılmadı");
  });

  it("baglanti durumunu ozetler", () => {
    const result = answerQuestion("Bağlantılar nasıl?", CONTEXT);
    expect(result.text).toContain("3/5");
    expect(result.text).toContain("107 ms");
  });

  it("kopuk kaynak varsa soyler", () => {
    const result = answerQuestion("Veri akışı sorunlu mu?", CONTEXT);
    expect(result.text).toContain("kopuk");
  });
});

describe("answerQuestion — genel özet", () => {
  const result = answerQuestion("Fabrikam nasıl gidiyor?", CONTEXT);

  it("darbogaz, kayip ve dogrulugu birlikte ozetler", () => {
    expect(result.text).toContain("Kaynak");
    expect(result.text).toContain("₺178.772");
    expect(result.text).toContain("%90");
  });

  it("yalnizca olculmus katmanlardan kuruldugunu yazar", () => {
    expect(
      result.reasons.some((reason) => reason.includes("eksik katmanlar")),
    ).toBe(true);
  });

  it("bos baglamda veri yok der", () => {
    const answer = answerQuestion("Fabrikam nasıl?", EMPTY);
    expect(answer.text).toBe(NO_DATA_MESSAGE);
    expect(answer.actions.length).toBeGreaterThan(0);
  });
});

describe("guardrail — uydurma sayı üretilmez", () => {
  const questions = [
    "Bugünkü darboğazı açıkla.",
    "Neden kayıp oluşuyor?",
    "Hangi istasyona yatırım yapmalıyım?",
    "Fire neden arttı?",
    "Model ne kadar uyumlu?",
    "Bağlantılar nasıl?",
    "Fabrikam nasıl gidiyor?",
  ];

  for (const question of questions) {
    it(`"${question}" yanıtındaki her sayı bağlamdan gelir`, () => {
      const result = answerQuestion(question, CONTEXT);
      expect(isGrounded(result.text, CONTEXT)).toBe(true);
    });
  }

  it("bos baglamda hicbir yanit sayi icermez", () => {
    for (const question of questions) {
      expect(isGrounded(answerQuestion(question, EMPTY).text, EMPTY)).toBe(true);
    }
  });
});

describe("actionFor", () => {
  it("katmani dogru ekrana baglar", () => {
    expect(actionFor("finance", "test").view).toBe("finance");
    expect(actionFor("live", "test").view).toBe("live");
    expect(actionFor("connectors", "test").view).toBe("connectors");
  });

  it("gerekceyi tasir", () => {
    expect(actionFor("heatmap", "Isıyı görmek için.").reason).toBe(
      "Isıyı görmek için.",
    );
  });
});

describe("RuleBasedProvider", () => {
  const provider = new RuleBasedProvider();

  it("yerel calisir ve anahtar istemez", () => {
    expect(provider.isAvailable).toBe(true);
    expect(provider.requiresApiKey).toBe(false);
    expect(provider.description).toContain("dışarı çıkmaz");
  });

  it("yanit uretir", async () => {
    const answer = await provider.generate({
      question: "Bugünkü darboğazı açıkla.",
      context: CONTEXT,
      nowMs: 1_700_000_000_000,
      history: [],
    });
    expect(answer.text).toContain("Kaynak");
  });

  it("saglik bilgisi verir ve ilk cagridan sonra gecikme olcer", async () => {
    expect(provider.health().status).toBe("ready");
    await provider.generate({
      question: "Kayıp nerede?",
      context: CONTEXT,
      nowMs: 1,
      history: [],
    });
    expect(provider.health().latencyMs).not.toBeNull();
  });

  it("kendi kotasi yoktur", () => {
    expect(provider.quota()).toBeNull();
  });
});
