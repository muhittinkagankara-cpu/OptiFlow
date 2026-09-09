/**
 * Uçtan uca kurulum akışı.
 *
 * Tek tek doğru çalışan işlevler, birlikte yanlış bir tablo çizebilir: hazırlık
 * puanı artarken kontrol listesinin aynı kalması ya da danışmanın tamamlanmış
 * bir adımı hâlâ eksik sayması, ancak akışın tamamı sınandığında görülür.
 */

import { describe, expect, it } from "vitest";
import { initialState, sampleConfigs, sampleRuntimes } from "../connectors";
import { isGrounded } from "../copilot";
import { answerSetupQuestion, buildSetupContext } from "./advisor";
import { buildChecklist, completedCount, nextItem, remainingMinutes } from "./checklist";
import { healthCards } from "./connectorHealth";
import { emptySignals, emptyState, sampleMachines } from "./fixtures";
import { upsertMachine } from "./inventory";
import { buildReadiness, isSetupComplete } from "./readiness";
import { parseState } from "./storage";
import type { EnterpriseState, ReadinessSignals } from "./types";

const NOW = new Date("2026-09-07T10:00:00");
const HEALTH = healthCards(
  initialState(sampleConfigs(), [], [], sampleRuntimes(NOW.getTime())),
  NOW.getTime(),
);

/** Kurulumun yedi adımını sırayla uygular. */
function walkSetup() {
  const steps: { label: string; state: EnterpriseState; signals: ReadinessSignals }[] = [];

  let state = emptyState();
  let signals = emptySignals();
  steps.push({ label: "başlangıç", state, signals });

  /* 1. Şirket */
  state = {
    ...state,
    company: {
      name: "Kuzey Metal A.Ş.",
      logoDataUrl: "data:image/png;base64,x",
      sector: "metal",
      factoryCount: 1,
      currency: "TRY",
    },
  };
  steps.push({ label: "şirket", state, signals });

  /* 2. Fabrika */
  state = {
    ...state,
    factories: [
      {
        id: "fab-1",
        name: "Kuzey Hat 1",
        location: "Kocaeli",
        lineCount: 2,
        shiftsPerDay: 2,
        shiftHours: 8,
      },
    ],
  };
  signals = { ...signals, savedFactoryCount: 1 };
  steps.push({ label: "fabrika", state, signals });

  /* 3. Makineler */
  let machines = state.machines;
  for (let index = 0; index < 8; index += 1) {
    machines = upsertMachine(machines, {
      ...sampleMachines()[0],
      id: `mch-${index}`,
      name: `CNC-0${index}`,
      serialNumber: `SN-${index}`,
    });
  }
  state = { ...state, machines };
  steps.push({ label: "makineler", state, signals });

  /* 4. Veri kaynakları */
  signals = { ...signals, connectorCount: 3, connectedCount: 3 };
  steps.push({ label: "kaynaklar", state, signals });

  /* 5. Simülasyon */
  signals = { ...signals, hasSimulationRun: true };
  steps.push({ label: "simülasyon", state, signals });

  /* 6. Doğrulama */
  signals = { ...signals, validationCount: 1 };
  steps.push({ label: "doğrulama", state, signals });

  /* 7. Rapor */
  state = {
    ...state,
    milestones: { ...state.milestones, firstReportAtMs: NOW.getTime() },
  };
  steps.push({ label: "rapor", state, signals });

  return steps;
}

const STEPS = walkSetup();
const FINAL = STEPS[STEPS.length - 1];

describe("kurulum akışı — hazırlık puanı", () => {
  it("her adımda artar", () => {
    const totals = STEPS.map(
      (step) => buildReadiness(step.state, step.signals).total,
    );
    for (let index = 1; index < totals.length; index += 1) {
      expect(totals[index]).toBeGreaterThan(totals[index - 1]);
    }
  });

  it("başlangıçta sıfırdır", () => {
    expect(buildReadiness(STEPS[0].state, STEPS[0].signals).total).toBe(0);
  });

  it("yedi adım sonunda yüze ulaşır", () => {
    expect(buildReadiness(FINAL.state, FINAL.signals).total).toBe(100);
  });

  it("sonunda band yeşile döner", () => {
    expect(buildReadiness(FINAL.state, FINAL.signals).band).toBe("green");
  });

  it("aradaki bir adımda band turuncu ya da maviye geçer", () => {
    const bands = STEPS.map((step) => buildReadiness(step.state, step.signals).band);
    expect(bands).toContain("orange");
    expect(bands[bands.length - 1]).toBe("green");
  });
});

