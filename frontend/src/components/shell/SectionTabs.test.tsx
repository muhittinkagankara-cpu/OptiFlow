/**
 * `SectionTabs` render testleri (Sprint 2B).
 *
 * Render `react-dom/server` ile yapılır; projede DOM ortamı yok
 * (`environment: "node"`), yeni bağımlılık da eklenmiyor. Bu yöntem tıklamayı
 * sınayamaz ama çıkan işaretlemenin — hangi sekmeler var, hangisi seçili,
 * şerit hangi ekranlarda çiziliyor — doğruluğunu sınar.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionTabs } from "./SectionTabs";
import { NAV_ITEMS, type View } from "./navigation";

const render = (view: View) =>
  renderToStaticMarkup(<SectionTabs view={view} onSelect={() => {}} />);

const CONNECTION_VIEWS: View[] = [
  "connectors",
  "runtime",
  "provisioning",
  "pilot",
  "trends",
  "diagnostics",
  "operations",
];

/** Bir etiketin, üstünde `aria-current` taşıyan düğmeye ait olup olmadığı. */
function activeLabel(html: string): string | null {
  const match = html.match(/<button[^>]*aria-current="page"[^>]*>([^<]*)</);
  return match === null ? null : match[1];
}

describe("SectionTabs görünürlüğü", () => {
  it("bağlantı ekranlarının hepsinde çizilir", () => {
    for (const view of CONNECTION_VIEWS) {
      expect(render(view)).toContain("<nav");
    }
  });

  it("bağlantı dışındaki ekranlarda hiçbir şey çizmez", () => {
    // Şerit her ekranda görünseydi, ait olmadığı sayfalarda yer kaplayan bir
    // gezinme aleti olurdu.
    for (const view of [
      "dashboard",
      "finance",
      "live",
      "reports",
      "settings",
      "workspace",
    ] as View[]) {
      expect(render(view)).toBe("");
    }
  });

  it("programatik görünümlerde de çizilmez", () => {
    for (const view of [
      "editor",
      "results",
      "intelligence",
      "comparison",
      "import",
    ] as View[]) {
      expect(render(view)).toBe("");
    }
  });
});

describe("SectionTabs içeriği", () => {
  it("yedi sekme çizer", () => {
    const html = render("connectors");
    expect(html.match(/<button/g)).toHaveLength(7);
  });

  it("etiketleri menüdeki adlardan alır", () => {
    const html = render("connectors");
    for (const section of CONNECTION_VIEWS) {
      const item = NAV_ITEMS.find((entry) => entry.id === section);
      expect(html).toContain(item!.label);
    }
  });

  it("şeridin erişilebilir bir adı vardır", () => {
    expect(render("connectors")).toContain('aria-label="Bağlantı bölümleri"');
  });

  it("dar ekranda yana kaydırılabilir", () => {
    // Yedi sekme 375 pikselde sığmaz; kaydırılan şey şeridin kendisidir,
    // sayfa değil.
    expect(render("connectors")).toContain("overflow-x-auto");
  });
});

describe("SectionTabs aktif sekmesi", () => {
  it("her bağlantı ekranında kendi sekmesini işaretler", () => {
    for (const view of CONNECTION_VIEWS) {
      const item = NAV_ITEMS.find((entry) => entry.id === view);
      expect(activeLabel(render(view))).toBe(item!.label);
    }
  });

  it("her zaman tam olarak bir sekme seçilidir", () => {
    for (const view of CONNECTION_VIEWS) {
      const html = render(view);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  it("seçili sekme yalnızca renkle değil alt çizgiyle de işaretlenir", () => {
    // Durum tek bir sinyalle taşınmaz (MASTER §22).
    const html = render("runtime");
    expect(html).toContain("border-brand-500");
    expect(html).toContain("border-b-2");
  });
});
