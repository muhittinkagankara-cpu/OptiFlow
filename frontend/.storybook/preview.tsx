/**
 * Storybook ortak çerçevesi (Sprint 2M.2).
 *
 * Koyu tema **varsayılandır ve tek seçenektir**. Açık tema eklenseydi, V4'ün
 * kanonik yüzeyleri (`--of-surface-canvas`, `--of-surface-1`) açık zeminde
 * görünmez olurdu ve katalog anayasayı temsil etmekten çıkardı.
 *
 * Zemin rengi burada elle yazılmaz; uygulamanın kendi `index.css` dosyasından
 * gelir. Elle yazılsaydı token bir gün değiştiğinde katalog eski rengi
 * göstermeye devam eder, yani sessizce yalan söylerdi.
 */

import type { Preview } from "@storybook/react-vite";

import "../src/index.css";

const preview: Preview = {
  parameters: {
    // Dekoratif arka plan seçici kapalı: zemin bir tercih değil, bir tokendır.
    backgrounds: { disable: true },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    docs: { toc: true },
  },
  decorators: [
    /*
     * Tuval, uygulamanın zeminiyle aynı yüzeyi kullanır. Storybook'un
     * varsayılan beyaz tuvali bırakılsaydı, hairline kenarlıklar
     * (`rgb(255 255 255 / 0.08)`) hiç görünmez ve katalog V4 yüzeylerini
     * yanlış gösterirdi.
     */
    (Story) => (
      <div
        style={{
          background: "var(--of-surface-canvas)",
          color: "var(--of-text)",
          minHeight: "100vh",
          padding: "24px",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
