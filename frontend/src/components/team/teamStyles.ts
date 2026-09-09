/**
 * Ekip ekranlarının ortak görsel sözlüğü.
 *
 * En önemli eşleme `ORIGIN_TONE`'dur: bir kaydın gerçek mi örnek mi olduğu altı
 * ayrı ekranda görünür. Renk her ekranda ayrı yazılsaydı, "Örnek" rozeti bir
 * yerde gri, başka bir yerde mavi olur ve kullanıcı ikisinin aynı şey olduğunu
 * anlamazdı.
 *
 * Renk hiçbir yerde tek başına bilgi taşımaz: her rozetin yanında kaynağın adı
 * yazılıdır ("Örnek", "Bu cihaz", "Hesap").
 */

import {
  Clock,
  Crown,
  Eye,
  HardHat,
  Shield,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  DataOrigin,
  InvitationStatus,
  MemberStatus,
  Role,
  SettingPersistence,
} from "../../lib/team";
import type { LimitStatus } from "../../lib/team";
import type { BadgeTone } from "../ui/Primitives";

/** Kaynağın rozet tonu; örnek veri hiçbir zaman "iyi" tonunda görünmez. */
export const ORIGIN_TONE: Record<DataOrigin, BadgeTone> = {
  account: "good",
  local: "info",
  fixture: "warning",
};

export const ROLE_ICON: Record<Role, LucideIcon> = {
  owner: Crown,
  admin: Shield,
  engineer: Wrench,
  // Vardiya lideri saati taşır: rolün tanımı vardiyadır, unvan değil.
  shift_lead: Clock,
  maintenance: Wrench,
  operator: HardHat,
  viewer: Eye,
};

export const ROLE_TONE: Record<Role, BadgeTone> = {
  owner: "info",
  admin: "info",
  engineer: "neutral",
  shift_lead: "neutral",
  maintenance: "neutral",
  operator: "neutral",
  viewer: "neutral",
};

export const MEMBER_STATUS_TONE: Record<MemberStatus, BadgeTone> = {
  active: "good",
  invited: "warning",
  suspended: "bad",
};

export const INVITATION_TONE: Record<InvitationStatus, BadgeTone> = {
  pending: "warning",
  accepted: "good",
  revoked: "neutral",
  expired: "bad",
};

export const LIMIT_TONE: Record<LimitStatus, BadgeTone> = {
  ok: "good",
  near: "warning",
  over: "bad",
  unlimited: "info",
};

/**
 * Limit durumunun rozet metni.
 *
 * Rozet önce satırın etiketini tekrar ediyordu ("Kullanıcı 1/10 Kullanıcı");
 * tarayıcıda okununca hiçbir şey söylemediği görüldü. Artık durumun kendisini
 * yazar.
 */
export const LIMIT_LABEL: Record<LimitStatus, string> = {
  ok: "Rahat",
  near: "Sınıra yakın",
  over: "Aşıldı",
  unlimited: "Sınırsız",
};

export const PERSISTENCE_TONE: Record<SettingPersistence, BadgeTone> = {
  local: "good",
  readonly: "neutral",
  unavailable: "bad",
};

export const PERSISTENCE_LABEL: Record<SettingPersistence, string> = {
  local: "Kaydediliyor",
  readonly: "Değiştirilemez",
  unavailable: "Kaydedilmiyor",
};

/** Okunamayan bir ölçünün ekrandaki karşılığı. */
export const UNVERIFIED_TEXT = "Doğrulanmadı";

/** Para tutarının okunur hâli. */
export function showMoney(value: number): string {
  return `₺${Math.round(value).toLocaleString("tr-TR")}`;
}
