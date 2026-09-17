/**
 * Playwright yapılandırması — V4 anayasasının tarayıcı tarafı (Sprint 2M).
 *
 * Kaynak testleri (`src/lib/designSystem`) bir sınıfın yazıldığını görebilir
 * ama o sınıfın ekranda **ne ürettiğini** göremez. `:hover` durumunda gelen bir
 * gölge, taşan bir yerleşim ya da 44px'in altında kalan bir düğme yalnızca
 * gerçek bir tarayıcıda ölçülebilir. Bu iki katman birbirinin yerine geçmez.
 *
 * Testler `tests/` altında durur, `src/` altında değil: vitest'in kapsamı
 * `src/**` olduğu için aynı dosyaları iki koşucu birden çalıştırmaya kalkardı.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  /*
   * Anlık görüntüler işletim sistemine göre ayrışır (`-win32.png`). Font
   * çizimi ve alt piksel yumuşatma platformdan platforma değiştiği için tek
   * bir taban çizgisi paylaşılamaz; paylaşılsaydı her CI koşumu kırmızı olur
   * ve ekip kısa sürede görsel testlere bakmayı bırakırdı.
   */
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "tests/.results/report.json" }]],
  use: {
    baseURL: BASE_URL,
    // Hata ayıklanabilirlik: düşen testin izi ve ekran görüntüsü kalır.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      /*
       * Küçük bir eşik bırakılıyor. Sıfır olsaydı, imleç konumundan ya da
       * animasyonun bir kare kaymasından doğan farklar gerçek regresyon gibi
       * okunurdu; çok büyük olsaydı gerçek bir kayma gözden kaçardı.
       */
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
