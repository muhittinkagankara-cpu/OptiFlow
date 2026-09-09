import { describe, expect, it } from "vitest";
import {
  PERIOD_DAYS,
  PERIOD_MS,
  QUOTA_LIMITS,
  WARNING_ABSOLUTE,
  canAsk,
  consume,
  initialQuota,
  isValidQuota,
  limitOf,
  parseQuota,
  periodEnd,
  quotaSnapshot,
  remaining,
  resetIfExpired,
  warningFor,
} from "./quota";
import type { QuotaState } from "./types";

const NOW = 1_700_000_000_000;

function state(overrides: Partial<QuotaState> = {}): QuotaState {
  return { tier: "growth", used: 0, periodStartMs: NOW, ...overrides };
}

describe("QUOTA_LIMITS", () => {
  it("Starter'da AI kapalidir", () => {
    expect(QUOTA_LIMITS.starter).toBe(0);
  });

  it("Growth'ta dönem başına 100 analiz vardir", () => {
    expect(QUOTA_LIMITS.growth).toBe(100);
  });

  it("Enterprise sinirsizdir ve sifirdan ayrilir", () => {
    // `null` ile `0` karistirilirsa sinirsiz paket kapali gorunurdu.
    expect(QUOTA_LIMITS.enterprise).toBeNull();
    expect(limitOf("enterprise")).not.toBe(0);
  });
});

describe("initialQuota / periodEnd", () => {
  it("yeni hesap sifir kullanimla baslar", () => {
    const quota = initialQuota("growth", NOW);
    expect(quota.used).toBe(0);
    expect(quota.periodStartMs).toBe(NOW);
  });

  it("donem otuz gun surer", () => {
    expect(periodEnd(state())).toBe(NOW + PERIOD_MS);
    expect(PERIOD_DAYS).toBe(30);
  });
});

describe("remaining", () => {
  it("kullanildikca azalir", () => {
    expect(remaining(state({ used: 30 }), NOW)).toBe(70);
  });

  it("sifirin altina inmez", () => {
    expect(remaining(state({ used: 150 }), NOW)).toBe(0);
  });

  it("sinirsiz pakette bos doner", () => {
    expect(remaining(state({ tier: "enterprise", used: 5_000 }), NOW)).toBeNull();
  });

  it("Starter'da hep sifirdir", () => {
    expect(remaining(state({ tier: "starter" }), NOW)).toBe(0);
  });
});

describe("canAsk", () => {
  it("hak varken izin verir", () => {
    expect(canAsk(state({ used: 99 }), NOW)).toBe(true);
  });

  it("hak bitince engeller", () => {
    expect(canAsk(state({ used: 100 }), NOW)).toBe(false);
  });

  it("Starter'da hicbir zaman izin vermez", () => {
    expect(canAsk(state({ tier: "starter" }), NOW)).toBe(false);
  });

  it("Enterprise'da her zaman izin verir", () => {
    expect(canAsk(state({ tier: "enterprise", used: 10_000 }), NOW)).toBe(true);
  });
});