describe("kurulum akışı — kontrol listesi", () => {
  it("tamamlanan madde sayısı puanla birlikte artar", () => {
    const counts = STEPS.map((step) =>
      completedCount(buildChecklist(buildReadiness(step.state, step.signals))),
    );
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
    }
    expect(counts[counts.length - 1]).toBe(7);
  });

  it("kalan süre her adımda azalır", () => {
    const minutes = STEPS.map((step) =>
      remainingMinutes(buildChecklist(buildReadiness(step.state, step.signals))),
    );
    for (let index = 1; index < minutes.length; index += 1) {
      expect(minutes[index]).toBeLessThanOrEqual(minutes[index - 1]);
    }
    expect(minutes[minutes.length - 1]).toBe(0);
  });

  it("sıradaki madde her zaman tamamlanmamış olandır", () => {
    for (const step of STEPS.slice(0, -1)) {
      const items = buildChecklist(buildReadiness(step.state, step.signals));
      const next = nextItem(items);
      expect(next?.done).toBe(false);
    }
  });

  it("kontrol listesi ile hazırlık raporu asla ayrışmaz", () => {
    for (const step of STEPS) {
      const report = buildReadiness(step.state, step.signals);
      const items = buildChecklist(report);
      expect(completedCount(items)).toBe(
        report.categories.filter((category) => category.complete).length,
      );
    }
  });

  it("kurulum bitince sıradaki madde kalmaz", () => {
    const report = buildReadiness(FINAL.state, FINAL.signals);
    expect(nextItem(buildChecklist(report))).toBeNull();
    expect(isSetupComplete(report)).toBe(true);
  });
});

describe("kurulum akışı — danışman", () => {
  it("her adımda dayanaksız sayı üretmez", () => {
    for (const step of STEPS) {
      const input = {
        state: step.state,
        readiness: buildReadiness(step.state, step.signals),
        health: HEALTH,
        now: NOW,
      };
      const context = buildSetupContext(input);
      const answer = answerSetupQuestion("Eksik kurulum adımlarım neler?", input);
      expect(isGrounded(answer.text, context)).toBe(true);
    }
  });

  it("eksik adımı kontrol listesiyle aynı söyler", () => {
    const step = STEPS[2];
    const readiness = buildReadiness(step.state, step.signals);
    const next = nextItem(buildChecklist(readiness));
    const answer = answerSetupQuestion("Eksik kurulum adımlarım neler?", {
      state: step.state,
      readiness,
      health: HEALTH,
      now: NOW,
    });
    expect(answer.text).toContain(next?.label ?? "");
  });

  it("kurulum bitince tamamlandığını söyler", () => {
    const answer = answerSetupQuestion("Eksik adımlarım neler?", {
      state: FINAL.state,
      readiness: buildReadiness(FINAL.state, FINAL.signals),
      health: HEALTH,
      now: NOW,
    });
    expect(answer.text).toContain("Kurulumun tamamı bitti");
  });

  it("canlı bağlantı sorusunda her adımda benzetim uyarısı verir", () => {
    for (const step of [STEPS[0], STEPS[4], FINAL]) {
      const answer = answerSetupQuestion("Canlı bağlantıya hazır mıyım?", {
        state: step.state,
        readiness: buildReadiness(step.state, step.signals),
        health: HEALTH,
        now: NOW,
      });
      expect(answer.text).toContain("benzetimdir");
    }
  });
});

describe("kurulum akışı — kalıcılık", () => {
  it("kaydedilen durum aynen geri okunur", () => {
    const parsed = parseState(JSON.stringify(FINAL.state));
    expect(parsed.company?.name).toBe(FINAL.state.company?.name);
    expect(parsed.machines).toHaveLength(FINAL.state.machines.length);
    expect(parsed.milestones.firstReportAtMs).toBe(NOW.getTime());
  });

  it("geri okunan durum aynı puanı verir", () => {
    const parsed = parseState(JSON.stringify(FINAL.state));
    expect(buildReadiness(parsed, FINAL.signals).total).toBe(
      buildReadiness(FINAL.state, FINAL.signals).total,
    );
  });

  it("bozuk kayıt kurulumu sıfırlamaz, boş durumla başlar", () => {
    expect(parseState("{bozuk").machines).toEqual([]);
    expect(parseState(null).company).toBeNull();
  });

  it("bozuk tek makine atılır, geri kalanı korunur", () => {
    const raw = JSON.stringify({
      ...FINAL.state,
      machines: [...FINAL.state.machines, { id: "kirik" }],
    });
    expect(parseState(raw).machines).toHaveLength(FINAL.state.machines.length);
  });

  it("eksik ayarlar varsayılanla tamamlanır", () => {
    const raw = JSON.stringify({ ...FINAL.state, settings: { currency: "EUR" } });
    const parsed = parseState(raw);
    expect(parsed.settings.currency).toBe("EUR");
    expect(parsed.settings.brandColor).not.toBe("");
  });
});
