import { describe, expect, it } from "vitest";
import { FEED_LIMIT, reduceLive, reduceLiveMany, type LiveEvent } from "./events";
import { QUEUE_CRITICAL, QUEUE_WARNING, openAlarmCount } from "./alarms";
import { START, seed, state, stationOf } from "./fixtures";

describe("reduceLive — temel davranış", () => {
  it("bos olay dizisinde durumu degistirmez", () => {
    const before = state();
    expect(reduceLiveMany(before, [])).toBe(before);
  });

  it("taninmayan istasyonu sessizce gecer", () => {
    // Gercek bir MES baglantisinda baska bir hatta ait olay gelebilir.
    const before = state();
    const after = reduceLive(before, {
      type: "station_started",
      atMinutes: START,
      stationId: "yok",
    });
    expect(after).toBe(before);
  });

  it("tick yalnizca saati ilerletir", () => {
    const after = reduceLive(state(), { type: "tick", atMinutes: START + 30 });
    expect(after.clockMinutes).toBe(START + 30);
    expect(after.feed).toHaveLength(0);
  });

  it("saat geriye gitmez", () => {
    // Sirasi bozulmus bir paket, ekrandaki saati geri almamali.
    const after = reduceLiveMany(state(), [
      { type: "tick", atMinutes: START + 30 },
      { type: "tick", atMinutes: START + 10 },
    ]);
    expect(after.clockMinutes).toBe(START + 30);
  });

  it("girdiyi degistirmez", () => {
    const before = state();
    reduceLive(before, {
      type: "part_completed",
      atMinutes: START,
      stationId: "s1",
      quantity: 5,
    });
    expect(stationOf(before, "s1").completed).toBe(0);
  });
});

describe("reduceLive — durum gecisleri", () => {
  it("baslatinca calisiyor olur", () => {
    const after = reduceLive(state(), {
      type: "station_started",
      atMinutes: START,
      stationId: "s1",
      operatorName: "Ayşe",
    });
    expect(stationOf(after, "s1").status).toBe("running");
    expect(stationOf(after, "s1").operatorName).toBe("Ayşe");
  });

  it("arizali makine 'basladi' olayiyla uretime donmez", () => {
    // Duran bir makineyi calisiyor gostermek, ekrandaki en pahali hata olurdu.
    const after = reduceLiveMany(state(), [
      { type: "machine_fault", atMinutes: START, stationId: "s1", reason: "Rulman" },
      { type: "station_started", atMinutes: START + 1, stationId: "s1" },
    ]);
    expect(stationOf(after, "s1").status).toBe("fault");
  });

  it("ariza cevrimdisi makine sayisini dusurur", () => {
    const after = reduceLive(state(), {
      type: "machine_fault",
      atMinutes: START,
      stationId: "s1",
      reason: "Rulman",
    });
    const station = stationOf(after, "s1");
    expect(station.onlineMachines).toBe(1);
    expect(station.faultReason).toBe("Rulman");
  });

  it("onarim sonrasi makine bosta bekler", () => {
    const after = reduceLiveMany(state(), [
      { type: "machine_fault", atMinutes: START, stationId: "s1", reason: "Rulman" },
      { type: "machine_repaired", atMinutes: START + 5, stationId: "s1" },
    ]);
    const station = stationOf(after, "s1");
    expect(station.status).toBe("idle");
    expect(station.faultReason).toBeNull();
    expect(station.onlineMachines).toBe(2);
  });

  it("onarim makine sayisini asmaz", () => {
    const after = reduceLiveMany(state(), [
      { type: "machine_repaired", atMinutes: START, stationId: "s1" },
      { type: "machine_repaired", atMinutes: START + 1, stationId: "s1" },
    ]);
    expect(stationOf(after, "s1").onlineMachines).toBe(2);
  });

  it("setup sirasinda kuyruk rengi setup'i ezmez", () => {
    // Arizanin ya da setup'in ustune 'kuyruk' yazmak, asil sorunu ekrandan
    // silerdi.
    const after = reduceLiveMany(state(), [
      { type: "setup_started", atMinutes: START, stationId: "s1", product: "Ürün B" },
      { type: "queue_changed", atMinutes: START + 1, stationId: "s1", queue: 20 },
    ]);
    expect(stationOf(after, "s1").status).toBe("setup");
  });

  it("setup bitince uretime doner", () => {
    const after = reduceLiveMany(state(), [
      { type: "setup_started", atMinutes: START, stationId: "s1", product: "Ürün B" },
      { type: "setup_finished", atMinutes: START + 6, stationId: "s1" },
    ]);
    const station = stationOf(after, "s1");
    expect(station.status).toBe("running");
    expect(station.setupProduct).toBeNull();
  });

  it("setup uzun kuyrukla biterse kuyruk durumuna gecer", () => {
    const after = reduceLiveMany(state(), [
      { type: "setup_started", atMinutes: START, stationId: "s1", product: "Ürün B" },
      { type: "queue_changed", atMinutes: START + 2, stationId: "s1", queue: 12 },
      { type: "setup_finished", atMinutes: START + 6, stationId: "s1" },
    ]);
    expect(stationOf(after, "s1").status).toBe("queued");
  });

  it("kuyruk esigi asilinca kuyruk durumuna, altina inince calisiyora doner", () => {
    const queued = reduceLiveMany(state(), [
      { type: "station_started", atMinutes: START, stationId: "s1" },
      {
        type: "queue_changed",
        atMinutes: START + 1,
        stationId: "s1",
        queue: QUEUE_WARNING,
      },
    ]);
    expect(stationOf(queued, "s1").status).toBe("queued");

    const relaxed = reduceLive(queued, {
      type: "queue_changed",
      atMinutes: START + 2,
      stationId: "s1",
      queue: 1,
    });
    expect(stationOf(relaxed, "s1").status).toBe("running");
  });

  it("negatif kuyrugu sifira ceker", () => {
    const after = reduceLive(state(), {
      type: "queue_changed",
      atMinutes: START,
      stationId: "s1",
      queue: -4,
    });
    expect(stationOf(after, "s1").queue).toBe(0);
  });

  it("sifir adetli uretim ve hurda kayit uretmez", () => {
    const after = reduceLiveMany(state(), [
      { type: "part_completed", atMinutes: START, stationId: "s1", quantity: 0 },
      { type: "part_scrapped", atMinutes: START, stationId: "s1", quantity: 0 },
    ]);
    expect(after.feed).toHaveLength(0);
    expect(stationOf(after, "s1").completed).toBe(0);
  });

  it("OEE olcumu 0-1 arasina kirpilir", () => {
    const high = reduceLive(state(), {
      type: "oee_sampled",
      atMinutes: START,
      stationId: "s1",
      oee: 4,
    });
    expect(stationOf(high, "s1").oee).toBe(1);

    const broken = reduceLive(state(), {
      type: "oee_sampled",
      atMinutes: START,
      stationId: "s1",
      oee: Number.NaN,
    });
    expect(stationOf(broken, "s1").oee).toBe(0);
  });

  it("OEE olcumu akisa satir yazmaz", () => {
    // Saniyede bir ornek, akisi okunmaz bir sayi yigina cevirirdi.
    const after = reduceLive(state(), {
      type: "oee_sampled",
      atMinutes: START,
      stationId: "s1",
      oee: 0.9,
    });
    expect(after.feed).toHaveLength(0);
  });

  it("operator birakildiginda uyari satiri yazar", () => {
    const after = reduceLive(state(), {
      type: "operator_released",
      atMinutes: START,
      stationId: "s1",
    });
    expect(stationOf(after, "s1").operatorName).toBeNull();
    expect(after.feed[0].level).toBe("warning");
  });
});

