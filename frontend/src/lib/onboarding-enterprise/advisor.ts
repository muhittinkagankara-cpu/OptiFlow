/**
 * Kurulum danışmanı — Copilot'un kurulum sorularını yanıtlaması.
 *
 * Yeni bir yanıt motoru **yazılmaz**: Copilot'un koruma katmanı
 * (`lib/copilot/guards.ts`) olduğu gibi kullanılır. Cümledeki her sayı
 * bağlamda bir olgu olarak durmak zorundadır; dayanaksız bir rakam üretilirse
 * yanıt gösterilmez. Kurulum ekranının kendi "akıllı" metinlerini yazması,
 * ürünün tek dürüstlük kuralını ikinci bir yerde yeniden uygulamak olurdu.
 *
 * Buradaki iş, kurulum durumunu Copilot'un anladığı dile çevirmektir:
 * `FactoryContext` içinde bir "onboarding" bölümü.
 */

import {
  confidenceOf,
  guardAnswer,
  noDataAnswer,
  type ActionCard,
  type ContextFact,
  type ContextSection,
  type CopilotAnswer,
  type FactoryContext,
} from "../copilot";
import { buildChecklist, nextItem, remainingMinutes } from "./checklist";
import { isSetupComplete, missingCategories } from "./readiness";
import {
  MACHINE_KIND_LABEL,
  STEP_LABEL,
  type ConnectorHealthCard,
  type EnterpriseState,
  type Machine,
  type ReadinessReport,
} from "./types";
import { validateMachines } from "./inventory";

/** Kurulum ekranında gösterilen hazır sorular. */
export const SETUP_QUESTIONS = [
  "Eksik kurulum adımlarım neler?",
  "İlk simülasyonu nasıl iyileştiririm?",
  "Hangi makine eksik tanımlanmış?",
  "Canlı bağlantıya hazır mıyım?",
];

export interface AdvisorInput {
  state: EnterpriseState;
  readiness: ReadinessReport;
  health: ConnectorHealthCard[];
  now: Date;
}

function fact(
  key: string,
  label: string,
  display: string,
  numeric: number | null,
): ContextFact {
  return {
    key,
    label,
    display,
    numeric,
    source: "onboarding",
    provenance: "measured",
  };
}

/**
 * Kurulum durumunu Copilot bağlamına çevirir.
 *
 * Tek bölüm üretir ("onboarding"); Copilot'un öteki bölümleri kendi
 * katmanlarından gelir ve burada taklit edilmez.
 */
export function buildSetupContext(input: AdvisorInput): FactoryContext {
  const { state, readiness, health } = input;
  const checklist = buildChecklist(readiness);
  const missing = missingCategories(readiness);
  const issues = validateMachines(state.machines, input.now);

  const facts: ContextFact[] = [
    fact("readiness_total", "Hazırlık puanı", `${readiness.total}`, readiness.total),
    fact(
      "completed_steps",
      "Tamamlanan adım",
      `${checklist.filter((item) => item.done).length}/${checklist.length}`,
      checklist.filter((item) => item.done).length,
    ),
    fact(
      "remaining_minutes",
      "Kalan tahmini süre",
      `${remainingMinutes(checklist)} dakika`,
      remainingMinutes(checklist),
    ),
    fact("machine_count", "Tanımlı makine", `${state.machines.length}`, state.machines.length),
    fact("machine_issues", "Eksik makine alanı", `${issues.length}`, issues.length),
    fact(
      "connector_measured",
      "Ölçümü olan kaynak",
      `${health.filter((card) => card.score !== null).length}/${health.length}`,
      health.filter((card) => card.score !== null).length,
    ),
  ];

  if (missing.length > 0) {
    facts.push(
      fact(
        "next_step",
        "Sıradaki adım",
        readiness.nextStep === null ? "—" : STEP_LABEL[readiness.nextStep],
        null,
      ),
      fact(
        "missing_steps",
        "Eksik adımlar",
        missing.map((category) => category.label).join(", "),
        missing.length,
      ),
    );
  }

  const worstMachine = firstIncompleteMachine(state.machines);
  if (worstMachine !== null) {
    facts.push(
      fact(
        "incomplete_machine",
        "Eksik tanımlı makine",
        `${worstMachine.name || "İsimsiz makine"} (${MACHINE_KIND_LABEL[worstMachine.kind]})`,
        null,
      ),
    );
  }

  const section: ContextSection = {
    source: "onboarding",
    available: true,
    missingReason: null,
    facts,
  };

  return {
    factoryName: state.company?.name ?? null,
    generatedAtMs: input.now.getTime(),
    sections: [section],
  };
}

