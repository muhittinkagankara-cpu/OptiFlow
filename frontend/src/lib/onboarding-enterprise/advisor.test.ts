import { describe, expect, it } from "vitest";
import { NO_DATA_MESSAGE, isGrounded } from "../copilot";
import { initialState, sampleConfigs, sampleRuntimes } from "../connectors";
import {
  SETUP_QUESTIONS,
  answerSetupQuestion,
  buildSetupContext,
  detectSetupIntent,
  firstIncompleteMachine,
  type AdvisorInput,
} from "./advisor";
import { healthCards } from "./connectorHealth";
import {
  completedSignals,
  completedState,
  emptySignals,
  emptyState,
  sampleMachines,
  sampleState,
} from "./fixtures";
import { buildReadiness } from "./readiness";
import type { EnterpriseState, ReadinessSignals } from "./types";

const NOW = new Date("2026-09-07T10:00:00");
const CONNECTOR_STATE = initialState(
  sampleConfigs(),
  [],
  [],
  sampleRuntimes(NOW.getTime()),
);

function input(
  state: EnterpriseState = sampleState(),
  signals: ReadinessSignals = emptySignals(),
): AdvisorInput {
  return {
    state,
    readiness: buildReadiness(state, signals),
    health: healthCards(CONNECTOR_STATE, NOW.getTime()),
    now: NOW,
  };
}

describe("SETUP_QUESTIONS", () => {
  it("dort hazir soru sunar", () => {
    expect(SETUP_QUESTIONS).toHaveLength(4);
    expect(SETUP_QUESTIONS[0]).toContain("Eksik kurulum");
  });
});

describe("detectSetupIntent", () => {
  it("eksik adim sorusunu tanir", () => {
    expect(detectSetupIntent("Eksik kurulum adımlarım neler?")).toBe("missing");
  });

  it("simulasyon sorusunu tanir", () => {
    expect(detectSetupIntent("İlk simülasyonu nasıl iyileştiririm?")).toBe("simulation");
  });

  it("makine sorusunu tanir", () => {
    expect(detectSetupIntent("Hangi makine eksik tanımlanmış?")).toBe("machines");
  });

  it("canli baglanti sorusunu tanir", () => {
    expect(detectSetupIntent("Canlı bağlantıya hazır mıyım?")).toBe("live");
  });

  it("taninmayan soru genel duruma gider", () => {
    expect(detectSetupIntent("Merhaba")).toBe("status");
  });

  it("buyuk harften etkilenmez", () => {
    expect(detectSetupIntent("HANGİ MAKİNE EKSİK?")).toBe("machines");
  });
});

describe("buildSetupContext", () => {
  const context = buildSetupContext(input());

  it("tek bir kurulum bolumu uretir", () => {
    expect(context.sections).toHaveLength(1);
    expect(context.sections[0].source).toBe("onboarding");
    expect(context.sections[0].available).toBe(true);
  });

  it("hazirlik puanini olgu olarak tasir", () => {
    const fact = context.sections[0].facts.find((item) => item.key === "readiness_total");
    expect(fact?.numeric).toBe(buildReadiness(sampleState(), emptySignals()).total);
  });

  it("tamamlanan adim sayisini tasir", () => {
    expect(
      context.sections[0].facts.some((item) => item.key === "completed_steps"),
    ).toBe(true);
  });

  it("eksik adimlari listeler", () => {
    const fact = context.sections[0].facts.find((item) => item.key === "missing_steps");
    expect(fact?.display).toContain("simülasyon");
  });

  it("kurulum bittiginde eksik adim olgusu eklenmez", () => {
    const done = buildSetupContext(input(completedState(), completedSignals()));
    expect(done.sections[0].facts.some((item) => item.key === "missing_steps")).toBe(false);
  });

  it("sirket adini baglama yazar", () => {
    expect(context.factoryName).toBe("Kuzey Metal A.Ş.");
  });

  it("eksik tanimli makineyi bulur", () => {
    const fact = context.sections[0].facts.find((item) => item.key === "incomplete_machine");
    expect(fact?.display).toContain("Torna-01");
  });
});

describe("firstIncompleteMachine", () => {
  it("seri numarasi eksik makineyi bulur", () => {
    expect(firstIncompleteMachine(sampleMachines())?.name).toBe("Torna-01");
  });

  it("hepsi tamsa bos doner", () => {
    const complete = sampleMachines().map((machine, index) => ({
      ...machine,
      serialNumber: machine.serialNumber ?? `SN-${index}`,
      installedYear: machine.installedYear ?? 2020,
    }));
    expect(firstIncompleteMachine(complete)).toBeNull();
  });

  it("bos listede bos doner", () => {
    expect(firstIncompleteMachine([])).toBeNull();
  });
});

