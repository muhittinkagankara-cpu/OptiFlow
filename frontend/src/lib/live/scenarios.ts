/**
 * Demo senaryoları.
 *
 * Beş hazır akış, canlı ekranın beş farklı hâlini tek tıkla göstermek için
 * vardır: normal üretim, darboğaz oluşumu, makine arızası, operatörün işi
 * bitirmesi ve setup değişimi.
 *
 * Senaryolar **deterministiktir**: aynı istasyon listesi her zaman aynı olay
 * dizisini verir. Rastgele üretilseydi ekranı onaylayan kişi her açılışta
 * başka bir şey görür ve bir hatayı yeniden üretmek imkânsızlaşırdı.
 *
 * Üretim saf bir işlevdir; zamanlama (`delayMs`) yalnızca bir veridir. Olayları
 * gerçekten kim ve ne zaman yayımlayacağına `DemoLiveProvider` karar verir —
 * yarın bu olaylar bir OPC UA aboneliğinden gelecek ve senaryo dosyası
 * silinecek, geri kalan hiçbir şey değişmeyecek.
 */

import type { LiveEvent } from "./events";
import type { StationSeed } from "./state";

/** Zamanlanmış tek bir adım. */
export interface ScenarioStep {
  /** Bir önceki adımdan sonra beklenecek süre (ms). */
  delayMs: number;
  events: LiveEvent[];
}

export type ScenarioId =
  | "normal"
  | "bottleneck"
  | "fault"
  | "handoff"
  | "setup";

export interface LiveScenario {
  id: ScenarioId;
  label: string;
  description: string;
  /** Senaryonun kapsadığı vardiya süresi (dakika); döngüde saat bu kadar ilerler. */
  durationMinutes: number;
  build(seeds: StationSeed[], startMinutes: number): ScenarioStep[];
}

/** Adım başına varsayılan bekleme. */
const BEAT_MS = 1400;

const OPERATORS = ["Ayşe", "Mehmet", "Elif", "Burak", "Deniz"];

/** Listeden güvenli seçim: kısa listelerde başa sarar, boş listede `null`. */
function pick(seeds: StationSeed[], index: number): StationSeed | null {
  if (seeds.length === 0) {
    return null;
  }
  return seeds[index % seeds.length];
}

/** Çevrim süresinden dakikada üretilebilecek parça sayısı. */
function batchFor(seed: StationSeed): number {
  if (seed.cycleSeconds <= 0) {
    return 2;
  }
  return Math.max(1, Math.round(60 / seed.cycleSeconds));
}

/* -------------------------------------------------------------------------- */

const normal: LiveScenario = {
  id: "normal",
  label: "Normal üretim",
  description: "Bütün istasyonlar çalışıyor, kuyruklar kısa, alarm yok.",
  durationMinutes: 12,
  build(seeds, start) {
    if (seeds.length === 0) {
      return [];
    }
    const steps: ScenarioStep[] = [];

    seeds.forEach((seed, index) => {
      steps.push({
        delayMs: index === 0 ? 200 : BEAT_MS / 2,
        events: [
          {
            type: "operator_assigned",
            atMinutes: start + index,
            stationId: seed.id,
            operatorName: OPERATORS[index % OPERATORS.length],
          },
          { type: "station_started", atMinutes: start + index, stationId: seed.id },
          {
            type: "oee_sampled",
            atMinutes: start + index,
            stationId: seed.id,
            oee: seed.oee > 0 ? seed.oee : 0.78,
          },
        ],
      });
    });

    // Üç tur üretim: her turda her istasyon bir parti bitirir, kuyruklar
    // kısa dalgalanır.
    for (let round = 0; round < 3; round += 1) {
      seeds.forEach((seed, index) => {
        const at = start + seeds.length + round * 3 + index;
        steps.push({
          delayMs: BEAT_MS,
          events: [
            {
              type: "part_completed",
              atMinutes: at,
              stationId: seed.id,
              quantity: batchFor(seed),
            },
            {
              type: "queue_changed",
              atMinutes: at,
              stationId: seed.id,
              queue: round === 1 ? 2 : 1,
            },
          ],
        });
      });
    }

    return steps;
  },
};

const bottleneck: LiveScenario = {
  id: "bottleneck",
  label: "Darboğaz oluşuyor",
  description:
    "İkinci istasyonun kuyruğu adım adım büyüyor; önce uyarı, sonra kritik alarm çıkar.",
  durationMinutes: 14,
  build(seeds, start) {
    const target = pick(seeds, 1) ?? pick(seeds, 0);
    const feeder = pick(seeds, 0);
    if (!target || !feeder) {
      return [];
    }

    const steps: ScenarioStep[] = [
      {
        delayMs: 200,
        events: [
          {
            type: "operator_assigned",
            atMinutes: start,
            stationId: feeder.id,
            operatorName: OPERATORS[0],
          },
          { type: "station_started", atMinutes: start, stationId: feeder.id },
          { type: "station_started", atMinutes: start, stationId: target.id },
        ],
      },
    ];

    // Kuyruk eşikleri geçsin diye kademeli büyür: 3 → 6 → 9 (uyarı) →
    // 12 → 16 (kritik).
    [3, 6, 9, 12, 16].forEach((queue, index) => {
      steps.push({
        delayMs: BEAT_MS,
        events: [
          {
            type: "queue_changed",
            atMinutes: start + 2 + index * 2,
            stationId: target.id,
            queue,
          },
          {
            type: "part_completed",
            atMinutes: start + 2 + index * 2,
            stationId: feeder.id,
            quantity: batchFor(feeder),
          },
          {
            type: "oee_sampled",
            atMinutes: start + 2 + index * 2,
            stationId: target.id,
            oee: Math.max(0.4, 0.85 - index * 0.07),
          },
        ],
      });
    });

    return steps;
  },
};

