/**
 * Sihirbaz mantığının testleri.
 *
 * Savunulan iki kural:
 *
 * 1. Adım atlanamaz — keşif yapılmadan eşleme ekranına düşülemez.
 * 2. Test edilmeden kaydedilemez — kaydedilmiş ama denenmemiş bir bağlantı
 *    arayüzde çalışıyormuş gibi durur.
 */

import { describe, expect, it } from "vitest";
import {
  applicableSuggestions,
  applySuggestions,
  canEnter,
  canSave,
  clearMapping,
  completeStep,
  goToStep,
  mappingList,
  pruneSelection,
  recordTest,
  resetWizard,
  setMapping,
  stepIndex,
  toggleTag,
  unmappedTags,
  unresolvedSuggestions,
} from "./wizard";
import { INITIAL_WIZARD, type DiscoveredTag, type WizardState } from "./types";

function tag(address: string): DiscoveredTag {
  return {
    address,
    name: address,
    kind: "gauge",
    kindLabel: "Ölçüm",
    value: 1,
    unit: null,
    dataType: "int",
  };
}

/** Test adımına kadar ilerlemiş bir sihirbaz. */
function advanced(): WizardState {
  let state: WizardState = INITIAL_WIZARD;
  for (const step of ["endpoint", "discovery", "tags", "mapping", "test"] as const) {
    state = completeStep(state, step);
  }
  return state;
}

describe("adım sırası", () => {
  it("ilk adımın sırası sıfır", () => {
    expect(stepIndex("endpoint")).toBe(0);
  });

  it("son adımın sırası beş", () => {
    expect(stepIndex("save")).toBe(5);
  });

  it("ilk adıma girilebilir", () => {
    expect(canEnter(INITIAL_WIZARD, "endpoint")).toBe(true);
  });

  it("keşif uç adresinden önce girilemez", () => {
    expect(canEnter(INITIAL_WIZARD, "discovery")).toBe(false);
  });

  it("eşleme atlanamaz", () => {
    // Atlamaya izin verilseydi, kullanıcı boş bir listeyle karşılaşırdı.
    expect(canEnter(INITIAL_WIZARD, "mapping")).toBe(false);
  });

  it("tamamlanan adımdan sonra sıradakine girilebilir", () => {
    expect(canEnter(completeStep(INITIAL_WIZARD, "endpoint"), "discovery")).toBe(true);
  });
});

describe("adım tamamlama", () => {
  it("tamamlanan adım listeye girer", () => {
    expect(completeStep(INITIAL_WIZARD, "endpoint").completed).toEqual(["endpoint"]);
  });

  it("sıradaki adıma geçilir", () => {
    expect(completeStep(INITIAL_WIZARD, "endpoint").step).toBe("discovery");
  });

  it("sırasız adım durumu değiştirmez", () => {
    expect(completeStep(INITIAL_WIZARD, "save")).toBe(INITIAL_WIZARD);
  });

  it("aynı adım iki kez eklenmez", () => {
    const once = completeStep(INITIAL_WIZARD, "endpoint");
    expect(completeStep(once, "endpoint").completed).toEqual(["endpoint"]);
  });

  it("son adımda kalınır", () => {
    let state = advanced();
    state = completeStep(state, "save");
    expect(state.step).toBe("save");
  });

  it("yeni nesne döner", () => {
    const next = completeStep(INITIAL_WIZARD, "endpoint");
    expect(next).not.toBe(INITIAL_WIZARD);
  });

  it("geri dönülebilir", () => {
    const state = completeStep(INITIAL_WIZARD, "endpoint");
    expect(goToStep(state, "endpoint").step).toBe("endpoint");
  });

  it("ileri atlanamaz", () => {
    expect(goToStep(INITIAL_WIZARD, "test")).toBe(INITIAL_WIZARD);
  });
});

describe("etiket seçimi", () => {
  it("etiket seçilir", () => {
    expect(toggleTag(INITIAL_WIZARD, "a").selected).toEqual(["a"]);
  });

  it("seçili etiket kaldırılır", () => {
    const state = toggleTag(INITIAL_WIZARD, "a");
    expect(toggleTag(state, "a").selected).toEqual([]);
  });

  it("seçimden çıkan etiketin eşlemesi düşer", () => {
    // Seçili olmayan bir adres için eşleme saklamak, kaydedilecek
    // yapılandırmaya hayalet satır eklerdi.
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "TORNA_01", "production_count");
    expect(toggleTag(state, "a").mapping).toEqual({});
  });

  it("başka etiketin eşlemesi korunur", () => {
    let state = toggleTag(toggleTag(INITIAL_WIZARD, "a"), "b");
    state = setMapping(state, "b", "TORNA_01", "production_count");
    expect(Object.keys(toggleTag(state, "a").mapping)).toEqual(["b"]);
  });
});

describe("eşleme", () => {
  it("eşleme kurulur", () => {
    const state = setMapping(INITIAL_WIZARD, "a", "TORNA_01", "production_count");
    expect(state.mapping.a.machineId).toBe("TORNA_01");
  });

  it("eşleme kaldırılır", () => {
    const state = setMapping(INITIAL_WIZARD, "a", "TORNA_01", "production_count");
    expect(clearMapping(state, "a").mapping).toEqual({});
  });

  it("eşlemesiz seçili etiket bildirilir", () => {
    expect(unmappedTags(toggleTag(INITIAL_WIZARD, "a"))).toEqual(["a"]);
  });

  it("eşlenmiş etiket bildirilmez", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "TORNA_01", "production_count");
    expect(unmappedTags(state)).toEqual([]);
  });

  it("eşlemeler adres sırasına göre listelenir", () => {
    let state = setMapping(INITIAL_WIZARD, "b", "X", "m");
    state = setMapping(state, "a", "X", "m");
    expect(mappingList(state).map((item) => item.address)).toEqual(["a", "b"]);
  });
});

