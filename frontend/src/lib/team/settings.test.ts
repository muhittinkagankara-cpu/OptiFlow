import { describe, expect, it } from "vitest";
import {
  SETTING_FIELDS,
  applySavable,
  dailyWorkingHours,
  defaultSettings,
  ignoredChanges,
  persistenceOf,
  savableKeys,
  validateSettings,
} from "./settings";
import { parseSettings } from "./storage";
import type { OrgSettings } from "./types";

const BASE = defaultSettings("Örnek Fabrika A.Ş.");

describe("defaultSettings", () => {
  it("organizasyon adini cagirandan alir", () => {
    expect(BASE.name).toBe("Örnek Fabrika A.Ş.");
  });

  it("varsayilan para birimi TRY", () => {
    expect(BASE.currency).toBe("TRY");
  });

  it("varsayilan saat dilimi Istanbul", () => {
    expect(BASE.timezone).toBe("Europe/Istanbul");
  });

  it("logo bos baslar", () => {
    expect(BASE.logoDataUrl).toBeNull();
  });

  it("bildirimler kapali baslar", () => {
    // Bildirim altyapisi yok; acik gostermek en sessiz yalan olurdu.
    expect(BASE.notifyOnSimulation).toBe(false);
    expect(BASE.notifyOnValidation).toBe(false);
    expect(BASE.notifyOnMemberChange).toBe(false);
  });
});

describe("SETTING_FIELDS", () => {
  it("her alan bir aciklama tasir", () => {
    for (const field of SETTING_FIELDS) {
      expect(field.note).not.toBeNull();
    }
  });

  it("her alan varsayilan ayarlarda karsiligi olan bir anahtardir", () => {
    for (const field of SETTING_FIELDS) {
      expect(field.key in BASE).toBe(true);
    }
  });

  it("her ayar alani listede yer alir", () => {
    const keys = SETTING_FIELDS.map((field) => field.key);
    for (const key of Object.keys(BASE) as (keyof OrgSettings)[]) {
      expect(keys).toContain(key);
    }
  });
});

describe("persistenceOf", () => {
  it("organizasyon adi degistirilemez", () => {
    expect(persistenceOf("name")).toBe("readonly");
  });

  it("para birimi bu cihaza kaydedilir", () => {
    expect(persistenceOf("currency")).toBe("local");
  });

  it("bildirimler kaydedilemez", () => {
    expect(persistenceOf("notifyOnSimulation")).toBe("unavailable");
  });

  it("bilinmeyen anahtar kaydedilemez sayilir", () => {
    expect(persistenceOf("yok" as keyof OrgSettings)).toBe("unavailable");
  });
});

describe("savableKeys", () => {
  it("yalnizca yerel alanlari listeler", () => {
    expect(savableKeys()).toEqual([
      "logoDataUrl",
      "timezone",
      "currency",
      "shiftHours",
      "shiftsPerDay",
    ]);
  });

  it("ad ve bildirimler listede degildir", () => {
    expect(savableKeys()).not.toContain("name");
    expect(savableKeys()).not.toContain("notifyOnValidation");
  });
});

describe("applySavable", () => {
  it("kaydedilebilir alani gunceller", () => {
    expect(applySavable(BASE, { currency: "EUR" }).currency).toBe("EUR");
  });

  it("organizasyon adini degistirmez", () => {
    expect(applySavable(BASE, { name: "Başka Firma" }).name).toBe(BASE.name);
  });

  it("bildirim anahtarini acik birakmaz", () => {
    // "Kaydedildi" yazip hicbir yere yazmayan form, aylar sonra fark edilir.
    expect(applySavable(BASE, { notifyOnSimulation: true }).notifyOnSimulation).toBe(
      false,
    );
  });

  it("verilmeyen alanlar korunur", () => {
    expect(applySavable(BASE, { currency: "USD" }).timezone).toBe(BASE.timezone);
  });

  it("undefined deger mevcut degeri ezmez", () => {
    expect(applySavable(BASE, { currency: undefined }).currency).toBe("TRY");
  });

  it("girdi nesnesini degistirmez", () => {
    applySavable(BASE, { currency: "EUR" });
    expect(BASE.currency).toBe("TRY");
  });

  it("logoyu kaydeder", () => {
    expect(applySavable(BASE, { logoDataUrl: "data:image/png;base64,AA" }).logoDataUrl).toBe(
      "data:image/png;base64,AA",
    );
  });
});

