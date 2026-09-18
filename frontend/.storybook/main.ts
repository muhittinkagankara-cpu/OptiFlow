/**
 * Storybook — V4 Anayasası'nın yaşayan referansı (Sprint 2M.2).
 *
 * Bu bir tasarım oyun alanı değil. Amacı, anayasanın bileşen düzeyindeki
 * karşılıklarını **gerçek fixture'larla** göstermek: bir kuralın metni MASTER'da
 * durur, bu katalog o kuralın ekranda neye benzediğini gösterir.
 *
 * Hikâyeler bileşenlerin yanında değil `src/stories/` altında durur: ürün
 * klasörlerinde dursalardı, `constitution.ts` taramasına dahil olurlardı ve bir
 * hikâyenin içindeki örnek yasak sınıf gerçek bir ihlal sayılırdı.
 */

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    // Prop tabloları bileşenlerin kendi tiplerinden üretilir; elle yazılan bir
    // tablo, imza değiştiğinde sessizce eskir.
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
