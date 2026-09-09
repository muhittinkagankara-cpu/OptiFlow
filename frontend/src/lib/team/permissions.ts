/**
 * Yetki motoru — kimin neyi yapabildiği tek bir tabloda.
 *
 * Bileşenlerde `if (role === "admin")` yazmak, altı ay sonra "operatör neden
 * finans görüyor?" sorusunu yanıtlanamaz hâle getirir: kural on ekrana dağılır
 * ve biri güncellenmeyi unutur. Burada tek bir matris vardır; ekranlar yalnızca
 * `can(...)` sorar.
 *
 * Yetkiler **kısıtlayıcı** tarafta hata yapacak biçimde tanımlanır: tanınmayan
 * bir rol hiçbir şey yapamaz. Yeni bir rol eklendiğinde matris derlenmez ve
 * eksik satır derleme zamanında görünür.
 */

import { ROLE_ORDER, type Role } from "./types";

/** Sorulabilecek yetkiler. */
export type Permission =
  | "canEditFactory"
  | "canRunSimulation"
  | "canManageMembers"
  | "canViewFinance"
  | "canAccessConnectors"
  | "canManageBilling"
  | "canEnterValidation"
  | "canComment"
  | "canResolveComment"
  | "canDownloadReport"
  | "canEditOrgSettings"
  | "canSilenceAlarm"
  | "canCommissionDevice";

export const PERMISSION_LABEL: Record<Permission, string> = {
  canEditFactory: "Fabrika modelini düzenleme",
  canRunSimulation: "Simülasyon çalıştırma",
  canManageMembers: "Ekip yönetimi",
  canViewFinance: "Finans görüntüleme",
  canAccessConnectors: "Veri kaynaklarını yönetme",
  canManageBilling: "Abonelik ve faturalandırma",
  canEnterValidation: "Doğrulama ölçümü girme",
  canComment: "Yorum yazma",
  canResolveComment: "Yorumu çözüldü işaretleme",
  canDownloadReport: "Rapor indirme",
  canEditOrgSettings: "Organizasyon ayarlarını değiştirme",
  canSilenceAlarm: "Alarm susturma ve vardiya devri",
  canCommissionDevice: "Cihaz devreye alma ve eşleme",
};

/**
 * Rol-yetki matrisi.
 *
 * Tasarım kararları:
 *
 * - **Operatör finans görmez.** Vardiya ekranını kullanan bir operatörün hattın
 *   parasal kaybını görmesi, çoğu müşteride sözleşmeye aykırıdır.
 * - **Mühendis ekip yönetemez.** Model kurmakla kişi eklemek farklı
 *   sorumluluklardır.
 * - **Faturalandırma yalnızca sahiptedir.** Yönetici bile aboneliği
 *   değiştiremez; para kararı tek kişide durur.
 * - **İzleyici yorum yazabilir.** Yorum, veriyi değiştirmez; danışmanın ya da
 *   müşterinin not bırakabilmesi ürünün işine yarar.
 * - **Vardiya lideri alarm susturur, bakım susturmaz.** Hattı durdurma ya da
 *   bir alarmı görmezden gelme kararı üretimden çıkar; bakım ekibi arızayı
 *   giderir, kararı vermez.
 * - **Bakım ölçüm giremez.** Cihaza dokunan kişinin ölçüme de müdahale
 *   edebilmesi, ölçümün kendisini şüpheli kılardı.
 * - **Operatör cihaz devreye alamaz.** Yanlış bir eşleme, bir makinenin üretim
 *   sayısını başka bir makineye yazar; bu yetki bakımda ve mühendistedir.
 */
const MATRIX: Record<Role, Record<Permission, boolean>> = {
  owner: {
    canEditFactory: true,
    canRunSimulation: true,
    canManageMembers: true,
    canViewFinance: true,
    canAccessConnectors: true,
    canManageBilling: true,
    canEnterValidation: true,
    canComment: true,
    canResolveComment: true,
    canDownloadReport: true,
    canEditOrgSettings: true,
    canSilenceAlarm: true,
    canCommissionDevice: true,
  },
  admin: {
    canEditFactory: true,
    canRunSimulation: true,
    canManageMembers: true,
    canViewFinance: true,
    canAccessConnectors: true,
    canManageBilling: false,
    canEnterValidation: true,
    canComment: true,
    canResolveComment: true,
    canDownloadReport: true,
    canEditOrgSettings: true,
    canSilenceAlarm: true,
    canCommissionDevice: true,
  },
  engineer: {
    canEditFactory: true,
    canRunSimulation: true,
    canManageMembers: false,
    canViewFinance: true,
    canAccessConnectors: true,
    canManageBilling: false,
    canEnterValidation: true,
    canComment: true,
    canResolveComment: true,
    canDownloadReport: true,
    canEditOrgSettings: false,
    canSilenceAlarm: true,
    canCommissionDevice: true,
  },
  shift_lead: {
    canEditFactory: false,
    canRunSimulation: false,
    canManageMembers: false,
    canViewFinance: false,
    canAccessConnectors: false,
    canManageBilling: false,
    canEnterValidation: true,
    canComment: true,
    canResolveComment: true,
    canDownloadReport: true,
    canEditOrgSettings: false,
    canSilenceAlarm: true,
    canCommissionDevice: false,
  },
  maintenance: {
    canEditFactory: false,
    canRunSimulation: false,
    canManageMembers: false,
    canViewFinance: false,
    canAccessConnectors: true,
    canManageBilling: false,
    // Cihaza dokunan kişinin ölçüme de müdahale edebilmesi, ölçümün kendisini
    // şüpheli kılardı.
    canEnterValidation: false,
    canComment: true,
    canResolveComment: true,
    canDownloadReport: true,
    canEditOrgSettings: false,
    canSilenceAlarm: false,
    canCommissionDevice: true,
  },
  operator: {
    canEditFactory: false,
    canRunSimulation: false,
    canManageMembers: false,
    canViewFinance: false,
    canAccessConnectors: false,
    canManageBilling: false,
    canEnterValidation: true,
    canComment: true,
    canResolveComment: false,
    canDownloadReport: false,
    canEditOrgSettings: false,
    canSilenceAlarm: false,
    canCommissionDevice: false,
  },
  viewer: {
    canEditFactory: false,
    canRunSimulation: false,
    canManageMembers: false,
    canViewFinance: true,
    canAccessConnectors: false,
    canManageBilling: false,
    canEnterValidation: false,
    canComment: true,
    canResolveComment: false,
    canDownloadReport: true,
    canEditOrgSettings: false,
    canSilenceAlarm: false,
    canCommissionDevice: false,
  },
};

