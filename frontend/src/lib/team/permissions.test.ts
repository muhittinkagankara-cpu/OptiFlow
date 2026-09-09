import { describe, expect, it } from "vitest";
import {
  PERMISSION_LABEL,
  can,
  canAccessConnectors,
  canChangeRole,
  canEditFactory,
  canManageBilling,
  canManageMembers,
  canRemoveMember,
  canRunSimulation,
  canViewFinance,
  denialReason,
  outranks,
  permissionsOf,
  type Permission,
} from "./permissions";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_ORDER, type Role } from "./types";

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABEL) as Permission[];

describe("matris bütünlüğü", () => {
  it("her rol her yetki icin bir yanit verir", () => {
    for (const role of ROLE_ORDER) {
      for (const permission of ALL_PERMISSIONS) {
        expect(typeof can(role, permission)).toBe("boolean");
      }
    }
  });

  it("sahip her seyi yapabilir", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can("owner", permission)).toBe(true);
    }
  });

  it("izleyici hicbir seyi degistiremez", () => {
    expect(can("viewer", "canEditFactory")).toBe(false);
    expect(can("viewer", "canRunSimulation")).toBe(false);
    expect(can("viewer", "canManageMembers")).toBe(false);
    expect(can("viewer", "canEnterValidation")).toBe(false);
  });

  it("yetki genisligi role sirasiyla azalir", () => {
    const counts = ROLE_ORDER.map((role) => permissionsOf(role).length);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[1]).toBeGreaterThanOrEqual(counts[2]);
  });
});

describe("can", () => {
  it("rol yoksa yetki de yok", () => {
    // Yetki sorusunun yaniti belirsizse guvenli yanit "hayir"dir.
    expect(can(null, "canEditFactory")).toBe(false);
    expect(can(undefined, "canViewFinance")).toBe(false);
  });

  it("taninmayan rol hicbir sey yapamaz", () => {
    expect(can("hacker" as Role, "canManageBilling")).toBe(false);
  });
});

describe("kısayollar", () => {
  it("canEditFactory yalnizca model kurabilenlerde acik", () => {
    expect(canEditFactory("owner")).toBe(true);
    expect(canEditFactory("admin")).toBe(true);
    expect(canEditFactory("engineer")).toBe(true);
    expect(canEditFactory("operator")).toBe(false);
    expect(canEditFactory("viewer")).toBe(false);
  });

  it("canRunSimulation operatorde kapali", () => {
    expect(canRunSimulation("engineer")).toBe(true);
    expect(canRunSimulation("operator")).toBe(false);
  });

  it("canManageMembers yalnizca sahip ve yoneticide", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("engineer")).toBe(false);
    expect(canManageMembers("operator")).toBe(false);
  });

  it("canViewFinance operatorde kapali, izleyicide acik", () => {
    // Vardiya ekranini kullanan operatorun parasal kaybi gormesi cogu
    // musteride sozlesmeye aykiridir.
    expect(canViewFinance("operator")).toBe(false);
    expect(canViewFinance("viewer")).toBe(true);
  });

  it("canAccessConnectors muhendis ve ustunde", () => {
    expect(canAccessConnectors("engineer")).toBe(true);
    expect(canAccessConnectors("operator")).toBe(false);
    expect(canAccessConnectors("viewer")).toBe(false);
  });

  it("canManageBilling yalnizca sahipte", () => {
    // Para karari tek kiside durur.
    expect(canManageBilling("owner")).toBe(true);
    expect(canManageBilling("admin")).toBe(false);
    expect(canManageBilling("engineer")).toBe(false);
  });
});

