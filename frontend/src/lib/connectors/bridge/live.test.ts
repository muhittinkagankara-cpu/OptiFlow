import { describe, expect, it } from "vitest";
import {
  ALARM_STATE_LABEL,
  RUNTIME_SOURCE_ID,
  STALE_AFTER_MS,
  STATION_STATUS_LABEL,
  acknowledgeAlarm,
  alarmsFromMachines,
  conflictingMachines,
  freshnessLabel,
  hasCriticalStatus,
  mergeAlarms,
  openAlarms,
  parseOverwrite,
  parseRuntimeDashboard,
  parseRuntimeKpi,
  parseRuntimeLiveState,
  parseRuntimeMachine,
  parseStationStatus,
  toDeviceState,
  unmeasuredOf,
  type RuntimeAlarm,
  type RuntimeMachine,
} from "./live";

const NOW = 1_700_000_000_000;

function machine(overrides: Partial<RuntimeMachine> = {}): RuntimeMachine {
  return {
    machineId: "TORNA_01",
    status: "running",
    statusLabel: "Çalışıyor",
    productionCount: null,
    scrapCount: null,
    queueLength: null,
    downtimeMinutes: null,
    throughputPerHour: null,
    cycleTimeSeconds: null,
    oee: null,
    sources: {},
    sampleCount: 0,
    updatedAtMs: NOW,
    ...overrides,
  };
}

describe("kaynak ve etiketler", () => {
  it("runtime kaynagi kimligi sabit", () => {
    expect(RUNTIME_SOURCE_ID).toBe("runtime");
  });

  it("dort istasyon durumu ve bilinmeyen tanimli", () => {
    expect(Object.keys(STATION_STATUS_LABEL)).toEqual([
      "running",
      "idle",
      "blocked",
      "down",
      "unknown",
    ]);
  });

  it("etiketler turkce", () => {
    expect(STATION_STATUS_LABEL.blocked).toBe("Bloke");
    expect(STATION_STATUS_LABEL.unknown).toBe("Bilinmiyor");
  });

  it("uc alarm durumu tanimli", () => {
    expect(Object.keys(ALARM_STATE_LABEL)).toEqual(["OPEN", "ACK", "RESOLVED"]);
  });
});

describe("parseStationStatus", () => {
  it("bilinen durumu korur", () => {
    expect(parseStationStatus("blocked")).toBe("blocked");
  });

  it("bilinmeyen durum bilinmiyor olur", () => {
    // Duran bir makineyi calisiyor gostermek en pahali hatadir.
    expect(parseStationStatus("acik")).toBe("unknown");
  });

  it("eksik durum bilinmiyor olur", () => {
    expect(parseStationStatus(undefined)).toBe("unknown");
  });
});

describe("parseRuntimeMachine", () => {
  it("alanlari okur", () => {
    const item = parseRuntimeMachine({
      machine_id: "TORNA_01",
      status: "running",
      status_label: "Çalışıyor",
      production_count: 1240,
      queue_length: 3,
      sample_count: 12,
      updated_at_ms: 5_000,
    });
    expect(item.machineId).toBe("TORNA_01");
    expect(item.productionCount).toBe(1240);
    expect(item.queueLength).toBe(3);
    expect(item.sampleCount).toBe(12);
  });

  it("olculmeyen alan null kalir", () => {
    const item = parseRuntimeMachine({ machine_id: "A" });
    expect(item.productionCount).toBeNull();
    expect(item.oee).toBeNull();
  });

  it("olculmus sifir korunur", () => {
    expect(parseRuntimeMachine({ queue_length: 0 }).queueLength).toBe(0);
  });

  it("etiket yoksa durumdan turetilir", () => {
    expect(parseRuntimeMachine({ status: "down" }).statusLabel).toBe("Duruş");
  });

  it("kaynaklar okunur", () => {
    const item = parseRuntimeMachine({ sources: { production_count: "plc-1" } });
    expect(item.sources.production_count).toBe("plc-1");
  });

  it("metin olmayan kaynak atilir", () => {
    expect(parseRuntimeMachine({ sources: { a: 5 } }).sources).toEqual({});
  });

  it("bos gövde cokmeden okunur", () => {
    expect(parseRuntimeMachine({}).status).toBe("unknown");
  });
});

describe("parseRuntimeKpi", () => {
  it("bos gövdede olculer null", () => {
    const kpi = parseRuntimeKpi({});
    expect(kpi.production).toBeNull();
    expect(kpi.availability).toBeNull();
  });

  it("bos gövdede sayaclar sifir", () => {
    expect(parseRuntimeKpi({}).totalMachines).toBe(0);
  });

  it("degerleri okur", () => {
    const kpi = parseRuntimeKpi({
      production: 100,
      availability: 0.75,
      active_machines: 3,
      total_machines: 4,
    });
    expect(kpi.production).toBe(100);
    expect(kpi.availability).toBe(0.75);
    expect(kpi.activeMachines).toBe(3);
  });
});

