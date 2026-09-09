/**
 * Birleşik alarm deposu.
 *
 * Bu dosya sprintin en açık sözünü korur: **tek gerçek**. Aynı arıza tek satır
 * üretir, onaylanan alarm geri açılmaz, benzetim ile gerçek karışmaz.
 */

import { describe, expect, it } from "vitest";
import {
  UnifiedAlarmStore,
  countAlarms,
  fromSimulationAlarm,
  mergeAlarms,
  sortAlarms,
} from "./store";
import type { UnifiedAlarm, UnifiedAlarmSeverity, UnifiedAlarmState } from "./types";

function alarm(overrides: Partial<UnifiedAlarm> = {}): UnifiedAlarm {
  const severity: UnifiedAlarmSeverity = overrides.severity ?? "critical";
  const state: UnifiedAlarmState = overrides.state ?? "OPEN";
  return {
    id: "machine_down::TORNA_01",
    rule: "machine_down",
    ruleLabel: "Makine durdu",
    subject: "TORNA_01",
    severity,
    severityLabel: "Kritik",
    state,
    stateLabel: "Açık",
    origin: "runtime",
    unattendedMs: null,
    silencedBy: null,
    silencedUntilMs: null,
    silenceReason: null,
    escalatedAtMs: null,
    escalationLevel: 0,
    repeatCount: 0,
    originLabel: "Gerçek",
    message: "TORNA_01 duruşta.",
    raisedAtMs: 1_000,
    updatedAtMs: 1_000,
    acknowledgedBy: null,
    acknowledgedAtMs: null,
    resolvedAtMs: null,
    durationMs: null,
    context: {},
    ...overrides,
  };
}

describe("birleştirme", () => {
  it("yeni alarm listeye girer", () => {
    expect(mergeAlarms([], [alarm()])).toHaveLength(1);
  });

  it("aynı kimlik iki satır üretmez", () => {
    expect(mergeAlarms([alarm()], [alarm()])).toHaveLength(1);
  });

  it("farklı kimlik ayrı satır olur", () => {
    const merged = mergeAlarms([alarm()], [alarm({ id: "queue_high::TORNA_01" })]);
    expect(merged).toHaveLength(2);
  });

  it("mesaj tazelenir", () => {
    const merged = mergeAlarms([alarm()], [alarm({ message: "Kuyruk 30 parça." })]);
    expect(merged[0].message).toBe("Kuyruk 30 parça.");
  });

  it("ilk görülme anı korunur", () => {
    const merged = mergeAlarms([alarm()], [alarm({ raisedAtMs: 90_000 })]);
    expect(merged[0].raisedAtMs).toBe(1_000);
  });

  it("onaylanan alarm açığa dönmez", () => {
    const merged = mergeAlarms(
      [alarm({ state: "ACKNOWLEDGED", acknowledgedBy: "Ayşe" })],
      [alarm({ state: "OPEN" })],
    );
    expect(merged[0].state).toBe("ACKNOWLEDGED");
  });

  it("onaylayan kişi korunur", () => {
    const merged = mergeAlarms(
      [alarm({ state: "ACKNOWLEDGED", acknowledgedBy: "Ayşe" })],
      [alarm({ state: "OPEN" })],
    );
    expect(merged[0].acknowledgedBy).toBe("Ayşe");
  });

  it("kapanma bildirimi kabul edilir", () => {
    const merged = mergeAlarms(
      [alarm({ state: "ACKNOWLEDGED" })],
      [alarm({ state: "RESOLVED" })],
    );
    expect(merged[0].state).toBe("RESOLVED");
  });
});

