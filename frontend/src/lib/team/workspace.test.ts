import { describe, expect, it } from "vitest";
import {
  PRESENCE_NOTE,
  hasLivePresence,
  normalizePresence,
  presenceByOrigin,
  presenceLine,
  unverifiedCount,
  workspaceStats,
  type WorkspaceInput,
} from "./workspace";
import type { ActivityEvent, Member, PresenceEntry } from "./types";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "m1",
    name: "Siz",
    email: "siz@fabrika.com",
    role: "owner",
    status: "active",
    lastActiveAtMs: NOW - MINUTE,
    origin: "account",
    ...overrides,
  };
}

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    kind: "simulation_run",
    atMs: NOW - 5 * MINUTE,
    actorName: "Siz",
    subject: "Kuzey Hat 1",
    detail: null,
    origin: "local",
    ...overrides,
  };
}

function input(overrides: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return {
    orgName: "Örnek Fabrika A.Ş.",
    factoryCount: 3,
    members: [member()],
    events: [event()],
    nowMs: NOW,
    ...overrides,
  };
}

describe("workspaceStats", () => {
  it("bes kart doner", () => {
    expect(workspaceStats(input())).toHaveLength(5);
  });

  it("organizasyon adi oturumdan okunur", () => {
    const stat = workspaceStats(input())[0];
    expect(stat.value).toBe("Örnek Fabrika A.Ş.");
    expect(stat.origin).toBe("account");
  });

  it("fabrika sayisi sunucudan gelir", () => {
    const stat = workspaceStats(input())[1];
    expect(stat.value).toBe("3");
    expect(stat.origin).toBe("account");
  });

  it("fabrika sayisi okunamazsa sifir degil null olur", () => {
    // Okunamamis bir "0", fabrikasi olmayan bir hesap izlenimi verirdi.
    const stat = workspaceStats(input({ factoryCount: null }))[1];
    expect(stat.value).toBeNull();
    expect(stat.origin).toBeNull();
    expect(stat.note).toContain("okunamadı");
  });

  it("uye sayisi toplam kayit sayisidir", () => {
    const stats = workspaceStats(
      input({ members: [member(), member({ id: "m2", origin: "fixture" })] }),
    );
    expect(stats[2].value).toBe("2");
  });

  it("ornek uye varsa kart bunu ornek olarak isaretler", () => {
    const stats = workspaceStats(
      input({ members: [member(), member({ id: "m2", origin: "fixture" })] }),
    );
    expect(stats[2].origin).toBe("fixture");
    expect(stats[2].note).toBe("1 gerçek, 1 örnek kayıt.");
  });

  it("tamami gercekse kart hesap kaynakli olur", () => {
    const stats = workspaceStats(input());
    expect(stats[2].origin).toBe("account");
    expect(stats[2].note).toBe("Tamamı gerçek kayıt.");
  });

  it("aktif kullanici olculebiliyorsa yazilir", () => {
    expect(workspaceStats(input())[3].value).toBe("1");
  });

  it("aktif kullanici olculemiyorsa dogrulanmadi kalir", () => {
    const stats = workspaceStats(input({ members: [member({ lastActiveAtMs: null })] }));
    expect(stats[3].value).toBeNull();
    expect(stats[3].note).toContain("uç yok");
  });

  it("son degisiklik goreli zaman yazar", () => {
    expect(workspaceStats(input())[4].value).toBe("5 dk önce");
  });

  it("gercek olay yoksa son degisiklik okunamaz", () => {
    const stats = workspaceStats(
      input({ events: [event({ origin: "fixture" })] }),
    );
    expect(stats[4].value).toBeNull();
    expect(stats[4].note).toContain("gerçek bir olay yok");
  });

  it("son degisiklik notunda kisi ve konu yazar", () => {
    expect(workspaceStats(input())[4].note).toBe("Siz · Kuzey Hat 1");
  });

  it("her kart bir aciklama tasir", () => {
    for (const stat of workspaceStats(input({ factoryCount: null }))) {
      expect(stat.note.length).toBeGreaterThan(0);
    }
  });

  it("degeri olan her kartin kaynagi vardir", () => {
    for (const stat of workspaceStats(input())) {
      expect(stat.origin).not.toBeNull();
    }
  });
});

describe("unverifiedCount", () => {
  it("okunamayan kartlari sayar", () => {
    const stats = workspaceStats(
      input({ factoryCount: null, members: [member({ lastActiveAtMs: null })] }),
    );
    expect(unverifiedCount(stats)).toBe(2);
  });

  it("hepsi okunabiliyorsa sifirdir", () => {
    expect(unverifiedCount(workspaceStats(input()))).toBe(0);
  });
});

describe("presence", () => {
  function entry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
    return {
      id: "p1",
      name: "Kaan",
      screen: "Süreç Editörü",
      activity: "editing",
      atMs: NOW,
      isLive: false,
      origin: "fixture",
      ...overrides,
    };
  }

  it("satir okunur bir cumle uretir", () => {
    expect(presenceLine(entry())).toBe("Kaan Süreç Editörü ekranında düzenliyor");
  });

  it("etkinlik turu cumleye yansir", () => {
    expect(presenceLine(entry({ activity: "running" }))).toContain("koşum alıyor");
  });

  it("normalizePresence canli bayragini dusurur", () => {
    // Kaynak ne derse desin, bu surumde canli eszamanlilik yok.
    const result = normalizePresence([entry({ isLive: true })]);
    expect(result[0].isLive).toBe(false);
  });

  it("normalizePresence oteki alanlari korur", () => {
    expect(normalizePresence([entry()])[0].name).toBe("Kaan");
  });

  it("normalize edilmis listede canli kayit bulunmaz", () => {
    expect(hasLivePresence(normalizePresence([entry({ isLive: true })]))).toBe(false);
  });

  it("hasLivePresence bos listede false doner", () => {
    expect(hasLivePresence([])).toBe(false);
  });

  it("aciklama canli olmadigini soyler", () => {
    expect(PRESENCE_NOTE).toContain("Canlı değil");
  });

  it("kaynak basina satir sayar", () => {
    expect(presenceByOrigin([entry(), entry({ id: "p2", origin: "local" })])).toEqual({
      account: 0,
      local: 1,
      fixture: 1,
    });
  });
});