describe("özel yetkiler", () => {
  it("operator dogrulama olcumu girebilir", () => {
    // Vardiyada olcum giren kisi operatordur.
    expect(can("operator", "canEnterValidation")).toBe(true);
  });

  it("izleyici olcum giremez", () => {
    expect(can("viewer", "canEnterValidation")).toBe(false);
  });

  it("herkes yorum yazabilir", () => {
    for (const role of ROLE_ORDER) {
      expect(can(role, "canComment")).toBe(true);
    }
  });

  it("yorumu yalnizca muhendis ve ustu cozer", () => {
    expect(can("engineer", "canResolveComment")).toBe(true);
    expect(can("operator", "canResolveComment")).toBe(false);
    expect(can("viewer", "canResolveComment")).toBe(false);
  });

  it("organizasyon ayarlarini yalnizca sahip ve yonetici degistirir", () => {
    // Ayarlar bütün organizasyonu etkiler; model kuran mühendisin işi değildir.
    expect(can("owner", "canEditOrgSettings")).toBe(true);
    expect(can("admin", "canEditOrgSettings")).toBe(true);
    expect(can("engineer", "canEditOrgSettings")).toBe(false);
    expect(can("operator", "canEditOrgSettings")).toBe(false);
    expect(can("viewer", "canEditOrgSettings")).toBe(false);
  });

  it("operator rapor indiremez, izleyici indirebilir", () => {
    expect(can("operator", "canDownloadReport")).toBe(false);
    expect(can("viewer", "canDownloadReport")).toBe(true);
  });
});

describe("permissionsOf", () => {
  it("rolun acik yetkilerini listeler", () => {
    expect(permissionsOf("owner")).toHaveLength(ALL_PERMISSIONS.length);
    expect(permissionsOf("operator")).toContain("canEnterValidation");
    expect(permissionsOf("operator")).not.toContain("canViewFinance");
  });
});

describe("outranks", () => {
  it("genis rol dar rolu asar", () => {
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("admin", "viewer")).toBe(true);
  });

  it("dar rol genis rolu asmaz", () => {
    expect(outranks("viewer", "engineer")).toBe(false);
  });

  it("ayni rol kendini asmaz", () => {
    expect(outranks("admin", "admin")).toBe(false);
  });
});

describe("canChangeRole", () => {
  const owner = { id: "u1", role: "owner" as Role };
  const admin = { id: "u2", role: "admin" as Role };
  const engineer = { id: "u3", role: "engineer" as Role };

  it("yetkisiz rol degistiremez", () => {
    const result = canChangeRole(engineer, admin, "viewer");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("yetkiniz yok");
  });

  it("kimse kendi rolunu degistiremez", () => {
    const result = canChangeRole(admin, admin, "owner");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Kendi rolünüzü");
  });

  it("yonetici sahibin rolunu degistiremez", () => {
    expect(canChangeRole(admin, owner, "admin").allowed).toBe(false);
  });

  it("yonetici kendinden genis rol atayamaz", () => {
    // Bu kural olmasaydi bir yonetici kendini sahip yapabilirdi.
    const result = canChangeRole(admin, engineer, "owner");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("yalnızca mevcut sahip");
  });

  it("yonetici normal rol degisikligi yapabilir", () => {
    expect(canChangeRole(admin, engineer, "operator").allowed).toBe(true);
  });

  it("sahip sahiplik devredebilir", () => {
    expect(canChangeRole(owner, admin, "owner").allowed).toBe(true);
  });
});

