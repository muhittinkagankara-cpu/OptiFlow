import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL,
  bucketOf,
  calendarDaysBetween,
  groupByStage,
  isValidLead,
  moveLead,
  parseLeads,
  pipelineCounts,
  upcomingMeetings,
} from "./pipeline";
import { sampleLeads, sampleMeetings } from "./fixtures";
import { STAGE_ORDER } from "./types";
import type { Lead } from "./types";

const NOW = new Date("2026-09-05T09:00:00");

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    company: `Firma ${id}`,
    sector: "Metal",
    city: "İstanbul",
    contactName: "Test Yetkili",
    phone: "0500 000 00 00",
    email: "test@example.com",
    machineCount: 10,
    employeeCount: 30,
    note: "",
    stage: "new",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    demo: null,
    wonMonthly: null,
    ...overrides,
  };
}

describe("moveLead", () => {
  it("durumu degistirir ve son islem saatini ilerletir", () => {
    const before = [lead("a", { updatedAt: "2026-09-01T00:00:00.000Z" })];
    const after = moveLead(before, "a", "demo", NOW);
    expect(after[0].stage).toBe("demo");
    expect(after[0].updatedAt).toBe(NOW.toISOString());
  });

  it("ayni duruma tasimak kaydi degistirmez", () => {
    // Ayni sutuna birakmak hatirlaticiyi sifirlamamali.
    const before = [lead("a", { stage: "demo", updatedAt: "2026-09-01T00:00:00.000Z" })];
    const after = moveLead(before, "a", "demo", NOW);
    expect(after[0]).toBe(before[0]);
  });

  it("taninmayan kimligi sessizce gecer", () => {
    const before = [lead("a")];
    expect(moveLead(before, "yok", "won", NOW)).toEqual(before);
  });

  it("girdiyi degistirmez", () => {
    const before = [lead("a")];
    moveLead(before, "a", "won", NOW, 5_000);
    expect(before[0].stage).toBe("new");
  });

  it("kazanildi durumunda aylik tutari yazar", () => {
    const after = moveLead([lead("a")], "a", "won", NOW, 12_000);
    expect(after[0].wonMonthly).toBe(12_000);
  });

  it("kazanilmis kayit geri alinirsa geliri siler", () => {
    // Kazanilmamis bir anlasmanin geliri raporlanamaz.
    const won = moveLead([lead("a")], "a", "won", NOW, 12_000);
    const back = moveLead(won, "a", "sent", NOW);
    expect(back[0].wonMonthly).toBeNull();
  });
});

describe("groupByStage", () => {
  it("bes sutunu da bos olsa uretir", () => {
    const groups = groupByStage([]);
    expect(Object.keys(groups).sort()).toEqual([...STAGE_ORDER].sort());
    for (const stage of STAGE_ORDER) {
      expect(groups[stage]).toEqual([]);
    }
  });

  it("her sutunda en son dokunulan kart ustte durur", () => {
    const groups = groupByStage([
      lead("eski", { stage: "demo", updatedAt: "2026-09-01T00:00:00.000Z" }),
      lead("yeni", { stage: "demo", updatedAt: "2026-09-04T00:00:00.000Z" }),
    ]);
    expect(groups.demo.map((item) => item.id)).toEqual(["yeni", "eski"]);
  });

  it("ornek veriyi bes duraga dagitir", () => {
    const groups = groupByStage(sampleLeads(NOW));
    expect(groups.new.length).toBeGreaterThan(0);
    expect(groups.demo.length).toBeGreaterThan(0);
    expect(groups.won.length).toBeGreaterThan(0);
  });
});

