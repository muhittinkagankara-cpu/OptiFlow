/**
 * Organizasyon ayarları — neyin gerçekten kaydedildiği.
 *
 * Ayarların bir kısmı bu tarayıcıya yazılır ve geri okunur (gerçekten
 * kaydedilir), bir kısmı oturumdan gelir ve değiştirilemez, bir kısmı için ise
 * ne uç ne depo vardır. Üçü aynı formda yan yana durur ve **hangisinin ne
 * olduğu her alanın altında yazar**.
 *
 * "Kaydedildi" yazıp hiçbir yere yazmayan bir form, kullanıcının ayarı bir
 * daha kontrol etmemesine ve aylar sonra yanlış para biriminde rapor
 * göndermesine yol açar.
 */

import type { OrgSettings, SettingField, SettingPersistence } from "./types";

/** Varsayılan ayarlar; organizasyon adı çağıran tarafından doldurulur. */
export function defaultSettings(orgName: string): OrgSettings {
  return {
    name: orgName,
    logoDataUrl: null,
    timezone: "Europe/Istanbul",
    currency: "TRY",
    shiftHours: 8,
    shiftsPerDay: 2,
    notifyOnSimulation: false,
    notifyOnValidation: false,
    notifyOnMemberChange: false,
  };
}

/**
 * Alanların kaydedilebilirlik durumu.
 *
 * Bildirimler `unavailable`'dır: bildirim göndermek için e-posta ya da anlık
 * bildirim altyapısı gerekir, ikisi de yok. Anahtarı açık gösterip hiçbir şey
 * göndermemek, en sessiz yalan olurdu.
 */
export const SETTING_FIELDS: SettingField[] = [
  {
    key: "name",
    label: "Organizasyon adı",
    persistence: "readonly",
    note: "Oturumdan geliyor; bu sürümde uygulamadan değiştirilemez.",
  },
  {
    key: "logoDataUrl",
    label: "Logo",
    persistence: "local",
    note: "Bu tarayıcıya kaydedilir ve raporların kapağında kullanılır.",
  },
  {
    key: "timezone",
    label: "Saat dilimi",
    persistence: "local",
    note: "Bu tarayıcıya kaydedilir.",
  },
  {
    key: "currency",
    label: "Para birimi",
    persistence: "local",
    note: "Bu tarayıcıya kaydedilir; rapor tutarlarında kullanılır.",
  },
  {
    key: "shiftHours",
    label: "Varsayılan vardiya süresi",
    persistence: "local",
    note: "Bu tarayıcıya kaydedilir.",
  },
  {
    key: "shiftsPerDay",
    label: "Günlük vardiya sayısı",
    persistence: "local",
    note: "Bu tarayıcıya kaydedilir.",
  },
  {
    key: "notifyOnSimulation",
    label: "Simülasyon bitince bildir",
    persistence: "unavailable",
    note: "Bildirim altyapısı yok; bu seçenek kapalı ve kaydedilmiyor.",
  },
  {
    key: "notifyOnValidation",
    label: "Doğrulama kaydedilince bildir",
    persistence: "unavailable",
    note: "Bildirim altyapısı yok; bu seçenek kapalı ve kaydedilmiyor.",
  },
  {
    key: "notifyOnMemberChange",
    label: "Ekip değişince bildir",
    persistence: "unavailable",
    note: "Bildirim altyapısı yok; bu seçenek kapalı ve kaydedilmiyor.",
  },
];

/** Bir alanın kaydedilebilirlik durumu. */
export function persistenceOf(key: keyof OrgSettings): SettingPersistence {
  return SETTING_FIELDS.find((field) => field.key === key)?.persistence ?? "unavailable";
}

/** Kaydedilebilen alanlar. */
export function savableKeys(): (keyof OrgSettings)[] {
  return SETTING_FIELDS.filter((field) => field.persistence === "local").map(
    (field) => field.key,
  );
}

/**
 * Kaydedilecek ayarları süzer.
 *
 * Yalnızca gerçekten yazılabilen alanlar geçer; ötekiler **mevcut değerlerinde
 * kalır**. Kullanıcının bildirim anahtarını açması, kaydedilmiş gibi
 * görünmemelidir.
 */
export function applySavable(
  current: OrgSettings,
  next: Partial<OrgSettings>,
): OrgSettings {
  const result: OrgSettings = { ...current };
  for (const key of savableKeys()) {
    if (key in next && next[key] !== undefined) {
      // Tür güvenliği için tek tek atanır; toplu atama `unknown` üretirdi.
      Object.assign(result, { [key]: next[key] });
    }
  }
  return result;
}

/** Kaydedilemeyecek alanlarda değişiklik denenmiş mi? */
export function ignoredChanges(
  current: OrgSettings,
  next: Partial<OrgSettings>,
): (keyof OrgSettings)[] {
  const savable = new Set(savableKeys());
  return (Object.keys(next) as (keyof OrgSettings)[]).filter(
    (key) => !savable.has(key) && next[key] !== current[key],
  );
}

/** Ayarların doğrulaması. */
export interface SettingIssue {
  key: keyof OrgSettings;
  text: string;
}

export function validateSettings(settings: OrgSettings): SettingIssue[] {
  const issues: SettingIssue[] = [];

  if (settings.shiftHours <= 0 || settings.shiftHours > 24) {
    issues.push({
      key: "shiftHours",
      text: "Vardiya süresi 1-24 saat aralığında olmalı.",
    });
  }
  if (settings.shiftsPerDay <= 0 || settings.shiftsPerDay > 3) {
    issues.push({
      key: "shiftsPerDay",
      text: "Günlük vardiya sayısı 1-3 arasında olmalı.",
    });
  }
  if (settings.shiftHours * settings.shiftsPerDay > 24) {
    issues.push({
      key: "shiftsPerDay",
      text: "Vardiya süresi ile vardiya sayısının çarpımı 24 saati aşamaz.",
    });
  }
  if (settings.currency.trim() === "") {
    issues.push({ key: "currency", text: "Para birimi seçilmeli." });
  }

  return issues;
}

/** Günlük toplam çalışma süresi (saat); doğrulamadan geçmişse anlamlıdır. */
export function dailyWorkingHours(settings: OrgSettings): number {
  return settings.shiftHours * settings.shiftsPerDay;
}
