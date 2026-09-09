/**
 * Hazırlık puanı — kurulumun ne kadarının **gerçekten** yapıldığı.
 *
 * Ağırlıklar açık sabittir ve toplamı 100'dür. Puanların büyük kısmı beyan
 * edilen veriye değil, ürünün ürettiği kanıta bağlıdır (simülasyon 20,
 * doğrulama 15, rapor 10): bir müşteri şirket adını yazarak %100 hazır
 * görünememelidir.
 *
 * Kısmi puan verilir. "Makine envanteri" kategorisinde tek makine giren bir
 * müşteri sıfır almaz — ilerlemenin görünmesi, kurulumu bitirme olasılığını
 * artıran tek şeydir. Ama tam puan yalnızca kategori gerçekten
 * tamamlandığında verilir.
 */

import {
  BAND_LABEL,
  STEP_LABEL,
  STEP_ORDER,
  type EnterpriseState,
  type ReadinessBand,
  type ReadinessCategory,
  type ReadinessReport,
  type ReadinessSignals,
  type SetupStepId,
} from "./types";

/** Kategori ağırlıkları; toplamı 100. */
export const READINESS_WEIGHTS: Record<SetupStepId, number> = {
  company: 10,
  factory: 15,
  machines: 20,
  connectors: 10,
  simulation: 20,
  validation: 15,
  report: 10,
};

/**
 * Tam puan için beklenen makine sayısı.
 *
 * Sekiz makine, küçük bir hattın tamamını temsil eder. Daha yükseği, envanteri
 * gerçekten dolduran bir müşteriyi bile eksik gösterirdi.
 */
export const EXPECTED_MACHINES = 8;

/** Bandların alt sınırları. */
export const BAND_THRESHOLDS = {
  green: 90,
  blue: 70,
  orange: 40,
} as const;

/** Puanın bandı. */
export function bandOf(total: number): ReadinessBand {
  if (total >= BAND_THRESHOLDS.green) {
    return "green";
  }
  if (total >= BAND_THRESHOLDS.blue) {
    return "blue";
  }
  return total >= BAND_THRESHOLDS.orange ? "orange" : "red";
}

/** Bandın kullanıcıya gösterilen adı. */
export function bandLabel(band: ReadinessBand): string {
  return BAND_LABEL[band];
}

/** Oranı ağırlığa çevirir; 0-1 dışındaki değerler kırpılır. */
function share(weight: number, ratio: number): number {
  const safe = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return Math.round(weight * safe * 10) / 10;
}

/* -------------------------------------------------------------------------- */

function companyCategory(state: EnterpriseState): ReadinessCategory {
  const company = state.company;
  const weight = READINESS_WEIGHTS.company;

  if (company === null || company.name.trim() === "") {
    return {
      id: "company",
      label: STEP_LABEL.company,
      weight,
      earned: 0,
      detail: "Şirket adı girilmedi.",
      complete: false,
    };
  }

  /*
   * Ad zorunlu, geri kalanı puanı tamamlar. Logo ve para birimi raporlarda
   * görünür; sektör şablon seçimini etkiler.
   */
  const optional = [
    company.sector.trim() !== "",
    company.currency.trim() !== "",
    company.logoDataUrl !== null,
  ];
  const filled = optional.filter(Boolean).length;
  const earned = share(weight, 0.4 + 0.6 * (filled / optional.length));

  return {
    id: "company",
    label: STEP_LABEL.company,
    weight,
    earned,
    detail:
      filled === optional.length
        ? `${company.name} tanımlı; logo, sektör ve para birimi girildi.`
        : "Sektör, para birimi ve logo tamamlanmadı.",
    complete: filled === optional.length,
  };
}

