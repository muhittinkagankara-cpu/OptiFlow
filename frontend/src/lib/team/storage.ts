/**
 * Ekip verisinin tarayıcıda saklanması.
 *
 * Yalnızca **bu cihazda oluşturulan** kayıtlar saklanır: davetler, yorumlar ve
 * ayarlar. Örnek kayıtlar (`fixture`) yazılmaz — kaydedilseydi, bir sonraki
 * açılışta örnek olduğu unutulur ve gerçek veriyle karışırdı.
 */

import { defaultSettings } from "./settings";
import {
  type Comment,
  type Invitation,
  type OrgSettings,
} from "./types";

const INVITE_KEY = "optiflow.team.invitations";
const COMMENT_KEY = "optiflow.team.comments";
const SETTINGS_KEY = "optiflow.team.settings";

/* -------------------------------------------------------------------------- */
/* Davetler                                                                    */
/* -------------------------------------------------------------------------- */

export function isValidInvitation(value: unknown): value is Invitation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.email === "string" &&
    typeof item.token === "string" &&
    typeof item.createdAtMs === "number" &&
    typeof item.expiresAtMs === "number" &&
    typeof item.emailSent === "boolean"
  );
}

/**
 * Davetleri okur.
 *
 * Örnek kayıtlar süzülür: depodan gelen her şey `local`'dır ve öyle
 * işaretlenir. Bir örneğin gerçek gibi geri yüklenmesi, davet listesinde
 * hiç oluşturulmamış bir bağlantının görünmesi demek olurdu.
 */
export function parseInvitations(raw: string | null): Invitation[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isValidInvitation)
      .map((item) => ({ ...item, origin: "local" as const }));
  } catch {
    return [];
  }
}

export function recallInvitations(): Invitation[] {
  try {
    return parseInvitations(window.localStorage.getItem(INVITE_KEY));
  } catch {
    return [];
  }
}

export function rememberInvitations(invitations: Invitation[]): void {
  try {
    window.localStorage.setItem(
      INVITE_KEY,
      // Örnek kayıtlar saklanmaz.
      JSON.stringify(invitations.filter((item) => item.origin !== "fixture")),
    );
  } catch {
    /* Depolama yoksa davetler yalnızca bu oturumda yaşar. */
  }
}

/* -------------------------------------------------------------------------- */
/* Yorumlar                                                                    */
/* -------------------------------------------------------------------------- */

export function isValidComment(value: unknown): value is Comment {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const target = item.target as Record<string, unknown> | undefined;
  return (
    typeof item.id === "string" &&
    typeof item.text === "string" &&
    typeof item.authorName === "string" &&
    typeof item.createdAtMs === "number" &&
    typeof item.resolved === "boolean" &&
    Array.isArray(item.mentions) &&
    typeof target === "object" &&
    target !== null &&
    typeof target.id === "string" &&
    (target.kind === "factory" || target.kind === "station")
  );
}

export function parseComments(raw: string | null): Comment[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isValidComment)
      .map((item) => ({ ...item, origin: "local" as const }));
  } catch {
    return [];
  }
}

export function recallComments(): Comment[] {
  try {
    return parseComments(window.localStorage.getItem(COMMENT_KEY));
  } catch {
    return [];
  }
}

export function rememberComments(comments: Comment[]): void {
  try {
    window.localStorage.setItem(
      COMMENT_KEY,
      JSON.stringify(comments.filter((item) => item.origin !== "fixture")),
    );
  } catch {
    /* yok sayılır */
  }
}

/* -------------------------------------------------------------------------- */
/* Ayarlar                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ayarları okur.
 *
 * Organizasyon adı **her zaman oturumdan** gelir; depodaki eski bir ad geri
 * yüklenirse, organizasyon adı değiştiğinde ekranda eskisi görünürdü.
 */
export function parseSettings(raw: string | null, orgName: string): OrgSettings {
  const base = defaultSettings(orgName);
  if (raw === null) {
    return base;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return base;
    }
    return { ...base, ...(parsed as Partial<OrgSettings>), name: orgName };
  } catch {
    return base;
  }
}

export function recallSettings(orgName: string): OrgSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY), orgName);
  } catch {
    return defaultSettings(orgName);
  }
}

export function rememberSettings(settings: OrgSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* yok sayılır */
  }
}