describe("consume", () => {
  it("hak varken sayaci artirir", () => {
    const result = consume(state({ used: 4 }), NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.used).toBe(5);
    expect(result.reason).toBeNull();
  });

  it("hak bittiginde sayaci artirmaz", () => {
    // Reddedilen bir istegin kotadan dusmesi, kullanicinin hakkini yemek olurdu.
    const result = consume(state({ used: 100 }), NOW);
    expect(result.allowed).toBe(false);
    expect(result.state.used).toBe(100);
  });

  it("hak bittiginde nedenini ve yenilenme sartini yazar", () => {
    const result = consume(state({ used: 100 }), NOW);
    expect(result.reason).toContain("100 analiz hakkı doldu");
    expect(result.reason).toContain(`${PERIOD_DAYS} günlük`);
  });

  it("Starter'da yukseltme cagrisi yapar", () => {
    const result = consume(state({ tier: "starter" }), NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Growth");
  });

  it("Enterprise'da sinir uygulamaz", () => {
    const result = consume(state({ tier: "enterprise", used: 5_000 }), NOW);
    expect(result.allowed).toBe(true);
    expect(result.state.used).toBe(5_001);
  });

  it("donem bittiyse once sifirlar sonra harcar", () => {
    const result = consume(state({ used: 100 }), NOW + PERIOD_MS + 1_000);
    expect(result.allowed).toBe(true);
    expect(result.state.used).toBe(1);
  });

  it("girdiyi degistirmez", () => {
    const original = state({ used: 4 });
    consume(original, NOW);
    expect(original.used).toBe(4);
  });
});

describe("resetIfExpired", () => {
  it("donem icinde dokunmaz", () => {
    const current = state({ used: 12 });
    expect(resetIfExpired(current, NOW + 1_000)).toBe(current);
  });

  it("donem bitince sayaci sifirlar", () => {
    const next = resetIfExpired(state({ used: 12 }), NOW + PERIOD_MS);
    expect(next.used).toBe(0);
  });

  it("aylarca kullanilmayan hesapta donemi bugune tasir", () => {
    // Tek donem eklemek, donem baslangicini gecmiste birakirdi.
    const next = resetIfExpired(state({ used: 12 }), NOW + PERIOD_MS * 5 + 500);
    expect(next.periodStartMs).toBe(NOW + PERIOD_MS * 5);
    expect(periodEnd(next)).toBeGreaterThan(NOW + PERIOD_MS * 5);
  });

  it("paketi korur", () => {
    expect(
      resetIfExpired(state({ tier: "enterprise", used: 3 }), NOW + PERIOD_MS).tier,
    ).toBe("enterprise");
  });
});

describe("warningFor", () => {
  it("bol hak varken uyarmaz", () => {
    expect(warningFor(state({ used: 10 }), NOW)).toBeNull();
  });

  it("hak azalinca kalan sayiyi yazar", () => {
    // Sunum ortasinda hakkin bittigini ogrenmek urunun sucu olarak gorulur.
    const warning = warningFor(state({ used: 95 }), NOW);
    expect(warning).toContain("5 analiz");
  });

  it("esikte uyarir", () => {
    expect(
      warningFor(state({ used: 100 - WARNING_ABSOLUTE }), NOW),
    ).not.toBeNull();
  });

  it("hak bitince acikca soyler", () => {
    expect(warningFor(state({ used: 100 }), NOW)).toBe("Analiz hakkınız doldu.");
  });

  it("Starter'da kapali oldugunu soyler", () => {
    expect(warningFor(state({ tier: "starter" }), NOW)).toContain("kapalı");
  });

  it("Enterprise'da uyari yoktur", () => {
    expect(warningFor(state({ tier: "enterprise", used: 9_999 }), NOW)).toBeNull();
  });
});

describe("quotaSnapshot", () => {
  it("arayuzun okudugu tum alanlari doldurur", () => {
    const snapshot = quotaSnapshot(state({ used: 40 }), NOW);
    expect(snapshot).toMatchObject({
      tier: "growth",
      used: 40,
      limit: 100,
      remaining: 60,
      allowed: true,
      warning: null,
    });
    expect(snapshot.periodEndMs).toBe(NOW + PERIOD_MS);
  });

  it("sinirsiz pakette limit ve kalan bostur", () => {
    const snapshot = quotaSnapshot(state({ tier: "enterprise", used: 7 }), NOW);
    expect(snapshot.limit).toBeNull();
    expect(snapshot.remaining).toBeNull();
    expect(snapshot.allowed).toBe(true);
  });

  it("donem bittiyse sifirlanmis hali gosterir", () => {
    const snapshot = quotaSnapshot(state({ used: 100 }), NOW + PERIOD_MS + 5);
    expect(snapshot.used).toBe(0);
    expect(snapshot.allowed).toBe(true);
  });

  it("Starter'da kapali ve uyarili doner", () => {
    const snapshot = quotaSnapshot(state({ tier: "starter" }), NOW);
    expect(snapshot.allowed).toBe(false);
    expect(snapshot.warning).not.toBeNull();
  });
});

describe("saklama", () => {
  it("gecerli kaydi tanir", () => {
    expect(isValidQuota(state())).toBe(true);
  });

  it("bozuk kaydi reddeder", () => {
    expect(isValidQuota(null)).toBe(false);
    expect(isValidQuota({ tier: "gold", used: 1, periodStartMs: 1 })).toBe(false);
    expect(isValidQuota({ tier: "growth", used: -1, periodStartMs: 1 })).toBe(false);
    expect(isValidQuota({ tier: "growth", used: "3", periodStartMs: 1 })).toBe(false);
  });

  it("bozuk metinde yedege doner", () => {
    const fallback = state();
    expect(parseQuota("{bozuk", fallback)).toBe(fallback);
    expect(parseQuota(null, fallback)).toBe(fallback);
    expect(parseQuota('{"tier":"yok"}', fallback)).toBe(fallback);
  });

  it("gecerli metni okur", () => {
    const stored = state({ used: 17 });
    expect(parseQuota(JSON.stringify(stored), state())).toEqual(stored);
  });
});