function factoryCategory(
  state: EnterpriseState,
  signals: ReadinessSignals,
): ReadinessCategory {
  const weight = READINESS_WEIGHTS.factory;
  const declared = state.factories.length;
  const saved = signals.savedFactoryCount;

  if (declared === 0 && saved === 0) {
    return {
      id: "factory",
      label: STEP_LABEL.factory,
      weight,
      earned: 0,
      detail: "Henüz fabrika oluşturulmadı.",
      complete: false,
    };
  }

  /*
   * Sunucuya kaydedilmiş fabrika, sihirbazda doldurulmuş bir formdan daha
   * güçlü bir kanıttır; ikisi de sayılır ama tam puan için kaydedilmiş bir
   * fabrika gerekir.
   */
  const complete = saved > 0;
  const earned = complete ? weight : share(weight, 0.5);

  return {
    id: "factory",
    label: STEP_LABEL.factory,
    weight,
    earned,
    detail: complete
      ? `${saved} fabrika kaydedildi.`
      : "Fabrika bilgileri girildi ama henüz kaydedilmedi.",
    complete,
  };
}

function machineCategory(state: EnterpriseState): ReadinessCategory {
  const weight = READINESS_WEIGHTS.machines;
  const count = state.machines.length;

  if (count === 0) {
    return {
      id: "machines",
      label: STEP_LABEL.machines,
      weight,
      earned: 0,
      detail: "Makine envanteri boş.",
      complete: false,
    };
  }

  const withSerial = state.machines.filter(
    (machine) => machine.serialNumber !== null && machine.serialNumber.trim() !== "",
  ).length;

  /*
   * Sayı puanın dörtte üçünü, seri numarası doluluğu kalanını belirler: seri
   * numarası olmayan bir envanter bakım takibinde işe yaramaz.
   */
  const countRatio = Math.min(1, count / EXPECTED_MACHINES);
  const serialRatio = withSerial / count;
  const earned = share(weight, countRatio * 0.75 + serialRatio * 0.25);

  return {
    id: "machines",
    label: STEP_LABEL.machines,
    weight,
    earned,
    detail:
      countRatio >= 1 && serialRatio >= 1
        ? `${count} makine tanımlı, hepsinin seri numarası var.`
        : `${count} makine tanımlı; ${count - withSerial} tanesinde seri numarası eksik.`,
    complete: countRatio >= 1 && serialRatio >= 1,
  };
}

function connectorCategory(signals: ReadinessSignals): ReadinessCategory {
  const weight = READINESS_WEIGHTS.connectors;

  if (signals.connectorCount === 0) {
    return {
      id: "connectors",
      label: STEP_LABEL.connectors,
      weight,
      earned: 0,
      detail: "Tanımlı veri kaynağı yok.",
      complete: false,
    };
  }

  const ratio = signals.connectedCount / signals.connectorCount;
  return {
    id: "connectors",
    label: STEP_LABEL.connectors,
    weight,
    earned: share(weight, 0.3 + 0.7 * ratio),
    detail: `${signals.connectorCount} kaynaktan ${signals.connectedCount} tanesi bağlı (benzetim).`,
    complete: ratio >= 1,
  };
}

function simulationCategory(signals: ReadinessSignals): ReadinessCategory {
  const weight = READINESS_WEIGHTS.simulation;
  return {
    id: "simulation",
    label: STEP_LABEL.simulation,
    weight,
    earned: signals.hasSimulationRun ? weight : 0,
    detail: signals.hasSimulationRun
      ? "İlk simülasyon çalıştırıldı."
      : "Henüz simülasyon çalıştırılmadı.",
    complete: signals.hasSimulationRun,
  };
}

function validationCategory(signals: ReadinessSignals): ReadinessCategory {
  const weight = READINESS_WEIGHTS.validation;
  if (signals.validationCount === 0) {
    return {
      id: "validation",
      label: STEP_LABEL.validation,
      weight,
      earned: 0,
      detail: "Gerçek üretim verisiyle doğrulama yapılmadı.",
      complete: false,
    };
  }

  /*
   * Tek ölçüm kurulumu tamamlar; ikinci ölçüm trendi açar ama hazırlık puanını
   * artırmaz — puan, kurulumun bittiğini söyler, olgunluğu değil.
   */
  return {
    id: "validation",
    label: STEP_LABEL.validation,
    weight,
    earned: weight,
    detail: `${signals.validationCount} doğrulama ölçümü kaydedildi.`,
    complete: true,
  };
}

