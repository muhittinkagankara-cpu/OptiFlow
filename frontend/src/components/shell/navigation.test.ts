/**
 * Gezinme modelinin değişmezleri (Sprint 2A).
 *
 * Bu testler görünüm değil **sözleşme** korur: menüde görünen her bölümün
 * açılabilir bir görünümü olmalı, gruplama hiçbir maddeyi düşürmemeli ve
 * Sprint 2A'nın dokunmamaya söz verdiği listeler olduğu gibi kalmalıdır.
 *
 * Bir bölümün menüden sessizce kaybolması, kullanıcı için o özelliğin yok
 * olması demektir ve tip denetimi bunu yakalamaz — dizi eksik bir elemanla da
 * geçerli bir dizidir. Aşağıdaki listeler bu yüzden elle yazılmıştır.
 */

import { describe, expect, it } from "vitest";
import {
  DEMO_NAV_ITEMS,
  NAV_GROUPS,
  NAV_ITEMS,
  SECTION_HUB,
  VIEW_TITLE,
  sectionOfView,
  type NavGroupId,
  type Section,
  type View,
} from "./navigation";

/** Sprint 2A öncesi menüdeki bölümler, sırasıyla. Bu sprintte değişmemeli. */
const NAV_ITEM_IDS: Section[] = [
  "dashboard",
  "enterprise",
  "factories",
  "machines",
  "simulation",
  "live",
  "finance",
  "inventory",
  "operator",
  "validation",
  "connectors",
  "pilot",
  "workspace",
  "runtime",
  "operations",
  "provisioning",
  "trends",
  "diagnostics",
  "sales",
  "copilot",
  "team",
  "reports",
  "settings",
];

/** Demoda gezilebilen bölümler. Bu sprintte değişmemeli. */
const DEMO_ITEM_IDS: Section[] = [
  "dashboard",
  "simulation",
  "live",
  "finance",
  "operator",
  "copilot",
  "reports",
];

/**
 * Menüye girmeyen görünümler.
 *
 * Bunlar gidilecek yerler değil, bir görevin adımlarıdır: açık bir model
 * olmadan süreç editörüne, çalıştırılmış bir koşum olmadan sonuç ekranına
 * gidilemez. Menüye eklenselerdi kullanıcı bağlamı olmayan bir ekrana düşerdi.
 */
const PROGRAMMATIC_VIEWS: View[] = [
  "editor",
  "results",
  "intelligence",
  "comparison",
  "import",
];

/** Bağlantı merkezine toplanacak bölümler. */
const CONNECTION_SECTIONS: Section[] = [
  "connectors",
  "runtime",
  "provisioning",
  "pilot",
  "trends",
  "diagnostics",
  "operations",
];

/** Bilinçli olarak hiçbir gruba girmeyen bölümler. */
const UNGROUPED: Section[] = ["copilot"];

describe("NAV_ITEMS ve DEMO_NAV_ITEMS korunuyor", () => {
  it("menüdeki bölümler ve sıraları değişmedi", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual(NAV_ITEM_IDS);
  });

  it("demo menüsü değişmedi", () => {
    expect(DEMO_NAV_ITEMS.map((item) => item.id)).toEqual(DEMO_ITEM_IDS);
  });

  it("demo menüsü tam menünün alt kümesidir", () => {
    for (const item of DEMO_NAV_ITEMS) {
      expect(NAV_ITEMS.some((entry) => entry.id === item.id)).toBe(true);
    }
  });

  it("her menü maddesinin açılabilir bir başlığı var", () => {
    for (const item of NAV_ITEMS) {
      expect(VIEW_TITLE[item.view]).toBeTruthy();
    }
  });
});

