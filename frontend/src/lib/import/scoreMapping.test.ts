import { describe, expect, it } from "vitest";
import {
  RuleBasedProvider,
  confidenceOf,
  mappingFromSuggestions,
  normalizeHeader,
  scoreColumnForField,
  scoreMapping,
} from "./scoreMapping";
import { fieldById } from "./types";
import type { DetectedColumn, FieldId } from "./types";

function column(
  index: number,
  header: string,
  kind: DetectedColumn["kind"] = "number",
): DetectedColumn {
  return { index, header, kind, samples: [], filledCount: 5 };
}

/** Bir alanın hangi kolona önerildiğini kısaca okur. */
function pick(columns: DetectedColumn[], fieldId: FieldId) {
  return scoreMapping(columns).find((item) => item.fieldId === fieldId);
}

describe("normalizeHeader", () => {
  it("Turkce harfleri ASCII'ye cevirir", () => {
    expect(normalizeHeader("Çevrim Süresi")).toBe("cevrim suresi");
    expect(normalizeHeader("İSTASYON")).toBe("istasyon");
  });

  it("birim eklerini atar", () => {
    // "Çevrim Süresi (dk)" ile "Cevrim Suresi" ayni kolondur.
    expect(normalizeHeader("Çevrim Süresi (dk)")).toBe("cevrim suresi");
    expect(normalizeHeader("Cycle Time [min]")).toBe("cycle time");
  });

  it("noktalama ve alt cizgiyi bosluga cevirir", () => {
    expect(normalizeHeader("CYCLE_TIME")).toBe("cycle time");
    expect(normalizeHeader("Oper.")).toBe("oper");
  });
});

describe("confidenceOf", () => {
  it("skoru uc bandda sinifllandirir", () => {
    expect(confidenceOf(0.95)).toBe("high");
    expect(confidenceOf(0.6)).toBe("medium");
    expect(confidenceOf(0.35)).toBe("low");
  });
});

