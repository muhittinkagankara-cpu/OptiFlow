import { describe, expect, it } from "vitest";
import {
  EMPTY_ACTIVITY_FILTER,
  MAX_EVENTS,
  appendEvent,
  describeEvent,
  eventsByOrigin,
  filterEvents,
  groupByDay,
  lastRealEvent,
  makeEvent,
  relativeTime,
} from "./activity";
import type { ActivityEvent } from "./types";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    kind: "simulation_run",
    atMs: NOW,
    actorName: "Kaan Demir",
    subject: "Kuzey Hat 1",
    detail: null,
    origin: "local",
    ...overrides,
  };
}

describe("makeEvent", () => {
  it("ayni girdi ayni kimligi uretir", () => {
    // Rastgele kimlik uretilseydi test edilemezdi.
    const a = makeEvent({ kind: "simulation_run", atMs: NOW }, 0);
    const b = makeEvent({ kind: "simulation_run", atMs: NOW }, 0);
    expect(a.id).toBe(b.id);
  });

  it("sira numarasi kimligi ayirir", () => {
    const a = makeEvent({ kind: "simulation_run", atMs: NOW }, 0);
    const b = makeEvent({ kind: "simulation_run", atMs: NOW }, 1);
    expect(a.id).not.toBe(b.id);
  });

  it("verilmeyen alanlar null olur", () => {
    const result = makeEvent({ kind: "factory_created", atMs: NOW }, 0);
    expect(result.actorName).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.detail).toBeNull();
  });

  it("varsayilan kaynak bu cihazdir", () => {
    expect(makeEvent({ kind: "factory_created", atMs: NOW }, 0).origin).toBe("local");
  });

  it("kaynak disaridan verilebilir", () => {
    expect(
      makeEvent({ kind: "factory_created", atMs: NOW, origin: "fixture" }, 0).origin,
    ).toBe("fixture");
  });
});

describe("appendEvent", () => {
  it("yeni olayi basa koyar", () => {
    const result = appendEvent([event({ id: "eski" })], {
      kind: "report_downloaded",
      atMs: NOW + 1,
    });
    expect(result[0].kind).toBe("report_downloaded");
  });

  it("liste sinirini asmaz", () => {
    const list = Array.from({ length: 5 }, (_, i) => event({ id: `e${i}` }));
    const result = appendEvent(list, { kind: "role_changed", atMs: NOW }, 3);
    expect(result).toHaveLength(3);
  });

  it("sinir asilinca en eski kayit duser", () => {
    const list = [event({ id: "yeni" }), event({ id: "eski" })];
    const result = appendEvent(list, { kind: "role_changed", atMs: NOW }, 2);
    expect(result.map((e) => e.id)).not.toContain("eski");
  });

  it("varsayilan sinir MAX_EVENTS", () => {
    expect(MAX_EVENTS).toBe(200);
    const list = Array.from({ length: MAX_EVENTS }, (_, i) => event({ id: `e${i}` }));
    expect(appendEvent(list, { kind: "role_changed", atMs: NOW })).toHaveLength(
      MAX_EVENTS,
    );
  });

  it("girdi listesini degistirmez", () => {
    const list = [event()];
    appendEvent(list, { kind: "role_changed", atMs: NOW });
    expect(list).toHaveLength(1);
  });
});