describe("reduceLive — akis ve alarm sinirlari", () => {
  it("akisi en yeni onde tutar", () => {
    const after = reduceLiveMany(state(), [
      { type: "station_started", atMinutes: START, stationId: "s1" },
      { type: "station_started", atMinutes: START + 1, stationId: "s2" },
    ]);
    expect(after.feed[0].stationId).toBe("s2");
  });

  it("akis ustunu tasmaz", () => {
    const events: LiveEvent[] = Array.from({ length: 100 }, (_, i) => ({
      type: "part_completed",
      atMinutes: START + i,
      stationId: "s1",
      quantity: 1,
    }));
    const after = reduceLiveMany(state(), events);
    expect(after.feed).toHaveLength(FEED_LIMIT);
    expect(stationOf(after, "s1").completed).toBe(100);
    expect(after.eventCount).toBe(100);
  });

  it("yuz olay ayni anda geldiginde sayaclar tutarli kalir", () => {
    const events: LiveEvent[] = [];
    for (let i = 0; i < 50; i += 1) {
      events.push({
        type: "part_completed",
        atMinutes: START + i,
        stationId: "s1",
        quantity: 2,
      });
      events.push({
        type: "queue_changed",
        atMinutes: START + i,
        stationId: "s2",
        queue: i % 5,
      });
    }
    const after = reduceLiveMany(state(), events);
    expect(stationOf(after, "s1").completed).toBe(100);
    expect(stationOf(after, "s2").queue).toBe(49 % 5);
  });
});

