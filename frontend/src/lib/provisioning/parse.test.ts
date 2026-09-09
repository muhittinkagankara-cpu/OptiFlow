/**
 * Keşif ayrıştırıcısının ve metinlerinin testleri.
 *
 * Savunulan kural: sunucu boş bir etiket listesi gönderdiyse arayüz de boş
 * gösterir. Örnek etiket üretmek, kullanıcının olmayan bir düğümü eşlemesine
 * ve hatanın ancak üretimde çıkmasına yol açardı.
 */

import { describe, expect, it } from "vitest";
import {
  parseChanged,
  parseCredentialTest,
  parseDiscovery,
  parseFingerprint,
  parseStep,
  parseSuggestions,
  parseTag,
  parseTagKind,
  parseTagValue,
  parseTags,
} from "./parse";
import {
  authLabel,
  credentialCaption,
  deviceChangeWarning,
  discoveryCaption,
  formatLatency,
  stepLabel,
  suggestionOutcome,
  tagValue,
  unmappedWarning,
} from "./format";
import { NOT_MEASURED, NO_DISCOVERY, type DiscoveryResult } from "./index";

function discovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    ...NO_DISCOVERY,
    ok: true,
    endpoint: "http://cihaz/veri",
    tagCount: 3,
    detail: "Uç yanıt verdi",
    latencyMs: 42,
    ...overrides,
  };
}

describe("etiket türü", () => {
  it("tanınan tür geçer", () => {
    expect(parseTagKind("counter")).toBe("counter");
  });

  it("tanınmayan tür bilinmiyor olur", () => {
    // Sayaç varsayılsaydı, bir metin alanı grafiğe konurdu.
    expect(parseTagKind("sayaç")).toBe("unknown");
  });

  it("eksik tür bilinmiyor olur", () => {
    expect(parseTagKind(undefined)).toBe("unknown");
  });
});

