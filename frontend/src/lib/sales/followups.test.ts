import { describe, expect, it } from "vitest";
import {
  DUE_SOON_MARGIN_DAYS,
  OVERDUE_DAYS,
  buildFollowUps,
  readyForProposal,
} from "./followups";
import { sampleLeads } from "./fixtures";
import type { Lead, LeadStage } from "./types";

const NOW = new Date("2026-09-05T09:00:00");

function daysAgo(days: number): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function lead(stage: LeadStage, waitedDays: number, id: string = stage): Lead {
  return {
    id,
    company: `Firma ${id}`,
    sector: "Metal",
    city: "İstanbul",
    contactName: "Yetkili",
    phone: "0500 000 00 00",
    email: "test@example.com",
    machineCount: 10,
    employeeCount: 30,
    note: "",
    stage,
    createdAt: daysAgo(waitedDays + 5),
    updatedAt: daysAgo(waitedDays),
    demo: null,
    wonMonthly: null,
  };
}

describe("buildFollowUps", () => {
  it("bos hatta hicbir sey uretmez", () => {
    expect(buildFollowUps([], NOW)).toEqual([]);
  });

  it("yeni girilen kayit ilk gun uyari dogurmaz", () => {
    // Her yeni firmanin aninda uyari dogurmasi, listeyi gormezden gelinen bir
    // gurultuye cevirirdi.
    expect(buildFollowUps([lead("new", 0)], NOW)).toEqual([]);
  });

  it("esigi gecen kaydi gecikmis isaretler", () => {
    const items = buildFollowUps([lead("demo", OVERDUE_DAYS.demo)], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("overdue");
    expect(items[0].waitingDays).toBe(OVERDUE_DAYS.demo);
  });

  it("demo sonrasi donus yapilmadi mesajini yazar", () => {
    const items = buildFollowUps([lead("demo", 4)], NOW);
    expect(items[0].text).toContain("Demo yapıldı");
    expect(items[0].text).toContain("dönüş yapılmadı");
  });

  it("teklif bekleyen icin gun sayisini yazar", () => {
    const items = buildFollowUps([lead("proposal", 3)], NOW);
    expect(items[0].text).toContain("3 gündür");
    expect(items[0].text).toContain("teklif");
  });

  it("esige bir gun kala yaklasan uyarisi verir", () => {
    const waited = OVERDUE_DAYS.sent - DUE_SOON_MARGIN_DAYS;
    const items = buildFollowUps([lead("sent", waited)], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("due");
    expect(items[0].text).toContain("Yarın");
  });

  it("kazanilmis kayit beklemez", () => {
    expect(buildFollowUps([lead("won", 90)], NOW)).toEqual([]);
  });

  it("gelecek tarihli kayitta uyari uretmez", () => {
    // Saat farki ya da elle duzenleme; bekleme suresi hesaplanamaz.
    const future = { ...lead("demo", 0), updatedAt: "2026-09-20T00:00:00.000Z" };
    expect(buildFollowUps([future], NOW)).toEqual([]);
  });

  it("gecikmisleri one alir, sonra en uzun bekleyeni", () => {
    const items = buildFollowUps(
      [
        lead("sent", OVERDUE_DAYS.sent - DUE_SOON_MARGIN_DAYS, "yaklasan"),
        lead("demo", 4, "az-gecikmis"),
        lead("new", 20, "cok-gecikmis"),
      ],
      NOW,
    );
    expect(items.map((item) => item.id)).toEqual([
      "overdue-cok-gecikmis",
      "overdue-az-gecikmis",
      "due-yaklasan",
    ]);
  });

  it("her durak icin ayri esik kullanir", () => {
    // Teklif hazir bekleyen, yeni lead'den daha cabuk gecikmis sayilir.
    expect(OVERDUE_DAYS.proposal).toBeLessThanOrEqual(OVERDUE_DAYS.sent);
    const waited = OVERDUE_DAYS.proposal;
    expect(buildFollowUps([lead("proposal", waited)], NOW)[0].severity).toBe(
      "overdue",
    );
  });

  it("ornek veride en az bir hatirlatici cikar", () => {
    expect(buildFollowUps(sampleLeads(NOW), NOW).length).toBeGreaterThan(0);
  });
});

describe("readyForProposal", () => {
  it("demosu yapilmis kayitlari verir", () => {
    const ready = readyForProposal(sampleLeads(NOW));
    expect(ready.every((item) => item.stage === "demo")).toBe(true);
    expect(ready.every((item) => item.demo !== null)).toBe(true);
  });

  it("demo kaydi olmayan 'demo' durumunu saymaz", () => {
    expect(readyForProposal([lead("demo", 1)])).toEqual([]);
  });
});
