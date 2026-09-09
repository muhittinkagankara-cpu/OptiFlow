import { describe, expect, it } from "vitest";
import {
  BACKOFF_FACTOR,
  BASE_DELAY_MS,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  applyAttempt,
  attemptsLeft,
  backoffDelay,
  isRetryDue,
  nextRetryAt,
  retryLabel,
  timeUntilRetry,
  type RetryState,
} from "./retry";
import { idleRuntime } from "./status";
import type { ConnectorRuntime, ConnectorStatus } from "./types";

const NOW = 1_000_000;

function runtime(
  status: ConnectorStatus,
  overrides: Partial<ConnectorRuntime> = {},
): ConnectorRuntime {
  return { ...idleRuntime("conn"), status, ...overrides };
}

describe("backoffDelay", () => {
  it("ilk deneme taban sureyi bekler", () => {
    expect(backoffDelay(1)).toBe(BASE_DELAY_MS);
  });

  it("her denemede ikiye katlar", () => {
    expect(backoffDelay(2)).toBe(BASE_DELAY_MS * BACKOFF_FACTOR);
    expect(backoffDelay(3)).toBe(BASE_DELAY_MS * BACKOFF_FACTOR ** 2);
    expect(backoffDelay(4)).toBe(BASE_DELAY_MS * BACKOFF_FACTOR ** 3);
  });

  it("tavani asmaz", () => {
    // Ag geri geldiginde baglantinin dakikalarca olu kalmamasi icin tavan var.
    expect(backoffDelay(30)).toBe(MAX_DELAY_MS);
  });

  it("sifir ve negatif deneme tabana cekilir", () => {
    // Cagiranin sayac hatasi, sifir beklemeli bir donguye donusmemeli.
    expect(backoffDelay(0)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(-5)).toBe(BASE_DELAY_MS);
  });

  it("gecersiz sayi tabana cekilir", () => {
    expect(backoffDelay(Number.NaN)).toBe(BASE_DELAY_MS);
  });

  it("ondalik deneme asagi yuvarlanir", () => {
    expect(backoffDelay(2.9)).toBe(backoffDelay(2));
  });
});

describe("nextRetryAt", () => {
  it("sureyi simdiye ekler", () => {
    expect(nextRetryAt(1, NOW)).toBe(NOW + BASE_DELAY_MS);
    expect(nextRetryAt(3, NOW)).toBe(NOW + backoffDelay(3));
  });
});

describe("applyAttempt", () => {
  const fresh: RetryState = { status: "connecting", attempt: 0, nextRetryAtMs: null };

  it("basarida sayaci sifirlar", () => {
    const next = applyAttempt({ ...fresh, attempt: 3 }, "success", NOW);
    expect(next).toEqual({ status: "connected", attempt: 0, nextRetryAtMs: null });
  });

  it("ilk basarisizlikta yeniden denemeye gecer", () => {
    const next = applyAttempt(fresh, "failure", NOW);
    expect(next.status).toBe("retrying");
    expect(next.attempt).toBe(1);
    expect(next.nextRetryAtMs).toBe(NOW + BASE_DELAY_MS);
  });

  it("her basarisizlikta bekleme buyur", () => {
    let state = applyAttempt(fresh, "failure", NOW);
    const first = (state.nextRetryAtMs ?? 0) - NOW;
    state = applyAttempt(state, "failure", NOW);
    const second = (state.nextRetryAtMs ?? 0) - NOW;
    expect(second).toBeGreaterThan(first);
  });

  it("sinira gelince vazgecer", () => {
    let state: RetryState = fresh;
    for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
      state = applyAttempt(state, "failure", NOW);
    }
    expect(state.status).toBe("failed");
    expect(state.attempt).toBe(MAX_ATTEMPTS);
    expect(state.nextRetryAtMs).toBeNull();
  });

  it("otomatik yeniden baglanma kapaliyken hic denemez", () => {
    // Bakim icin bilerek kapatilmis bir hatti rahatsiz etmemek gerekir.
    const next = applyAttempt(fresh, "failure", NOW, false);
    expect(next.status).toBe("failed");
    expect(next.nextRetryAtMs).toBeNull();
  });

  it("basaridan sonra yeni bir kopma bastan sayar", () => {
    let state = applyAttempt(fresh, "failure", NOW);
    state = applyAttempt(state, "failure", NOW);
    state = applyAttempt(state, "success", NOW);
    const afterRecovery = applyAttempt(state, "failure", NOW);
    expect(afterRecovery.attempt).toBe(1);
    expect(afterRecovery.nextRetryAtMs).toBe(NOW + BASE_DELAY_MS);
  });
});

describe("isRetryDue", () => {
  it("zamani gelmemis deneme calismaz", () => {
    const item = runtime("retrying", { attempt: 1, nextRetryAtMs: NOW + 500 });
    expect(isRetryDue(item, NOW)).toBe(false);
  });

  it("zamani gelen deneme calisir", () => {
    const item = runtime("retrying", { attempt: 1, nextRetryAtMs: NOW });
    expect(isRetryDue(item, NOW)).toBe(true);
    expect(isRetryDue(item, NOW + 10)).toBe(true);
  });

  it("baska durumlarda deneme yoktur", () => {
    expect(isRetryDue(runtime("connected"), NOW)).toBe(false);
    expect(isRetryDue(runtime("failed", { nextRetryAtMs: NOW - 10 }), NOW)).toBe(
      false,
    );
    expect(isRetryDue(runtime("idle"), NOW)).toBe(false);
  });

  it("zamani olmayan bekleme calismaz", () => {
    expect(isRetryDue(runtime("retrying", { nextRetryAtMs: null }), NOW)).toBe(
      false,
    );
  });
});

describe("timeUntilRetry", () => {
  it("kalan sureyi verir", () => {
    const item = runtime("retrying", { attempt: 1, nextRetryAtMs: NOW + 3_000 });
    expect(timeUntilRetry(item, NOW)).toBe(3_000);
  });

  it("gecmis zaman negatife dusmez", () => {
    const item = runtime("retrying", { attempt: 1, nextRetryAtMs: NOW - 500 });
    expect(timeUntilRetry(item, NOW)).toBe(0);
  });

  it("beklemeyen baglantida bos doner", () => {
    expect(timeUntilRetry(runtime("connected"), NOW)).toBeNull();
  });
});

describe("attemptsLeft", () => {
  it("kalan hakki sayar", () => {
    expect(attemptsLeft(runtime("retrying", { attempt: 2 }))).toBe(
      MAX_ATTEMPTS - 2,
    );
  });

  it("sinirin altina dusmez", () => {
    expect(attemptsLeft(runtime("failed", { attempt: 99 }))).toBe(0);
  });
});

describe("retryLabel", () => {
  it("bekleyen denemede saniyeyi yazar", () => {
    const item = runtime("retrying", { attempt: 2, nextRetryAtMs: NOW + 2_400 });
    expect(retryLabel(item, NOW)).toContain("3 sn sonra");
    expect(retryLabel(item, NOW)).toContain("2. deneme");
  });

  it("vazgecilen baglantida mudahale ister", () => {
    const item = runtime("failed", { attempt: MAX_ATTEMPTS });
    expect(retryLabel(item, NOW)).toContain("ayarları kontrol edin");
  });

  it("saglikli baglantida cumle kurmaz", () => {
    expect(retryLabel(runtime("connected"), NOW)).toBeNull();
  });
});
