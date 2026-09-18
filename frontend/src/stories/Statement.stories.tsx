/**
 * Statement — V4 Yasa 1: ekran sayı duvarıyla değil bir cümleyle açılır.
 *
 * Sprint metni "Constraint / Fault / Neutral" varyantları istiyordu.
 * **Bileşende durum prop'u yok**: imza `headline, detail, meta, action`.
 * Üç hal bir varyant değil, üç farklı *cümle*. Hikâyeler bunu olduğu gibi
 * gösterir; sahte bir `state` prop'u uydurulmadı.
 *
 * "Empty" de uydurulmadı: gerçek boş hal, kısıt henüz ölçülmemişken
 * `action` ile birlikte gösterilen `NoConstraint` hikâyesidir.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { Statement } from "../components/ui/Statement";
import { Badge, Button } from "../components/ui/Primitives";

const meta = {
  title: "V4/Statement",
  component: Statement,
  parameters: {
    docs: {
      description: {
        component:
          "Her ekran bir durum tespitiyle açılır. `detail` ölçülemiyorsa " +
          "verilmez — boş bir satır, ölçülmüş bir şeyin yerini tutamaz. " +
          "Kısıt bilinmiyorsa `action` o ölçümü üretecek adımı gösterir " +
          "(Yasa 5: her ekran bir sonraki adımla biter).",
      },
    },
  },
} satisfies Meta<typeof Statement>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ölçülmüş kısıt: hangi istasyon, ne kadar sınırlıyor, parayla sonucu ne. */
export const Constraint: Story = {
  args: {
    headline: "Bugün hattınızı Torna sınırlıyor.",
    detail:
      "Toplam zamanın %62'si Torna'da geçiyor; hat teorik kapasitesinin %74'ünde çalışıyor.",
    meta: <Badge tone="info">Benzetim</Badge>,
  },
};

/** Ölçülmüş arıza: renk değil cümle taşıyor. */
export const Fault: Story = {
  args: {
    headline: "Kaynak istasyonu 12 dakikadır duruyor.",
    detail: "Duruş nedeni bildirilmedi; vardiya hedefi 38 parça geride.",
    meta: <Badge tone="bad">Arıza</Badge>,
  },
};

/** Kısıt henüz ölçülmedi — gerçek boş hal. Cümle bunu söyler, eylem ölçümü üretir. */
export const NoConstraint: Story = {
  args: {
    headline: "Canlı hat durumu izleniyor; belirlenmiş bir kısıt yok.",
    detail: null,
    meta: <Badge tone="neutral">Ölçülmedi</Badge>,
    action: <Button variant="secondary">Simülasyonu aç</Button>,
  },
};
