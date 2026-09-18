/**
 * ConstraintRail — MASTER §15.4: segment genişliği, o varyantta **kısıtı
 * belirleyen ölçümü** kodlar.
 *
 * Canlı ekranda bu ölçüm kuyruktur; sonuç ekranında doluluk. En geniş segment
 * her zaman kısıttır. Bütün kuyruklar sıfırsa segmentler eşitlenir ve hiçbiri
 * kısıt işaretlenmez — eşit genişlik "ölçüm yok" demenin yoludur.
 *
 * Sprint metni "Disabled" istemiyordu, doğru: şeridin kapalı bir hali yok.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { ConstraintRail } from "../components/ui/ConstraintRail";

const meta = {
  title: "V4/ConstraintRail",
  component: ConstraintRail,
  parameters: {
    docs: {
      description: {
        component:
          "Genişlik bir iddiadır: en geniş segment kısıttır. Genişlik ile " +
          "kısıt işareti **aynı ölçümden** gelmek zorundadır, yoksa şerit " +
          "kendi verdiği sözü tutmaz.",
      },
    },
  },
} satisfies Meta<typeof ConstraintRail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hiç kuyruk yok: paylar eşit, kısıt işaretlenmiyor. */
export const NoQueue: Story = {
  args: {
    stations: [
      { id: "s1", label: "Kesme", share: 0.25, value: "0 parça", state: "ok", isConstraint: false },
      { id: "s2", label: "Torna", share: 0.25, value: "0 parça", state: "ok", isConstraint: false },
      { id: "s3", label: "Kaynak", share: 0.25, value: "0 parça", state: "ok", isConstraint: false },
      { id: "s4", label: "Boyama", share: 0.25, value: "0 parça", state: "ok", isConstraint: false },
    ],
  },
};

/** Tek darboğaz: en uzun kuyruk tam paya sahip, ötekiler ona göre okunuyor. */
export const SingleBottleneck: Story = {
  args: {
    stations: [
      { id: "s1", label: "Kesme", share: 0.1, value: "1 parça", state: "ok", isConstraint: false },
      { id: "s2", label: "Torna", share: 1, value: "10 parça", state: "fault", isConstraint: true },
      { id: "s3", label: "Kaynak", share: 0.5, value: "5 parça", state: "warn", isConstraint: false },
      { id: "s4", label: "Boyama", share: 0, value: "0 parça", state: "ok", isConstraint: false },
    ],
  },
};

/** Çok istasyonlu hat: paylar en uzun kuyruğa göre ölçekli. */
export const MultipleStations: Story = {
  args: {
    stations: [
      { id: "s1", label: "Kesme", share: 0.4, value: "4 parça", state: "warn", isConstraint: false },
      { id: "s2", label: "Torna", share: 0.6, value: "6 parça", state: "warn", isConstraint: false },
      { id: "s3", label: "Kaynak", share: 1, value: "10 parça", state: "fault", isConstraint: true },
      { id: "s4", label: "Boyama", share: 0.3, value: "3 parça", state: "ok", isConstraint: false },
      { id: "s5", label: "Montaj", share: 0.2, value: "2 parça", state: "ok", isConstraint: false },
      { id: "s6", label: "Paket", share: 0.1, value: "1 parça", state: "ok", isConstraint: false },
    ],
  },
};