describe("NAV_GROUPS", () => {
  it("beklenen altı grubu bu sırayla içerir", () => {
    const expected: NavGroupId[] = [
      "overview",
      "factory",
      "operations",
      "connect",
      "setup",
      "admin",
    ];
    expect(NAV_GROUPS.map((group) => group.id)).toEqual(expected);
  });

  it("her grubun boş olmayan bir başlığı var", () => {
    for (const group of NAV_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.sections.length).toBeGreaterThan(0);
    }
  });

  it("yalnızca geçerli NAV_ITEMS kimlikleri kullanır", () => {
    for (const group of NAV_GROUPS) {
      for (const section of group.sections) {
        expect(NAV_ITEM_IDS).toContain(section);
      }
    }
  });

  it("hiçbir bölüm iki gruba birden girmez", () => {
    const seen = NAV_GROUPS.flatMap((group) => group.sections);
    expect(seen.length).toBe(new Set(seen).size);
  });

  it("gruplanmayan tek bölüm AI Copilot'tur", () => {
    // Copilot uzun vadede global bir çekmeceye taşınacak; bir gruba
    // zorlanmaması o taşımayı tek bir satırlık iş hâlinde bırakır.
    const grouped = new Set(NAV_GROUPS.flatMap((group) => group.sections));
    const missing = NAV_ITEM_IDS.filter((id) => !grouped.has(id));
    expect(missing).toEqual(UNGROUPED);
  });

  it("gruplama hiçbir menü maddesini düşürmez", () => {
    const grouped = NAV_GROUPS.flatMap((group) => group.sections);
    expect([...grouped, ...UNGROUPED].sort()).toEqual([...NAV_ITEM_IDS].sort());
  });

  it("programatik görünümler menü grubuna girmez", () => {
    const grouped = new Set<string>(
      NAV_GROUPS.flatMap((group) => group.sections),
    );
    for (const view of PROGRAMMATIC_VIEWS) {
      expect(grouped.has(view)).toBe(false);
    }
  });

  it("bağlantı grubu yedi bağlantı bölümünü taşır", () => {
    const connect = NAV_GROUPS.find((group) => group.id === "connect");
    expect(connect?.sections).toEqual(CONNECTION_SECTIONS);
  });

  it("pilot bağlantı grubunda, pilot kurulum kurulum grubundadır", () => {
    // İki madde menüde yan yana durduğunda adlarından ayırt edilemiyordu;
    // ayrı gruplara düşmeleri farkı görünür kılar.
    const connect = NAV_GROUPS.find((group) => group.id === "connect");
    const setup = NAV_GROUPS.find((group) => group.id === "setup");
    expect(connect?.sections).toContain("pilot");
    expect(setup?.sections).toContain("workspace");
  });
});

describe("SECTION_HUB", () => {
  it("hedefleri geçerli bölümlerdir", () => {
    for (const target of Object.values(SECTION_HUB)) {
      expect(NAV_ITEM_IDS).toContain(target as Section);
    }
  });

  it("anahtarları geçerli bölümlerdir", () => {
    for (const key of Object.keys(SECTION_HUB)) {
      expect(NAV_ITEM_IDS).toContain(key as Section);
    }
  });

  it("bağlantı merkezi kendi kendine eşlenir", () => {
    expect(SECTION_HUB.connectors).toBe("connectors");
  });

  it("yedi bağlantı bölümünün tamamı merkeze yönlenir", () => {
    for (const section of CONNECTION_SECTIONS) {
      expect(SECTION_HUB[section]).toBe("connectors");
    }
  });

  it("bağlantı dışındaki bölümler eşlenmez", () => {
    // Eşlenmemiş bölüm kendini aydınlatır; gereksiz kayıt, ileride biri
    // değiştiğinde iki yerde bakım demek olurdu.
    const mapped = Object.keys(SECTION_HUB);
    expect([...mapped].sort()).toEqual([...CONNECTION_SECTIONS].sort());
  });

  it("vurgu bölümü her zaman menüde bulunabilir bir maddedir", () => {
    for (const item of NAV_ITEMS) {
      const highlighted = SECTION_HUB[item.id] ?? item.id;
      expect(NAV_ITEMS.some((entry) => entry.id === highlighted)).toBe(true);
    }
  });
});

describe("SECTION_OF_VIEW ile tutarlılık", () => {
  it("bağlantı görünümlerinden gelen vurgu merkezde toplanır", () => {
    // Kenar çubuğunun yaptığı hesabın aynısı: gerçek bölüm bulunur, sonra
    // vurgu bölümüne çevrilir. `SECTION_OF_VIEW` bu sprintte değişmedi.
    const connectionViews: View[] = [
      "connectors",
      "runtime",
      "provisioning",
      "pilot",
      "trends",
      "diagnostics",
      "operations",
    ];
    for (const view of connectionViews) {
      const actual = sectionOfView(view);
      expect(SECTION_HUB[actual] ?? actual).toBe("connectors");
    }
  });

  it("programatik görünümler kendi üst bölümlerini korur", () => {
    expect(sectionOfView("editor")).toBe("simulation");
    expect(sectionOfView("results")).toBe("simulation");
    expect(sectionOfView("intelligence")).toBe("simulation");
    expect(sectionOfView("comparison")).toBe("simulation");
    expect(sectionOfView("import")).toBe("factories");
  });

  it("programatik görünümlerin vurgusu da menüde bir maddeye düşer", () => {
    for (const view of PROGRAMMATIC_VIEWS) {
      const actual = sectionOfView(view);
      const highlighted = SECTION_HUB[actual] ?? actual;
      expect(NAV_ITEMS.some((entry) => entry.id === highlighted)).toBe(true);
    }
  });
});
