/**
 * Üye listesi işlemleri.
 *
 * Listedeki tek **gerçek** kayıt, oturum açmış kullanıcıdır; ötekiler örnek
 * veridir ve `origin: "fixture"` taşır. Bu ayrım listede rozet olarak görünür —
 * bir yöneticinin olmayan bir kişiye yetki verdiğini sanması, bu ekranda
 * yapılabilecek en pahalı hatadır.
 *
 * Zaman dışarıdan verilir; hiçbir işlev saat okumaz.
 */

import { ROLE_ORDER, type DataOrigin, type Member, type MemberStatus, type Role } from "./types";

/** Oturumdaki kullanıcıyı üye kaydına çevirir. */
export function memberFromAccount(account: {
  user_id: string;
  email?: string | null;
  role?: Role;
}): Member {
  const email = account.email ?? "";
  return {
    id: account.user_id,
    // Ad alanı için bir uç yok; e-postanın yerel kısmı en dürüst yaklaşımdır.
    name: email === "" ? "Siz" : email.split("@")[0],
    email,
    role: account.role ?? "owner",
    status: "active",
    /*
     * Kendi son etkinliğimiz "şimdi"dir ama bunu burada üretmeyiz: zaman
     * dışarıdan gelir ve çağıran gerçekten ölçtüğü anı yazar.
     */
    lastActiveAtMs: null,
    origin: "account",
  };
}

/** Üyeyi ekler ya da günceller. */
export function upsertMember(members: Member[], member: Member): Member[] {
  const exists = members.some((item) => item.id === member.id);
  return exists
    ? members.map((item) => (item.id === member.id ? member : item))
    : [...members, member];
}

export function removeMember(members: Member[], id: string): Member[] {
  return members.filter((item) => item.id !== id);
}

/** Rolü değiştirir; üye yoksa liste olduğu gibi döner. */
export function setRole(members: Member[], id: string, role: Role): Member[] {
  return members.map((item) => (item.id === id ? { ...item, role } : item));
}

/** Durumu değiştirir. */
export function setStatus(
  members: Member[],
  id: string,
  status: MemberStatus,
): Member[] {
  return members.map((item) => (item.id === id ? { ...item, status } : item));
}

/**
 * Listeyi sıralar: önce rol genişliği, sonra ad.
 *
 * Sahibin listenin başında olması, "bu organizasyonun sorumlusu kim?"
 * sorusunun ilk satırda yanıtlanmasını sağlar.
 */
export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    return byRole !== 0 ? byRole : a.name.localeCompare(b.name, "tr");
  });
}

export interface MemberFilter {
  role: Role | "all";
  status: MemberStatus | "all";
  query: string;
}

export const EMPTY_MEMBER_FILTER: MemberFilter = {
  role: "all",
  status: "all",
  query: "",
};

/** Ad ve e-postada arar; Türkçe harflere duyarsızdır. */
export function filterMembers(members: Member[], filter: MemberFilter): Member[] {
  const query = normalize(filter.query);
  return members.filter((member) => {
    if (filter.role !== "all" && member.role !== filter.role) {
      return false;
    }
    if (filter.status !== "all" && member.status !== filter.status) {
      return false;
    }
    if (query === "") {
      return true;
    }
    return normalize(`${member.name} ${member.email}`).includes(query);
  });
}

export function normalize(value: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
    ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  };
  return [...value]
    .map((char) => map[char] ?? char)
    .join("")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

/** Rol başına üye sayısı. */
export function countByRole(members: Member[]): Record<Role, number> {
  const counts = {} as Record<Role, number>;
  for (const role of ROLE_ORDER) {
    counts[role] = members.filter((member) => member.role === role).length;
  }
  return counts;
}

/** Kaynak başına üye sayısı; kaç kaydın örnek olduğu buradan görünür. */
export function countByOrigin(members: Member[]): Record<DataOrigin, number> {
  return {
    account: members.filter((member) => member.origin === "account").length,
    local: members.filter((member) => member.origin === "local").length,
    fixture: members.filter((member) => member.origin === "fixture").length,
  };
}

/**
 * "Aktif kullanıcı" sayısı.
 *
 * Yalnızca **gerçek** kayıtlar sayılır ve son etkinliği bilinen üyeler
 * hesaplanır. Örnek üyelerin sayılması, boş bir organizasyonu kalabalık
 * gösterirdi. Ölçülemiyorsa `null` döner ve arayüz "Doğrulanmadı" yazar.
 */
export function activeUserCount(
  members: Member[],
  nowMs: number,
  windowMs: number = 15 * 60_000,
): number | null {
  const real = members.filter((member) => member.origin !== "fixture");
  const measurable = real.filter((member) => member.lastActiveAtMs !== null);
  if (measurable.length === 0) {
    return null;
  }
  return measurable.filter(
    (member) => nowMs - (member.lastActiveAtMs ?? 0) <= windowMs,
  ).length;
}

/** Son etkinliğin okunur hâli; bilinmiyorsa `null`. */
export function lastActiveLabel(
  member: Member,
  nowMs: number,
): string | null {
  if (member.lastActiveAtMs === null) {
    return null;
  }
  const diff = nowMs - member.lastActiveAtMs;
  if (diff < 60_000) {
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
  return `${Math.floor(hours / 24)} gün önce`;
}
