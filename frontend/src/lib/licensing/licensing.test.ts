/**
 * Lisans katmanının testleri.
 *
 * Savunulan iki ayrım:
 *
 * 1. Bir **sınır** için `null` sınırsız, bir **kullanım** için `null`
 *    sayılamadı demektir. İkisi de sıfıra çevrilseydi, kurumsal plan en
 *    kısıtlı plan olurdu.
 * 2. Süresi dolan lisans ekranı karartmaz; engellenen şey büyümedir.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_LICENSE_VIEW,
  LICENSE_STATUS_LABEL,
  LICENSE_TIER_LABEL,
  LICENSE_TIER_ORDER,
  NOT_MEASURED,
  UNLIMITED,
  blockedLabel,
  licenseCaption,
  licenseWarning,
  limitTone,
  limitValue,
  parseLicense,
  parseLicenseView,
  parseLimitCheck,
  parseLimits,
  parseStatus,
  parseTier,
  parseUsage,
  remainingLabel,
  statusLabel,
  tierLabel,
  type LicenseView,
  type LimitCheck,
} from "./index";

function view(overrides: Partial<LicenseView> = {}): LicenseView {
  return {
    ...EMPTY_LICENSE_VIEW,
    license: {
      orgId: "org-a",
      tier: "growth",
      tierLabel: "Büyüme",
      customer: "Pilot A.Ş.",
      startsAtMs: 1_000,
      expiresAtMs: 100_000,
      limits: { users: 25, machines: 150, factories: 5 },
      revokedAtMs: null,
      revokedReason: null,
      issuedAtMs: 1_000,
      issuedBy: "sistem",
      status: "active",
      statusLabel: "Etkin",
      remainingMs: 99_000,
      remainingDays: 12,
      isTrial: false,
    },
    status: "active",
    statusLabel: "Etkin",
    limits: [],
    usage: { users: 3, machines: 12, factories: 1 },
    blocked: [],
    healthy: true,
    reason: null,
    ...overrides,
  };
}

function check(overrides: Partial<LimitCheck> = {}): LimitCheck {
  return {
    resource: "machines",
    label: "Makine",
    used: 12,
    limit: 150,
    exceeded: false,
    ratio: 0.08,
    reason: null,
    ...overrides,
  };
}

describe("plan", () => {
  it("dört plan", () => {
    expect(LICENSE_TIER_ORDER).toHaveLength(4);
  });

  it("tanınan plan geçer", () => {
    expect(parseTier("enterprise")).toBe("enterprise");
  });

  it("tanınmayan plan denemeye düşer", () => {
    // Kurumsala düşseydi, anlamadığımız bir plan sınırsız görünürdü.
    expect(parseTier("sinirsiz")).toBe("trial");
  });

  it("eksik plan denemeye düşer", () => {
    expect(parseTier(undefined)).toBe("trial");
  });

  it("plan etiketleri Türkçe", () => {
    expect(tierLabel("enterprise")).toBe("Kurumsal");
  });

  it("her planın etiketi var", () => {
    expect(Object.keys(LICENSE_TIER_LABEL)).toHaveLength(4);
  });
});

describe("durum", () => {
  it("tanınan durum geçer", () => {
    expect(parseStatus("expired")).toBe("expired");
  });

  it("tanınmayan durum lisans yok olur", () => {
    // "Etkin"e düşmek, anlamadığımız bir durumu sağlıklı göstermek olurdu.
    expect(parseStatus("belirsiz")).toBe("missing");
  });

  it("durum etiketleri Türkçe", () => {
    expect(statusLabel("expiring")).toBe("Bitiyor");
  });

  it("altı durum tanımlı", () => {
    expect(Object.keys(LICENSE_STATUS_LABEL)).toHaveLength(6);
  });
});

describe("sınırlar", () => {
  it("sayı okunur", () => {
    expect(parseLimits({ users: 25 }).users).toBe(25);
  });

  it("sınırsız null kalır", () => {
    expect(parseLimits({ users: null }).users).toBeNull();
  });

  it("eksik sınır null kalır", () => {
    expect(parseLimits({}).machines).toBeNull();
  });

  it("sıfır sınır korunur", () => {
    expect(parseLimits({ factories: 0 }).factories).toBe(0);
  });

  it("kullanım sayılamadıysa null", () => {
    expect(parseUsage({}).users).toBeNull();
  });

  it("ölçülmüş sıfır kullanım korunur", () => {
    expect(parseUsage({ machines: 0 }).machines).toBe(0);
  });
});

describe("sınır denetimi", () => {
  it("aşım bayrağı okunur", () => {
    expect(parseLimitCheck({ exceeded: true }).exceeded).toBe(true);
  });

  it("eksik aşım bayrağı null kalır", () => {
    // `false` demek "aşılmadı" iddiasında bulunmak olurdu.
    expect(parseLimitCheck({}).exceeded).toBeNull();
  });

  it("sınırsız kaynak Sınırsız yazar", () => {
    expect(limitValue(check({ limit: null }))).toBe(UNLIMITED);
  });

  it("ölçülemeyen kullanım tire yazar", () => {
    expect(limitValue(check({ used: null }))).toBe(`${NOT_MEASURED} / 150`);
  });

  it("normal sınır kesir yazar", () => {
    expect(limitValue(check())).toBe("12 / 150");
  });

  it("ölçülemeyen sınır nötr", () => {
    // Bilinmeyen bir şey ne iyi ne kötüdür.
    expect(limitTone(check({ exceeded: null }))).toBe("neutral");
  });

  it("aşılan sınır kötü", () => {
    expect(limitTone(check({ exceeded: true }))).toBe("bad");
  });

  it("dolmaya yakın sınır uyarı", () => {
    expect(limitTone(check({ ratio: 0.95 }))).toBe("warning");
  });

  it("rahat sınır iyi", () => {
    expect(limitTone(check())).toBe("good");
  });
});

describe("lisans kaydı", () => {
  it("plan okunur", () => {
    expect(parseLicense({ tier: "growth" })?.tier).toBe("growth");
  });

  it("boş gövde null", () => {
    expect(parseLicense(null)).toBeNull();
  });

  it("durum verilmezse null kalır", () => {
    expect(parseLicense({ tier: "growth" })?.status).toBeNull();
  });

  it("kalan gün okunur", () => {
    expect(parseLicense({ tier: "growth", remaining_days: 12 })?.remainingDays).toBe(12);
  });

  it("süresi dolmuşta kalan null", () => {
    expect(parseLicense({ tier: "growth" })?.remainingMs).toBeNull();
  });

  it("deneme bayrağı okunur", () => {
    expect(parseLicense({ tier: "trial", is_trial: true })?.isTrial).toBe(true);
  });
});

describe("görünüm", () => {
  it("boş gövde varsayılan görünüm", () => {
    expect(parseLicenseView(null)).toBe(EMPTY_LICENSE_VIEW);
  });

  it("varsayılan görünüm sağlıklı değil", () => {
    expect(EMPTY_LICENSE_VIEW.healthy).toBe(false);
  });

  it("sağlık bayrağı okunur", () => {
    expect(parseLicenseView({ status: "active", healthy: true }).healthy).toBe(true);
  });

  it("engellenenler okunur", () => {
    const parsed = parseLicenseView({ status: "expired", blocked: ["add_user"] });
    expect(parsed.blocked).toEqual(["add_user"]);
  });

  it("sınırlar çözülür", () => {
    const parsed = parseLicenseView({ status: "active", limits: [{ resource: "users" }] });
    expect(parsed.limits).toHaveLength(1);
  });
});

describe("metinler", () => {
  it("lisanssız görünümde neden yazılır", () => {
    const boş = { ...EMPTY_LICENSE_VIEW, reason: "Lisans yok." };
    expect(licenseCaption(boş)).toBe("Lisans yok.");
  });

  it("lisanslı görünümde plan yazılır", () => {
    expect(licenseCaption(view())).toContain("Büyüme");
  });

  it("müşteri adı yazılır", () => {
    expect(licenseCaption(view())).toContain("Pilot A.Ş.");
  });

  it("kalan gün yazılır", () => {
    expect(remainingLabel(view())).toBe("12 gün kaldı");
  });

  it("bugün biten lisans ayrı yazılır", () => {
    // Sıfır gün, bitmiş bir lisanstan farklıdır.
    const bugün = view({ license: { ...view().license!, remainingDays: 0 } });
    expect(remainingLabel(bugün)).toBe("Bugün bitiyor");
  });

  it("süresi dolmuşta tire yazılır", () => {
    const dolmuş = view({ license: { ...view().license!, remainingDays: null } });
    expect(remainingLabel(dolmuş)).toBe(NOT_MEASURED);
  });

  it("engel yoksa söylenir", () => {
    expect(blockedLabel([])).toContain("Hiçbir işlem engellenmiyor");
  });

  it("engellenenler okunur yazılır", () => {
    expect(blockedLabel(["add_machine"])).toContain("yeni makine");
  });

  it("engel metni izlemenin sürdüğünü söyler", () => {
    // Yalnızca "lisans doldu" demek, ekranın kapanacağı sanısına yol açardı.
    expect(blockedLabel(["add_user"])).toContain("İzleme sürüyor");
  });

  it("sağlıklı lisansta uyarı yok", () => {
    expect(licenseWarning(view())).toBeNull();
  });

  it("lisanssız kurulumda uyarı", () => {
    expect(licenseWarning(EMPTY_LICENSE_VIEW)).toContain("tanımlanmamış");
  });

  it("süresi dolan lisansta izleme sürdüğü yazılır", () => {
    const dolmuş = view({ healthy: false, status: "expired" });
    expect(licenseWarning(dolmuş)).toContain("İzleme sürüyor");
  });

  it("iptal edilen lisansta neden yazılır", () => {
    const iptal = view({ healthy: false, status: "revoked", reason: "Ödeme alınmadı" });
    expect(licenseWarning(iptal)).toBe("Ödeme alınmadı");
  });

  it("başlamamış lisansta uyarı", () => {
    const bekleyen = view({ healthy: false, status: "pending" });
    expect(licenseWarning(bekleyen)).toContain("başlamadı");
  });

  it("sınır aşımında neden yazılır", () => {
    const aşan = view({ healthy: false, reason: "25/25 — sınır dolu" });
    expect(licenseWarning(aşan)).toBe("25/25 — sınır dolu");
  });
});