describe("pipelineCounts", () => {
  it("bos hatta hepsini sifir verir", () => {
    expect(pipelineCounts([])).toEqual({
      total: 0,
      awaitingDemo: 0,
      awaitingProposal: 0,
      won: 0,
      wonMonthlyTotal: 0,
    });
  });

  it("duraklari ayri ayri sayar", () => {
    const counts = pipelineCounts([
      lead("a", { stage: "new" }),
      lead("b", { stage: "demo" }),
      lead("c", { stage: "demo" }),
      lead("d", { stage: "won", wonMonthly: 10_000 }),
      lead("e", { stage: "won", wonMonthly: 5_000 }),
    ]);
    expect(counts).toMatchObject({
      total: 5,
      awaitingDemo: 1,
      awaitingProposal: 2,
      won: 2,
      wonMonthlyTotal: 15_000,
    });
  });

  it("tutari olmayan kazanimi sifir sayar, cokmez", () => {
    expect(pipelineCounts([lead("a", { stage: "won" })]).wonMonthlyTotal).toBe(0);
  });
});

describe("takvim", () => {
  it("gun farkini takvim gunu uzerinden olcer", () => {
    // Saat 23:00'te bakan biri icin "yarin 09:00" gercekten yarindir.
    const late = new Date("2026-09-05T23:00:00");
    const tomorrowMorning = new Date("2026-09-06T09:00:00");
    expect(calendarDaysBetween(late, tomorrowMorning)).toBe(1);
  });

  it("bugun, yarin ve bu hafta kovalarini ayirir", () => {
    expect(bucketOf(new Date("2026-09-05T15:00:00").toISOString(), NOW)).toBe("today");
    expect(bucketOf(new Date("2026-09-06T10:00:00").toISOString(), NOW)).toBe("tomorrow");
    expect(bucketOf(new Date("2026-09-09T10:00:00").toISOString(), NOW)).toBe("week");
    expect(bucketOf(new Date("2026-09-30T10:00:00").toISOString(), NOW)).toBe("later");
  });

  it("gecmis gorusmeyi takvime koymaz", () => {
    // Gecmisi hatirlaticilar takip eder, takvim degil.
    expect(bucketOf(new Date("2026-09-01T10:00:00").toISOString(), NOW)).toBeNull();
  });

  it("gecersiz tarihte null doner", () => {
    expect(bucketOf("bozuk", NOW)).toBeNull();
  });

  it("her kovada gorusmeleri zamana gore siralar", () => {
    const buckets = upcomingMeetings(sampleMeetings(NOW), NOW);
    expect(buckets.today.length).toBeGreaterThan(0);
    expect(buckets.tomorrow.length).toBeGreaterThan(0);
    for (const key of Object.keys(BUCKET_LABEL) as (keyof typeof BUCKET_LABEL)[]) {
      const list = buckets[key];
      for (let i = 1; i < list.length; i += 1) {
        expect(Date.parse(list[i].at)).toBeGreaterThanOrEqual(
          Date.parse(list[i - 1].at),
        );
      }
    }
  });
});

describe("saklama", () => {
  it("bozuk metinde bos liste doner", () => {
    expect(parseLeads(null)).toEqual([]);
    expect(parseLeads("{ bozuk")).toEqual([]);
    expect(parseLeads('"dizi degil"')).toEqual([]);
  });

  it("gecersiz kayitlari eler", () => {
    // Depoya baska bir sekme ya da eski bir surum herhangi bir sey yazmis
    // olabilir.
    const raw = JSON.stringify([
      lead("saglam"),
      { id: "eksik" },
      { ...lead("bozukDurum"), stage: "yok" },
      { ...lead("adsiz"), company: "" },
    ]);
    const parsed = parseLeads(raw);
    expect(parsed.map((item) => item.id)).toEqual(["saglam"]);
  });

  it("saglam kaydi tanir", () => {
    expect(isValidLead(lead("a"))).toBe(true);
    expect(isValidLead(null)).toBe(false);
    expect(isValidLead("metin")).toBe(false);
  });

  it("yazip okumak listeyi korur", () => {
    const leads = sampleLeads(NOW);
    expect(parseLeads(JSON.stringify(leads))).toEqual(leads);
  });
});