/**
 * Bir rolün belirli bir yetkisi var mı?
 *
 * Tanınmayan rol her zaman `false` döner: yetki sorusunun yanıtı belirsizse,
 * güvenli yanıt "hayır"dır.
 */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (role === null || role === undefined) {
    return false;
  }
  return MATRIX[role]?.[permission] ?? false;
}

/* --- Sprint sözleşmesinde adı geçen kısayollar --- */

export const canEditFactory = (role: Role | null): boolean =>
  can(role, "canEditFactory");

export const canRunSimulation = (role: Role | null): boolean =>
  can(role, "canRunSimulation");

export const canManageMembers = (role: Role | null): boolean =>
  can(role, "canManageMembers");

export const canViewFinance = (role: Role | null): boolean =>
  can(role, "canViewFinance");

export const canAccessConnectors = (role: Role | null): boolean =>
  can(role, "canAccessConnectors");

export const canManageBilling = (role: Role | null): boolean =>
  can(role, "canManageBilling");

/** Rolün sahip olduğu tüm yetkiler. */
export function permissionsOf(role: Role): Permission[] {
  return (Object.keys(MATRIX[role]) as Permission[]).filter((permission) =>
    MATRIX[role][permission],
  );
}

/** Bir rol ötekinden daha geniş yetkili mi? */
export function outranks(a: Role, b: Role): boolean {
  return ROLE_ORDER.indexOf(a) < ROLE_ORDER.indexOf(b);
}

/**
 * Rol değiştirme yetkisi.
 *
 * Üç kural: ekip yönetimi yetkisi gerekir, kimse kendi rolünü değiştiremez ve
 * kimse kendinden geniş bir rol atayamaz. Sonuncusu olmadan bir yönetici
 * kendini sahip yapabilirdi.
 */
export function canChangeRole(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
  nextRole: Role,
): { allowed: boolean; reason: string | null } {
  if (!can(actor.role, "canManageMembers")) {
    return { allowed: false, reason: "Ekip yönetimi yetkiniz yok." };
  }
  if (actor.id === target.id) {
    return { allowed: false, reason: "Kendi rolünüzü değiştiremezsiniz." };
  }
  if (target.role === "owner" && actor.role !== "owner") {
    return { allowed: false, reason: "Sahibin rolünü yalnızca sahip değiştirebilir." };
  }
  if (nextRole === "owner" && actor.role !== "owner") {
    return { allowed: false, reason: "Sahip rolünü yalnızca mevcut sahip verebilir." };
  }
  return { allowed: true, reason: null };
}

/**
 * Üye çıkarma yetkisi.
 *
 * Sahip çıkarılamaz: organizasyonun sahibi olmayan bir hesap, faturalandırmayı
 * ve ayarları kilitler.
 */
export function canRemoveMember(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
): { allowed: boolean; reason: string | null } {
  if (!can(actor.role, "canManageMembers")) {
    return { allowed: false, reason: "Ekip yönetimi yetkiniz yok." };
  }
  if (target.role === "owner") {
    return { allowed: false, reason: "Organizasyon sahibi çıkarılamaz." };
  }
  if (actor.id === target.id) {
    return { allowed: false, reason: "Kendinizi çıkaramazsınız." };
  }
  return { allowed: true, reason: null };
}

/** Bir yetkinin neden reddedildiğini anlatan cümle. */
export function denialReason(role: Role | null, permission: Permission): string {
  if (role === null) {
    return "Bu işlem için oturum açmanız gerekiyor.";
  }
  return `${PERMISSION_LABEL[permission]} yetkisi ${role} rolünde yok.`;
}
