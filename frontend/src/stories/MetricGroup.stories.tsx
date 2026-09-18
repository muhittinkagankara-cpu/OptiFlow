/**
 * MetricGroup — V4 Yasa 2 (çıplak metrik yasak) ve Yasa 4 (uydurma ölçüm yok).
 *
 * Her sayı bir sonuç taşır: kapasite, eşik, para ya da darboğaz. Ölçülemeyen
 * değer `null` gelir, "—" olarak çizilir ve **nedeni** yazılır; sıfır bir
 * yer tutucu değildir.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { MetricGroup } from "../components/ui/MetricGroup";
import { Button } from "../components/ui/Primitives";

const meta = {
  title: "V4/MetricGroup",
  component: MetricGroup,
  parameters: {
    docs: {
      description: {
        component:
          "`value: null` → \"—\" artı `emptyReason`. Ölçülmeyen bir değeri " +
          "sıfır göstermek, olmayan bir olguyu ölçülmüş gibi sunmaktır — " +
          "ürünün en pahalı hatası.",
      },
    },
  },
} satisfies Meta<typeof MetricGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ölçülmüş değerler; her biri sonucuyla birlikte. */
export const Active: Story = {
  args: {
    items: [
      {
        id: "throughput",
        label: "Üretim",
        value: "778 birim",
        consequence: "Teorik kapasitenin %74'ü",
      },
      {
        id: "flow",
        label: "Akış süresi",
        value: "5.3 dk",
        consequence: "%95 aralık 4.9 – 5.8",
      },
      {
        id: "loss",
        label: "Günlük kayıp",
        value: "₺178.772",
        consequence: "22 iş günü üzerinden ölçüldü",
        isMoney: true,
      },
    ],
  },
};

/** Ölçülemeyen değer: "—", nedeni ve ölçümü üretecek eylem. */
export const EmptyReason: Story = {
  args: {
    items: [
      {
        id: "throughput",
        label: "Üretim",
        value: "778 birim",
        consequence: "Teorik kapasitenin %74'ü",
      },
      {
        id: "oee",
        label: "OEE",
        value: null,
        emptyReason:
          "Cihazdan çevrim süresi okunamadı; OEE hesaplanamıyor.",
        action: <Button variant="secondary">Bağlantıyı doğrula</Button>,
      },
      {
        id: "recovery",
        label: "Geri kazanılabilir",
        value: null,
        emptyReason: "Maliyet oranları girilmedi.",
        isMoney: true,
      },
    ],
  },
};