describe("filterEvents", () => {
  const list = [
    event({ id: "a", kind: "simulation_run", origin: "local", subject: "Kuzey Hat 1" }),
    event({ id: "b", kind: "report_downloaded", origin: "fixture", subject: "Yönetici raporu" }),
    event({
      id: "c",
      kind: "role_changed",
      origin: "fixture",
      actorName: "Selin",
      subject: "Kaan Demir",
    }),
  ];

  it("bos filtre hepsini gecirir", () => {
    expect(filterEvents(list, EMPTY_ACTIVITY_FILTER)).toHaveLength(3);
  });

  it("turune gore suzer", () => {
    expect(
      filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, kind: "role_changed" }),
    ).toHaveLength(1);
  });

  it("ornek kayitlari gizleyebilir", () => {
    const result = filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, hideFixtures: true });
    expect(result.map((e) => e.id)).toEqual(["a"]);
  });

  it("konuya gore arar", () => {
    expect(
      filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, query: "kuzey" }),
    ).toHaveLength(1);
  });

  it("kisi adina gore arar", () => {
    expect(filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, query: "selin" })).toHaveLength(
      1,
    );
  });

  it("olay etiketine gore arar", () => {
    expect(filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, query: "rapor" })).toHaveLength(
      1,
    );
  });

  it("eslesme yoksa bos doner", () => {
    expect(filterEvents(list, { ...EMPTY_ACTIVITY_FILTER, query: "zzz" })).toHaveLength(0);
  });

  it("tur ve ornek suzgeci birlikte calisir", () => {
    const result = filterEvents(list, {
      ...EMPTY_ACTIVITY_FILTER,
      kind: "report_downloaded",
      hideFixtures: true,
    });
    expect(result).toHaveLength(0);
  });
});

describe("describeEvent", () => {
  it("kisi ve olayi birlestirir", () => {
    expect(describeEvent(event({ subject: null }))).toBe(
      "Kaan Demir — Simülasyon çalıştırıldı",
    );
  });

  it("konu varsa sonuna ekler", () => {
    expect(describeEvent(event())).toContain("Kuzey Hat 1");
  });

  it("kisi bilinmiyorsa bunu yazar", () => {
    expect(describeEvent(event({ actorName: null }))).toContain("Bilinmeyen kullanıcı");
  });
});

describe("groupByDay", () => {
  it("ayni gunun olaylarini tek grupta toplar", () => {
    const groups = groupByDay([event({ id: "a" }), event({ id: "b", atMs: NOW + HOUR })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(2);
  });

  it("farkli gunleri ayirir", () => {
    const groups = groupByDay([event({ id: "a" }), event({ id: "b", atMs: NOW - 48 * HOUR })]);
    expect(groups).toHaveLength(2);
  });

  it("bos listede bos doner", () => {
    expect(groupByDay([])).toHaveLength(0);
  });
});

describe("eventsByOrigin", () => {
  it("kaynaklari sayar", () => {
    const counts = eventsByOrigin([
      event({ id: "a", origin: "local" }),
      event({ id: "b", origin: "fixture" }),
      event({ id: "c", origin: "fixture" }),
    ]);
    expect(counts).toEqual({ account: 0, local: 1, fixture: 2 });
  });

  it("bos listede hepsi sifirdir", () => {
    expect(eventsByOrigin([])).toEqual({ account: 0, local: 0, fixture: 0 });
  });
});

describe("lastRealEvent", () => {
  it("ilk ornek olmayan olayi doner", () => {
    const result = lastRealEvent([
      event({ id: "a", origin: "fixture" }),
      event({ id: "b", origin: "local" }),
    ]);
    expect(result?.id).toBe("b");
  });

  it("hepsi ornekse null doner", () => {
    // "Son degisiklik" karti bu durumda "Dogrulanmadi" yazar.
    expect(lastRealEvent([event({ origin: "fixture" })])).toBeNull();
  });

  it("bos listede null doner", () => {
    expect(lastRealEvent([])).toBeNull();
  });
});

describe("relativeTime", () => {
  it("bir dakikadan yeni ise 'az once'", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("az önce");
  });

  it("gelecekteki zamani 'az once' sayar", () => {
    // Saat kaymasinda negatif fark uretilebilir; "-3 dk once" yazmak yerine
    // en yakin dogru ifade kullanilir.
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toBe("az önce");
  });

  it("dakika yazar", () => {
    expect(relativeTime(NOW - 20 * MINUTE, NOW)).toBe("20 dk önce");
  });

  it("saat yazar", () => {
    expect(relativeTime(NOW - 5 * HOUR, NOW)).toBe("5 sa önce");
  });

  it("bir gun onceyi 'dun' yazar", () => {
    expect(relativeTime(NOW - 26 * HOUR, NOW)).toBe("dün");
  });

  it("birden fazla gunu sayiyla yazar", () => {
    expect(relativeTime(NOW - 72 * HOUR, NOW)).toBe("3 gün önce");
  });
});
