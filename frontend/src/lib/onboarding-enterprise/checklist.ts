/**
 * Kurulum kontrol listesi ve "İlk 30 dakika" rehberi.
 *
 * Liste, hazırlık raporundan türetilir — ikinci bir tamamlanma kaynağı yoktur.
 * Ayrı hesaplansaydı, kartta "tamamlandı" görünen bir adım puan tablosunda
 * eksik kalabilirdi.
 *
 * Her madde tıklanabilir ve gideceği ekranı taşır: kullanıcıya "makine
 * envanteriniz eksik" deyip onu ekranı aramaya bırakmak, kurulumu yarıda
 * bıraktıran en sık nedendir.
 */

import {
  GUIDE_BUDGET_MINUTES,
  STEP_LABEL,
  STEP_MINUTES,
  STEP_ORDER,
  type ChecklistItem,
  type ReadinessReport,
  type SetupStepId,
} from "./types";

/** Adımın açılacağı ekran (`navigation.ts` görünüm kimliği). */
export const STEP_VIEW: Record<SetupStepId, string> = {
  company: "enterprise",
  factory: "enterprise",
  machines: "machines",
  connectors: "connectors",
  simulation: "wizard",
  validation: "validation",
  report: "reports",
};

/** Hazırlık raporunu tıklanabilir kontrol listesine çevirir. */
export function buildChecklist(report: ReadinessReport): ChecklistItem[] {
  const byId = new Map(report.categories.map((category) => [category.id, category]));

  return STEP_ORDER.map((id) => {
    const category = byId.get(id);
    return {
      id,
      label: STEP_LABEL[id],
      done: category?.complete ?? false,
      hint: category?.detail ?? "Bu adım hakkında bilgi yok.",
      view: STEP_VIEW[id],
      minutes: STEP_MINUTES[id],
    };
  });
}

/** Tamamlanan madde sayısı. */
export function completedCount(items: ChecklistItem[]): number {
  return items.filter((item) => item.done).length;
}

/**
 * İlerleme oranı (0-1).
 *
 * Madde yoksa `null` döner — sıfır "hiçbiri tamamlanmadı" demektir; madde
 * yokken tamamlanacak bir şey de yoktur.
 */
export function progressRatio(items: ChecklistItem[]): number | null {
  if (items.length === 0) {
    return null;
  }
  return completedCount(items) / items.length;
}

/** Sıradaki tamamlanmamış madde; hepsi bittiyse `null`. */
export function nextItem(items: ChecklistItem[]): ChecklistItem | null {
  return items.find((item) => !item.done) ?? null;
}

/** En son tamamlanan madde (akış sırasına göre); yoksa `null`. */
export function lastCompleted(items: ChecklistItem[]): ChecklistItem | null {
  const done = items.filter((item) => item.done);
  return done.length === 0 ? null : done[done.length - 1];
}

/** Kalan tahmini süre (dakika). */
export function remainingMinutes(items: ChecklistItem[]): number {
  return items
    .filter((item) => !item.done)
    .reduce((sum, item) => sum + item.minutes, 0);
}

/* -------------------------------------------------------------------------- */
/* İlk 30 dakika rehberi                                                       */
/* -------------------------------------------------------------------------- */

export interface GuideStep extends ChecklistItem {
  /** Bu adım bitene kadar geçmesi beklenen toplam süre. */
  cumulativeMinutes: number;
  /** Adım 30 dakikalık bütçenin içinde mi? */
  withinBudget: boolean;
}

/**
 * Rehber adımları.
 *
 * Süreler tahmindir ve birikimli yazılır: kullanıcı "buraya kadar 15 dakika"
 * bilgisini gördüğünde nerede olduğunu anlar. Bütçeyi aşan adım işaretlenir —
 * 30 dakika sözü tutulamıyorsa bunu gizlemek yerine göstermek gerekir.
 */
export function buildGuide(
  items: ChecklistItem[],
  budgetMinutes: number = GUIDE_BUDGET_MINUTES,
): GuideStep[] {
  let cumulative = 0;
  return items.map((item) => {
    cumulative += item.minutes;
    return {
      ...item,
      cumulativeMinutes: cumulative,
      withinBudget: cumulative <= budgetMinutes,
    };
  });
}

/** Rehberin toplam tahmini süresi. */
export function guideTotalMinutes(items: ChecklistItem[]): number {
  return items.reduce((sum, item) => sum + item.minutes, 0);
}

/** Rehber 30 dakikalık söze sığıyor mu? */
export function fitsBudget(
  items: ChecklistItem[],
  budgetMinutes: number = GUIDE_BUDGET_MINUTES,
): boolean {
  return guideTotalMinutes(items) <= budgetMinutes;
}

/**
 * Kullanıcıya gösterilecek özet cümle.
 *
 * Tamamlanan sayıyı ve kalan süreyi birlikte verir; ikisinden biri eksikse
 * cümle ya baskıcı ya da anlamsız olur.
 */
export function guideSummary(items: ChecklistItem[]): string {
  const done = completedCount(items);
  if (done === items.length && items.length > 0) {
    return "Kurulumun tamamı bitti; canlı bağlantıya geçebilirsiniz.";
  }
  const remaining = remainingMinutes(items);
  return `${items.length} adımdan ${done} tanesi tamam; kalan tahmini süre ${remaining} dakika.`;
}
