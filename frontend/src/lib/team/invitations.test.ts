import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_DAYS,
  acceptInvitation,
  createInvitation,
  daysLeft,
  defaultToken,
  invitationLink,
  invitationNote,
  isValidEmail,
  pendingInvitations,
  revokeInvitation,
  statusAt,
} from "./invitations";
import type { Invitation } from "./types";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const token = () => "sabitbelirtec0123456789a";

function invite(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    email: "yeni@fabrika.com",
    role: "engineer",
    token: "abc",
    createdAtMs: NOW,
    expiresAtMs: NOW + 7 * DAY,
    status: "pending",
    emailSent: false,
    origin: "local",
    ...overrides,
  };
}

describe("isValidEmail", () => {
  it("normal adresi kabul eder", () => {
    expect(isValidEmail("kaan@fabrika.com")).toBe(true);
  });

  it("bos degeri reddeder", () => {
    expect(isValidEmail("   ")).toBe(false);
  });

  it("@ olmayan degeri reddeder", () => {
    expect(isValidEmail("kaanfabrika.com")).toBe(false);
  });

  it("alan adinda nokta yoksa reddeder", () => {
    expect(isValidEmail("kaan@fabrika")).toBe(false);
  });

  it("bosluk iceren adresi reddeder", () => {
    expect(isValidEmail("ka an@fabrika.com")).toBe(false);
  });

  it("iki @ olan adresi reddeder", () => {
    expect(isValidEmail("a@b@c.com")).toBe(false);
  });
});

describe("defaultToken", () => {
  it("bos olmayan bir belirtec uretir", () => {
    expect(defaultToken().length).toBeGreaterThan(8);
  });

  it("ard arda ayni belirteci uretmez", () => {
    expect(defaultToken()).not.toBe(defaultToken());
  });
});