describe("reduceLive — alarmlar", () => {
  it("ariza kritik alarm acar ve onarim onu kapatir", () => {
    const broken = reduceLive(state(), {
      type: "machine_fault",
      atMinutes: START,
      stationId: "s1",
      reason: "Rulman",
    });
    expect(broken.alarms).toHaveLength(1);
    expect(broken.alarms[0].level).toBe("critical");
    expect(openAlarmCount(broken.alarms)).toBe(1);

    const fixed = reduceLive(broken, {
      type: "machine_repaired",
      atMinutes: START + 9,
      stationId: "s1",
    });
    // Kayit silinmez, kapatilir: "ariza kac dakika surdu?" ancak boyle
    // yanitlanabilir.
    expect(fixed.alarms).toHaveLength(1);
    expect(fixed.alarms[0].resolvedAtMinutes).toBe(START + 9);
    expect(openAlarmCount(fixed.alarms)).toBe(0);
  });

  it("acik ariza varken ikinci alarm acmaz", () => {
    const after = reduceLiveMany(state(), [
      { type: "machine_fault", atMinutes: START, stationId: "s1", reason: "Rulman" },
      { type: "machine_fault", atMinutes: START + 1, stationId: "s1", reason: "Rulman" },
    ]);
    expect(after.alarms).toHaveLength(1);
  });

  it("ariza sonrasi toparlanmada yeni ariza yeniden alarm acar", () => {
    const after = reduceLiveMany(state(), [
      { type: "machine_fault", atMinutes: START, stationId: "s1", reason: "Rulman" },
      { type: "machine_repaired", atMinutes: START + 5, stationId: "s1" },
      { type: "station_started", atMinutes: START + 6, stationId: "s1" },
      { type: "machine_fault", atMinutes: START + 20, stationId: "s1", reason: "Kayış" },
    ]);
    expect(after.alarms).toHaveLength(2);
    expect(openAlarmCount(after.alarms)).toBe(1);
    expect(stationOf(after, "s1").status).toBe("fault");
  });

  it("kuyruk alarmini yerinde yukseltir, kopya acmaz, sonra dusurmez", () => {
    const warned = reduceLive(state(), {
      type: "queue_changed",
      atMinutes: START,
      stationId: "s1",
      queue: QUEUE_WARNING,
    });
    expect(warned.alarms).toHaveLength(1);
    expect(warned.alarms[0].level).toBe("warning");
    expect(warned.alarms[0].updatedAtMinutes).toBe(START);

    // Uyari acikken kuyruk kritige cikarsa ikinci bir satir acilmaz; ayni
    // kayit yukseltilir. Kimlik seviyeden bagimsiz oldugu icin satir listede
    // yerinde kalir.
    const escalated = reduceLive(warned, {
      type: "queue_changed",
      atMinutes: START + 1,
      stationId: "s1",
      queue: QUEUE_CRITICAL + 3,
    });
    expect(escalated.alarms).toHaveLength(1);
    expect(escalated.alarms[0].id).toBe(warned.alarms[0].id);
    expect(escalated.alarms[0].level).toBe("critical");
    expect(escalated.alarms[0].text).toContain("tıkanıyor");
    // Baslangic saati korunur, "en son ne zaman degisti" ayri tutulur.
    expect(escalated.alarms[0].atMinutes).toBe(START);
    expect(escalated.alarms[0].updatedAtMinutes).toBe(START + 1);
    expect(openAlarmCount(escalated.alarms)).toBe(1);

    // Ayni seviyede kalan bir degisim kaydi hic ellemez.
    const steady = reduceLive(escalated, {
      type: "queue_changed",
      atMinutes: START + 2,
      stationId: "s1",
      queue: QUEUE_CRITICAL + 9,
    });
    expect(steady.alarms[0]).toBe(escalated.alarms[0]);

    // Kritige cikmis alarm, kuyruk uyari araligina gerilese de kritik kalir:
    // sorun surerken alarmin sessizce sararmasi "hallolmus" diye okunurdu.
    const eased = reduceLive(steady, {
      type: "queue_changed",
      atMinutes: START + 3,
      stationId: "s1",
      queue: QUEUE_WARNING + 1,
    });
    expect(eased.alarms).toHaveLength(1);
    expect(eased.alarms[0].level).toBe("critical");
    expect(eased.alarms[0].updatedAtMinutes).toBe(START + 1);
  });

  it("kuyruk esigin altina inince uyariyi kapatir", () => {
    const after = reduceLiveMany(state(), [
      { type: "queue_changed", atMinutes: START, stationId: "s1", queue: 12 },
      { type: "queue_changed", atMinutes: START + 4, stationId: "s1", queue: 2 },
    ]);
    expect(openAlarmCount(after.alarms)).toBe(0);
    expect(after.alarms[0].resolvedAtMinutes).toBe(START + 4);
  });

  it("fire esigi asilinca uyari acar ve tekrarlamaz", () => {
    const after = reduceLiveMany(state([seed("s1", "Kesim")]), [
      { type: "part_completed", atMinutes: START, stationId: "s1", quantity: 10 },
      { type: "part_scrapped", atMinutes: START + 1, stationId: "s1", quantity: 2 },
      { type: "part_scrapped", atMinutes: START + 2, stationId: "s1", quantity: 2 },
    ]);
    expect(after.alarms.filter((a) => a.id.startsWith("scrap:"))).toHaveLength(1);
  });

  it("dusuk firede alarm acmaz", () => {
    const after = reduceLiveMany(state(), [
      { type: "part_completed", atMinutes: START, stationId: "s1", quantity: 100 },
      { type: "part_scrapped", atMinutes: START + 1, stationId: "s1", quantity: 1 },
    ]);
    expect(after.alarms).toHaveLength(0);
  });
});