describe("parseRuntimeLiveState", () => {
  it("bos gövde cokmeden okunur", () => {
    const state = parseRuntimeLiveState({});
    expect(state.machines).toEqual([]);
    expect(state.kpi.production).toBeNull();
    expect(state.persistence.persistent).toBe(false);
  });

  it("makineler cozulur", () => {
    const state = parseRuntimeLiveState({
      machines: [{ machine_id: "A" }, { machine_id: "B" }],
    });
    expect(state.machines).toHaveLength(2);
  });

  it("kalicilik durumu okunur", () => {
    const state = parseRuntimeLiveState({
      persistence: { mode: "database", persistent: true },
    });
    expect(state.persistence.mode).toBe("database");
    expect(state.persistence.persistent).toBe(true);
  });

  it("ustune yazmalar cozulur", () => {
    const state = parseRuntimeLiveState({
      overwrites: [
        {
          machine_id: "A",
          metric: "production_count",
          previous_source: "plc-1",
          new_source: "mqtt-1",
          at_ms: 5,
        },
      ],
    });
    expect(state.overwrites[0].previousSource).toBe("plc-1");
  });
});

describe("parseOverwrite", () => {
  it("alanlari okur", () => {
    const item = parseOverwrite({
      machine_id: "A",
      metric: "queue_length",
      previous_source: "a",
      new_source: "b",
      at_ms: 9,
    });
    expect(item.metric).toBe("queue_length");
    expect(item.newSource).toBe("b");
  });

  it("bos gövdede bos metin doner", () => {
    expect(parseOverwrite({}).machineId).toBe("");
  });
});

describe("parseRuntimeDashboard", () => {
  it("bos gövdede sayaclar sifir", () => {
    const dashboard = parseRuntimeDashboard({});
    expect(dashboard.connections).toBe(0);
    expect(dashboard.snapshots).toBe(0);
  });

  it("olculmeyen olay hizi null kalir", () => {
    // Bir saniyelik pencereden hiz cikarmak olcum degil tahmindir.
    expect(parseRuntimeDashboard({}).eventsPerSecond).toBeNull();
  });

  it("kalicilik modu okunur", () => {
    const dashboard = parseRuntimeDashboard({
      persistence_mode: "database",
      persistent: true,
    });
    expect(dashboard.persistenceMode).toBe("database");
    expect(dashboard.persistent).toBe(true);
  });

  it("kurtarma sayisi okunur", () => {
    expect(parseRuntimeDashboard({ recoveries: 3 }).recoveries).toBe(3);
  });
});

describe("alarmsFromMachines", () => {
  it("calisan makine alarm uretmez", () => {
    expect(alarmsFromMachines([machine()], NOW)).toEqual([]);
  });

  it("durus alarmi uretilir", () => {
    const alarms = alarmsFromMachines([machine({ status: "down" })], NOW);
    expect(alarms).toHaveLength(1);
    expect(alarms[0].kind).toBe("down");
    expect(alarms[0].state).toBe("OPEN");
  });

  it("bloke alarmi uretilir", () => {
    const alarms = alarmsFromMachines([machine({ status: "blocked" })], NOW);
    expect(alarms[0].kind).toBe("blocked");
  });

  it("bloke ve durus ayni anda uretilmez", () => {
    const alarms = alarmsFromMachines([machine({ status: "down" })], NOW);
    expect(alarms.filter((alarm) => alarm.kind === "blocked")).toHaveLength(0);
  });

  it("veri eskimesi ayri alarm uretir", () => {
    // "Makine duruyor" ile "makineden haber alamiyoruz" farkli sorunlardir.
    const alarms = alarmsFromMachines(
      [machine({ updatedAtMs: NOW - STALE_AFTER_MS - 1_000 })],
      NOW,
    );
    expect(alarms).toHaveLength(1);
    expect(alarms[0].kind).toBe("stale");
  });

  it("taze veri eskime alarmi uretmez", () => {
    const alarms = alarmsFromMachines([machine({ updatedAtMs: NOW - 1_000 })], NOW);
    expect(alarms).toEqual([]);
  });

  it("hic olcum alinmamis makine eskime alarmi uretmez", () => {
    const alarms = alarmsFromMachines([machine({ updatedAtMs: 0 })], NOW);
    expect(alarms).toEqual([]);
  });

  it("alarm kimligi makine ve turden olusur", () => {
    const alarms = alarmsFromMachines([machine({ status: "down" })], NOW);
    expect(alarms[0].id).toBe("TORNA_01::down");
  });

  it("mesaj makine adini tasir", () => {
    const alarms = alarmsFromMachines([machine({ status: "down" })], NOW);
    expect(alarms[0].message).toContain("TORNA_01");
  });
});

