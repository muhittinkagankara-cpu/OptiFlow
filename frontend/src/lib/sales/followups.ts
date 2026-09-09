/**
 * Hatırlatıcılar — "kim ne kadardır bekliyor?".
 *
 * Bir satış hattının en pahalı hatası unutmaktır: demo yapılmış ama dönüş
 * yapılmamış bir firma, teklif çıkmış ama gönderilmemiş bir dosya. Eşikler
 * burada durur ve sınanır; liste bileşeni yalnızca çizer.
 *
 * Kural: yalnızca **beklemenin anlamlı olduğu** duraklarda hatırlatıcı üretilir.
 * Kazanılmış bir kayıt beklemez; yeni girilmiş bir kayıt da ilk gün beklemiş
 * sayılmaz — her yeni firmanın anında uyarı doğurması, listeyi görmezden
 * gelinen bir gürültüye çevirirdi.
 */

import { calendarDaysBetween } from "./pipeline";
import type { FollowUp, Lead, LeadStage } from "./types";

/** Bu gün sayısından sonra durak "gecikmiş" sayılır. */
export const OVERDUE_DAYS: Record<Exclude<LeadStage, "won">, number> = {
  // Yeni bir firmaya iki gün içinde dönülmeliydi.
  new: 2,
  // Demo sonrası sıcaklık üç günde kaybolur.
  demo: 3,
  // Hazırlanmış bir teklif bekletilmez.
  proposal: 2,
  // Gönderilen teklife bir hafta içinde yanıt aranır.
  sent: 7,
};

/** Gecikme eşiğinin bu kadar öncesinde "yaklaşıyor" uyarısı çıkar. */
export const DUE_SOON_MARGIN_DAYS = 1;

const MESSAGE: Record<Exclude<LeadStage, "won">, (days: number) => string> = {
  new: (days) => `${days} gündür ilk temas kurulmadı.`,
  demo: (days) => `Demo yapıldı, ${days} gündür dönüş yapılmadı.`,
  proposal: (days) => `${days} gündür teklif hazır ama gönderilmedi.`,
  sent: (days) => `Teklif ${days} gündür yanıt bekliyor.`,
};

/**
 * Bekleyen işleri üretir; en acili en üstte.
 *
 * `now` dışarıdan verilir ki kural sınanabilsin.
 */
export function buildFollowUps(leads: Lead[], now: Date): FollowUp[] {
  const items: FollowUp[] = [];

  for (const lead of leads) {
    if (lead.stage === "won") {
      continue;
    }

    const stage = lead.stage as Exclude<LeadStage, "won">;
    const threshold = OVERDUE_DAYS[stage];
    const waited = calendarDaysBetween(new Date(lead.updatedAt), now);

    if (!Number.isFinite(waited) || waited < 0) {
      // Gelecek tarihli bir kayıt (saat farkı ya da elle düzenleme); bekleme
      // süresi hesaplanamaz, uyarı üretilmez.
      continue;
    }

    if (waited >= threshold) {
      items.push({
        id: `overdue-${lead.id}`,
        leadId: lead.id,
        company: lead.company,
        severity: "overdue",
        text: MESSAGE[stage](waited),
        waitingDays: waited,
      });
      continue;
    }

    if (waited >= threshold - DUE_SOON_MARGIN_DAYS) {
      items.push({
        id: `due-${lead.id}`,
        leadId: lead.id,
        company: lead.company,
        severity: "due",
        text: `${MESSAGE[stage](waited)} Yarın gecikmiş sayılacak.`,
        waitingDays: waited,
      });
    }
  }

  // Gecikmişler önce, sonra en uzun bekleyen.
  return items.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "overdue" ? -1 : 1;
    }
    return (right.waitingDays ?? 0) - (left.waitingDays ?? 0);
  });
}

/**
 * Demosu yapılmış ama teklifi çıkmamış firmalar.
 *
 * Hatırlatıcıdan ayrı tutulur: bu bir gecikme değil, satışçının bir sonraki
 * doğal adımıdır ve ekranda ayrı bir yerde durur.
 */
export function readyForProposal(leads: Lead[]): Lead[] {
  return leads.filter((lead) => lead.stage === "demo" && lead.demo !== null);
}
