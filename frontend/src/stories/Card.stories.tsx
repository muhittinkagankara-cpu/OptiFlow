/**
 * Card — V4 §3.8.2 (yarıçap 16) ve §3.8.3 (dekoratif gölge yok).
 *
 * Sprint metninde "Loading" varyantı isteniyordu; **bileşende böyle bir hal
 * yok**. `Card`'ın tamamı `children, className, interactive, index` — yükleme
 * göstergesi kartın değil, içine konan iskeletin işidir. Uydurulmadı.
 *
 * "warning", "fault" ve "disabled" de aynı nedenle yok: kart bir durum
 * taşımaz. Renk bir ölçümdür (Yasa 3) ve kartın kendisi hiçbir şey ölçmez.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "../components/ui/Primitives";

const meta = {
  title: "V4/Card",
  component: Card,
  parameters: {
    docs: {
      description: {
        component:
          "Kart yüzeyi tek kaynaktan gelir: yarıçap `--of-cc-radius-card` " +
          "(16px), kenarlık hairline `--of-cc-border`, zemin `--of-cc-card`. " +
          "`interactive` hover geri bildirimi ekler ama **gölge eklemez** — " +
          "Sprint 2M'de `optiflow-lift` (gölgeli) yerine `optiflow-cc-lift` " +
          "kullanılmaya başlandı.",
      },
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

const Icerik = (
  <div className="p-5">
    <p className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
      Torna
    </p>
    <p className="mt-2 text-[30px] leading-9 font-semibold text-[var(--of-cc-ink)] tabular-nums">
      %62
    </p>
    <p className="mt-1 text-sm text-[var(--of-cc-ink-muted)]">
      Hattın kısıtı; kuyruk 4 parça
    </p>
  </div>
);

export const Default: Story = {
  args: { children: Icerik },
};

/** Tıklanabilir kart. Hover'da yükselir ve kenarlığı belirginleşir; gölge yoktur. */
export const Interactive: Story = {
  args: { children: Icerik, interactive: true },
};

/** `index` — liste girişlerinin kademeli belirmesi (45ms × sıra). */
export const Staggered: Story = {
  args: { children: Icerik, index: 3 },
};
