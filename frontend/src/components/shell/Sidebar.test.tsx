/**
 * `Sidebar` render testleri (Sprint 2B).
 *
 * Sprint 2B'nin en görünür sözü şu: bağlantı ekranları menüde yedi satır
 * kaplamayı bırakıp tek bir "Bağlantılar" satırına iniyor. Bu testler o sözü
 * ve onunla birlikte bozulmaması gereken Sprint 2A davranışlarını korur.
 *
 * Render `react-dom/server` ile yapılır (proje DOM ortamı taşımıyor); tıklama
 * sınanmaz, çizilen işaretleme sınanır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "./Sidebar";
import { DEMO_NAV_ITEMS, NAV_ITEMS, type Section } from "./navigation";

const render = (active: Section, demo = false) =>
  renderToStaticMarkup(
    <Sidebar
      active={active}
      onSelect={() => {}}
      isOpen={true}
      onClose={() => {}}
      factoryName="Demo Metal Hattı"
      items={demo ? DEMO_NAV_ITEMS : undefined}
    />,
  );

/** Menüdeki madde etiketleri, çizildikleri sırayla. */
function labels(html: string): string[] {
  return [...html.matchAll(/<span class="truncate">([^<]*)</g)].map(
    (match) => match[1],
  );
}

const HIDDEN_BY_TABS = [
  "Runtime Köprüsü",
  "Cihaz Kurulumu",
  "Pilot Bağlantı",
  "Geçmiş Trendler",
  "Tanılama",
  "Operasyon",
];

describe("Bağlantı hub'ı menüde tek satır", () => {
  it("yalnızca 'Bağlantılar' görünür", () => {
    const shown = labels(render("dashboard"));
    expect(shown).toContain("Bağlantılar");
  });

  it("sekmeye dönüşen altı bölüm menüden çıkar", () => {
    const shown = labels(render("dashboard"));
    for (const label of HIDDEN_BY_TABS) {
      expect(shown).not.toContain(label);
    }
  });

  it("menüdeki madde sayısı yirmi üçten on yediye iner", () => {
    expect(NAV_ITEMS).toHaveLength(23);
    expect(labels(render("dashboard"))).toHaveLength(17);
  });

  it("bağlantı grubu başlığı hâlâ çizilir", () => {
    // Grup tek maddeye indi ama yok olmadı; başlık kaybolsaydı "Bağlantılar"
    // maddesi sahipsiz kalırdı.
    expect(render("dashboard")).toContain("Bağlantı");
  });
});

describe("Bağlantı dışındaki gezinme değişmedi", () => {
  it("bağlantı dışındaki bütün bölümler menüde durur", () => {
    const shown = labels(render("dashboard"));
    for (const item of NAV_ITEMS) {
      if (!HIDDEN_BY_TABS.includes(item.label)) {
        expect(shown).toContain(item.label);
      }
    }
  });

  it("altı grup başlığı da çizilir", () => {
    const html = render("dashboard");
    for (const label of [
      "Genel Bakış",
      "Fabrika",
      "Operasyon",
      "Bağlantı",
      "Kurulum",
      "Yönetim",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("AI Copilot gruplanmamış hâlde sonda kalır", () => {
    const shown = labels(render("dashboard"));
    expect(shown[shown.length - 1]).toBe("AI Copilot");
  });
});

describe("Aktif durum", () => {
  it("bağlantı ekranlarında 'Bağlantılar' aydınlanır", () => {
    const connection: Section[] = [
      "connectors",
      "runtime",
      "provisioning",
      "pilot",
      "trends",
      "diagnostics",
      "operations",
    ];
    for (const section of connection) {
      const html = render(section);
      const match = html.match(/aria-current="page"[\s\S]*?truncate">([^<]*)</);
      expect(match?.[1]).toBe("Bağlantılar");
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it("bağlantı dışındaki bölüm kendini aydınlatır", () => {
    const html = render("finance");
    const match = html.match(/aria-current="page"[\s\S]*?truncate">([^<]*)</);
    expect(match?.[1]).toBe("Finans");
  });
});

describe("Demo modu bozulmadı", () => {
  it("demo menüsü yedi maddede kalır", () => {
    expect(labels(render("dashboard", true))).toHaveLength(
      DEMO_NAV_ITEMS.length,
    );
  });

  it("demo menüsünde boş grup başlığı çizilmez", () => {
    const html = render("dashboard", true);
    expect(html).toContain("Genel Bakış");
    expect(html).not.toContain("Kurulum");
    expect(html).not.toContain("Yönetim");
  });
});