/** Alanları eksik ilk makine; hepsi tamsa `null`. */
export function firstIncompleteMachine(machines: Machine[]): Machine | null {
  return (
    machines.find(
      (machine) =>
        machine.name.trim() === "" ||
        machine.serialNumber === null ||
        machine.serialNumber.trim() === "" ||
        machine.installedYear === null,
    ) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Yanıtlar                                                                    */
/* -------------------------------------------------------------------------- */

function action(view: string, label: string, reason: string): ActionCard {
  return { id: `setup-${view}`, label, view, reason };
}

/** Sorunun hangi kurulum konusuna baktığı. */
export type SetupIntent = "missing" | "simulation" | "machines" | "live" | "status";

export function detectSetupIntent(question: string): SetupIntent {
  const text = question.toLocaleLowerCase("tr-TR");
  if (text.includes("makine")) {
    return "machines";
  }
  if (text.includes("simülasyon") || text.includes("simulasyon")) {
    return "simulation";
  }
  if (text.includes("canlı") || text.includes("canli") || text.includes("bağlantı")) {
    return "live";
  }
  if (text.includes("eksik") || text.includes("adım") || text.includes("adim")) {
    return "missing";
  }
  return "status";
}

/**
 * Kurulum sorusunu yanıtlar.
 *
 * Yanıt, Copilot'un koruma katmanından geçer; bu yüzden buradaki cümlelerde
 * geçen her sayı `buildSetupContext` içinde bir olgu olarak bulunmalıdır.
 */
export function answerSetupQuestion(
  question: string,
  input: AdvisorInput,
): CopilotAnswer {
  const context = buildSetupContext(input);
  const { readiness, state, health } = input;
  const checklist = buildChecklist(readiness);
  const missing = missingCategories(readiness);
  const intent = detectSetupIntent(question);

  const sentences: string[] = [];
  const reasons: string[] = [];
  const actions: ActionCard[] = [];

  if (intent === "machines") {
    const issues = validateMachines(state.machines, input.now);
    const incomplete = firstIncompleteMachine(state.machines);

    if (state.machines.length === 0) {
      return noDataAnswer(
        {
          ...context,
          sections: context.sections.map((section) => ({
            ...section,
            available: false,
            missingReason: "Makine envanteri boş; karşılaştırılacak kayıt yok.",
            facts: [],
          })),
        },
        ["onboarding"],
        [action("machines", "Envanteri aç", "Makineleri eklemek için.")],
      );
    }

    sentences.push(`Envanterde ${state.machines.length} makine tanımlı.`);
    if (incomplete !== null) {
      sentences.push(
        `Eksik tanımlı ilk makine: ${incomplete.name || "İsimsiz makine"} (${MACHINE_KIND_LABEL[incomplete.kind]}).`,
      );
      reasons.push("Seri numarası ya da kurulum yılı girilmemiş makineler bakım takibine giremez.");
    }
    sentences.push(`Toplam ${issues.length} eksik alan var.`);
    reasons.push(`Envanter doğrulaması ${issues.length} eksik alan buldu.`);
    actions.push(action("machines", "Envanteri aç", "Eksik alanları doldurmak için."));
  } else if (intent === "simulation") {
    const simulationDone = readiness.categories.find(
      (category) => category.id === "simulation",
    )?.complete;

    if (simulationDone !== true) {
      sentences.push("Henüz bir simülasyon çalıştırılmadı; önce ilk koşumu alın.");
      reasons.push("Hazırlık raporunda simülasyon kategorisi tamamlanmamış görünüyor.");
      actions.push(action("wizard", "Simülasyona git", "İlk koşumu almak için."));
    } else {
      sentences.push(
        `Makine envanteri ${state.machines.length} kayıt içeriyor; modelin istasyon süreleri bu envanterle karşılaştırıldığında daha isabetli olur.`,
      );
      reasons.push(
        "Doğrulama ekranında ölçülen gerçek çevrim süreleri, modeldeki servis sürelerini düzeltmenin tek dayanağıdır.",
      );
      actions.push(action("validation", "Doğrulamayı aç", "Modeli sahayla karşılaştırmak için."));
    }
  } else if (intent === "live") {
    const measured = health.filter((card) => card.score !== null).length;
    sentences.push(
      `Tanımlı ${health.length} veri kaynağının ${measured} tanesinde ölçüm var.`,
    );
    sentences.push(
      "Bu kaynakların tamamı bu sürümde benzetimdir; gerçek bir PLC, OPC UA, MQTT ya da MES bağlantısı kurulmadı.",
    );
    reasons.push(
      "Canlı bağlantı, ancak gerçek bir uç noktada doğrulandıktan sonra 'hazır' sayılabilir.",
    );
    if (missing.length > 0) {
      sentences.push(
        `Kurulumda ${missing.length} adım eksik olduğu için canlıya geçiş henüz önerilmiyor.`,
      );
    }
    actions.push(action("connectors", "Bağlantıları aç", "Kaynakların durumunu görmek için."));
  } else if (intent === "missing") {
    if (missing.length === 0) {
      sentences.push(
        `Kurulumun tamamı bitti; hazırlık puanı ${readiness.total}.`,
      );
      reasons.push("Hazırlık raporundaki yedi kategorinin hepsi tamamlandı.");
    } else {
      sentences.push(
        `Hazırlık puanınız ${readiness.total}. Eksik adımlar: ${missing.map((category) => category.label).join(", ")}.`,
      );
      const next = nextItem(checklist);
      if (next !== null) {
        sentences.push(`Sıradaki adım: ${next.label}.`);
        reasons.push(next.hint);
        actions.push(action(next.view, `${next.label} adımına git`, next.hint));
      }
      sentences.push(`Kalan tahmini süre ${remainingMinutes(checklist)} dakika.`);
      reasons.push("Süreler adım başına tahmindir; ölçülmüş bir süre değildir.");
    }
  } else {
    sentences.push(
      `Hazırlık puanı ${readiness.total}; ${checklist.filter((item) => item.done).length}/${checklist.length} adım tamam.`,
    );
    if (missing.length > 0) {
      sentences.push(`Kalan tahmini süre ${remainingMinutes(checklist)} dakika.`);
    }
    reasons.push("Puan, ürünün gerçekten ürettiği sonuçlardan hesaplanır (koşum, doğrulama, rapor).");
    actions.push(action("dashboard", "Kurulum kartını aç", "Kalan adımları görmek için."));
  }

  if (isSetupComplete(readiness) && intent !== "live") {
    actions.push(action("reports", "Raporu aç", "Yönetici raporunu indirmek için."));
  }

  return guardAnswer(
    {
      text: sentences.join(" "),
      reasons,
      actions,
      confidence: confidenceOf(["onboarding"], context),
      sources: ["onboarding"],
    },
    context,
  );
}
