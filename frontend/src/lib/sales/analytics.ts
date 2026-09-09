/**
 * Satış analitiği — huni ve aylık gelir.
 *
 * Huninin kritik kararı şudur: bir durağın sayısı, o durakta **duran** kayıt
 * değil, o duraktan **geçmiş** kayıttır. Kanban sütunundaki kart adedi
 * kullanılsaydı, kazanılmış bir firma "demo yapıldı" sayısına girmez ve
 * dönüşüm oranı zamanla sahte biçimde düşerdi.
 *
 * Durakların sırası bilindiği için "geçmiş olmak" ölçülebilir: `won`
 * durumundaki bir kayıt, kendinden önceki her duraktan geçmiştir.
 */

import { STAGE_ORDER, type FunnelStep, type Lead, type LeadStage, type MonthlyRevenue } from "./types";

/** Bir kaydın verilen durağa ulaşıp ulaşmadığı. */
export function hasReached(lead: Lead, stage: LeadStage): boolean {
  return STAGE_ORDER.indexOf(lead.stage) >= STAGE_ORDER.indexOf(stage);
}

/** Verilen durağa ulaşmış kayıt sayısı. */
export function reachedCount(leads: Lead[], stage: LeadStage): number {
  return leads.filter((lead) => hasReached(lead, stage)).length;
}

const FUNNEL_STEPS: { from: LeadStage; to: LeadStage; label: string }[] = [
  { from: "new", to: "demo", label: "Lead → Demo" },
  { from: "demo", to: "proposal", label: "Demo → Teklif" },
  { from: "proposal", to: "won", label: "Teklif → Kazanıldı" },
];

/**
 * Üç dönüşüm adımı.
 *
 * Kaynak adımda hiç kayıt yoksa oran `null` kalır — sıfır göstermek, ölçüm
 * yapılmadığı hâlde "hiç dönüşmedi" demek olurdu.
 */
export function conversionFunnel(leads: Lead[]): FunnelStep[] {
  return FUNNEL_STEPS.map((step) => {
    const fromCount = reachedCount(leads, step.from);
    const toCount = reachedCount(leads, step.to);
    return {
      ...step,
      fromCount,
      toCount,
      rate: fromCount > 0 ? toCount / fromCount : null,
    };
  });
}

/** "2026-09" → "Eyl 2026". */
const MONTH_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Son `months` ayın kazanılan geliri.
 *
 * Kayıt olmayan aylar da listede yer alır ve sıfır gösterilir. Burada sıfır
 * bir ölçümdür, eksik veri değil: o ay hiçbir anlaşma kazanılmamıştır ve
 * grafikte boşluk bırakmak eğilimi okunamaz kılardı.
 *
 * Kazanma ayı `updatedAt` üzerinden alınır — kaydın açıldığı ay değil,
 * anlaşmanın kapandığı ay.
 */
export function monthlyWonRevenue(
  leads: Lead[],
  now: Date,
  months = 6,
): MonthlyRevenue[] {
  const buckets = new Map<string, MonthlyRevenue>();

  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    buckets.set(monthKey(date), {
      month: monthKey(date),
      label: monthLabel(date),
      wonCount: 0,
      monthlyRevenue: 0,
    });
  }

  for (const lead of leads) {
    if (lead.stage !== "won") {
      continue;
    }
    const closed = new Date(lead.updatedAt);
    if (Number.isNaN(closed.getTime())) {
      continue;
    }
    const bucket = buckets.get(monthKey(closed));
    // Pencerenin dışında kapanmış anlaşmalar sayılmaz.
    if (bucket) {
      bucket.wonCount += 1;
      bucket.monthlyRevenue += lead.wonMonthly ?? 0;
    }
  }

  return [...buckets.values()];
}

/**
 * Kazanılan anlaşmaların ortalama aylık büyüklüğü.
 *
 * Hiç kazanılmamışsa `null`; sıfır göstermek "ortalama sıfır lira" demek
 * olurdu.
 */
export function averageWonMonthly(leads: Lead[]): number | null {
  const won = leads.filter((lead) => lead.stage === "won");
  if (won.length === 0) {
    return null;
  }
  return won.reduce((sum, lead) => sum + (lead.wonMonthly ?? 0), 0) / won.length;
}