function reportCategory(state: EnterpriseState): ReadinessCategory {
  const weight = READINESS_WEIGHTS.report;
  const done = state.milestones.firstReportAtMs !== null;
  return {
    id: "report",
    label: STEP_LABEL.report,
    weight,
    earned: done ? weight : 0,
    detail: done
      ? "İlk yönetici raporu indirildi."
      : "Henüz yönetici raporu indirilmedi.",
    complete: done,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Hazırlık raporunu üretir.
 *
 * Kategoriler `STEP_ORDER` sırasındadır; ekran, rapor ve kontrol listesi aynı
 * sırayı kullanır.
 */
export function buildReadiness(
  state: EnterpriseState,
  signals: ReadinessSignals,
): ReadinessReport {
  const byId: Record<SetupStepId, ReadinessCategory> = {
    company: companyCategory(state),
    factory: factoryCategory(state, signals),
    machines: machineCategory(state),
    connectors: connectorCategory(signals),
    simulation: simulationCategory(signals),
    validation: validationCategory(signals),
    report: reportCategory(state),
  };

  const categories = STEP_ORDER.map((id) => byId[id]);
  const total =
    Math.round(
      categories.reduce((sum, category) => sum + category.earned, 0) * 10,
    ) / 10;

  return {
    total,
    band: bandOf(total),
    categories,
    nextStep: nextStepOf(categories),
  };
}

/**
 * Sıradaki adım — **akış sırasındaki** ilk tamamlanmamış kategori.
 *
 * İlk yazımda "en çok puan kazandıran adım" seçiliyordu; tarayıcıda görüldü ki
 * bu, hiç kurulum yapmamış bir kullanıcıyı sihirbazın üçüncü adımına
 * (makineler) atıyordu — çünkü o adımın ağırlığı en yüksekti. Kurulum bir
 * öğretici akıştır: şirket tanımlanmadan makine girmek anlamsızdır.
 *
 * Puanı en yüksek adım hâlâ hesaplanabilir (`highestImpactStep`) ve öneri
 * metinlerinde kullanılabilir; ama sihirbazın açılış adımı sıradır.
 */
export function nextStepOf(categories: ReadinessCategory[]): SetupStepId | null {
  const ordered = [...categories].sort(
    (a, b) => STEP_ORDER.indexOf(a.id) - STEP_ORDER.indexOf(b.id),
  );
  return ordered.find((category) => !category.complete)?.id ?? null;
}

/**
 * Puanı en çok artıracak tamamlanmamış adım.
 *
 * Eşitlik hâlinde akış sırası kazanır. "Önce şuna baksanız daha çok kazanırsınız"
 * türü öneriler için vardır; akışın kendisini bu belirlemez.
 */
export function highestImpactStep(
  categories: ReadinessCategory[],
): SetupStepId | null {
  const pending = categories.filter((category) => !category.complete);
  if (pending.length === 0) {
    return null;
  }
  return [...pending].sort((a, b) => {
    const missingA = a.weight - a.earned;
    const missingB = b.weight - b.earned;
    if (missingA !== missingB) {
      return missingB - missingA;
    }
    return STEP_ORDER.indexOf(a.id) - STEP_ORDER.indexOf(b.id);
  })[0].id;
}

/** Kurulum bitti mi? */
export function isSetupComplete(report: ReadinessReport): boolean {
  return report.categories.every((category) => category.complete);
}

/** Eksik kategoriler; danışman ve kontrol listesi bunu okur. */
export function missingCategories(
  report: ReadinessReport,
): ReadinessCategory[] {
  return report.categories.filter((category) => !category.complete);
}