describe("canRemoveMember", () => {
  const owner = { id: "u1", role: "owner" as Role };
  const admin = { id: "u2", role: "admin" as Role };
  const viewer = { id: "u4", role: "viewer" as Role };

  it("sahip cikarilamaz", () => {
    // Sahipsiz bir organizasyon faturalandirmayi kilitler.
    const result = canRemoveMember(owner, { id: "u9", role: "owner" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("sahibi çıkarılamaz");
  });

  it("kisi kendini cikaramaz", () => {
    expect(canRemoveMember(admin, admin).allowed).toBe(false);
  });

  it("yetkisiz kisi kimseyi cikaramaz", () => {
    expect(canRemoveMember(viewer, admin).allowed).toBe(false);
  });

  it("yonetici uyeyi cikarabilir", () => {
    expect(canRemoveMember(admin, viewer).allowed).toBe(true);
  });
});

describe("denialReason", () => {
  it("oturum yoksa oturum acmayi soyler", () => {
    expect(denialReason(null, "canEditFactory")).toContain("oturum açmanız");
  });

  it("yetki adini ve rolu yazar", () => {
    const reason = denialReason("operator", "canViewFinance");
    expect(reason).toContain("Finans görüntüleme");
    expect(reason).toContain("operator");
  });
});

/*
 * Saha rolleri (SALES-16).
 *
 * Sahada bir vardiya üç kişiye bölünür ve üçünün yetkisi farklıdır. Bu
 * testler, yetki matrisinin o ayrımı gerçekten kurduğunu doğrular.
 */
describe("saha rolleri", () => {
  it("yedi rol tanımlı", () => {
    expect(ROLE_ORDER).toHaveLength(7);
  });

  it("vardiya lideri operatörden geniş yetkili", () => {
    expect(outranks("shift_lead", "operator")).toBe(true);
  });

  it("vardiya lideri bakımdan geniş yetkili", () => {
    // Hattı durdurma kararı bakımdan değil üretimden çıkar.
    expect(outranks("shift_lead", "maintenance")).toBe(true);
  });

  it("bakım operatörden geniş yetkili", () => {
    expect(outranks("maintenance", "operator")).toBe(true);
  });

  it("vardiya lideri alarm susturur", () => {
    expect(can("shift_lead", "canSilenceAlarm")).toBe(true);
  });

  it("bakım alarm susturmaz", () => {
    // Bakım ekibi arızayı giderir, kararı vermez.
    expect(can("maintenance", "canSilenceAlarm")).toBe(false);
  });

  it("operatör alarm susturmaz", () => {
    expect(can("operator", "canSilenceAlarm")).toBe(false);
  });

  it("bakım cihaz devreye alır", () => {
    expect(can("maintenance", "canCommissionDevice")).toBe(true);
  });

  it("vardiya lideri cihaz devreye almaz", () => {
    expect(can("shift_lead", "canCommissionDevice")).toBe(false);
  });

  it("operatör cihaz devreye almaz", () => {
    // Yanlış bir eşleme, üretim sayısını başka makineye yazar.
    expect(can("operator", "canCommissionDevice")).toBe(false);
  });

  it("bakım ölçüm giremez", () => {
    // Cihaza dokunanın ölçüme müdahalesi, ölçümü şüpheli kılardı.
    expect(can("maintenance", "canEnterValidation")).toBe(false);
  });

  it("operatör ölçüm girer", () => {
    expect(can("operator", "canEnterValidation")).toBe(true);
  });

  it("vardiya lideri ölçüm girer", () => {
    expect(can("shift_lead", "canEnterValidation")).toBe(true);
  });

  it("bakım bağlantılara erişir", () => {
    expect(can("maintenance", "canAccessConnectors")).toBe(true);
  });

  it("vardiya lideri bağlantılara erişmez", () => {
    expect(can("shift_lead", "canAccessConnectors")).toBe(false);
  });

  it("saha rolleri finans görmez", () => {
    expect(can("shift_lead", "canViewFinance")).toBe(false);
    expect(can("maintenance", "canViewFinance")).toBe(false);
  });

  it("saha rolleri fabrika modelini değiştiremez", () => {
    expect(can("shift_lead", "canEditFactory")).toBe(false);
    expect(can("maintenance", "canEditFactory")).toBe(false);
  });

  it("saha rollerinin açıklaması var", () => {
    expect(ROLE_DESCRIPTION.shift_lead).toContain("Vardiya");
    expect(ROLE_DESCRIPTION.maintenance).toContain("Cihaza");
  });

  it("saha rollerinin Türkçe etiketi var", () => {
    expect(ROLE_LABEL.shift_lead).toBe("Vardiya Lideri");
    expect(ROLE_LABEL.maintenance).toBe("Bakım");
  });

  it("iki yeni yetkinin etiketi var", () => {
    expect(PERMISSION_LABEL.canSilenceAlarm).toBeTruthy();
    expect(PERMISSION_LABEL.canCommissionDevice).toBeTruthy();
  });

  it("mühendis her iki yeni yetkiye sahip", () => {
    expect(can("engineer", "canSilenceAlarm")).toBe(true);
    expect(can("engineer", "canCommissionDevice")).toBe(true);
  });
});