describe("etiket değeri", () => {
  it("sayı korunur", () => {
    expect(parseTagValue(42)).toBe(42);
  });

  it("sıfır korunur", () => {
    expect(parseTagValue(0)).toBe(0);
  });

  it("metin korunur", () => {
    expect(parseTagValue("OK")).toBe("OK");
  });

  it("mantıksal değer korunur", () => {
    expect(parseTagValue(false)).toBe(false);
  });

  it("nesne null olur", () => {
    // Nesneyi metne çevirmek `[object Object]` göstermek olurdu.
    expect(parseTagValue({ a: 1 })).toBeNull();
  });

  it("sonsuz null olur", () => {
    expect(parseTagValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("etiket", () => {
  it("adres okunur", () => {
    expect(parseTag({ address: "ns=2;i=5" }).address).toBe("ns=2;i=5");
  });

  it("ad yoksa adres kullanılır", () => {
    expect(parseTag({ address: "ns=2;i=5" }).name).toBe("ns=2;i=5");
  });

  it("ad okunur", () => {
    expect(parseTag({ address: "a", name: "Üretim" }).name).toBe("Üretim");
  });

  it("tür etiketi türetilir", () => {
    expect(parseTag({ address: "a", kind: "counter" }).kindLabel).toBe("Sayaç");
  });

  it("okunamayan değer null", () => {
    expect(parseTag({ address: "a" }).value).toBeNull();
  });

  it("adressiz etiket listeden düşer", () => {
    expect(parseTags([{ name: "Üretim" }])).toEqual([]);
  });

  it("dizi olmayan liste boş", () => {
    expect(parseTags("yok")).toEqual([]);
  });
});

describe("öneriler", () => {
  it("öneri okunur", () => {
    const found = parseSuggestions([{ address: "a", machine_id: "T1", metric: "m" }]);
    expect(found[0].machineId).toBe("T1");
  });

  it("anlaşılamayan makine null kalır", () => {
    // Rastgele bir makineye atanması, başka bir hattın üretimini bozardı.
    expect(parseSuggestions([{ address: "a" }])[0].machineId).toBeNull();
  });

  it("anlaşılamayan metrik null kalır", () => {
    expect(parseSuggestions([{ address: "a" }])[0].metric).toBeNull();
  });

  it("dizi olmayan öneri listesi boş", () => {
    expect(parseSuggestions(null)).toEqual([]);
  });
});

describe("parmak izi", () => {
  it("özet okunur", () => {
    expect(parseFingerprint({ digest: "abc", tag_count: 2 })?.digest).toBe("abc");
  });

  it("özeti olmayan iz null", () => {
    expect(parseFingerprint({ endpoint: "x" })).toBeNull();
  });

  it("boş gövde null", () => {
    expect(parseFingerprint(null)).toBeNull();
  });
});

describe("cihaz değişimi", () => {
  it("true okunur", () => {
    expect(parseChanged(true)).toBe(true);
  });

  it("false okunur", () => {
    expect(parseChanged(false)).toBe(false);
  });

  it("eksik alan null kalır", () => {
    // "Aynı cihaz" ile "daha önce görülmemiş" farklı bilgilerdir.
    expect(parseChanged(undefined)).toBeNull();
  });
});

describe("keşif yanıtı", () => {
  it("başarı okunur", () => {
    expect(parseDiscovery({ ok: true, detail: "x" }).ok).toBe(true);
  });

  it("başarısız keşifte etiket yok", () => {
    expect(parseDiscovery({ ok: false, detail: "bağlantı yok" }).tags).toEqual([]);
  });

  it("başarısız keşifte neden korunur", () => {
    expect(parseDiscovery({ ok: false, detail: "bağlantı yok" }).detail).toBe("bağlantı yok");
  });

  it("nedensiz yanıt için varsayılan cümle", () => {
    expect(parseDiscovery({ ok: false }).detail).toBe("Sunucu ayrıntı bildirmedi");
  });

  it("okunamayan düğümler listelenir", () => {
    expect(parseDiscovery({ ok: true, unreadable: ["a", ""] }).unreadable).toEqual(["a"]);
  });

  it("önbellek bayrağı okunur", () => {
    expect(parseDiscovery({ ok: true, cached: true }).cached).toBe(true);
  });

  it("ölçülmeyen gecikme null", () => {
    expect(parseDiscovery({ ok: true }).latencyMs).toBeNull();
  });

  it("boş gövde keşif yapılmamış sayılır", () => {
    expect(parseDiscovery(null)).toBe(NO_DISCOVERY);
  });

  it("etiket sayısı listeden türetilir", () => {
    const found = parseDiscovery({ ok: true, tags: [{ address: "a" }] });
    expect(found.tagCount).toBe(1);
  });
});

describe("kimlik denemesi", () => {
  it("başarı okunur", () => {
    expect(parseCredentialTest({ ok: true, detail: "açıldı" }).ok).toBe(true);
  });

  it("kullanıcı adı okunur", () => {
    expect(parseCredentialTest({ username: "opc" }).username).toBe("opc");
  });

  it("anonim denemede kullanıcı null", () => {
    expect(parseCredentialTest({}).username).toBeNull();
  });

  it("kimlik gerekliliği bilinmiyorsa null", () => {
    // `false` demek "gerekmiyor" iddiasında bulunmak olurdu.
    expect(parseCredentialTest({}).requiresAuth).toBeNull();
  });

  it("ölçülmeyen gecikme null", () => {
    expect(parseCredentialTest({}).latencyMs).toBeNull();
  });
});

describe("adım kimliği", () => {
  it("tanınan adım geçer", () => {
    expect(parseStep("mapping")).toBe("mapping");
  });

  it("tanınmayan adım null", () => {
    expect(parseStep("bitir")).toBeNull();
  });

  it("adım etiketi Türkçe", () => {
    expect(stepLabel("discovery")).toBe("Keşif");
  });
});

describe("metinler", () => {
  it("ölçülmeyen gecikme tire", () => {
    expect(formatLatency(null)).toBe(NOT_MEASURED);
  });

  it("gecikme yuvarlanır", () => {
    expect(formatLatency(42.6)).toBe("43 ms");
  });

  it("okunamayan etiket değeri tire", () => {
    expect(tagValue({ ...parseTag({ address: "a" }) })).toBe(NOT_MEASURED);
  });

  it("mantıksal değer Türkçe yazılır", () => {
    expect(tagValue(parseTag({ address: "a", value: true }))).toBe("Açık");
  });

  it("sayısal değer biçimlenir", () => {
    expect(tagValue(parseTag({ address: "a", value: 1234.5 }))).toBe("1.234,5");
  });

  it("başarısız keşifte neden gösterilir", () => {
    expect(discoveryCaption(discovery({ ok: false, detail: "port kapalı" }))).toBe(
      "port kapalı",
    );
  });

  it("başarılı keşifte etiket sayısı yazılır", () => {
    expect(discoveryCaption(discovery())).toContain("3 etiket bulundu");
  });

  it("önbellekten geldiği söylenir", () => {
    expect(discoveryCaption(discovery({ cached: true }))).toContain("önbellekten");
  });

  it("okunamayan düğümler söylenir", () => {
    expect(discoveryCaption(discovery({ unreadable: ["a"] }))).toContain("1 düğüm okunamadı");
  });

  it("ilk kurulumda cihaz değişimi uyarısı yok", () => {
    expect(deviceChangeWarning(discovery())).toBeNull();
  });

  it("aynı cihazda uyarı yok", () => {
    expect(deviceChangeWarning(discovery({ deviceChanged: false }))).toBeNull();
  });

  it("cihaz değiştiyse uyarılır", () => {
    expect(deviceChangeWarning(discovery({ deviceChanged: true }))).toContain("farklı");
  });

  it("kimlik cümlesi gecikmeyi taşır", () => {
    const test = parseCredentialTest({ ok: true, detail: "açıldı", latency_ms: 12 });
    expect(credentialCaption(test)).toContain("12 ms");
  });

  it("bilinmeyen kimlik gerekliliği tire", () => {
    expect(authLabel(null)).toBe(NOT_MEASURED);
  });

  it("kimlikli deneme adlandırılır", () => {
    expect(authLabel(true)).toBe("Kimlik bilgisi ile");
  });

  it("anonim deneme adlandırılır", () => {
    expect(authLabel(false)).toBe("Anonim");
  });

  it("hepsi eşlenmişse uyarı yok", () => {
    expect(unmappedWarning([])).toBeNull();
  });

  it("eşlenmemiş etiket uyarılır", () => {
    expect(unmappedWarning(["a", "b"])).toContain("2 etiketin eşlemesi yok");
  });

  it("uygulanacak öneri yoksa nedeni yazılır", () => {
    expect(suggestionOutcome(0, 0)).toContain("zaten kurulu");
  });

  it("hiç uygulanamadıysa makine sorunu söylenir", () => {
    // Düğmenin sessiz kalması, bozuk olduğu izlenimi verirdi.
    expect(suggestionOutcome(0, 2)).toContain("makine adı adresten çıkarılamadı");
  });

  it("hepsi uygulandıysa sayı yazılır", () => {
    expect(suggestionOutcome(3, 0)).toBe("3 eşleme önerilerden kuruldu.");
  });

  it("kısmi uygulamada iki sayı da yazılır", () => {
    const text = suggestionOutcome(2, 1);
    expect(text).toContain("2 eşleme kuruldu");
    expect(text).toContain("1 etiket");
  });
});