describe("sıralama", () => {
  it("kritik önce gelir", () => {
    const sorted = sortAlarms([
      alarm({ id: "a", severity: "info" }),
      alarm({ id: "b", severity: "critical" }),
    ]);
    expect(sorted[0].severity).toBe("critical");
  });

  it("uyarı bilgiden önce gelir", () => {
    const sorted = sortAlarms([
      alarm({ id: "a", severity: "info" }),
      alarm({ id: "b", severity: "warning" }),
    ]);
    expect(sorted[0].severity).toBe("warning");
  });

  it("aynı ağırlıkta yeni olan önce gelir", () => {
    const sorted = sortAlarms([
      alarm({ id: "a", raisedAtMs: 1_000 }),
      alarm({ id: "b", raisedAtMs: 9_000 }),
    ]);
    expect(sorted[0].id).toBe("b");
  });

  it("özgün liste değişmez", () => {
    const original = [alarm({ id: "a", severity: "info" }), alarm({ id: "b" })];
    sortAlarms(original);
    expect(original[0].id).toBe("a");
  });
});

describe("sayaçlar", () => {
  it("etkin sayısı sayılır", () => {
    expect(countAlarms([alarm(), alarm({ id: "b" })], []).active).toBe(2);
  });

  it("açık ve onaylı ayrışır", () => {
    const counts = countAlarms(
      [alarm(), alarm({ id: "b", state: "ACKNOWLEDGED" })],
      [],
    );
    expect(counts.open).toBe(1);
    expect(counts.acknowledged).toBe(1);
  });

  it("kritik sayısı ayrı tutulur", () => {
    const counts = countAlarms([alarm(), alarm({ id: "b", severity: "info" })], []);
    expect(counts.critical).toBe(1);
  });

  it("geçmiş sayılır", () => {
    expect(countAlarms([], [alarm({ state: "RESOLVED" })]).history).toBe(1);
  });

  it("boş depoda hepsi sıfır", () => {
    expect(countAlarms([], []).active).toBe(0);
  });
});

describe("depo", () => {
  it("yeni alarm açar", () => {
    const store = new UnifiedAlarmStore();
    expect(store.sync([alarm()], "runtime").opened).toBe(1);
  });

  it("aynı alarm ikinci kez açılmaz", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    const result = store.sync([alarm()], "runtime");
    expect(result.opened).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("yüz eşitleme tek satır bırakır", () => {
    const store = new UnifiedAlarmStore();
    for (let step = 0; step < 100; step += 1) {
      store.sync([alarm({ updatedAtMs: step * 1_000 })], "runtime");
    }
    expect(store.view().active).toHaveLength(1);
  });

  it("listeden düşen alarm kapanır", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    const result = store.sync([], "runtime");
    expect(result.resolved).toBe(1);
    expect(store.view().active).toHaveLength(0);
  });

  it("kapanan alarm geçmişe gider", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.sync([], "runtime");
    expect(store.view().history[0].state).toBe("RESOLVED");
  });

  it("başka kaynağın eşitlemesi bu kaynağın alarmını kapatmaz", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.sync([], "simulation");
    expect(store.view().active).toHaveLength(1);
  });

  it("benzetim ve gerçek birlikte durur", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.sync([alarm({ id: "simulation::x", origin: "simulation" })], "simulation");
    expect(store.view().active).toHaveLength(2);
  });

  it("kaynağa göre süzülür", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.sync([alarm({ id: "simulation::x", origin: "simulation" })], "simulation");
    expect(store.byOrigin("simulation")).toHaveLength(1);
  });

  it("ağırlığa göre süzülür", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm(), alarm({ id: "b", severity: "warning" })], "runtime");
    expect(store.bySeverity("critical")).toHaveLength(1);
  });

  it("makineye göre süzülür", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm(), alarm({ id: "b", subject: "FREZE_01" })], "runtime");
    expect(store.forSubject("FREZE_01")).toHaveLength(1);
  });

  it("açık alarm onaylanır", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    const result = store.acknowledge("machine_down::TORNA_01", "Ayşe", 5_000);
    expect(result?.state).toBe("ACKNOWLEDGED");
  });

  it("onaylayan yazılır", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.acknowledge("machine_down::TORNA_01", "Ayşe", 5_000);
    expect(store.view().active[0].acknowledgedBy).toBe("Ayşe");
  });

  it("ikinci onay reddedilir", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.acknowledge("machine_down::TORNA_01", "Ayşe", 5_000);
    expect(store.acknowledge("machine_down::TORNA_01", "Mehmet", 6_000)).toBeNull();
  });

  it("bilinmeyen alarm onaylanamaz", () => {
    expect(new UnifiedAlarmStore().acknowledge("yok", "Ayşe", 1)).toBeNull();
  });

  it("onaylanan alarm sonraki eşitlemede açığa dönmez", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.acknowledge("machine_down::TORNA_01", "Ayşe", 5_000);
    for (let step = 0; step < 20; step += 1) {
      store.sync([alarm()], "runtime");
    }
    expect(store.view().active[0].state).toBe("ACKNOWLEDGED");
  });

  it("onaylanan alarm neden bitince kapanır", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.acknowledge("machine_down::TORNA_01", "Ayşe", 5_000);
    store.sync([], "runtime");
    expect(store.view().active).toHaveLength(0);
    expect(store.view().history[0].state).toBe("RESOLVED");
  });

  it("geçmiş sınırlanır", () => {
    const store = new UnifiedAlarmStore(3);
    for (let step = 0; step < 10; step += 1) {
      store.sync([alarm({ id: `m${step}` })], "runtime");
      store.sync([], "runtime");
    }
    expect(store.view().history).toHaveLength(3);
  });

  it("temizleme her şeyi siler", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    store.clear();
    expect(store.view().active).toHaveLength(0);
  });

  it("görünüm sayaçları içerir", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm()], "runtime");
    expect(store.view().counts.critical).toBe(1);
  });

  it("görünüm kritikten sıralı gelir", () => {
    const store = new UnifiedAlarmStore();
    store.sync(
      [alarm({ id: "a", severity: "info" }), alarm({ id: "b", severity: "critical" })],
      "runtime",
    );
    expect(store.view().active[0].severity).toBe("critical");
  });
});

