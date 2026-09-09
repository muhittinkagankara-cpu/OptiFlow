import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMBER_FILTER,
  activeUserCount,
  countByOrigin,
  countByRole,
  filterMembers,
  lastActiveLabel,
  memberFromAccount,
  normalize,
  removeMember,
  setRole,
  setStatus,
  sortMembers,
  upsertMember,
} from "./members";
import type { Member } from "./types";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "m1",
    name: "Kaan Demir",
    email: "kaan@ornek.com",
    role: "engineer",
    status: "active",
    lastActiveAtMs: NOW - 2 * MINUTE,
    origin: "local",
    ...overrides,
  };
}

describe("memberFromAccount", () => {
  it("oturumdaki kullaniciyi hesap kaynakli uyeye cevirir", () => {
    const result = memberFromAccount({ user_id: "u1", email: "ayse@fabrika.com" });
    expect(result.id).toBe("u1");
    expect(result.origin).toBe("account");
    expect(result.status).toBe("active");
  });

  it("ad alani e-postanin yerel kismindan gelir", () => {
    expect(memberFromAccount({ user_id: "u1", email: "ayse@fabrika.com" }).name).toBe(
      "ayse",
    );
  });

  it("e-posta yoksa ad 'Siz' olur", () => {
    expect(memberFromAccount({ user_id: "u1", email: null }).name).toBe("Siz");
  });

  it("varsayilan rol sahiptir", () => {
    // Kendi hesabini kuran kisi organizasyonun sahibidir.
    expect(memberFromAccount({ user_id: "u1" }).role).toBe("owner");
  });

  it("verilen rol korunur", () => {
    expect(memberFromAccount({ user_id: "u1", role: "viewer" }).role).toBe("viewer");
  });

  it("son etkinlik uydurmaz", () => {
    // Zaman disaridan gelir; burada "simdi" yazmak olculmemis bir deger olurdu.
    expect(memberFromAccount({ user_id: "u1" }).lastActiveAtMs).toBeNull();
  });
});

describe("upsertMember", () => {
  it("yeni uyeyi ekler", () => {
    expect(upsertMember([], member())).toHaveLength(1);
  });

  it("var olan uyeyi gunceller, cogaltmaz", () => {
    const list = [member()];
    const result = upsertMember(list, member({ name: "Kaan D." }));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Kaan D.");
  });

  it("girdi listesini degistirmez", () => {
    const list = [member()];
    upsertMember(list, member({ id: "m2" }));
    expect(list).toHaveLength(1);
  });
});

describe("removeMember / setRole / setStatus", () => {
  const list = [member(), member({ id: "m2", name: "Ayşe", role: "operator" })];

  it("uyeyi cikarir", () => {
    expect(removeMember(list, "m2").map((m) => m.id)).toEqual(["m1"]);
  });

  it("olmayan kimlik listeyi bozmaz", () => {
    expect(removeMember(list, "yok")).toHaveLength(2);
  });

  it("rolu degistirir", () => {
    expect(setRole(list, "m2", "admin")[1].role).toBe("admin");
  });

  it("rol degisikligi baska uyeye dokunmaz", () => {
    expect(setRole(list, "m2", "admin")[0].role).toBe("engineer");
  });

  it("durumu degistirir", () => {
    expect(setStatus(list, "m1", "suspended")[0].status).toBe("suspended");
  });
});

describe("sortMembers", () => {
  it("once rol genisligine gore siralar", () => {
    const sorted = sortMembers([
      member({ id: "a", role: "viewer", name: "Ali" }),
      member({ id: "b", role: "owner", name: "Zeynep" }),
      member({ id: "c", role: "engineer", name: "Mehmet" }),
    ]);
    expect(sorted.map((m) => m.role)).toEqual(["owner", "engineer", "viewer"]);
  });

  it("ayni rolde ada gore siralar", () => {
    const sorted = sortMembers([
      member({ id: "a", role: "admin", name: "Zeynep" }),
      member({ id: "b", role: "admin", name: "Ahmet" }),
    ]);
    expect(sorted.map((m) => m.name)).toEqual(["Ahmet", "Zeynep"]);
  });

  it("girdiyi yerinde degistirmez", () => {
    const list = [member({ role: "viewer" }), member({ id: "m2", role: "owner" })];
    sortMembers(list);
    expect(list[0].role).toBe("viewer");
  });
});

describe("normalize", () => {
  it("turkce harfleri ascii karsiligina cevirir", () => {
    expect(normalize("Şişli Öğüt")).toBe("sisli ogut");
  });

  it("bosluklari kirpar", () => {
    expect(normalize("  Ayşe  ")).toBe("ayse");
  });

  it("noktali I ile noktasiz i ayni sonucu verir", () => {
    // "İzmir" arayan biri "izmir" yazdiginda da bulmali.
    expect(normalize("İZMİR")).toBe(normalize("izmir"));
  });
});