describe("scoreColumnForField", () => {
  it("tam eslesmeye en yuksek puani verir", () => {
    const result = scoreColumnForField(column(0, "Cycle Time"), fieldById("cycleTime"));
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it("tur uyumsuzlugunu eler degil, azaltir", () => {
    // Metin gorunen bir "Makine" kolonu ("2 adet") yine aday kalmali.
    const asNumber = scoreColumnForField(column(0, "Makine"), fieldById("machines"));
    const asText = scoreColumnForField(
      column(0, "Makine", "text"),
      fieldById("machines"),
    );
    expect(asText.score).toBeGreaterThan(0);
    expect(asText.score).toBeLessThan(asNumber.score);
  });

  it("bos kolonu cezalandirir", () => {
    const empty = scoreColumnForField(
      column(0, "Cycle Time", "empty"),
      fieldById("cycleTime"),
    );
    const filled = scoreColumnForField(column(0, "Cycle Time"), fieldById("cycleTime"));
    expect(empty.score).toBeLessThan(filled.score);
  });

  it("alakasiz baslikta sifir doner", () => {
    expect(scoreColumnForField(column(0, "Renk"), fieldById("cycleTime")).score).toBe(0);
  });

  it("kisa kisaltmalari alt dize olarak aramaz", () => {
    // "ct" ⊂ "action" — alt dize aramasi yanlis eslesme uretirdi.
    expect(scoreColumnForField(column(0, "Action"), fieldById("cycleTime")).score).toBe(
      0,
    );
  });
});

describe("scoreMapping — Ingilizce kolonlar", () => {
  const columns = [
    column(0, "Station Name", "text"),
    column(1, "Cycle Time"),
    column(2, "Machine"),
    column(3, "Operator"),
    column(4, "Scrap Rate"),
  ];

  it("her alani dogru kolona esler", () => {
    expect(pick(columns, "station")?.columnIndex).toBe(0);
    expect(pick(columns, "cycleTime")?.columnIndex).toBe(1);
    expect(pick(columns, "machines")?.columnIndex).toBe(2);
    expect(pick(columns, "operators")?.columnIndex).toBe(3);
    expect(pick(columns, "scrap")?.columnIndex).toBe(4);
  });

  it("tam eslesmelerde guven yuksektir", () => {
    expect(pick(columns, "cycleTime")?.confidence).toBe("high");
  });
});

describe("scoreMapping — Turkce kolonlar", () => {
  const columns = [
    column(0, "İstasyon", "text"),
    column(1, "Çevrim Süresi (dk)"),
    column(2, "Makine Sayısı"),
    column(3, "Hurda Oranı"),
    column(4, "Tampon"),
  ];

  it("Turkce basliklari tanir", () => {
    expect(pick(columns, "station")?.columnIndex).toBe(0);
    expect(pick(columns, "cycleTime")?.columnIndex).toBe(1);
    expect(pick(columns, "machines")?.columnIndex).toBe(2);
    expect(pick(columns, "scrap")?.columnIndex).toBe(3);
    expect(pick(columns, "buffer")?.columnIndex).toBe(4);
  });
});

describe("scoreMapping — kisaltmalar", () => {
  it("CT, Mak ve Oper. kisaltmalarini cozer", () => {
    const columns = [
      column(0, "İstasyon", "text"),
      column(1, "CT"),
      column(2, "Mak"),
      column(3, "Oper."),
    ];
    expect(pick(columns, "cycleTime")?.columnIndex).toBe(1);
    expect(pick(columns, "machines")?.columnIndex).toBe(2);
    expect(pick(columns, "operators")?.columnIndex).toBe(3);
  });
});

describe("scoreMapping — karisik ve eksik kolonlar", () => {
  it("Turkce ve Ingilizce karisik dosyayi cozer", () => {
    const columns = [
      column(0, "Operasyon", "text"),
      column(1, "Cycle Time (min)"),
      column(2, "Operatör Sayısı"),
    ];
    expect(pick(columns, "station")?.columnIndex).toBe(0);
    expect(pick(columns, "cycleTime")?.columnIndex).toBe(1);
    expect(pick(columns, "operators")?.columnIndex).toBe(2);
  });

  it("bulunamayan alan icin null oneri verir", () => {
    const columns = [column(0, "İstasyon", "text"), column(1, "Cycle Time")];
    const suggestion = pick(columns, "leadTime");
    expect(suggestion?.columnIndex).toBeNull();
    expect(suggestion?.score).toBe(0);
  });

  it("hicbir kolon tanimadiginda hepsi bos doner", () => {
    const columns = [column(0, "Renk", "text"), column(1, "Ağırlık")];
    const suggestions = scoreMapping(columns);
    expect(suggestions.every((item) => item.columnIndex === null)).toBe(true);
  });

  it("bos kolon listesinde cokmez", () => {
    expect(scoreMapping([]).every((item) => item.columnIndex === null)).toBe(true);
  });
});

describe("scoreMapping — cakisma onleme", () => {
  it("ayni kolonu iki alana onermez", () => {
    // Her alan bagimsizca en iyi kolonunu secseydi, iki alan ayni kolonu
    // isteyebilir ve kullaniciya bastan cakismali bir esleştirme sunulurdu.
    const columns = [
      column(0, "Süre"),
      column(1, "İstasyon", "text"),
    ];
    const suggestions = scoreMapping(columns);
    const used = suggestions
      .map((item) => item.columnIndex)
      .filter((index): index is number => index !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it("ayni dosya her acilista ayni oneriyi verir", () => {
    const columns = [
      column(0, "İstasyon", "text"),
      column(1, "Cycle Time"),
      column(2, "Machine"),
    ];
    expect(scoreMapping(columns)).toEqual(scoreMapping(columns));
  });
});

describe("mappingFromSuggestions", () => {
  it("onerileri duzenlenebilir esleştirmeye cevirir", () => {
    const columns = [column(0, "İstasyon", "text"), column(1, "CT")];
    const mapping = mappingFromSuggestions(scoreMapping(columns));
    expect(mapping.station).toBe(0);
    expect(mapping.cycleTime).toBe(1);
  });
});

describe("RuleBasedProvider", () => {
  it("saglayici arayuzunu uygular ve ayni sonucu verir", async () => {
    const columns = [column(0, "İstasyon", "text"), column(1, "Cycle Time")];
    const provider = new RuleBasedProvider();
    expect(provider.name).toBeTruthy();
    expect(await provider.suggest(columns)).toEqual(scoreMapping(columns));
  });

  it("yapay zeka kullanmadigini aciklamasinda soyler", () => {
    expect(new RuleBasedProvider().description).toContain("yapay zekâ");
  });
});