describe("benzetim alarmının çevrilmesi", () => {
  const BENZETIM = {
    id: "fault:s1:120",
    level: "critical",
    stationId: "s1",
    stationName: "Torna",
    text: "Torna arızalandı.",
    atMinutes: 120,
    updatedAtMinutes: 125,
    resolvedAtMinutes: null,
  };

  it("kaynağı benzetim olur", () => {
    expect(fromSimulationAlarm(BENZETIM).origin).toBe("simulation");
  });

  it("etiket benzetim yazar", () => {
    expect(fromSimulationAlarm(BENZETIM).originLabel).toBe("Benzetim");
  });

  it("kimlik ön ek alır", () => {
    expect(fromSimulationAlarm(BENZETIM).id).toBe("simulation::fault:s1:120");
  });

  it("gerçek alarmla kimliği çakışmaz", () => {
    const store = new UnifiedAlarmStore();
    store.sync([alarm({ id: "simulation::fault:s1:120" })], "runtime");
    expect(fromSimulationAlarm(BENZETIM).id).toBe("simulation::fault:s1:120");
  });

  it("dakika milisaniyeye çevrilir", () => {
    expect(fromSimulationAlarm(BENZETIM).raisedAtMs).toBe(120 * 60_000);
  });

  it("açık alarmın süresi ölçülmemiştir", () => {
    expect(fromSimulationAlarm(BENZETIM).durationMs).toBeNull();
  });

  it("kapanan alarmın süresi hesaplanır", () => {
    const closed = fromSimulationAlarm({ ...BENZETIM, resolvedAtMinutes: 130 });
    expect(closed.durationMs).toBe(10 * 60_000);
  });

  it("kapanan alarm kapalı işaretlenir", () => {
    const closed = fromSimulationAlarm({ ...BENZETIM, resolvedAtMinutes: 130 });
    expect(closed.state).toBe("RESOLVED");
  });

  it("tanınmayan seviye uyarı olur", () => {
    const parsed = fromSimulationAlarm({ ...BENZETIM, level: "felaket" });
    expect(parsed.severity).toBe("warning");
  });

  it("istasyon adı bağlamda taşınır", () => {
    expect(fromSimulationAlarm(BENZETIM).context.stationName).toBe("Torna");
  });
});
