/**
 * LiveStatusBar — V4 §3.8.7: 72px, yalnızca **ölçülmüş** üç alan.
 *
 * Besleme tonları bileşenin gerçek birleşimidir:
 * `real | waiting | simulated | unverified`. Sprint metnindeki "Demo" =
 * `simulated`, "Runtime" = `real`, "Disconnected" = `unverified`. Dördüncü ton
 * (`waiting`) da gerçek olduğu için eklendi; gizlemek katalogda olmayan bir
 * hal varmış izlenimi verirdi.
 *
 * "Empty" hali üretilmedi: besleme yokken çubuk boşalmaz, `unverified` der.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { LiveStatusBar } from "../components/live/LiveStatusBar";

const meta = {
  title: "V4/LiveStatusBar",
  component: LiveStatusBar,
  parameters: {
    docs: {
      description: {
        component:
          "Aynı bilgi başka bir kontrolde okunuyorsa durum çubuğunda tekrar " +
          "edilmez — \"Mod\" alanı bu yüzden kaldırıldı (§3.8.7). Kısıt " +
          "ölçülmemişse `constraintName` `null` gelir ve çubuk bunu yazar.",
      },
    },
  },
  args: { clock: "08:03" },
} satisfies Meta<typeof LiveStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Demo senaryosu: veri üretilmiş, çubuk bunu saklamıyor. */
export const Simulated: Story = {
  args: { feedLabel: "Benzetim", feedTone: "simulated", constraintName: "Torna" },
};

/** Gerçek cihazdan ölçüm akıyor. */
export const Real: Story = {
  args: { feedLabel: "Gerçek Veri", feedTone: "real", constraintName: "Kaynak" },
};

/** Akış açık ama cihazdan henüz ölçüm gelmedi. */
export const Waiting: Story = {
  args: { feedLabel: "Veri Bekleniyor", feedTone: "waiting", constraintName: null },
};

/** Bağlantı doğrulanmadı — "bağlanamadı" değil; hiç denenmemiş olabilir. */
export const Unverified: Story = {
  args: { feedLabel: "Doğrulanmadı", feedTone: "unverified", constraintName: null },
};
