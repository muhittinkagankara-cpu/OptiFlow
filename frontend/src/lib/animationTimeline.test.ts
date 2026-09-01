/**
 * Animasyon zaman çizelgesinin birim testleri.
 *
 * Buradaki hatalar sessizdir: bir evrenin bitişi yanlış hesaplanırsa parçalar
 * ekranda takılı kalır ya da sebepsizce kaybolur, ve bu ancak animasyon
 * izlenirken fark edilir. Testler, backend'in gerçekten ürettiği olay
 * dizilerini kullanır (`arrival → service_start → service_end → ...`).
 */

import { describe, expect, it } from "vitest";
import {
  buildPhases,
  entitiesAt,
  summarizeTrace,
  type EntityPhase,
} from "./animationTimeline";
import type {
  SimulationEvent,
  SimulationEventType,
  SimulationTrace,
} from "../types/simulationTypes";

function event(
  timestamp: number,
  entityId: string,
  type: SimulationEventType,
  stationId: string | null = null,
): SimulationEvent {
  return {
    timestamp,
    entity_id: entityId,
    event_type: type,
    station_id: stationId,
  };
}

function trace(events: SimulationEvent[], duration = 100): SimulationTrace {
  return {
    events,
    duration_minutes: duration,
    replication_index: 0,
    total_replications: 30,
    truncated: false,
    station_ids: ["A", "B"],
  };
}

/** Backend'in tek bir parça için ürettiği tipik dizi. */
const SINGLE_ENTITY = trace([
  event(10, "1", "arrival"),
  event(10, "1", "service_start", "A"),
  event(12, "1", "service_end", "A"),
  event(12, "1", "queue_enter", "B"),
  event(15, "1", "queue_exit", "B"),
  event(15, "1", "service_start", "B"),
  event(18, "1", "service_end", "B"),
  event(18, "1", "system_exit", "B"),
]);

// --------------------------------------------------------------------------- //
// 1. Evrelere bölme
// --------------------------------------------------------------------------- //

