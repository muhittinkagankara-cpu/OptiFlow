/**
 * Davet akışı — e-posta **gönderilmez**.
 *
 * OptiFlow'un bu sürümünde e-posta altyapısı yok. Davet oluşturulur, bağlantı
 * üretilir, kullanıcı bağlantıyı kopyalayıp kendisi iletir. Arayüz bunu her
 * yerde söyler ve `emailSent` alanı her zaman `false`'tur.
 *
 * "Davet gönderildi" yazan bir ekran, ulaşmayan bir davetin günler sonra fark
 * edilmesine yol açardı; bu, ekip kurulumunda en pahalı yanlış anlamadır.
 *
 * Belirteç üretimi dışarıdan verilir (`makeToken`), böylece testler kararlıdır.
 */

import type { Invitation, InvitationStatus, Role } from "./types";

/** Davetin geçerlilik süresi (gün). */
export const INVITE_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Basit e-posta biçim kontrolü. */
export function isValidEmail(value: string): boolean {
  const text = value.trim();
  if (text === "" || text.includes(" ")) {
    return false;
  }
  return /^[^@]+@[^@.]+\.[^@]+$/.test(text);
}

/**
 * Belirteç üretir.
 *
 * Tarayıcının kriptografik üreticisi varsa o kullanılır; yoksa zaman ve sayaç
 * temelli bir yedek. Yedek daha zayıftır ama bu belirteç bir kimlik doğrulama
 * anahtarı değil, yalnızca yerel bir davet kaydının kimliğidir — ve arayüz
 * bağlantının benzetim olduğunu zaten yazar.
 */
export function defaultToken(): string {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return `inv${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface CreateInvitationInput {
  email: string;
  role: Role;
  nowMs: number;
  /** Belirteç üreticisi; testlerde sabitlenir. */
  makeToken?: () => string;
  ttlDays?: number;
}

export interface CreateInvitationResult {
  invitation: Invitation | null;
  /** Oluşturulamadıysa nedeni. */
  error: string | null;
}

/**
 * Davet oluşturur.
 *
 * Aynı e-postaya bekleyen bir davet varsa ikincisi **oluşturulmaz**: iki geçerli
 * bağlantı, hangisinin iptal edildiğini takip edilemez hâle getirir.
 */
export function createInvitation(
  existing: Invitation[],
  input: CreateInvitationInput,
): CreateInvitationResult {
  const email = input.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    return { invitation: null, error: "Geçerli bir e-posta adresi girin." };
  }

  const duplicate = existing.find(
    (item) => item.email === email && statusAt(item, input.nowMs) === "pending",
  );
  if (duplicate !== undefined) {
    return {
      invitation: null,
      error: "Bu adrese bekleyen bir davet zaten var; önce onu iptal edin.",
    };
  }

  const ttl = (input.ttlDays ?? INVITE_TTL_DAYS) * DAY_MS;
  const token = (input.makeToken ?? defaultToken)();

  return {
    invitation: {
      id: `inv-${token.slice(0, 8)}`,
      email,
      role: input.role,
      token,
      createdAtMs: input.nowMs,
      expiresAtMs: input.nowMs + ttl,
      status: "pending",
      // E-posta altyapısı yok; gönderilmiş gibi göstermek yasak.
      emailSent: false,
      origin: "local",
    },
    error: null,
  };
}

/**
 * Davetin o andaki durumu.
 *
 * Süre dolması **okuma anında** hesaplanır; arka planda bir zamanlayıcıya
 * bağlansaydı, sekmesi kapalı duran bir hesapta davet sonsuza kadar geçerli
 * görünürdü.
 */
export function statusAt(invitation: Invitation, nowMs: number): InvitationStatus {
  if (invitation.status !== "pending") {
    return invitation.status;
  }
  return nowMs >= invitation.expiresAtMs ? "expired" : "pending";
}

/** Daveti iptal eder. */
export function revokeInvitation(
  invitations: Invitation[],
  id: string,
): Invitation[] {
  return invitations.map((item) =>
    item.id === id && item.status === "pending"
      ? { ...item, status: "revoked" }
      : item,
  );
}

/** Daveti kabul edilmiş olarak işaretler (bağlantıyı açan kişi geldiğinde). */
export function acceptInvitation(
  invitations: Invitation[],
  token: string,
  nowMs: number,
): { invitations: Invitation[]; accepted: Invitation | null; error: string | null } {
  const target = invitations.find((item) => item.token === token);

  if (target === undefined) {
    return { invitations, accepted: null, error: "Davet bulunamadı." };
  }

  const status = statusAt(target, nowMs);
  if (status !== "pending") {
    return {
      invitations,
      accepted: null,
      error: `Davet kullanılamaz: ${status === "expired" ? "süresi dolmuş" : "iptal edilmiş ya da kullanılmış"}.`,
    };
  }

  const accepted: Invitation = { ...target, status: "accepted" };
  return {
    invitations: invitations.map((item) => (item.id === target.id ? accepted : item)),
    accepted,
    error: null,
  };
}

/**
 * Davet bağlantısı.
 *
 * Bağlantı gerçek bir adrese işaret eder (uygulamanın kendi kökü) ama arka
 * planda kabul akışını işleyen bir uç **yoktur**; bu yüzden arayüz bağlantının
 * yanına "Benzetim" etiketi koyar.
 */
export function invitationLink(invitation: Invitation, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/davet?token=${invitation.token}`;
}

/** Bekleyen davetler. */
export function pendingInvitations(
  invitations: Invitation[],
  nowMs: number,
): Invitation[] {
  return invitations.filter((item) => statusAt(item, nowMs) === "pending");
}

/** Kalan süre (gün); süresi dolmuşsa `0`, bekleyen değilse `null`. */
export function daysLeft(invitation: Invitation, nowMs: number): number | null {
  if (statusAt(invitation, nowMs) !== "pending") {
    return null;
  }
  return Math.max(0, Math.ceil((invitation.expiresAtMs - nowMs) / DAY_MS));
}

/**
 * Davetin kullanıcıya gösterilecek durum cümlesi.
 *
 * E-postanın gönderilmediği her bekleyen davette yazılır; kullanıcı bağlantıyı
 * kendisinin iletmesi gerektiğini bilmelidir.
 */
export function invitationNote(invitation: Invitation, nowMs: number): string {
  const status = statusAt(invitation, nowMs);
  if (status === "pending") {
    const days = daysLeft(invitation, nowMs) ?? 0;
    return `E-posta gönderilmedi; bağlantıyı kopyalayıp iletin. ${days} gün geçerli.`;
  }
  if (status === "expired") {
    return "Süresi doldu; yeni bir davet oluşturun.";
  }
  if (status === "revoked") {
    return "İptal edildi; bağlantı artık çalışmaz.";
  }
  return "Kabul edildi.";
}
