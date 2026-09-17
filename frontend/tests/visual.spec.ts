/**
 * Görsel regresyon taban çizgileri (Sprint 2M).
 *
 * Kural ve ölçüm testleri "gradient var mı?" gibi **adlandırılmış** soruları
 * yanıtlar. Görsel taban çizgisi, kimsenin sormayı akıl etmediği değişikliği
 * yakalar: kayan bir hizalama, yanlış sarmalanan bir başlık, bir anda
 * yarıya inen bir tuval.
 *
 * Taban çizgileri platforma göre ayrışır (`-win32.png`). Font çizimi ve alt
 * piksel yumuşatma işletim sistemine göre değiştiği için tek bir dosya
 * paylaşılamaz; paylaşılsaydı her CI koşumu kırmızı olur ve ekip görsel
 * testlere bakmayı bırakırdı. Başka bir platformda ilk koşum kendi taban
 * çizgisini üretir.
 *
 * Çekim öncesi animasyonlar durdurulur ve hareket eden her şey beklenir;
 * durdurulmasaydı taban çizgisi kendi kendine kırmızıya dönerdi.
 */

import { expect, test } from "@playwright/test";

import { SCREENS, VIEWPORTS, enterDemo, gotoScreen, settle, type ScreenId } from "./helpers";

for (const screen of Object.keys(SCREENS) as ScreenId[]) {
  test.describe(`${SCREENS[screen]} — görsel`, () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.ad}px`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await enterDemo(page);
        await gotoScreen(page, screen);
        await settle(page);

        await expect(page).toHaveScreenshot(`${screen}-${vp.ad}.png`, {
          // Tam sayfa değil görünen alan: sayfa yüksekliği veriye göre
          // değişiyor ve her veri değişimi görsel regresyon gibi okunurdu.
          fullPage: false,
        });
      });
    }
  });
}