describe("buildPhases", () => {
  it("tek bir parçanın yaşam döngüsünü evrelere böler", () => {
    // Beklenen evreler elle turetildi. Ayni anda gerceklesen olaylarin
    // arasindaki sifir uzunluklu evreler (arrival->service_start,
    // service_end->queue_enter, service_end->system_exit) atilir.
    const phases = buildPhases(SINGLE_ENTITY);

    expect(
      phases.map((phase) => [phase.kind, phase.start, phase.end, phase.toStation]),
    ).toEqual([
      ["service", 10, 12, "A"],
      ["queued", 12, 15, "B"],
      ["service", 15, 18, "B"],
    ]);
  });

  it("sıfır uzunluklu evreleri atar", () => {
    // arrival ve service_start ayni anda (t=10) gerceklesir; aradaki
    // "yolculuk" evresi sifir uzunluktadir ve cizilemez.
    const phases = buildPhases(SINGLE_ENTITY);
    expect(phases.every((phase) => phase.end > phase.start)).toBe(true);
  });

  it("queue_exit kendi evresini oluşturmaz", () => {
    // Motor queue_exit'i her zaman service_start ile ayni anda uretir; kendi
    // evresi olsaydi parca bir kare boyunca hicbir yerde gorunmezdi.
    const phases = buildPhases(SINGLE_ENTITY);
    const queueExitPhases = phases.filter(
      (phase) => phase.start === 15 && phase.kind === "travel",
    );
    expect(queueExitPhases).toHaveLength(0);
  });

  it("kuyruk evresini doğru istasyona bağlar", () => {
    const phases = buildPhases(SINGLE_ENTITY);
    const queued = phases.find((phase) => phase.kind === "queued");

    expect(queued).toBeDefined();
    expect(queued?.toStation).toBe("B");
    expect(queued?.start).toBe(12);
    expect(queued?.end).toBe(15);
  });

  it("işlem evresini doğru istasyona ve süreye bağlar", () => {
    const phases = buildPhases(SINGLE_ENTITY);
    const services = phases.filter((phase) => phase.kind === "service");

    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({ toStation: "A", start: 10, end: 12 });
    expect(services[1]).toMatchObject({ toStation: "B", start: 15, end: 18 });
  });

  it("istasyonlar arası yolculuğun iki ucunu da bilir", () => {
    const moving = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(5, "1", "service_end", "A"),
      event(8, "1", "queue_enter", "B"),
    ]);
    const travel = buildPhases(moving).find((phase) => phase.kind === "travel");

    expect(travel).toMatchObject({ fromStation: "A", toStation: "B", start: 5, end: 8 });
  });

  it("sistemden çıkışta hedef boş kalır", () => {
    const leaving = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(5, "1", "service_end", "A"),
      event(7, "1", "system_exit", "A"),
    ]);
    const travel = buildPhases(leaving).find((phase) => phase.kind === "travel");

    expect(travel?.fromStation).toBe("A");
    expect(travel?.toStation).toBeNull();
  });

  it("son olayı system_exit olan parça sahnede kalmaz", () => {
    const phases = buildPhases(SINGLE_ENTITY);
    const last = phases[phases.length - 1];

    // system_exit evre baslatmaz; en son evre ondan once biter.
    expect(last.end).toBeLessThanOrEqual(18);
    expect(entitiesAt(phases, 20)).toHaveLength(0);
  });

  it("penceresi ortasında kesilen parça izin sonuna kadar kalır", () => {
    // Iz penceresi parcanin ortasinda bitmisse parca yok olmamalidir; aksi
    // halde pencere sonuna dogru parcalar sebepsizce kaybolurdu.
    const cut = trace(
      [
        event(90, "1", "arrival"),
        event(90, "1", "service_start", "A"),
      ],
      100,
    );
    const phases = buildPhases(cut);
    const service = phases.find((phase) => phase.kind === "service");

    expect(service?.end).toBe(100);
    expect(entitiesAt(phases, 99)).toHaveLength(1);
  });

  it("evreler başlangıç zamanına göre sıralı döner", () => {
    const many = trace([
      event(30, "2", "arrival"),
      event(30, "2", "service_start", "A"),
      event(10, "1", "arrival"),
      event(10, "1", "service_start", "A"),
      event(35, "2", "service_end", "A"),
      event(40, "2", "system_exit", "A"),
      event(20, "1", "service_end", "A"),
      event(25, "1", "system_exit", "A"),
    ]);
    const starts = buildPhases(many).map((phase) => phase.start);

    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("boş iz boş liste üretir", () => {
    expect(buildPhases(trace([]))).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// 2. Belirli bir andaki parçalar
// --------------------------------------------------------------------------- //

describe("entitiesAt", () => {
  const phases = buildPhases(SINGLE_ENTITY);

  it("başlamamış parçayı göstermez", () => {
    expect(entitiesAt(phases, 5)).toHaveLength(0);
  });

  it("işlemdeki parçayı doğru istasyonda gösterir", () => {
    const active = entitiesAt(phases, 11);

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: "service", stationId: "A" });
  });

  it("kuyruktaki parçayı doğru istasyonda gösterir", () => {
    const active = entitiesAt(phases, 13);

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: "queued", stationId: "B" });
  });

  it("çıkmış parçayı göstermez", () => {
    expect(entitiesAt(phases, 50)).toHaveLength(0);
  });

  it("evre sınırlarında parçayı iki kez göstermez", () => {
    // Bir evrenin bitisi bir sonrakinin baslangicidir; her ikisi de aktif
    // sayilirsa parca ekranda cift gorunurdu.
    for (const time of [10, 12, 15, 18]) {
      const ids = entitiesAt(phases, time).map((item) => item.entityId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("yolculuk ilerlemesini doğrusal hesaplar", () => {
    const moving = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(10, "1", "service_end", "A"),
      event(20, "1", "queue_enter", "B"),
    ]);
    const movingPhases = buildPhases(moving);

    expect(entitiesAt(movingPhases, 10)[0].progress).toBeCloseTo(0, 5);
    expect(entitiesAt(movingPhases, 15)[0].progress).toBeCloseTo(0.5, 5);
    expect(entitiesAt(movingPhases, 19.99)[0].progress).toBeCloseTo(1, 2);
  });

  it("kuyruktaki parçaları geliş sırasına göre numaralar", () => {
    // Motor FIFO calisir; kuyruk sirasi gercek hizmet sirasiyla ayni olmali.
    const queueing = trace([
      event(0, "1", "arrival"),
      event(0, "1", "queue_enter", "B"),
      event(1, "2", "arrival"),
      event(1, "2", "queue_enter", "B"),
      event(2, "3", "arrival"),
      event(2, "3", "queue_enter", "B"),
      event(50, "1", "queue_exit", "B"),
      event(50, "1", "service_start", "B"),
    ]);
    const queued = entitiesAt(buildPhases(queueing), 10);

    expect(queued).toHaveLength(3);
    const byIndex = [...queued].sort((a, b) => a.queueIndex - b.queueIndex);
    expect(byIndex.map((item) => item.entityId)).toEqual(["1", "2", "3"]);
  });

  it("farklı istasyonların kuyrukları ayrı numaralanır", () => {
    const twoQueues = trace([
      event(0, "1", "arrival"),
      event(0, "1", "queue_enter", "A"),
      event(0, "2", "arrival"),
      event(0, "2", "queue_enter", "B"),
    ]);
    const active = entitiesAt(buildPhases(twoQueues), 5);

    expect(active).toHaveLength(2);
    // Her ikisi de kendi kuyrugunun basinda olmali.
    expect(active.every((item) => item.queueIndex === 0)).toBe(true);
  });

  it("bloke parçayı kendi türüyle gösterir", () => {
    const blocking = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(5, "1", "service_end", "A"),
      event(5, "1", "blocked", "A"),
      event(9, "1", "queue_enter", "B"),
    ]);
    const active = entitiesAt(buildPhases(blocking), 7);

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: "blocked", stationId: "A" });
  });
  it("paralel makinede işlem gören parçaları üst üste çizdirmez", () => {
    // Tek bir istasyonda aynı anda üç parça işlem görüyor. Gruplanmasalardı
    // hepsi kutunun merkezine, tek noktaya çizilir ve kullanıcı üç meşgul
    // makineyi tek parça sanırdı.
    const phases = buildPhases(
      trace([
        event(0, "1", "arrival"),
        event(0, "1", "service_start", "A"),
        event(2, "2", "arrival"),
        event(2, "2", "service_start", "A"),
        event(4, "3", "arrival"),
        event(4, "3", "service_start", "A"),
        event(30, "1", "service_end", "A"),
        event(30, "1", "system_exit", "A"),
        event(32, "2", "service_end", "A"),
        event(32, "2", "system_exit", "A"),
        event(34, "3", "service_end", "A"),
        event(34, "3", "system_exit", "A"),
      ]),
    );

    const inService = entitiesAt(phases, 10).filter(
      (entity) => entity.kind === "service",
    );
    expect(inService).toHaveLength(3);
    expect(inService.map((entity) => entity.queueIndex).sort()).toEqual([0, 1, 2]);
    expect(inService.every((entity) => entity.groupSize === 3)).toBe(true);
  });

  it("işlemdeki parçaları da giriş sırasına göre dizer", () => {
    const phases = buildPhases(
      trace([
        event(5, "geç", "arrival"),
        event(5, "geç", "service_start", "A"),
        event(1, "erken", "arrival"),
        event(1, "erken", "service_start", "A"),
        event(50, "erken", "service_end", "A"),
        event(50, "erken", "system_exit", "A"),
        event(52, "geç", "service_end", "A"),
        event(52, "geç", "system_exit", "A"),
      ]),
    );

    const inService = entitiesAt(phases, 20)
      .filter((entity) => entity.kind === "service")
      .sort((first, second) => first.queueIndex - second.queueIndex);
    expect(inService.map((entity) => entity.entityId)).toEqual(["erken", "geç"]);
  });

  it("bloke parçaları işlemdekilerle aynı grupta sayar", () => {
    // Bloke parça da kutunun içinde durur; ayrı gruplansaydı işlemdekinin
    // üstüne çizilirdi.
    const phases = buildPhases(
      trace([
        event(0, "1", "arrival"),
        event(0, "1", "service_start", "A"),
        event(10, "1", "blocked", "A"),
        event(40, "1", "system_exit", "A"),
        event(2, "2", "arrival"),
        event(2, "2", "service_start", "A"),
        event(45, "2", "service_end", "A"),
        event(45, "2", "system_exit", "A"),
      ]),
    );

    const inBox = entitiesAt(phases, 20).filter(
      (entity) => entity.kind === "service" || entity.kind === "blocked",
    );
    expect(inBox).toHaveLength(2);
    expect(new Set(inBox.map((entity) => entity.queueIndex)).size).toBe(2);
    expect(inBox.every((entity) => entity.groupSize === 2)).toBe(true);
  });

  it("kuyruk ve işlem gruplarını birbirine karıştırmaz", () => {
    const phases = buildPhases(
      trace([
        event(0, "1", "arrival"),
        event(0, "1", "service_start", "A"),
        event(60, "1", "service_end", "A"),
        event(60, "1", "system_exit", "A"),
        event(5, "2", "arrival"),
        event(5, "2", "queue_enter", "A"),
        event(60, "2", "queue_exit", "A"),
        event(60, "2", "service_start", "A"),
        event(70, "2", "system_exit", "A"),
      ]),
    );

    const active = entitiesAt(phases, 20);
    const service = active.filter((entity) => entity.kind === "service");
    const queued = active.filter((entity) => entity.kind === "queued");
    expect(service).toHaveLength(1);
    expect(queued).toHaveLength(1);
    // Ayrı gruplar: her biri kendi içinde tek kişilik.
    expect(service[0].groupSize).toBe(1);
    expect(queued[0].groupSize).toBe(1);
  });

  it("yolculuktaki parça tek kişilik grup sayılır", () => {
    // İki istasyon arasında gerçekten süren bir yolculuk gerekir; aynı zaman
    // damgalı olaylar sıfır uzunlukta evre üretir ve elenir.
    const phases = buildPhases(
      trace([
        event(0, "1", "arrival"),
        event(0, "1", "service_start", "A"),
        event(5, "1", "service_end", "A"),
        event(8, "1", "queue_enter", "B"),
      ]),
    );
    const travelling = entitiesAt(phases, 6).filter(
      (entity) => entity.kind === "travel",
    );
    expect(travelling.length).toBeGreaterThan(0);
    expect(travelling.every((entity) => entity.groupSize === 1)).toBe(true);
  });
});