describe("answerSetupQuestion — eksik adımlar", () => {
  const answer = answerSetupQuestion("Eksik kurulum adımlarım neler?", input());

  it("puani ve eksikleri yazar", () => {
    expect(answer.text).toContain("Hazırlık puanınız");
    expect(answer.text).toContain("İlk simülasyon");
  });

  it("siradaki adimi ve suresini soyler", () => {
    expect(answer.text).toContain("Sıradaki adım");
    expect(answer.text).toContain("dakika");
  });

  it("surelerin tahmin oldugunu gerekcede yazar", () => {
    // Olculmemis bir sureyi olculmus gibi sunmamak icin.
    expect(answer.reasons.some((reason) => reason.includes("tahmindir"))).toBe(true);
  });

  it("eylem karti verir", () => {
    expect(answer.actions.length).toBeGreaterThan(0);
  });

  it("kurulum bittiginde tamamlandigini soyler", () => {
    const done = answerSetupQuestion(
      "Eksik adımlarım neler?",
      input(completedState(), completedSignals()),
    );
    expect(done.text).toContain("Kurulumun tamamı bitti");
  });
});

describe("answerSetupQuestion — makineler", () => {
  it("eksik tanimli makineyi soyler", () => {
    const answer = answerSetupQuestion("Hangi makine eksik tanımlanmış?", input());
    expect(answer.text).toContain("Torna-01");
    expect(answer.text).toContain("eksik alan");
  });

  it("envanter bosken veri yok der", () => {
    const answer = answerSetupQuestion(
      "Hangi makine eksik?",
      input(emptyState(), emptySignals()),
    );
    expect(answer.text).toBe(NO_DATA_MESSAGE);
    expect(answer.confidence).toBe("none");
  });

  it("envanter bosken envantere goturur", () => {
    const answer = answerSetupQuestion(
      "Hangi makine eksik?",
      input(emptyState(), emptySignals()),
    );
    expect(answer.actions.some((action) => action.view === "machines")).toBe(true);
  });

  it("makine sayisini yazar", () => {
    const answer = answerSetupQuestion("Makineler nasıl?", input());
    expect(answer.text).toContain(`${sampleMachines().length} makine`);
  });
});

describe("answerSetupQuestion — simülasyon", () => {
  it("kosum yoksa once kosum almayi soyler", () => {
    const answer = answerSetupQuestion("İlk simülasyonu nasıl iyileştiririm?", input());
    expect(answer.text).toContain("Henüz bir simülasyon çalıştırılmadı");
    expect(answer.actions.some((action) => action.view === "wizard")).toBe(true);
  });

  it("kosum varsa dogrulamaya yonlendirir", () => {
    const answer = answerSetupQuestion(
      "İlk simülasyonu nasıl iyileştiririm?",
      input(completedState(), completedSignals()),
    );
    expect(answer.actions.some((action) => action.view === "validation")).toBe(true);
  });
});

describe("answerSetupQuestion — canlı bağlantı", () => {
  const answer = answerSetupQuestion("Canlı bağlantıya hazır mıyım?", input());

  it("kaynak sayisini ve olcum durumunu yazar", () => {
    expect(answer.text).toContain("veri kaynağının");
  });

  it("benzetim oldugunu acikca soyler", () => {
    // Urunun en tehlikeli yalani, benzetimi gercek baglanti gibi sunmak olurdu.
    expect(answer.text).toContain("benzetimdir");
    expect(answer.text).toContain("gerçek bir PLC");
  });

  it("gercek dogrulama sartini gerekcede yazar", () => {
    expect(
      answer.reasons.some((reason) => reason.includes("gerçek bir uç noktada")),
    ).toBe(true);
  });

  it("kurulum eksikken canliya gecisi onermez", () => {
    expect(answer.text).toContain("canlıya geçiş henüz önerilmiyor");
  });

  it("baglantilara goturur", () => {
    expect(answer.actions.some((action) => action.view === "connectors")).toBe(true);
  });
});

describe("answerSetupQuestion — genel durum", () => {
  it("puani ve adim sayisini ozetler", () => {
    const answer = answerSetupQuestion("Durum nedir?", input());
    expect(answer.text).toContain("Hazırlık puanı");
    expect(answer.text).toContain("adım tamam");
  });

  it("puanin kanittan geldigini gerekcede yazar", () => {
    const answer = answerSetupQuestion("Durum nedir?", input());
    expect(answer.reasons.some((reason) => reason.includes("gerçekten"))).toBe(true);
  });
});

describe("guardrail", () => {
  it("her yanittaki sayilar baglamdan gelir", () => {
    const advisorInput = input();
    const context = buildSetupContext(advisorInput);
    for (const question of SETUP_QUESTIONS) {
      const answer = answerSetupQuestion(question, advisorInput);
      expect(isGrounded(answer.text, context)).toBe(true);
    }
  });

  it("tamamlanmis kurulumda da sayilar dayanaklidir", () => {
    const advisorInput = input(completedState(), completedSignals());
    const context = buildSetupContext(advisorInput);
    for (const question of SETUP_QUESTIONS) {
      expect(isGrounded(answerSetupQuestion(question, advisorInput).text, context)).toBe(
        true,
      );
    }
  });

  it("yanitlar kurulum kaynagini bildirir", () => {
    const answer = answerSetupQuestion("Durum nedir?", input());
    expect(answer.sources).toEqual(["onboarding"]);
  });
});
