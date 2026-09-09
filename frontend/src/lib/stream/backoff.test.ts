/**
 * Yeniden bağlanma zamanlaması.
 *
 * Korunan davranışlar: bekleme her denemede ikiye katlanır, bir tavanda
 * durur ve titreşim içerir. Titreşim olmasaydı, sunucu yeniden başladığında
 * bütün tarayıcılar aynı saniyede geri döner ve sunucuyu ikinci kez
 * düşürürdü.
 */

import { describe, expect, it } from "vitest";
import {
  BASE_DELAY_MS,
  INITIAL_RECONNECT,
  JITTER_RATIO,
  MAX_DELAY_MS,
  backoffDelayMs,
  baseDelayMs,
  describeReconnect,
  noteConnected,
  noteDisconnect,
} from "./backoff";

const NO_JITTER = () => 0;
const FULL_JITTER = () => 1;

describe("bekleme süresi", () => {
  it("ilk denemede taban bekleme", () => {
    expect(backoffDelayMs(1, NO_JITTER)).toBe(BASE_DELAY_MS);
  });

  it("ikinci denemede iki katı", () => {
    expect(backoffDelayMs(2, NO_JITTER)).toBe(2_000);
  });

  it("üçüncü denemede dört katı", () => {
    expect(backoffDelayMs(3, NO_JITTER)).toBe(4_000);
  });

  it("tavan aşılmaz", () => {
    expect(backoffDelayMs(20, NO_JITTER)).toBe(MAX_DELAY_MS);
  });

  it("sıfırıncı deneme diye bir şey yok", () => {
    expect(backoffDelayMs(0, NO_JITTER)).toBe(BASE_DELAY_MS);
  });

  it("negatif deneme taban verir", () => {
    expect(backoffDelayMs(-5, NO_JITTER)).toBe(BASE_DELAY_MS);
  });

  it("titreşim beklemeyi uzatır", () => {
    expect(backoffDelayMs(1, FULL_JITTER)).toBe(
      BASE_DELAY_MS + BASE_DELAY_MS * JITTER_RATIO,
    );
  });

  it("titreşimli bekleme de tavanı aşmaz", () => {
    expect(backoffDelayMs(20, FULL_JITTER)).toBe(MAX_DELAY_MS);
  });

  it("bozuk rastgelelik titreşimsiz sayılır", () => {
    expect(backoffDelayMs(1, () => Number.NaN)).toBe(BASE_DELAY_MS);
  });

  it("aralık dışı rastgelelik kırpılır", () => {
    expect(backoffDelayMs(1, () => 5)).toBe(
      BASE_DELAY_MS + BASE_DELAY_MS * JITTER_RATIO,
    );
  });

  it("bekleme monoton büyür", () => {
    const values = [1, 2, 3, 4, 5].map((step) => baseDelayMs(step));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("taban bekleme titreşimsizdir", () => {
    expect(baseDelayMs(2)).toBe(2_000);
  });
});

describe("yeniden bağlanma durumu", () => {
  it("başlangıçta kopma yok", () => {
    expect(INITIAL_RECONNECT.attempts).toBe(0);
    expect(INITIAL_RECONNECT.nextDelayMs).toBeNull();
  });

  it("kopma sayacı artar", () => {
    const state = noteDisconnect(INITIAL_RECONNECT, "akış koptu", NO_JITTER);
    expect(state.attempts).toBe(1);
  });

  it("kopmada bekleme hesaplanır", () => {
    const state = noteDisconnect(INITIAL_RECONNECT, null, NO_JITTER);
    expect(state.nextDelayMs).toBe(BASE_DELAY_MS);
  });

  it("art arda kopmada bekleme büyür", () => {
    let state = noteDisconnect(INITIAL_RECONNECT, null, NO_JITTER);
    state = noteDisconnect(state, null, NO_JITTER);
    expect(state.nextDelayMs).toBe(2_000);
  });

  it("kopma nedeni saklanır", () => {
    const state = noteDisconnect(INITIAL_RECONNECT, "sunucu 502 döndü", NO_JITTER);
    expect(state.lastError).toBe("sunucu 502 döndü");
  });

  it("bağlanınca sayaç sıfırlanır", () => {
    const kopuk = noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    expect(noteConnected(kopuk).attempts).toBe(0);
  });

  it("bağlanınca bekleme kalkar", () => {
    const kopuk = noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    expect(noteConnected(kopuk).nextDelayMs).toBeNull();
  });

  it("bağlanınca geçmiş hata korunur", () => {
    /* Kullanıcı "az önce ne oldu?" sorusunu ancak böyle yanıtlayabilir. */
    const kopuk = noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    expect(noteConnected(kopuk).lastError).toBe("koptu");
  });

  it("durum değiştirilmez, yenisi üretilir", () => {
    noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    expect(INITIAL_RECONNECT.attempts).toBe(0);
  });
});

describe("okunur özet", () => {
  it("hiç kopmadıysa böyle söyler", () => {
    expect(describeReconnect(INITIAL_RECONNECT)).toBe("Bağlantı kopmadı.");
  });

  it("yeniden kurulduysa böyle söyler", () => {
    const state = noteConnected(noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER));
    expect(describeReconnect(state)).toBe("Bağlantı yeniden kuruldu.");
  });

  it("bekleyen denemede süreyi yazar", () => {
    const state = noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    expect(describeReconnect(state)).toContain("1 sn");
  });

  it("deneme sayısını yazar", () => {
    let state = noteDisconnect(INITIAL_RECONNECT, "koptu", NO_JITTER);
    state = noteDisconnect(state, "koptu", NO_JITTER);
    expect(describeReconnect(state)).toContain("2. deneme");
  });
});
