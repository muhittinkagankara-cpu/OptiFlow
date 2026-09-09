/**
 * Aktivite geçmişi.
 *
 * Backend'de bir olay günlüğü yok; bu yüzden geçmiş iki kaynaktan beslenir:
 * bu tarayıcıda gerçekten olan işler (`local`) ve ürünün ne kaydettiğini
 * göstermek için konmuş örnekler (`fixture`). İkisi listede **ayrı rozetlerle**
 * görünür ve süzülebilir.
 *
 * Örnek bir olayı gerçek gibi göstermek, "bu raporu kim indirdi?" sorusunun
 * yanlış yanıtlanmasına yol açardı.
 */

import {
  ACTIVITY_LABEL,
  type ActivityEvent,
  type ActivityKind,
  type DataOrigin,
} from "./types";

/** Saklanan en fazla olay. */
export const MAX_EVENTS = 200;

export interface NewEvent {
  kind: ActivityKind;
  atMs: number;
  actorName?: string | null;
  subject?: string | null;
  detail?: string | null;
  origin?: DataOrigin;
}

/**
 * Olay kaydı üretir.
 *
 * Kimlik zaman ve sıra numarasından türetilir; rastgele üretilseydi aynı girdi
 * aynı çıktıyı vermez ve test edilemezdi.
 */
export function makeEvent(input: NewEvent, sequence: number): ActivityEvent {
  return {
    id: `evt-${input.atMs.toString(36)}-${sequence}`,
    kind: input.kind,
    atMs: input.atMs,
    actorName: input.actorName ?? null,
    subject: input.subject ?? null,
    detail: input.detail ?? null,
    origin: input.origin ?? "local",
  };
}

/**
 * Olayı listeye ekler.
 *
 * Liste **yeniden eskiye** sıralıdır: geçmiş ekranı en son olanla açılır.
 * Sınır aşıldığında en eski kayıt düşer.
 */
export function appendEvent(
  events: ActivityEvent[],
  input: NewEvent,
  limit: number = MAX_EVENTS,
): ActivityEvent[] {
  const event = makeEvent(input, events.length);
  return [event, ...events].slice(0, limit);
}

export interface ActivityFilter {
  kind: ActivityKind | "all";
  /** Yalnızca gerçek kayıtlar mı gösterilsin? */
  hideFixtures: boolean;
  query: string;
}

export const EMPTY_ACTIVITY_FILTER: ActivityFilter = {
  kind: "all",
  hideFixtures: false,
  query: "",
};

export function filterEvents(
  events: ActivityEvent[],
  filter: ActivityFilter,
): ActivityEvent[] {
  const query = filter.query.trim().toLocaleLowerCase("tr-TR");

  return events.filter((event) => {
    if (filter.kind !== "all" && event.kind !== filter.kind) {
      return false;
    }
    if (filter.hideFixtures && event.origin === "fixture") {
      return false;
    }
    if (query === "") {
      return true;
    }
    const haystack = [
      ACTIVITY_LABEL[event.kind],
      event.actorName ?? "",
      event.subject ?? "",
      event.detail ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase("tr-TR");
    return haystack.includes(query);
  });
}

/** Olayın tek cümlelik özeti. */
export function describeEvent(event: ActivityEvent): string {
  const actor = event.actorName ?? "Bilinmeyen kullanıcı";
  const label = ACTIVITY_LABEL[event.kind];
  return event.subject === null
    ? `${actor} — ${label}`
    : `${actor} — ${label}: ${event.subject}`;
}

/** Gün başlıklarına göre gruplar; ekran tarih ayraçları çizer. */
export function groupByDay(
  events: ActivityEvent[],
): { day: string; events: ActivityEvent[] }[] {
  const groups = new Map<string, ActivityEvent[]>();

  for (const event of events) {
    const date = new Date(event.atMs);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const bucket = groups.get(day);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(day, [event]);
    }
  }

  return [...groups.entries()].map(([day, items]) => ({ day, events: items }));
}

/**
 * Kaynak başına olay sayısı; kaçının örnek olduğu buradan okunur.
 *
 * Ad, üye sayacından ayrılır (`eventsByOrigin`): ikisi aynı adla dışa
 * aktarıldığında barrel dosyası belirsiz kalıyordu ve okuyan da hangisinin
 * çağrıldığını ancak içe aktarma satırına bakarak anlayabiliyordu.
 */
export function eventsByOrigin(
  events: ActivityEvent[],
): Record<DataOrigin, number> {
  return {
    account: events.filter((event) => event.origin === "account").length,
    local: events.filter((event) => event.origin === "local").length,
    fixture: events.filter((event) => event.origin === "fixture").length,
  };
}

/** En son gerçek (örnek olmayan) olay; yoksa `null`. */
export function lastRealEvent(events: ActivityEvent[]): ActivityEvent | null {
  return events.find((event) => event.origin !== "fixture") ?? null;
}

/** "3 dk önce" biçiminde göreli zaman. */
export function relativeTime(atMs: number, nowMs: number): string {
  const diff = nowMs - atMs;
  if (diff < 0 || diff < 60_000) {
    return "az önce";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "dün" : `${days} gün önce`;
}
