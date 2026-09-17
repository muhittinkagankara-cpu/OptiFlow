/**
 * V4 anayasasının çalışma zamanı bekçileri (Sprint 2M).
 *
 * Kaynak testleri bir sınıfın yazıldığını görür; burası o sınıfın ekranda ne
 * ürettiğini ölçer. İkisi farklı şeyleri yakalar:
 *
 * - Kaynak testi, `shadow-lg` yazan birini yakalar.
 * - Bu test, üçüncü taraf bir kütüphanenin kendi stilinden gelen gölgeyi ya da
 *   `:hover` durumunda beliren bir yüzeyi yakalar — hiçbiri kaynakta yazmaz.
 *
 * Ölçüm tuzakları, oturum boyunca tek tek bulunup burada kalıcı hale getirildi;
 * yorumlar hangi yanlış ölçümün neden elendiğini anlatır.
 */

import { expect, test } from "@playwright/test";

import { SCREENS, VIEWPORTS, enterDemo, gotoScreen, settle, type ScreenId } from "./helpers";

/** Ölçülmüş durum halkaları dekoratif sayılmaz (V4 §3.8.3). */
const OLCULMUS_RENKLER = [
  "34, 197, 94", // ok
  "245, 158, 11", // uyarı
  "239, 68, 68", // arıza
  "61, 125, 255", // etkileşim
  "220, 38, 38", // darboğaz nabzı
];

/** Cam muafiyeti olan ekranlar (V4 §3.8.4 — operatör ayrı sprintin borcu). */
const CAM_MUAF: ScreenId[] = ["operator"];

/**
 * Dekoratif gölge muafiyeti.
 *
 * Operatör ekranı bir telefon çerçevesi içinde render ediliyor ve o çerçeve
 * `md:shadow-xl` taşıyor (`OperatorApp.tsx:227`). Bu gölge bir yüzeyi
 * süslemiyor, bir **cihazı** çiziyor — ve daha önemlisi bu daldan önce
 * geliyor: `git log -L` ölçümü `b702eec` diyor. Operatör V4 göçüne hiç
 * girmedi; kendi primitif ailesini kullanıyor.
 *
 * Muafiyet kaldırılacaksa çerçevenin kasıtlı mı yoksa artık mı olduğu bir
 * ürün kararıdır; testi susturmak o kararı vermez, yalnızca gizler.
 */
const GOLGE_MUAF: ScreenId[] = ["operator"];

async function olc(page: import("@playwright/test").Page) {
  return page.evaluate((olculmus) => {
    /*
     * Bir gölge ancak EN AZ BİR katmanı görünür renkteyse dekoratiftir.
     * Tailwind `shadow-none` ve `shadow-sm` bu projede tümü saydam katmanlara
     * çözülüyor; `boxShadow !== "none"` demek, sekiz sahte bulgu üretmişti.
     */
    const gorunur = (b: string) => {
      if (!b || b === "none") return false;
      const renkler = b.match(/rgba?\([^)]+\)/g) ?? [];
      return renkler.some((c) => {
        const m = c.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
        return m ? parseFloat(m[1]) > 0.01 : true;
      });
    };

    const hepsi = Array.from(document.querySelectorAll("*"));
    const golgeli = hepsi.filter((e) => gorunur(getComputedStyle(e).boxShadow));
    const dekoratif = golgeli.filter((e) => {
      const b = getComputedStyle(e).boxShadow;
      return !olculmus.some((renk) => b.includes(renk));
    });

    return {
      bodyTasma: Math.max(0, document.body.scrollWidth - window.innerWidth),
      docTasma: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth,
      ),
      dekoratifGolge: dekoratif.map(
        (e) =>
          `${e.tagName}.${String((e as HTMLElement).className ?? "").slice(0, 60)}`,
      ),
      cssGradient: hepsi.filter((e) =>
        /gradient/.test(getComputedStyle(e).backgroundImage),
      ).length,
      svgGradient: document.querySelectorAll("linearGradient, radialGradient")
        .length,
      cam: hepsi.filter((e) => getComputedStyle(e).backdropFilter !== "none")
        .length,
    };
  }, OLCULMUS_RENKLER);
}

for (const screen of Object.keys(SCREENS) as ScreenId[]) {
  test.describe(`${SCREENS[screen]} — V4 kuralları`, () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.ad}px`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await enterDemo(page);
        await gotoScreen(page, screen);
        await settle(page);

        const o = await olc(page);

        // V4: hiçbir genişlikte yatay sayfa kaydırması yok.
        expect(o.bodyTasma, "body yatay taşma").toBe(0);
        expect(o.docTasma, "belge yatay taşma").toBe(0);

        // V4 §3.8.3
        if (!GOLGE_MUAF.includes(screen)) {
          expect(o.dekoratifGolge, "dekoratif gölge").toEqual([]);
        }
        expect(o.cssGradient, "CSS gradient").toBe(0);
        expect(o.svgGradient, "SVG gradient").toBe(0);

        // V4 §3.8.4
        if (!CAM_MUAF.includes(screen)) {
          expect(o.cam, "cam yüzey").toBe(0);
        }
      });
    }
  });
}