describe("ignoredChanges", () => {
  it("kaydedilemeyen degisikligi bildirir", () => {
    expect(ignoredChanges(BASE, { notifyOnSimulation: true })).toEqual([
      "notifyOnSimulation",
    ]);
  });

  it("ad degisikligini bildirir", () => {
    expect(ignoredChanges(BASE, { name: "Yeni" })).toEqual(["name"]);
  });

  it("kaydedilebilir degisiklik bildirilmez", () => {
    expect(ignoredChanges(BASE, { currency: "EUR" })).toEqual([]);
  });

  it("ayni deger degisiklik sayilmaz", () => {
    expect(ignoredChanges(BASE, { name: BASE.name })).toEqual([]);
  });

  it("birden fazla yok sayilan alani listeler", () => {
    expect(
      ignoredChanges(BASE, { notifyOnSimulation: true, notifyOnValidation: true }),
    ).toHaveLength(2);
  });
});

describe("validateSettings", () => {
  it("varsayilan ayarlar gecerlidir", () => {
    expect(validateSettings(BASE)).toEqual([]);
  });

  it("sifir vardiya suresi reddedilir", () => {
    expect(validateSettings({ ...BASE, shiftHours: 0 })[0].key).toBe("shiftHours");
  });

  it("24 saatten uzun vardiya reddedilir", () => {
    expect(validateSettings({ ...BASE, shiftHours: 25 })).toHaveLength(2);
  });

  it("sifir vardiya sayisi reddedilir", () => {
    expect(validateSettings({ ...BASE, shiftsPerDay: 0 })[0].key).toBe("shiftsPerDay");
  });

  it("ucten fazla vardiya reddedilir", () => {
    expect(
      validateSettings({ ...BASE, shiftsPerDay: 4 }).some(
        (issue) => issue.key === "shiftsPerDay",
      ),
    ).toBe(true);
  });

  it("toplam sure 24 saati asamaz", () => {
    const issues = validateSettings({ ...BASE, shiftHours: 10, shiftsPerDay: 3 });
    expect(issues.some((issue) => issue.text.includes("24 saati aşamaz"))).toBe(true);
  });

  it("tam 24 saat gecerlidir", () => {
    expect(validateSettings({ ...BASE, shiftHours: 8, shiftsPerDay: 3 })).toEqual([]);
  });

  it("bos para birimi reddedilir", () => {
    expect(validateSettings({ ...BASE, currency: "  " })[0].key).toBe("currency");
  });
});

describe("dailyWorkingHours", () => {
  it("vardiya suresi ile sayisini carpar", () => {
    expect(dailyWorkingHours({ ...BASE, shiftHours: 8, shiftsPerDay: 2 })).toBe(16);
  });
});

describe("parseSettings", () => {
  it("kayit yoksa varsayilanlari doner", () => {
    expect(parseSettings(null, "Firma")).toEqual(defaultSettings("Firma"));
  });

  it("bozuk JSON varsayilanlara duser", () => {
    expect(parseSettings("{bozuk", "Firma").currency).toBe("TRY");
  });

  it("dizi gelirse varsayilanlara duser", () => {
    expect(parseSettings("[]", "Firma").timezone).toBe("Europe/Istanbul");
  });

  it("kaydedilmis degerleri geri okur", () => {
    expect(parseSettings(JSON.stringify({ currency: "EUR" }), "Firma").currency).toBe(
      "EUR",
    );
  });

  it("organizasyon adi her zaman oturumdan gelir", () => {
    // Depodaki eski ad geri yuklenirse, ad degistiginde eskisi gorunurdu.
    const parsed = parseSettings(JSON.stringify({ name: "Eski Ad" }), "Yeni Ad");
    expect(parsed.name).toBe("Yeni Ad");
  });

  it("eksik alanlar varsayilanla tamamlanir", () => {
    expect(parseSettings(JSON.stringify({ currency: "USD" }), "Firma").shiftHours).toBe(8);
  });
});