describe("öneriler", () => {
  const suggestions = [
    { address: "a", machineId: "TORNA_01", metric: "production_count" },
    { address: "b", machineId: null, metric: "production_count" },
    { address: "c", machineId: "TORNA_02", metric: null },
  ];

  it("seçili ve eksiksiz öneri uygulanır", () => {
    const state = applySuggestions(toggleTag(INITIAL_WIZARD, "a"), suggestions);
    expect(state.mapping.a.metric).toBe("production_count");
  });

  it("seçili olmayan öneri uygulanmaz", () => {
    expect(applySuggestions(INITIAL_WIZARD, suggestions).mapping).toEqual({});
  });

  it("makinesi belirsiz öneri uygulanmaz", () => {
    // Eksik bir öneriyi yarım uygulamak, makinesi belirsiz bir metrik
    // yazmak olurdu.
    const state = applySuggestions(toggleTag(INITIAL_WIZARD, "b"), suggestions);
    expect(state.mapping).toEqual({});
  });

  it("metriği belirsiz öneri uygulanmaz", () => {
    const state = applySuggestions(toggleTag(INITIAL_WIZARD, "c"), suggestions);
    expect(state.mapping).toEqual({});
  });

  it("uygulanabilir öneri sayılır", () => {
    expect(applicableSuggestions(toggleTag(INITIAL_WIZARD, "a"), suggestions)).toHaveLength(1);
  });

  it("seçili olmayan öneri uygulanabilir sayılmaz", () => {
    expect(applicableSuggestions(INITIAL_WIZARD, suggestions)).toEqual([]);
  });

  it("eksik öneri çözülemeyen olarak bildirilir", () => {
    // Sessiz kalmak, düğmenin bozuk olduğu izlenimi verirdi; tarayıcıda
    // tam olarak böyle göründü.
    const state = toggleTag(toggleTag(INITIAL_WIZARD, "b"), "c");
    expect(unresolvedSuggestions(state, suggestions)).toHaveLength(2);
  });

  it("eksiksiz öneri çözülemeyen sayılmaz", () => {
    expect(unresolvedSuggestions(toggleTag(INITIAL_WIZARD, "a"), suggestions)).toEqual([]);
  });

  it("eşlenmiş etiket ikinci kez uygulanabilir sayılmaz", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "ELLE", "queue_length");
    expect(applicableSuggestions(state, suggestions)).toEqual([]);
  });

  it("elle kurulan eşleme ezilmez", () => {
    let state = toggleTag(INITIAL_WIZARD, "a");
    state = setMapping(state, "a", "ELLE", "queue_length");
    expect(applySuggestions(state, suggestions).mapping.a.machineId).toBe("ELLE");
  });
});

describe("test ve kayıt", () => {
  it("test yapılmadan sonuç null", () => {
    expect(INITIAL_WIZARD.testOk).toBeNull();
  });

  it("test sonucu kaydedilir", () => {
    expect(recordTest(INITIAL_WIZARD, true, "bağlandı").testOk).toBe(true);
  });

  it("test ayrıntısı kaydedilir", () => {
    expect(recordTest(INITIAL_WIZARD, false, "reddedildi").testDetail).toBe("reddedildi");
  });

  it("test edilmeden kaydedilemez", () => {
    expect(canSave(advanced())).toBe(false);
  });

  it("başarısız testten sonra kaydedilemez", () => {
    // Çalışmayan bir bağlantıyı listeye "kurulu" diye eklemek olurdu.
    expect(canSave(recordTest(advanced(), false, "reddedildi"))).toBe(false);
  });

  it("başarılı testten sonra kaydedilir", () => {
    expect(canSave(recordTest(advanced(), true, "bağlandı"))).toBe(true);
  });

  it("test adımı tamamlanmadan kaydedilemez", () => {
    expect(canSave(recordTest(INITIAL_WIZARD, true, "bağlandı"))).toBe(false);
  });
});

describe("seçim budama", () => {
  it("cihazda olmayan seçim düşer", () => {
    // Kaydedilecek yapılandırma cihazda bulunmayan bir düğüme işaret ederdi.
    const state = toggleTag(toggleTag(INITIAL_WIZARD, "a"), "b");
    expect(pruneSelection(state, [tag("a")]).selected).toEqual(["a"]);
  });

  it("düşen seçimin eşlemesi de silinir", () => {
    let state = toggleTag(INITIAL_WIZARD, "b");
    state = setMapping(state, "b", "X", "m");
    expect(pruneSelection(state, [tag("a")]).mapping).toEqual({});
  });

  it("değişiklik yoksa aynı nesne döner", () => {
    const state = toggleTag(INITIAL_WIZARD, "a");
    expect(pruneSelection(state, [tag("a")])).toBe(state);
  });

  it("sıfırlama seçimi temizler", () => {
    // Önceki uçun etiketleri taşınsaydı, başka bir cihazın düğümleri yeni
    // cihaza eşlenmiş olurdu.
    expect(resetWizard().selected).toEqual([]);
  });

  it("sıfırlama ilk adıma döner", () => {
    expect(resetWizard().step).toBe("endpoint");
  });

  it("sıfırlama test sonucunu siler", () => {
    expect(resetWizard().testOk).toBeNull();
  });
});
