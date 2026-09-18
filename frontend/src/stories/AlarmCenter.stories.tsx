/**
 * AlarmCenter — V4 Yasa 5: her alarm bir sonraki adıma bağlanır ya da hiç
 * düğme göstermez.
 *
 * Sprint metni "AlarmCard" istiyordu; **böyle bir bileşen yok**. Alarmlar
 * `AlarmCenter` içinde listeleniyor ve istenen dört varyant (queue, fault,
 * scrap, setup) bir prop değil, alarm **kimliğinin ön ekidir**
 * (`queue:s1:480` → `queue`, bkz. `alarmAction.ts`). Hikâyeler o gerçek
 * kodlamayı kullanır.
 *
 * Yalnızca `queue` alarmında düğme çıkar: kuyruk birikmesi ürünün yanıtlayabildiği
 * tek soru (kapasite). Arıza, fire ve setup alarmlarında düğme **yoktur** —
 * çalışmayan bir düğme, olmayan bir yeteneği vaat etmektir.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import { AlarmCenter } from "../components/live/AlarmCenter";
import type { Alarm } from "../lib/live";

const SAAT = 8 * 60 + 12;

function alarm(
  id: string,
  level: Alarm["level"],
  stationName: string,
  text: string,
): Alarm {
  return {
    id,
    level,
    atMinutes: SAAT - 6,
    stationId: id.split(":")[1] ?? "s1",
    stationName,
    text,
    updatedAtMinutes: SAAT - 6,
    resolvedAtMinutes: null,
  };
}

const meta = {
  title: "V4/AlarmCenter",
  component: AlarmCenter,
  parameters: {
    docs: {
      description: {
        component:
          "Alarm kartı sırayla şunu söyler: tür → istasyon → ölçüm → " +
          "**gerçek** sonraki adım. Bağlanacak bir ekran yoksa düğme yazılmaz.",
      },
    },
  },
  args: {
    clockMinutes: SAAT,
    onSelectStation: () => undefined,
    onOpenSimulation: () => undefined,
  },
} satisfies Meta<typeof AlarmCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Kuyruk — tek eyleme bağlanabilen tür. "Simülasyonda modelle" düğmesi çıkar. */
export const Queue: Story = {
  args: {
    alarms: [
      alarm("queue:s2:486", "warning", "Torna", "Kuyruk 10 parçaya çıktı."),
    ],
  },
};

/** Arıza — düğme yok; bağlanacak bir ekran bulunmuyor. */
export const Fault: Story = {
  args: {
    alarms: [
      alarm("fault:s3:486", "critical", "Kaynak", "İstasyon 12 dakikadır duruyor."),
    ],
  },
};

/** Fire — kalite işi; ürün bu soruyu yanıtlamıyor, düğme yok. */
export const Scrap: Story = {
  args: {
    alarms: [
      alarm("scrap:s4:486", "warning", "Boyama", "Fire oranı %4.2'ye çıktı."),
    ],
  },
};

/** Setup — bilgilendirme; eylem gerektirmiyor. */
export const Setup: Story = {
  args: {
    alarms: [
      alarm("setup:s1:486", "info", "Kesme", "Kalıp değişimi başladı."),
    ],
  },
};

/** Dördü bir arada: seviyeye göre sıralanır (critical → warning → info). */
export const Mixed: Story = {
  args: {
    alarms: [
      alarm("setup:s1:486", "info", "Kesme", "Kalıp değişimi başladı."),
      alarm("queue:s2:486", "warning", "Torna", "Kuyruk 10 parçaya çıktı."),
      alarm("fault:s3:486", "critical", "Kaynak", "İstasyon 12 dakikadır duruyor."),
      alarm("scrap:s4:486", "warning", "Boyama", "Fire oranı %4.2'ye çıktı."),
    ],
  },
};

/** Gerçek boş hal: alarm yokken merkez ne yapılacağını söyler, boş kalmaz. */
export const NoAlarms: Story = {
  args: { alarms: [] },
};