describe("createInvitation", () => {
  it("gecerli girdiyle davet uretir", () => {
    const result = createInvitation([], {
      email: "yeni@fabrika.com",
      role: "operator",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.error).toBeNull();
    expect(result.invitation?.role).toBe("operator");
  });

  it("e-postayi kucuk harfe cevirir", () => {
    const result = createInvitation([], {
      email: "  Yeni@Fabrika.COM ",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation?.email).toBe("yeni@fabrika.com");
  });

  it("gecersiz e-postayi reddeder", () => {
    const result = createInvitation([], {
      email: "bozuk",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation).toBeNull();
    expect(result.error).toContain("Geçerli bir e-posta");
  });

  it("emailSent her zaman false", () => {
    // E-posta altyapisi yok; gonderilmis gibi gostermek yasak.
    const result = createInvitation([], {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation?.emailSent).toBe(false);
  });

  it("kaynak local olur", () => {
    const result = createInvitation([], {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation?.origin).toBe("local");
  });

  it("varsayilan gecerlilik suresi 7 gundur", () => {
    const result = createInvitation([], {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation?.expiresAtMs).toBe(NOW + INVITE_TTL_DAYS * DAY);
  });

  it("sure disaridan verilebilir", () => {
    const result = createInvitation([], {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
      ttlDays: 2,
    });
    expect(result.invitation?.expiresAtMs).toBe(NOW + 2 * DAY);
  });

  it("ayni adrese ikinci bekleyen daveti engeller", () => {
    // Iki gecerli baglanti, hangisinin iptal edildigini takip edilemez kilar.
    const existing = [invite({ email: "yeni@fabrika.com" })];
    const result = createInvitation(existing, {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation).toBeNull();
    expect(result.error).toContain("bekleyen bir davet");
  });

  it("iptal edilmis davetten sonra yenisi olusturulabilir", () => {
    const existing = [invite({ status: "revoked" })];
    const result = createInvitation(existing, {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation).not.toBeNull();
  });

  it("suresi dolmus davetten sonra yenisi olusturulabilir", () => {
    const existing = [invite({ expiresAtMs: NOW - DAY })];
    const result = createInvitation(existing, {
      email: "yeni@fabrika.com",
      role: "viewer",
      nowMs: NOW,
      makeToken: token,
    });
    expect(result.invitation).not.toBeNull();
  });
});

describe("statusAt", () => {
  it("suresi gecmemis bekleyen davet bekliyor kalir", () => {
    expect(statusAt(invite(), NOW + DAY)).toBe("pending");
  });

  it("suresi gecmis davet okuma aninda suresi dolmus sayilir", () => {
    // Zamanlayiciya bagli olsaydi, sekmesi kapali hesapta sonsuza kadar
    // gecerli gorunurdu.
    expect(statusAt(invite(), NOW + 8 * DAY)).toBe("expired");
  });

  it("iptal edilmis davet zamandan etkilenmez", () => {
    expect(statusAt(invite({ status: "revoked" }), NOW + 90 * DAY)).toBe("revoked");
  });

  it("kabul edilmis davet zamandan etkilenmez", () => {
    expect(statusAt(invite({ status: "accepted" }), NOW + 90 * DAY)).toBe("accepted");
  });

  it("tam bitis aninda suresi dolmus olur", () => {
    expect(statusAt(invite(), NOW + 7 * DAY)).toBe("expired");
  });
});

describe("revokeInvitation", () => {
  it("bekleyen daveti iptal eder", () => {
    expect(revokeInvitation([invite()], "inv-1")[0].status).toBe("revoked");
  });

  it("kabul edilmis daveti degistirmez", () => {
    const list = [invite({ status: "accepted" })];
    expect(revokeInvitation(list, "inv-1")[0].status).toBe("accepted");
  });

  it("olmayan kimlik listeyi bozmaz", () => {
    expect(revokeInvitation([invite()], "yok")[0].status).toBe("pending");
  });
});

describe("acceptInvitation", () => {
  it("gecerli belirtec kabul edilir", () => {
    const result = acceptInvitation([invite({ token: "xyz" })], "xyz", NOW);
    expect(result.error).toBeNull();
    expect(result.accepted?.status).toBe("accepted");
  });

  it("liste guncellenir", () => {
    const result = acceptInvitation([invite({ token: "xyz" })], "xyz", NOW);
    expect(result.invitations[0].status).toBe("accepted");
  });

  it("bilinmeyen belirtec hata verir", () => {
    const result = acceptInvitation([invite()], "yok", NOW);
    expect(result.accepted).toBeNull();
    expect(result.error).toBe("Davet bulunamadı.");
  });

  it("suresi dolmus davet kabul edilemez", () => {
    const result = acceptInvitation([invite({ token: "xyz" })], "xyz", NOW + 8 * DAY);
    expect(result.error).toContain("süresi dolmuş");
  });

  it("iptal edilmis davet kabul edilemez", () => {
    const result = acceptInvitation(
      [invite({ token: "xyz", status: "revoked" })],
      "xyz",
      NOW,
    );
    expect(result.error).toContain("iptal edilmiş");
  });
});

describe("invitationLink", () => {
  it("belirteci sorgu parametresine koyar", () => {
    expect(invitationLink(invite({ token: "abc" }), "https://app.optiflow.dev")).toBe(
      "https://app.optiflow.dev/davet?token=abc",
    );
  });

  it("sondaki egik cizgiyi cogaltmaz", () => {
    expect(invitationLink(invite({ token: "abc" }), "https://x.dev/")).toBe(
      "https://x.dev/davet?token=abc",
    );
  });
});

describe("pendingInvitations", () => {
  it("yalnizca bekleyenleri doner", () => {
    const list = [
      invite({ id: "a" }),
      invite({ id: "b", status: "revoked" }),
      invite({ id: "c", expiresAtMs: NOW - DAY }),
    ];
    expect(pendingInvitations(list, NOW).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("daysLeft", () => {
  it("kalan gunu yukari yuvarlar", () => {
    expect(daysLeft(invite(), NOW + 5.2 * DAY)).toBe(2);
  });

  it("bekleyen olmayan davette null doner", () => {
    expect(daysLeft(invite({ status: "accepted" }), NOW)).toBeNull();
  });
});

describe("invitationNote", () => {
  it("bekleyen davette e-posta gonderilmedigini yazar", () => {
    const note = invitationNote(invite(), NOW);
    expect(note).toContain("E-posta gönderilmedi");
    expect(note).toContain("7 gün geçerli");
  });

  it("suresi dolmus davette yenisini olusturmayi soyler", () => {
    expect(invitationNote(invite(), NOW + 8 * DAY)).toContain("Süresi doldu");
  });

  it("iptal edilmis davette baglantinin calismadigini yazar", () => {
    expect(invitationNote(invite({ status: "revoked" }), NOW)).toContain("İptal edildi");
  });

  it("kabul edilmis davette kabul yazar", () => {
    expect(invitationNote(invite({ status: "accepted" }), NOW)).toBe("Kabul edildi.");
  });
});