describe("mergeAlarms", () => {
  function alarm(overrides: Partial<RuntimeAlarm> = {}): RuntimeAlarm {
    return {
      id: "TORNA_01::down",
      machineId: "TORNA_01",
      kind: "down",
      message: "duruş",
      state: "OPEN",
      raisedAtMs: NOW,
      updatedAtMs: NOW,
      ...overrides,
    };
  }

  it("yeni alarm eklenir", () => {
    expect(mergeAlarms([], [alarm()], NOW)).toHaveLength(1);
  });

  it("ayni alarm cift kaydedilmez", () => {
    const merged = mergeAlarms([alarm()], [alarm()], NOW + 1_000);
    expect(merged).toHaveLength(1);
  });

  it("gorulmus alarm yeniden acik olmaz", () => {
    // Operator "goruldu" dediyse, bir sonraki yenilemede alarm yine acik
    // gorunmemeli.
    const merged = mergeAlarms([alarm({ state: "ACK" })], [alarm()], NOW + 1_000);
    expect(merged[0].state).toBe("ACK");
  });

  it("kaybolan neden alarmi kapatir", () => {
    const merged = mergeAlarms([alarm()], [], NOW + 1_000);
    expect(merged[0].state).toBe("RESOLVED");
  });

  it("kapanan alarm silinmez", () => {
    // Kapanmanin kendisi de bir bilgidir.
    const merged = mergeAlarms([alarm()], [], NOW + 1_000);
    expect(merged).toHaveLength(1);
  });

  it("neden yeniden ortaya cikarsa alarm yeniden acilir", () => {
    const merged = mergeAlarms([alarm({ state: "RESOLVED" })], [alarm()], NOW + 5_000);
    expect(merged[0].state).toBe("OPEN");
  });

  it("mesaj guncellenir", () => {
    const merged = mergeAlarms(
      [alarm()],
      [alarm({ message: "yeni mesaj" })],
      NOW + 1_000,
    );
    expect(merged[0].message).toBe("yeni mesaj");
  });

  it("farkli makineler ayri alarm tutar", () => {
    const other = alarm({ id: "KAYNAK_01::down", machineId: "KAYNAK_01" });
    expect(mergeAlarms([alarm()], [alarm(), other], NOW)).toHaveLength(2);
  });

  it("sonuc en yeniden eskiye siralanir", () => {
    const eski = alarm({ id: "A::down", updatedAtMs: NOW - 10_000 });
    const yeni = alarm({ id: "B::down", updatedAtMs: NOW });
    const merged = mergeAlarms([eski, yeni], [], NOW + 1_000);
    expect(merged).toHaveLength(2);
  });
});

describe("acknowledgeAlarm", () => {
  const open: RuntimeAlarm = {
    id: "A::down",
    machineId: "A",
    kind: "down",
    message: "x",
    state: "OPEN",
    raisedAtMs: NOW,
    updatedAtMs: NOW,
  };

  it("acik alarm goruldu olur", () => {
    expect(acknowledgeAlarm([open], "A::down", NOW + 1)[0].state).toBe("ACK");
  });

  it("kapanmis alarm degismez", () => {
    const resolved = { ...open, state: "RESOLVED" as const };
    expect(acknowledgeAlarm([resolved], "A::down", NOW + 1)[0].state).toBe("RESOLVED");
  });

  it("olmayan kimlik listeyi bozmaz", () => {
    expect(acknowledgeAlarm([open], "yok", NOW + 1)[0].state).toBe("OPEN");
  });

  it("acik alarmlar suzulur", () => {
    const resolved = { ...open, id: "B::down", state: "RESOLVED" as const };
    expect(openAlarms([open, resolved])).toHaveLength(1);
  });
});

describe("ekran yardimcilari", () => {
  it("olculmeyen alanlar listelenir", () => {
    expect(unmeasuredOf(machine())).toHaveLength(4);
  });

  it("olculen alan listelenmez", () => {
    expect(unmeasuredOf(machine({ productionCount: 5 }))).not.toContain("Üretim");
  });

  it("cakisan makineler listelenir", () => {
    const machines = conflictingMachines([
      {
        machineId: "A",
        metric: "production_count",
        previousSource: "x",
        newSource: "y",
        atMs: 1,
      },
      {
        machineId: "A",
        metric: "queue_length",
        previousSource: "x",
        newSource: "y",
        atMs: 2,
      },
    ]);
    expect(machines).toEqual(["A"]);
  });

  it("tazelik az once yazar", () => {
    expect(freshnessLabel(machine({ updatedAtMs: NOW - 5_000 }), NOW)).toBe("az önce");
  });

  it("tazelik dakika yazar", () => {
    expect(freshnessLabel(machine({ updatedAtMs: NOW - 5 * 60_000 }), NOW)).toBe(
      "5 dk önce",
    );
  });

  it("tazelik saat yazar", () => {
    expect(freshnessLabel(machine({ updatedAtMs: NOW - 3 * 3_600_000 }), NOW)).toBe(
      "3 sa önce",
    );
  });

  it("olcum alinmamis makine bildirilir", () => {
    expect(freshnessLabel(machine({ updatedAtMs: 0 }), NOW)).toBe("Hiç ölçüm alınmadı");
  });

  it("durus kritik sayilir", () => {
    expect(hasCriticalStatus(machine({ status: "down" }))).toBe(true);
    expect(hasCriticalStatus(machine({ status: "idle" }))).toBe(false);
  });

  it("bloke cihaz durumuna cevrilir", () => {
    expect(toDeviceState("blocked")).toBe("setup");
    expect(toDeviceState("running")).toBe("running");
  });
});
