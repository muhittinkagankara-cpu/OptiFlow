/**
 * LiveStationNode — V4 §3.8.8: hairline kenarlık, gölge yok, tek yüzey.
 * Amber halka ve parıltı yalnızca **gerçek ölçülmüş** darboğazda çizilir.
 *
 * Bu düğüm React Flow'un içinde yaşıyor ve `Handle` bağlam istiyor; bu yüzden
 * hikâyeler `ReactFlowProvider` ile sarmalanır. Sarmalanmasaydı bileşen
 * Storybook'ta hiç render olmazdı.
 *
 * Varyantlar `MachineStatus` birleşiminden gelir:
 * `running | idle | queued | fault | setup`. Sprint metnindeki "Bottleneck"
 * bir durum değil, ayrı bir **ölçüm bayrağıdır** (`isBottleneck`) — hattın en
 * uzun kuyruğu bu istasyondaysa doğru olur. İkisi karıştırılsaydı, çalışan bir
 * darboğaz ya "çalışıyor" ya "darboğaz" görünürdü; oysa ikisi aynı anda doğru.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReactFlowProvider, type NodeProps } from "reactflow";

import { LiveStationNode, type LiveNodeData } from "../components/live/LiveStationNode";

/**
 * Hikâyelerin yüzeyi: `LiveNodeData` alanlarını doğrudan kontrol paneline
 * açar. Düğümün kendi `NodeProps` imzası React Flow'a aittir ve bir katalog
 * kullanıcısının onunla uğraşması gerekmez.
 */
function StationNodeOrnek(data: LiveNodeData) {
  const nodeProps = {
    id: "s1",
    type: "station",
    data,
    selected: false,
    isConnectable: false,
    zIndex: 0,
    xPos: 0,
    yPos: 0,
    dragging: false,
  } as unknown as NodeProps<LiveNodeData>;

  return (
    <ReactFlowProvider>
      <div style={{ width: 240 }}>
        <LiveStationNode {...nodeProps} />
      </div>
    </ReactFlowProvider>
  );
}

const meta = {
  title: "V4/LiveStationNode",
  component: StationNodeOrnek,
  parameters: {
    docs: {
      description: {
        component:
          "Durum rengi ince kenarlıkta ve alttaki şeritte taşınır; 2 " +
          "piksellik kenarlık ve sert gölge Sprint 2I-D'de kaldırıldı. " +
          "Durum yalnızca renkle anlatılmaz — her düğüm durumun yazılı " +
          "etiketini de taşır.",
      },
    },
  },
  argTypes: {
    status: {
      control: "select",
      options: ["running", "idle", "queued", "fault", "setup"],
      description: "Gerçek `MachineStatus` birleşimi.",
    },
    queue: { control: { type: "number", min: 0 } },
    oee: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    isBottleneck: {
      control: "boolean",
      description: "Hattın en uzun kuyruğu bu istasyonda mı? Ölçülmüş bayrak.",
    },
  },
  args: {
    stationName: "Torna",
    status: "running",
    queue: 2,
    oee: 0.78,
    completed: 184,
    isBottleneck: false,
    operatorName: "Ayşe K.",
  },
} satisfies Meta<typeof StationNodeOrnek>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Çalışıyor, kuyruk küçük, darboğaz değil. */
export const Running: Story = {};

/** Çalışıyor **ve** darboğaz: ikisi aynı anda doğru olabilir. Parıltı ölçülmüş bir durumu işaretler. */
export const Bottleneck: Story = {
  args: { status: "running", queue: 10, isBottleneck: true },
};

/** Duruş. Bu ekranın en pahalı hatası duran makineyi çalışıyor göstermektir. */
export const Fault: Story = {
  args: { status: "fault", queue: 6, oee: 0.31, operatorName: null },
};

/** Boşta: iş bekliyor, kuyruk yok. */
export const Idle: Story = {
  args: { status: "idle", queue: 0, completed: 12 },
};

/** Kuyrukta: önceki istasyon beslemiyor. */
export const Queued: Story = {
  args: { status: "queued", queue: 4 },
};

/** Kalıp değişimi. */
export const Setup: Story = {
  args: { status: "setup", queue: 1, oee: 0.5 },
};
