/**
 * Button — V4 §3.8.2 (yarıçap 14) ve §3.8.8 (bölge başına tek `primary`).
 *
 * Varyantlar bileşenin **gerçek** `ButtonVariant` birleşiminden alınmıştır:
 * `primary | secondary | ghost | danger`. Sprint metninde istenen "Loading"
 * hali `busy` prop'unun karşılığıdır ve gerçektir.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Play } from "lucide-react";

import { Button } from "../components/ui/Primitives";

const meta = {
  title: "V4/Button",
  component: Button,
  parameters: {
    docs: {
      description: {
        component:
          "Bir ekran bölgesinde en fazla bir `primary` düğme bulunur " +
          "(MASTER §3.8.8). `danger` yıkıcı eylem içindir; `destructive` diye " +
          "bir varyant yoktur.",
      },
    },
  },
  args: { children: "Simülasyonu çalıştır" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: "primary" },
};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Ghost: Story = {
  args: { variant: "ghost" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Koşumu sil" },
};

export const Disabled: Story = {
  args: { variant: "primary", disabled: true },
};

/** `busy` — düğme içi göstergeye izin verilen tek yer (MASTER: sayfa yüklemesi spinner göstermez). */
export const Busy: Story = {
  args: { variant: "primary", busy: true, children: "Çalışıyor" },
};

export const WithIcon: Story = {
  args: { variant: "primary", icon: Play },
};