// --------------------------------------------------------------------------- //
// 3. Özet
// --------------------------------------------------------------------------- //

describe("summarizeTrace", () => {
  it("parça ve blokaj sayılarını çıkarır", () => {
    const blocking = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(5, "1", "service_end", "A"),
      event(5, "1", "blocked", "A"),
      event(9, "1", "queue_enter", "B"),
      event(2, "2", "arrival"),
      event(2, "2", "queue_enter", "A"),
    ]);
    const summary = summarizeTrace(blocking, buildPhases(blocking));

    expect(summary.entityCount).toBe(2);
    expect(summary.blockedEvents).toBe(1);
  });

  it("en yoğun kuyruğu ve tepe uzunluğunu bulur", () => {
    const queueing = trace([
      event(0, "1", "arrival"),
      event(0, "1", "queue_enter", "B"),
      event(1, "2", "arrival"),
      event(1, "2", "queue_enter", "B"),
      event(2, "3", "arrival"),
      event(2, "3", "queue_enter", "B"),
      event(3, "4", "arrival"),
      event(3, "4", "queue_enter", "A"),
      event(60, "1", "queue_exit", "B"),
      event(60, "1", "service_start", "B"),
    ]);
    const summary = summarizeTrace(queueing, buildPhases(queueing));

    expect(summary.busiestStationId).toBe("B");
    expect(summary.peakQueueLength).toBe(3);
  });

  it("kuyruk oluşmayan izde tepe sıfırdır", () => {
    const noQueue = trace([
      event(0, "1", "arrival"),
      event(0, "1", "service_start", "A"),
      event(5, "1", "service_end", "A"),
      event(5, "1", "system_exit", "A"),
    ]);
    const summary = summarizeTrace(noQueue, buildPhases(noQueue));

    expect(summary.peakQueueLength).toBe(0);
    expect(summary.busiestStationId).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// 4. Performans — 500 dakikalık gerçekçi iz
// --------------------------------------------------------------------------- //

describe("performans", () => {
  /** Gerçek ize yakın boyutta sentetik bir iz üretir. */
  function largeTrace(entityCount: number): SimulationTrace {
    const events: SimulationEvent[] = [];
    for (let index = 0; index < entityCount; index += 1) {
      const base = index * 2.4;
      const id = String(index);
      events.push(event(base, id, "arrival"));
      events.push(event(base, id, "queue_enter", "A"));
      events.push(event(base + 0.5, id, "queue_exit", "A"));
      events.push(event(base + 0.5, id, "service_start", "A"));
      events.push(event(base + 1.5, id, "service_end", "A"));
      events.push(event(base + 1.8, id, "queue_enter", "B"));
      events.push(event(base + 2.4, id, "queue_exit", "B"));
      events.push(event(base + 2.4, id, "service_start", "B"));
      events.push(event(base + 3.6, id, "service_end", "B"));
      events.push(event(base + 3.8, id, "system_exit", "B"));
    }
    events.sort((first, second) => first.timestamp - second.timestamp);
    return trace(events, entityCount * 2.4 + 10);
  }

  it("2000+ olaylı izde bir karelik hesap hızlı kalır", () => {
    // Gercek olculen iz 500 dakikada ~2.085 olay iceriyordu; 60 fps'de her
    // kare bu hesabi yapar, dolayisiyla tek bir cagri milisaniyeler surmeli.
    const large = largeTrace(220);
    const phases = buildPhases(large);

    expect(large.events.length).toBeGreaterThan(2000);

    const started = performance.now();
    for (let frame = 0; frame < 60; frame += 1) {
      entitiesAt(phases, (frame / 60) * large.duration_minutes);
    }
    const elapsed = performance.now() - started;

    // 60 kare (bir saniyelik animasyon) toplam 100 ms'nin altinda kalmali.
    expect(elapsed).toBeLessThan(100);
  });

  it("aynı anda ekranda az sayıda parça bulunur", () => {
    // Canvas cizimi bu sayiyla orantilidir; yuzlerce parca ayni anda
    // gorunseydi cizim maliyeti sorun olurdu.
    const large = largeTrace(220);
    const phases = buildPhases(large);

    let peak = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      const count = entitiesAt(phases, (frame / 200) * large.duration_minutes).length;
      peak = Math.max(peak, count);
    }

    expect(peak).toBeLessThan(30);
  });
});

// --------------------------------------------------------------------------- //
// 5. Değişmezler
// --------------------------------------------------------------------------- //

describe("değişmezler", () => {
  const phases: EntityPhase[] = buildPhases(SINGLE_ENTITY);

  it("her evrenin bitişi başlangıcından sonradır", () => {
    expect(phases.every((phase) => phase.end > phase.start)).toBe(true);
  });

  it("yolculuk dışındaki evreler bir istasyona bağlıdır", () => {
    for (const phase of phases) {
      if (phase.kind !== "travel") {
        expect(phase.toStation).not.toBeNull();
      }
    }
  });

  it("ilerleme her zaman 0 ile 1 arasındadır", () => {
    for (let time = 0; time <= 20; time += 0.25) {
      for (const entity of entitiesAt(phases, time)) {
        expect(entity.progress).toBeGreaterThanOrEqual(0);
        expect(entity.progress).toBeLessThanOrEqual(1);
      }
    }
  });
});