const fault: LiveScenario = {
  id: "fault",
  label: "Makine arızası",
  description:
    "Bir makine duruyor, arkasında kuyruk birikiyor, sonra onarılıp üretime dönüyor.",
  durationMinutes: 16,
  build(seeds, start) {
    const broken = pick(seeds, 1) ?? pick(seeds, 0);
    if (!broken) {
      return [];
    }

    return [
      {
        delayMs: 200,
        events: [
          {
            type: "operator_assigned",
            atMinutes: start,
            stationId: broken.id,
            operatorName: OPERATORS[1],
          },
          { type: "station_started", atMinutes: start, stationId: broken.id },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "part_completed",
            atMinutes: start + 2,
            stationId: broken.id,
            quantity: batchFor(broken),
          },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "machine_fault",
            atMinutes: start + 4,
            stationId: broken.id,
            reason: "Hidrolik basınç düştü",
          },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "queue_changed",
            atMinutes: start + 6,
            stationId: broken.id,
            queue: 7,
          },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "queue_changed",
            atMinutes: start + 8,
            stationId: broken.id,
            queue: 13,
          },
        ],
      },
      {
        delayMs: BEAT_MS * 2,
        events: [
          { type: "machine_repaired", atMinutes: start + 12, stationId: broken.id },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          { type: "station_started", atMinutes: start + 13, stationId: broken.id },
          {
            type: "part_completed",
            atMinutes: start + 13,
            stationId: broken.id,
            quantity: batchFor(broken),
          },
          {
            type: "queue_changed",
            atMinutes: start + 14,
            stationId: broken.id,
            queue: 4,
          },
        ],
      },
    ];
  },
};

const handoff: LiveScenario = {
  id: "handoff",
  label: "Operatör işi tamamlıyor",
  description:
    "Operatör partiyi bitiriyor, kuyruk eriyor, istasyon boşta kalıyor.",
  durationMinutes: 10,
  build(seeds, start) {
    const seed = pick(seeds, 0);
    if (!seed) {
      return [];
    }
    const batch = batchFor(seed);

    return [
      {
        delayMs: 200,
        events: [
          {
            type: "operator_assigned",
            atMinutes: start,
            stationId: seed.id,
            operatorName: OPERATORS[2],
          },
          { type: "station_started", atMinutes: start, stationId: seed.id },
          { type: "queue_changed", atMinutes: start, stationId: seed.id, queue: 6 },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "part_completed",
            atMinutes: start + 2,
            stationId: seed.id,
            quantity: batch,
          },
          { type: "queue_changed", atMinutes: start + 2, stationId: seed.id, queue: 4 },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "part_completed",
            atMinutes: start + 4,
            stationId: seed.id,
            quantity: batch,
          },
          {
            type: "part_scrapped",
            atMinutes: start + 4,
            stationId: seed.id,
            quantity: 1,
          },
          { type: "queue_changed", atMinutes: start + 4, stationId: seed.id, queue: 1 },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "part_completed",
            atMinutes: start + 6,
            stationId: seed.id,
            quantity: batch,
          },
          { type: "queue_changed", atMinutes: start + 6, stationId: seed.id, queue: 0 },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          { type: "station_idled", atMinutes: start + 8, stationId: seed.id },
          { type: "operator_released", atMinutes: start + 8, stationId: seed.id },
        ],
      },
    ];
  },
};

const setup: LiveScenario = {
  id: "setup",
  label: "Setup değişimi",
  description:
    "İstasyon yeni ürüne geçiyor; setup boyunca üretim durur, kuyruk birikir.",
  durationMinutes: 12,
  build(seeds, start) {
    const seed = pick(seeds, 2) ?? pick(seeds, 0);
    if (!seed) {
      return [];
    }

    return [
      {
        delayMs: 200,
        events: [
          {
            type: "operator_assigned",
            atMinutes: start,
            stationId: seed.id,
            operatorName: OPERATORS[3],
          },
          { type: "station_started", atMinutes: start, stationId: seed.id },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "setup_started",
            atMinutes: start + 2,
            stationId: seed.id,
            product: "Ürün B",
          },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          { type: "queue_changed", atMinutes: start + 4, stationId: seed.id, queue: 5 },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          { type: "queue_changed", atMinutes: start + 6, stationId: seed.id, queue: 9 },
        ],
      },
      {
        delayMs: BEAT_MS * 2,
        events: [
          { type: "setup_finished", atMinutes: start + 9, stationId: seed.id },
        ],
      },
      {
        delayMs: BEAT_MS,
        events: [
          {
            type: "part_completed",
            atMinutes: start + 11,
            stationId: seed.id,
            quantity: batchFor(seed),
          },
          { type: "queue_changed", atMinutes: start + 11, stationId: seed.id, queue: 3 },
        ],
      },
    ];
  },
};

export const SCENARIOS: LiveScenario[] = [
  normal,
  bottleneck,
  fault,
  handoff,
  setup,
];

export function scenarioById(id: ScenarioId): LiveScenario {
  return SCENARIOS.find((item) => item.id === id) ?? normal;
}
