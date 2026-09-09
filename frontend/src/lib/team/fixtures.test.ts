/**
 * Örnek verinin gerçek veriden ayrıldığının sınanması.
 *
 * Bu dosyadaki testler ürünün en kritik dürüstlük kuralını korur: örnek bir
 * kayıt hiçbir yolla gerçek gibi görünemez, saklanamaz ve geri yüklenemez.
 */

import { describe, expect, it } from "vitest";
import {
  sampleActivity,
  sampleComments,
  sampleInvitations,
  sampleMembers,
  samplePresence,
} from "./fixtures";
import {
  isValidComment,
  isValidInvitation,
  parseComments,
  parseInvitations,
} from "./storage";
import { hasLivePresence } from "./workspace";
import { activeUserCount } from "./members";
import { lastRealEvent } from "./activity";

const NOW = 1_700_000_000_000;

describe("örnek kayıtların etiketi", () => {
  it("ornek uyelerin hepsi fixture", () => {
    expect(sampleMembers(NOW).every((item) => item.origin === "fixture")).toBe(true);
  });

  it("ornek olaylarin hepsi fixture", () => {
    expect(sampleActivity(NOW).every((item) => item.origin === "fixture")).toBe(true);
  });

  it("ornek yorumlarin hepsi fixture", () => {
    expect(sampleComments(NOW).every((item) => item.origin === "fixture")).toBe(true);
  });

  it("ornek eszamanlilik kayitlarinin hepsi fixture", () => {
    expect(samplePresence(NOW).every((item) => item.origin === "fixture")).toBe(true);
  });

  it("ornek davetlerin hepsi fixture", () => {
    expect(sampleInvitations(NOW).every((item) => item.origin === "fixture")).toBe(true);
  });
});

describe("örnek veri gerçek gibi davranmaz", () => {
  it("ornek uyeler aktif kullanici sayilmaz", () => {
    expect(activeUserCount(sampleMembers(NOW), NOW)).toBeNull();
  });

  it("ornek olaylar son gercek olay sayilmaz", () => {
    expect(lastRealEvent(sampleActivity(NOW))).toBeNull();
  });

  it("ornek eszamanlilik kayitlari canli degildir", () => {
    expect(hasLivePresence(samplePresence(NOW))).toBe(false);
  });

  it("ornek davette e-posta gonderilmis gorunmez", () => {
    expect(sampleInvitations(NOW).every((item) => !item.emailSent)).toBe(true);
  });
});

describe("örnek veri tutarlılığı", () => {
  it("zaman disaridan verilir ve ureticiyi etkiler", () => {
    const a = sampleMembers(NOW);
    const b = sampleMembers(NOW + 1_000);
    expect(b[0].lastActiveAtMs).toBe((a[0].lastActiveAtMs ?? 0) + 1_000);
  });

  it("katilmamis ornek uyenin son etkinligi bilinmez", () => {
    const invited = sampleMembers(NOW).find((item) => item.status === "invited");
    expect(invited?.lastActiveAtMs).toBeNull();
  });

  it("ornek kimlikler benzersizdir", () => {
    const ids = sampleMembers(NOW).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ornek olaylar yeniden eskiye siralidir", () => {
    const times = sampleActivity(NOW).map((item) => item.atMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("ornek yorumlardan biri cozulmus, biri aciktir", () => {
    const comments = sampleComments(NOW);
    expect(comments.some((item) => item.resolved)).toBe(true);
    expect(comments.some((item) => !item.resolved)).toBe(true);
  });

  it("cozulmus ornek yorum kimin kapattigini tasir", () => {
    const resolved = sampleComments(NOW).find((item) => item.resolved);
    expect(resolved?.resolvedBy).not.toBeNull();
  });
});

describe("depolamada örnek veri", () => {
  it("depodan okunan davetler bu cihaz kaynakli olur", () => {
    // Bir ornek gercek gibi geri yuklenirse, hic olusturulmamis bir baglanti
    // davet listesinde gorunurdu.
    const raw = JSON.stringify(sampleInvitations(NOW));
    expect(parseInvitations(raw).every((item) => item.origin === "local")).toBe(true);
  });

  it("depodan okunan yorumlar bu cihaz kaynakli olur", () => {
    const raw = JSON.stringify(sampleComments(NOW));
    expect(parseComments(raw).every((item) => item.origin === "local")).toBe(true);
  });
});

describe("parseInvitations", () => {
  it("kayit yoksa bos doner", () => {
    expect(parseInvitations(null)).toEqual([]);
  });

  it("bozuk JSON bos doner", () => {
    expect(parseInvitations("{bozuk")).toEqual([]);
  });

  it("dizi olmayan icerik bos doner", () => {
    expect(parseInvitations(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("eksik alanli kayit atilir", () => {
    expect(parseInvitations(JSON.stringify([{ id: "x" }]))).toEqual([]);
  });

  it("gecerli kayit okunur", () => {
    const raw = JSON.stringify(sampleInvitations(NOW));
    expect(parseInvitations(raw)).toHaveLength(1);
  });
});

describe("isValidInvitation", () => {
  it("gecerli daveti taniyor", () => {
    expect(isValidInvitation(sampleInvitations(NOW)[0])).toBe(true);
  });

  it("null reddedilir", () => {
    expect(isValidInvitation(null)).toBe(false);
  });

  it("metin reddedilir", () => {
    expect(isValidInvitation("davet")).toBe(false);
  });
});

describe("parseComments", () => {
  it("kayit yoksa bos doner", () => {
    expect(parseComments(null)).toEqual([]);
  });

  it("bozuk JSON bos doner", () => {
    expect(parseComments("[")).toEqual([]);
  });

  it("gecerli yorumlari okur", () => {
    expect(parseComments(JSON.stringify(sampleComments(NOW)))).toHaveLength(2);
  });

  it("hedefi bozuk yorum atilir", () => {
    const broken = [{ ...sampleComments(NOW)[0], target: { kind: "makine", id: "x" } }];
    expect(parseComments(JSON.stringify(broken))).toEqual([]);
  });
});

describe("isValidComment", () => {
  it("gecerli yorumu taniyor", () => {
    expect(isValidComment(sampleComments(NOW)[0])).toBe(true);
  });

  it("anmalari dizi olmayan yorumu reddeder", () => {
    expect(isValidComment({ ...sampleComments(NOW)[0], mentions: "ayse" })).toBe(false);
  });

  it("hedefi olmayan yorumu reddeder", () => {
    const { target: _target, ...rest } = sampleComments(NOW)[0];
    expect(isValidComment(rest)).toBe(false);
  });
});
