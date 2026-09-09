/**
 * Satış hattının durum geçişleri ve sayaçları.
 *
 * Kanban sürüklemesi, KPI kartları ve takvim aynı işlevlerden beslenir. Her
 * ekran kendi sayımını yapsaydı, "Demo Bekleyen" kartındaki sayı ile
 * sütundaki kart adedi ayrışabilirdi.
 *
 * Zaman dışarıdan verilir (`now`). `Date.now()` burada okunsaydı işlevler saf
 * olmaktan çıkar ve "3 gündür bekliyor" kuralı sınanamazdı.
 */

import { STAGE_ORDER, type Lead, type LeadStage, type Meeting } from "./types";

/** Tarayıcıda saklama anahtarı. */
const STORAGE_KEY = "optiflow.sales.leads";

/* -------------------------------------------------------------------------- */
/* Durum geçişi                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bir kaydı başka bir duruma taşır ve **yeni** bir liste döner.
 *
 * Aynı duruma taşımak kaydı değiştirmez: sürükleyip aynı sütuna bırakmak
 * "son işlem" saatini ilerletseydi, hiçbir şey yapılmadığı hâlde hatırlatıcı
 * sıfırlanırdı.
 *
 * Kazanılan bir kayda aylık tutar yazılır; başka bir duruma geri alınırsa
 * silinir — kazanılmamış bir anlaşmanın geliri raporlanamaz.
 */
export function moveLead(
  leads: Lead[],
  leadId: string,
  stage: LeadStage,
  now: Date,
  wonMonthly: number | null = null,
): Lead[] {
  return leads.map((lead) => {
    if (lead.id !== leadId || lead.stage === stage) {
      return lead;
    }
    return {
      ...lead,
      stage,
      updatedAt: now.toISOString(),
      wonMonthly: stage === "won" ? (wonMonthly ?? lead.wonMonthly) : null,
    };
  });
}

/** Kayıtları duruma göre gruplar; her sütun boş da olsa yer alır. */
export function groupByStage(leads: Lead[]): Record<LeadStage, Lead[]> {
  const groups = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, [] as Lead[]]),
  ) as Record<LeadStage, Lead[]>;

  for (const lead of leads) {
    groups[lead.stage].push(lead);
  }

  // Her sütunda en son dokunulan kart en üstte durur.
  for (const stage of STAGE_ORDER) {
    groups[stage].sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  }

  return groups;
}

export interface PipelineCounts {
  total: number;
  /** Demo bekleyen: henüz demo yapılmamış kayıtlar. */
  awaitingDemo: number;
  /** Teklif bekleyen: demosu yapılmış ama teklifi çıkmamış kayıtlar. */
  awaitingProposal: number;
  won: number;
  /** Kazanılan anlaşmaların aylık toplamı (₺). */
  wonMonthlyTotal: number;
}

/** Üstteki dört KPI kartının kaynağı. */
export function pipelineCounts(leads: Lead[]): PipelineCounts {
  return {
    total: leads.length,
    awaitingDemo: leads.filter((lead) => lead.stage === "new").length,
    awaitingProposal: leads.filter((lead) => lead.stage === "demo").length,
    won: leads.filter((lead) => lead.stage === "won").length,
    wonMonthlyTotal: leads
      .filter((lead) => lead.stage === "won")
      .reduce((sum, lead) => sum + (lead.wonMonthly ?? 0), 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Takvim                                                                      */
/* -------------------------------------------------------------------------- */

export type MeetingBucket = "today" | "tomorrow" | "week" | "later";

export const BUCKET_LABEL: Record<MeetingBucket, string> = {
  today: "Bugün",
  tomorrow: "Yarın",
  week: "Bu hafta",
  later: "Daha sonra",
};

/**
 * Bir görüşmenin hangi kovaya düştüğü.
 *
 * Gün farkı **takvim günü** üzerinden hesaplanır, 24 saat üzerinden değil:
 * saat 23:00'te bakan biri için "yarın 09:00" gerçekten yarındır, "17 saat
 * sonra" değil.
 */
export function bucketOf(at: string, now: Date): MeetingBucket | null {
  const when = Date.parse(at);
  if (Number.isNaN(when)) {
    return null;
  }
  const days = calendarDaysBetween(now, new Date(when));
  if (days < 0) {
    // Geçmiş görüşmeler takvimde yer almaz; onlar hatırlatıcıların işidir.
    return null;
  }
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= 7 ? "week" : "later";
}

/** Yaklaşan görüşmeleri kovalara ayırır; her kova zamana göre sıralıdır. */
export function upcomingMeetings(
  meetings: Meeting[],
  now: Date,
): Record<MeetingBucket, Meeting[]> {
  const buckets: Record<MeetingBucket, Meeting[]> = {
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  };

  for (const meeting of meetings) {
    const bucket = bucketOf(meeting.at, now);
    if (bucket !== null) {
      buckets[bucket].push(meeting);
    }
  }

  for (const key of Object.keys(buckets) as MeetingBucket[]) {
    buckets[key].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  }

  return buckets;
}

/** İki tarih arasındaki takvim günü farkı (yerel saat). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Saklama                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Depodan okunan veriyi doğrular.
 *
 * Depoya güvenilmez: başka bir sekme ya da eski bir sürüm oraya herhangi bir
 * şey yazmış olabilir. Doğrulanmayan bir kayıt, adı olmayan bir kart olarak
 * ekrana düşerdi.
 */
export function isValidLead(value: unknown): value is Lead {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const lead = value as Record<string, unknown>;
  return (
    typeof lead.id === "string" &&
    typeof lead.company === "string" &&
    lead.company.length > 0 &&
    typeof lead.stage === "string" &&
    STAGE_ORDER.includes(lead.stage as LeadStage) &&
    typeof lead.createdAt === "string" &&
    typeof lead.updatedAt === "string"
  );
}

/** Ham metni kayıt listesine çevirir; bozuk girdide boş liste döner. */
export function parseLeads(raw: string | null): Lead[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidLead) : [];
  } catch {
    return [];
  }
}

/** Saklanmış kayıtları okur; depo kapalıysa boş liste. */
export function recallLeads(): Lead[] {
  try {
    return parseLeads(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Kayıtları saklar. Depo kapalıysa sessizce vazgeçer. */
export function rememberLeads(leads: Lead[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  } catch {
    // Kota dolu ya da gizli sekme; saklama bir kolaylıktır, akışı durdurmaz.
  }
}
