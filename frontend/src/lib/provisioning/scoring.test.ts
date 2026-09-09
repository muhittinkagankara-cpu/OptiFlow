/**
 * Eşleme sihirbazı 2.0 testleri: güven puanı ve geri alma.
 *
 * Savunulan kural: **puan bir olasılık değildir.** Kaç kanıta dayandığını
 * söyler; "%80 ihtimalle doğru" demek, ölçülmemiş bir sayı uydurmak olurdu.
 */

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LABEL,
  INITIAL_WIZARD,
  MAX_EVIDENCE,
  MIN_APPLY_SCORE,
  blockedReason,
  scoreAll,
  scoreLabel,
  scoreSuggestion,
  scoreTone,
  setMapping,
  suggestedCount,
  toggleTag,
  typeMatches,
  undoSuggestions,
  type DiscoveredTag,
  type TagKind,
  type TagSuggestion,
} from "./index";

function etiket(address: string, kind: TagKind = "counter"): DiscoveredTag {
  return {
    address,
    name: address,
    kind,
    kindLabel: "Sayaç",
    value: 1,
    unit: null,
    dataType: "int",
  };
}

function oneri(
  address: string,
  machineId: string | null,
  metric: string | null,
): TagSuggestion {
  return { address, machineId, metric };
}

describe("tür uyumu", () => {
  it("sayaç sayısal ölçüme uyar", () => {
    expect(typeMatches("counter", "production_count")).toBe(true);
  });

  it("ölçüm sayısal ölçüme uyar", () => {
    expect(typeMatches("gauge", "queue_length")).toBe(true);
  });

  it("metin sayısal ölçüme uymaz", () => {
    expect(typeMatches("text", "production_count")).toBe(false);
  });

  it("metin durum ölçümüne uyar", () => {
    expect(typeMatches("text", "status")).toBe(true);
  });

  it("mantıksal durum ölçümüne uyar", () => {
    expect(typeMatches("boolean", "status")).toBe(true);
  });

  it("bilinmeyen tür uymuş sayılmaz", () => {
    // Değer okunamadığında uyum bir varsayımdır, kanıt değil.
    expect(typeMatches("unknown", "production_count")).toBe(false);
  });

  it("ölçümsüz uyum yok", () => {
    expect(typeMatches("counter", null)).toBe(false);
  });

  it("tanınmayan ölçüm uymaz", () => {
    expect(typeMatches("counter", "bilinmeyen")).toBe(false);
  });
});

describe("güven puanı", () => {
  it("üç kanıtlı öneri", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", "FREZE_01", "production_count"));
    expect(puan.score).toBe(MAX_EVIDENCE);
  });

  it("üç kanıtlı öneri eksiksiz", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", "FREZE_01", "production_count"));
    expect(puan.complete).toBe(true);
  });

  it("makinesiz öneri iki kanıt", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", null, "production_count"));
    expect(puan.score).toBe(2);
  });

  it("makinesiz öneri eksiksiz değil", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", null, "production_count"));
    expect(puan.complete).toBe(false);
  });

  it("bilinmeyen türde tür kanıtı yok", () => {
    const puan = scoreSuggestion(
      etiket("a", "unknown"),
      oneri("a", "FREZE_01", "production_count"),
    );
    expect(puan.evidence).not.toContain("type");
  });

  it("önerisiz etikette kanıt yok", () => {
    expect(scoreSuggestion(etiket("a"), undefined).score).toBe(0);
  });

  it("önerisiz etiket listeden düşmez", () => {
    // Kullanıcı o etiketin unutulduğunu sanırdı.
    expect(scoreAll([etiket("a"), etiket("b")], [])).toHaveLength(2);
  });

  it("öneriler adrese göre eşleşir", () => {
    const puanlar = scoreAll(
      [etiket("a"), etiket("b")],
      [oneri("b", "FREZE_01", "production_count")],
    );
    expect(puanlar[1].machineId).toBe("FREZE_01");
  });

  it("her kanıtın etiketi var", () => {
    expect(Object.keys(EVIDENCE_LABEL)).toHaveLength(MAX_EVIDENCE);
  });

  it("puan kesir olarak yazılır", () => {
    // Yüzde yazılsaydı, bir olasılık gibi okunurdu.
    expect(scoreLabel(2)).toBe("2/3 kanıt");
  });

  it("tam puan yeşil", () => {
    expect(scoreTone(3)).toBe("good");
  });

  it("uygulama eşiği sarı", () => {
    expect(scoreTone(MIN_APPLY_SCORE)).toBe("warning");
  });

  it("tek kanıt nötr", () => {
    // Tek kanıtlı bir öneriyi yeşil göstermek, incelemeden kabule yol açardı.
    expect(scoreTone(1)).toBe("neutral");
  });
});

describe("engelleme nedeni", () => {
  it("eksiksiz öneride neden yok", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", "FREZE_01", "production_count"));
    expect(blockedReason(puan)).toBeNull();
  });

  it("makinesiz öneride neden yazılır", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", null, "production_count"));
    expect(blockedReason(puan)).toContain("Makine adı");
  });

  it("ölçümsüz öneride neden yazılır", () => {
    const puan = scoreSuggestion(etiket("a"), oneri("a", "FREZE_01", null));
    expect(blockedReason(puan)).toContain("Ölçüm adı");
  });

  it("hiçbir şey çıkarılamadıysa söylenir", () => {
    expect(blockedReason(scoreSuggestion(etiket("a"), undefined))).toContain(
      "ne makine ne de ölçüm",
    );
  });

  it("tek kanıtlı öneride elle onay istenir", () => {
    const puan = scoreSuggestion(
      etiket("a", "unknown"),
      oneri("a", "FREZE_01", null),
    );
    expect(blockedReason(puan)).toContain("Ölçüm adı");
  });
});

describe("geri alma", () => {
  it("öneriden gelen eşleme sayılır", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "M1", "production_count", "suggestion");
    expect(suggestedCount(state)).toBe(1);
  });

  it("elle kurulan eşleme sayılmaz", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "M1", "production_count");
    expect(suggestedCount(state)).toBe(0);
  });

  it("öneriler toplu geri alınır", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "M1", "production_count", "suggestion");
    expect(undoSuggestions(state).mapping).toEqual({});
  });

  it("elle kurulanlar korunur", () => {
    // Kullanıcının kendi emeğini kaybetmesi olurdu.
    let state = toggleTag(toggleTag(INITIAL_WIZARD, "a"), "b");
    state = setMapping(state, "a", "M1", "production_count", "suggestion");
    state = setMapping(state, "b", "M2", "queue_length");
    expect(Object.keys(undoSuggestions(state).mapping)).toEqual(["b"]);
  });

  it("varsayılan kaynak elle", () => {
    const state = setMapping(INITIAL_WIZARD, "a", "M1", "production_count");
    expect(state.mapping.a.source).toBe("manual");
  });

  it("geri alma yeni nesne döner", () => {
    const state = setMapping(INITIAL_WIZARD, "a", "M1", "production_count", "suggestion");
    expect(undoSuggestions(state)).not.toBe(state);
  });
});
