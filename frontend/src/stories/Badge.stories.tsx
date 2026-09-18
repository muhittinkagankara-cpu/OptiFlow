/**
 * Badge — V4 Yasa 3: renk bir ölçümdür.
 *
 * Ton adları bileşenin **gerçek** `BadgeTone` birleşimidir:
 * `neutral | good | warning | bad | info`. Sprint metnindeki "Success" ve
 * "Danger" adları kodda `good` ve `bad` olarak geçiyor; hikâyeler kodun
 * adlandırmasını kullanır, yoksa katalog ile kaynak ayrışırdı.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
// `Info` ikonu takma adla alınıyor: hikâye adı da `Info` ve ikisi çakışıyordu.
import { AlertTriangle, CheckCircle2, Info as InfoIcon, XCircle } from "lucide-react";

import { Badge } from "../components/ui/Primitives";

const meta = {
  title: "V4/Badge",
  component: Badge,
  parameters: {
    docs: {
      description: {
        component:
          "Yeşil/sarı/kırmızı **ölçülmüş** bir durumu anlatır, mavi " +
          "etkileşimi. Ölçülmemiş olan nötr kalır. Durum yalnızca renkle " +
          "taşınmaz: her rozet bir etiket, çoğu ayrıca bir ikon taşır.",
      },
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: { children: "Ölçülmedi", tone: "neutral" },
};

export const Good: Story = {
  args: { children: "Eşik içinde", tone: "good", icon: CheckCircle2 },
};

export const Warning: Story = {
  args: { children: "Eşiğe yakın", tone: "warning", icon: AlertTriangle },
};

export const Bad: Story = {
  args: { children: "Eşik aşıldı", tone: "bad", icon: XCircle },
};

export const Info: Story = {
  args: { children: "Benzetim", tone: "info", icon: InfoIcon },
};
