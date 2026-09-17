/**
 * Ekranlara ulaşmanın tek yolu (Sprint 2M).
 *
 * Her test dosyası kendi gezinme adımlarını yazsaydı, menü bir kez
 * değiştiğinde altı dosya birden bozulurdu. Buradaki yardımcılar gerçek
 * kullanıcı yolunu izler: karşılama ekranından demoya girilir, sonra kenar
 * çubuğundan ekran seçilir.
 */

import type { Page } from "@playwright/test";

/** V4 §3.8.10'un zorunlu ölçüm genişlikleri. */
export const VIEWPORTS = [
  { ad: "375", width: 375, height: 812 },
  { ad: "390", width: 390, height: 844 },
  { ad: "768", width: 768, height: 1024 },
  { ad: "1024", width: 1024, height: 900 },
  { ad: "1440", width: 1440, height: 900 },
  { ad: "1600", width: 1600, height: 900 },
] as const;

/** Kenar çubuğundaki adıyla ekranlar. */
export const SCREENS = {
  command: "Dashboard",
  reports: "Raporlar",
  results: "Simülasyon",
  live: "Canlı Üretim",
  finance: "Finans",
  operator: "Operatör",
} as const;

export type ScreenId = keyof typeof SCREENS;

/**
 * Demo oturumunu açar.
 *
 * Demo yolu seçildi çünkü oturum açma gerektirmiyor ve her koşumda **aynı**
 * veriyi üretiyor. Gerçek bir oturumla çalışılsaydı, ekran görüntüleri
 * hesaptaki veriye göre değişir ve görsel regresyon anlamını yitirirdi.
 */
export async function enterDemo(page: Page): Promise<void> {
  await page.goto("/");
  const demo = page.getByRole("button", { name: "Demo Başlat" });
  await demo.waitFor({ state: "visible", timeout: 30_000 });
  await demo.click();
  // Kabuk yüklenene kadar bekle: gezinme düğmesi bunun ön koşulu.
  await navButton(page, "Dashboard").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

/**
 * Kenar çubuğundaki gezinme düğmesi.
 *
 * `getByText` kullanmak iki kez pahalıya patladı: aynı metin üst çubukta da
 * geçiyor ve `.first()` çekmece perdesinin **arkasında** kalan öğeyi
 * seçebiliyor. Playwright o öğeyi tıklamayı 30 saniye boyunca yeniden dener ve
 * test, ürün hatasıymış gibi zaman aşımına düşer. Gezinme öğeleri gerçek
 * `button` olduğu için rolle aramak hem kesin hem de perdeden etkilenmez.
 */
function navButton(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true }).first();
}

/** Dar ekranda çekmeceyi kapatan perde/çarpı düğmesi. */
function drawerCloser(page: Page) {
  return page.getByRole("button", { name: "Menüyü kapat" }).first();
}

/**
 * Kenar çubuğundan bir ekrana geçer.
 *
 * `lg` altında kenar çubuğu bir çekmecedir ve önce açılması gerekir. Seçimden
 * sonra çekmece **kendiliğinden** kapanır (`goToSection` → `setMenuOpen(false)`);
 * kapanmasını beklemek şart, çünkü açık kalan perde `backdrop-blur-sm` taşır ve
 * cam kuralını haklı olarak düşürürdü — ama ölçülen şey ekran değil, açık
 * kalmış bir menü olurdu.
 */
export async function gotoScreen(page: Page, screen: ScreenId): Promise<void> {
  const opener = page.getByRole("button", { name: "Menüyü aç" });
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
    await drawerCloser(page).waitFor({ state: "visible", timeout: 10_000 });
  }

  const item = navButton(page, SCREENS[screen]);
  await item.waitFor({ state: "visible", timeout: 15_000 });
  await item.click();

  await drawerCloser(page)
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => undefined);

  await page.waitForTimeout(1_000);
}

/**
 * Ekranı görüntü almaya hazırlar.
 *
 * Animasyonlar ve canlı saat, her koşumda birkaç pikseli değiştirir; bunlar
 * durdurulmadan alınan taban çizgisi ilk koşumda kırmızıya döner. Durdurulan
 * şey yalnızca hareket; ölçülen hiçbir değer değişmez.
 */
export async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });
  await page.waitForTimeout(600);
}
