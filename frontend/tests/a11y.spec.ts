/**
 * Erişilebilirlik kapıları — axe-core (Sprint 2M).
 *
 * "Erişilebilir" demek ölçmeden yazılamaz. Bu dosya kontrastı, aria
 * etiketlerini, başlık hiyerarşisini, landmark'ları ve düğme rollerini gerçek
 * bir tarayıcıda ölçer.
 *
 * Kapı iki kademeli:
 *
 * 1. **critical** her zaman sıfır olmalı. Bu kademe tartışmaya kapalı.
 * 2. **serious** için yalnızca aşağıda **gerekçesiyle** listelenen kural
 *    kimlikleri kabul edilir. Yeni bir tür serious ihlal eklenirse test düşer.
 *
 * Neden sayı değil de kural kimliği sabitlendi: düğüm sayısı ekrandaki canlı
 * veriye göre değişiyor (canlı üretimde istasyon sayısı, finansta satır
 * sayısı). Sayıya bağlanan bir kapı, hiçbir şey bozulmadan kırmızıya döner ve
 * kısa sürede görmezden gelinen bir kapıya dönüşür.
 *
 * Ölçülen borç (2026-09-17, 1440px):
 *   Dashboard  color-contrast 18
 *   Raporlar   color-contrast 1
 *   Simülasyon color-contrast 12
 *   Canlı      color-contrast 24, scrollable-region-focusable 1
 *   Finans     color-contrast 1, nested-interactive 4
 *   Operatör   temiz
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { SCREENS, enterDemo, gotoScreen, settle, type ScreenId } from "./helpers";

/** Ölçüm bu genişlikte yapılır; mobil düzen ayrı bir sprintin konusu. */
const GENISLIK = { width: 1440, height: 900 };

/**
 * Kabul edilen serious ihlaller ve **neden** henüz kapatılmadıkları.
 *
 * Hiçbiri "önemsiz" olduğu için burada değil; her biri kapatılması ürün
 * sahibinin kararını gerektiren bir işe bağlı.
 */
const KABUL_EDILEN_SERIOUS: Record<string, string> = {
  "color-contrast":
    "Kalan ihlallerin çekirdeği `--of-cc-ink-label` (#6b7685) tokenıdır; 10-11px " +
    "metinde 3.93-4.16 oranı veriyor, AA 4.5 istiyor. Bu bir kanonik V4 tokenı " +
    "(MASTER §3.8.1) ve değiştirmek paleti değiştirmek demek — anayasa bunu " +
    "açıkça yasaklıyor. Palet ile WCAG AA arasındaki bu çakışmayı ürün sahibi " +
    "karara bağlamalı. Kenar çubuğundan gelen kısım 2M'de zaten düzeltildi " +
    "(her ekranda 5 düğüm eksildi).",
  "scrollable-region-focusable":
    "Canlı üretimde kaydırılabilir bir bölge klavyeyle odaklanamıyor. " +
    "Düzeltmesi küçük (tabindex) ama kaydırma davranışını değiştirdiği için " +
    "ayrı ölçüm ister; 2M görsel/ölçüm sprinti, davranış sprinti değil.",
  "nested-interactive":
    "React Flow istasyon düğümleri odaklanabilir çocuk taşıyor. Düzeltmek " +
    "üçüncü taraf düğüm işaretlemesine dokunmak demek ve tuval etkileşimini " +
    "bozma riski taşıyor — runtime davranışı bu sprintin kapsamı dışında.",
};

function ozet(ihlaller: { id: string; impact?: string | null; nodes: unknown[] }[]) {
  return ihlaller.map(
    (v) => `${v.impact ?? "bilinmiyor"}: ${v.id} (${v.nodes.length} düğüm)`,
  );
}

for (const screen of Object.keys(SCREENS) as ScreenId[]) {
  test(`${SCREENS[screen]} — axe`, async ({ page }) => {
    await page.setViewportSize(GENISLIK);
    await enterDemo(page);
    await gotoScreen(page, screen);
    await settle(page);

    const sonuc = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // 1. kademe: critical tartışmaya kapalı.
    const kritik = sonuc.violations.filter((v) => v.impact === "critical");
    expect(ozet(kritik), `${SCREENS[screen]} critical ihlaller`).toEqual([]);

    // 2. kademe: yalnızca gerekçesi yazılı serious türleri kabul edilir.
    const yeniSerious = sonuc.violations
      .filter((v) => v.impact === "serious")
      .filter((v) => !(v.id in KABUL_EDILEN_SERIOUS));
    expect(
      ozet(yeniSerious),
      `${SCREENS[screen]} — gerekçesi yazılmamış yeni serious ihlal`,
    ).toEqual([]);
  });
}

test.describe("kabul edilen borcun gerekçesi yazılıdır", () => {
  test("her muafiyet neden kapatılmadığını söyler", () => {
    // Gerekcesiz muafiyet, kurali sessizce kaldirmanin kolay yolu olurdu.
    for (const [id, gerekce] of Object.entries(KABUL_EDILEN_SERIOUS)) {
      expect(id.length, "kural kimliği").toBeGreaterThan(3);
      expect(gerekce.length, `${id} gerekçesi`).toBeGreaterThan(80);
    }
  });

  test("borç listesi büyümedi", () => {
    /*
     * Üç madde ölçülerek bulundu. Listenin uzaması, bir sonraki sprintin
     * borcu kapatmak yerine üstüne eklediği anlamına gelir.
     */
    expect(Object.keys(KABUL_EDILEN_SERIOUS)).toHaveLength(3);
  });
});

test.describe("klavye ile gezinme", () => {
  test("ilk sekme görünür bir odak halkası bırakır", async ({ page }) => {
    await page.setViewportSize(GENISLIK);
    await enterDemo(page);
    await settle(page);

    await page.keyboard.press("Tab");

    const odak = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        etiket: el.tagName,
        // `:focus-visible` kuralı index.css'te tek yerde duruyor ve hiçbir
        // sadeleştirmede silinmemeli.
        outline: s.outlineStyle !== "none" || s.boxShadow !== "none",
      };
    });

    expect(odak, "Tab sonrası odaklanan öğe").not.toBeNull();
    expect(odak?.outline, "odak görsel olarak işaretli").toBe(true);
  });
});
