/**
 * Gezinme dumanı (Sprint 2M).
 *
 * Görsel ve erişilebilirlik testlerinin tamamı bu yolun çalışmasına bağlı.
 * Ayrı bir dosya olması bilinçli: gezinme bozulduğunda hangi katmanın
 * düştüğü tek bakışta görünür, onlarca ekran görüntüsü testi birden
 * kırmızıya dönmez.
 */

import { expect, test } from "@playwright/test";

import { SCREENS, enterDemo, gotoScreen, type ScreenId } from "./helpers";

test.describe("demo oturumu ve gezinme", () => {
  test("karşılama ekranından demoya girilir", async ({ page }) => {
    await enterDemo(page);
    await expect(page.getByText("Dashboard", { exact: true }).first()).toBeVisible();
  });

  for (const screen of Object.keys(SCREENS) as ScreenId[]) {
    test(`${SCREENS[screen]} ekranı açılır`, async ({ page }) => {
      await enterDemo(page);
      await gotoScreen(page, screen);
      // Ekranın gerçekten değiştiğinin kanıtı: gövde metni boş değil.
      const metin = await page.locator("body").innerText();
      expect(metin.trim().length).toBeGreaterThan(50);
    });
  }
});