describe("filterMembers", () => {
  const list = [
    member({ id: "m1", name: "Kaan Demir", role: "engineer", status: "active" }),
    member({ id: "m2", name: "Ayşe Yıldız", role: "operator", status: "invited", email: "ayse@x.com" }),
    member({
      id: "m3",
      name: "Mehmet Koç",
      role: "viewer",
      status: "active",
      email: "mehmet@x.com",
    }),
  ];

  it("bos filtre hepsini gecirir", () => {
    expect(filterMembers(list, EMPTY_MEMBER_FILTER)).toHaveLength(3);
  });

  it("role gore suzer", () => {
    expect(
      filterMembers(list, { ...EMPTY_MEMBER_FILTER, role: "operator" }),
    ).toHaveLength(1);
  });

  it("duruma gore suzer", () => {
    expect(
      filterMembers(list, { ...EMPTY_MEMBER_FILTER, status: "active" }),
    ).toHaveLength(2);
  });

  it("adda turkce harflere duyarsiz arar", () => {
    const found = filterMembers(list, { ...EMPTY_MEMBER_FILTER, query: "ayse" });
    expect(found.map((m) => m.id)).toEqual(["m2"]);
  });

  it("e-postada da arar", () => {
    expect(
      filterMembers(list, { ...EMPTY_MEMBER_FILTER, query: "ayse@x" }),
    ).toHaveLength(1);
  });

  it("eslesme yoksa bos doner", () => {
    expect(
      filterMembers(list, { ...EMPTY_MEMBER_FILTER, query: "bulunamaz" }),
    ).toHaveLength(0);
  });

  it("rol ve arama birlikte uygulanir", () => {
    expect(
      filterMembers(list, { ...EMPTY_MEMBER_FILTER, role: "viewer", query: "kaan" }),
    ).toHaveLength(0);
  });
});

describe("countByRole", () => {
  it("her rol icin bir sayi verir", () => {
    const counts = countByRole([member({ role: "owner" }), member({ id: "m2", role: "owner" })]);
    expect(counts.owner).toBe(2);
    expect(counts.viewer).toBe(0);
  });
});

describe("countByOrigin", () => {
  it("gercek ve ornek kayitlari ayirir", () => {
    const counts = countByOrigin([
      member({ id: "a", origin: "account" }),
      member({ id: "b", origin: "fixture" }),
      member({ id: "c", origin: "fixture" }),
    ]);
    expect(counts).toEqual({ account: 1, local: 0, fixture: 2 });
  });

  it("bos listede hepsi sifirdir", () => {
    expect(countByOrigin([])).toEqual({ account: 0, local: 0, fixture: 0 });
  });
});

describe("activeUserCount", () => {
  it("olculemiyorsa sifir degil null doner", () => {
    // Hic olculmemis bir "0", kimsenin calismadigi izlenimi verirdi.
    expect(activeUserCount([member({ lastActiveAtMs: null })], NOW)).toBeNull();
  });

  it("bos listede null doner", () => {
    expect(activeUserCount([], NOW)).toBeNull();
  });

  it("ornek uyeler sayilmaz", () => {
    const list = [member({ origin: "fixture", lastActiveAtMs: NOW })];
    expect(activeUserCount(list, NOW)).toBeNull();
  });

  it("pencere icindeki gercek uyeyi sayar", () => {
    expect(activeUserCount([member({ lastActiveAtMs: NOW - MINUTE })], NOW)).toBe(1);
  });

  it("pencere disindaki uyeyi saymaz", () => {
    expect(activeUserCount([member({ lastActiveAtMs: NOW - 60 * MINUTE })], NOW)).toBe(0);
  });

  it("pencere genisligi ayarlanabilir", () => {
    const list = [member({ lastActiveAtMs: NOW - 30 * MINUTE })];
    expect(activeUserCount(list, NOW, 60 * MINUTE)).toBe(1);
  });
});

describe("lastActiveLabel", () => {
  it("bilinmiyorsa null doner", () => {
    expect(lastActiveLabel(member({ lastActiveAtMs: null }), NOW)).toBeNull();
  });

  it("bir dakikadan yeni ise 'az once'", () => {
    expect(lastActiveLabel(member({ lastActiveAtMs: NOW - 5_000 }), NOW)).toBe("az önce");
  });

  it("dakika yazar", () => {
    expect(lastActiveLabel(member({ lastActiveAtMs: NOW - 12 * MINUTE }), NOW)).toBe(
      "12 dk önce",
    );
  });

  it("saat yazar", () => {
    expect(lastActiveLabel(member({ lastActiveAtMs: NOW - 3 * 60 * MINUTE }), NOW)).toBe(
      "3 sa önce",
    );
  });

  it("gun yazar", () => {
    expect(
      lastActiveLabel(member({ lastActiveAtMs: NOW - 50 * 60 * MINUTE }), NOW),
    ).toBe("2 gün önce");
  });
});
