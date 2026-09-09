/**
 * Ekip çalışma alanının özeti ve eşzamanlı çalışma göstergeleri.
 *
 * Özet kartlarının tamamı `WorkspaceStat` döner ve her kart nereden geldiğini
 * taşır. Okunamayan bir ölçü **sıfır ya da tahmin değil, `null`** olur ve
 * ekranda "Doğrulanmadı" yazar: hiç ölçülmemiş bir "aktif kullanıcı: 0",
 * kimsenin çalışmadığı izlenimi verirdi.
 */

import { activeUserCount } from "./members";
import { lastRealEvent, relativeTime } from "./activity";
import {
  PRESENCE_LABEL,
  type ActivityEvent,
  type DataOrigin,
  type Member,
  type PresenceEntry,
  type WorkspaceStat,
} from "./types";

export interface WorkspaceInput {
  orgName: string;
  /** Sunucudan okunan fabrika sayısı; okunamadıysa `null`. */
  factoryCount: number | null;
  members: Member[];
  events: ActivityEvent[];
  nowMs: number;
}

/**
 * Çalışma alanı kartları.
 *
 * Organizasyon adı ve fabrika sayısı gerçektir (oturum ve API). Üye sayısı
 * karışıktır: gerçek üye bir tanedir (siz), gerisi örnektir — kart bunu
 * açıkça yazar. Aktif kullanıcı ölçülemez, çünkü kimin ne zaman etkin olduğunu
 * bildiren bir uç yok.
 */
export function workspaceStats(input: WorkspaceInput): WorkspaceStat[] {
  const realMembers = input.members.filter((member) => member.origin !== "fixture");
  const fixtureMembers = input.members.length - realMembers.length;
  const active = activeUserCount(input.members, input.nowMs);
  const lastEvent = lastRealEvent(input.events);

  return [
    {
      label: "Organizasyon",
      value: input.orgName,
      origin: "account",
      note: "Oturumdan okundu.",
    },
    {
      label: "Fabrika sayısı",
      value: input.factoryCount === null ? null : String(input.factoryCount),
      origin: input.factoryCount === null ? null : "account",
      note:
        input.factoryCount === null
          ? "Fabrika listesi okunamadı."
          : "Sunucudaki fabrika listesinden.",
    },
    {
      label: "Üye sayısı",
      value: String(input.members.length),
      origin: fixtureMembers > 0 ? "fixture" : "account",
      note:
        fixtureMembers > 0
          ? `${realMembers.length} gerçek, ${fixtureMembers} örnek kayıt.`
          : "Tamamı gerçek kayıt.",
    },
    {
      label: "Aktif kullanıcı",
      value: active === null ? null : String(active),
      origin: active === null ? null : "local",
      note:
        active === null
          ? "Kimin etkin olduğunu bildiren bir uç yok."
          : "Son 15 dakikada bu cihazdan ölçülen etkinlik.",
    },
    {
      label: "Son değişiklik",
      value:
        lastEvent === null ? null : relativeTime(lastEvent.atMs, input.nowMs),
      origin: lastEvent === null ? null : lastEvent.origin,
      note:
        lastEvent === null
          ? "Bu cihazda kayıtlı gerçek bir olay yok."
          : `${lastEvent.actorName ?? "Bilinmeyen"} · ${lastEvent.subject ?? "—"}`,
    },
  ];
}

/** Okunamayan kartların sayısı; ekran bunu tek cümleyle özetler. */
export function unverifiedCount(stats: WorkspaceStat[]): number {
  return stats.filter((stat) => stat.value === null).length;
}

/* -------------------------------------------------------------------------- */
/* Eşzamanlı çalışma                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Eşzamanlı çalışma satırı.
 *
 * `isLive` alanı bu sürümde **her zaman `false`**: gerçek eşzamanlılık bir
 * WebSocket ya da sunucu yoklaması ister, ikisi de yok. İşlev, canlı sanılan
 * bir kaydın listeye girmesini de engeller — kaynak ne derse desin, bayrak
 * burada düşürülür.
 */
export function presenceLine(entry: PresenceEntry): string {
  return `${entry.name} ${entry.screen} ekranında ${PRESENCE_LABEL[entry.activity]}`;
}

/** Kayıtları canlı olmayan biçimde normalleştirir. */
export function normalizePresence(entries: PresenceEntry[]): PresenceEntry[] {
  return entries.map((entry) => ({ ...entry, isLive: false }));
}

/** Listede canlı kayıt var mı? Bu sürümde her zaman `false` olmalıdır. */
export function hasLivePresence(entries: PresenceEntry[]): boolean {
  return entries.some((entry) => entry.isLive);
}

/** Eşzamanlı çalışma listesinin altına yazılan açıklama. */
export const PRESENCE_NOTE =
  "Canlı değil: eşzamanlı çalışma için sunucu bağlantısı gerekiyor, bu kayıtlar örnektir.";

/** Kaynak başına satır sayısı. */
export function presenceByOrigin(
  entries: PresenceEntry[],
): Record<DataOrigin, number> {
  return {
    account: entries.filter((entry) => entry.origin === "account").length,
    local: entries.filter((entry) => entry.origin === "local").length,
    fixture: entries.filter((entry) => entry.origin === "fixture").length,
  };
}
