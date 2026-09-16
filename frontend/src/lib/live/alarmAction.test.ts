/**
 * Alarmdan sonraki adım (Sprint 2I-B).
 *
 * Korunan kural: **uydurma eylem yok.** Yalnızca üründe var olan bir ekrana
 * bağlanabilen alarm eylem gösterir.
 */

import { describe, expect, it } from "vitest";
import type { Alarm, AlarmLevel } from "./types";
import { alarmAction, alarmKind } from "./alarmAction";

const alarm = (
  kind: string,
  level: AlarmLevel = "warning",
  resolvedAtMinutes: number | null = null,
): Alarm => ({
  id: `${kind}:s1:480`,
  level,
  atMinutes: 480,
  stationId: "s1",
  stationName: "Torna",
  text: "Kuyruk büyüdü.",
  updatedAtMinutes: 480,
  resolvedAtMinutes,
});

describe("alarm türü kimlikten okunur", () => {
  it("ön ek türü verir", () => {
    expect(alarmKind(alarm("queue"))).toBe("queue");
    expect(alarmKind(alarm("fault"))).toBe("fault");
  });
});

describe("yalnızca kuyruk alarmının hedefi var", () => {
  it("kuyruk alarmı simülasyona bağlanır", () => {
    const eylem = alarmAction(alarm("queue"))!;
    expect(eylem.label).toBe("Simülasyonda modelle");
    expect(eylem.reason).toContain("kapasite");
  });

  it("arıza alarmı için eylem gösterilmez", () => {
    // Bakım akışı üründe yok; olmayan yeteneği düğme yapmayız.
    expect(alarmAction(alarm("fault", "critical"))).toBeNull();
  });

  it("fire alarmı için eylem gösterilmez", () => {
    expect(alarmAction(alarm("scrap"))).toBeNull();
  });

  it("setup bilgisi için eylem gösterilmez", () => {
    expect(alarmAction(alarm("setup", "info"))).toBeNull();
  });
});

describe("kapanmış ve olmayan alarm", () => {
  it("giderilmiş alarm eylem göstermez", () => {
    expect(alarmAction(alarm("queue", "warning", 495))).toBeNull();
  });

  it("alarm yoksa eylem de yok", () => {
    expect(alarmAction(null)).toBeNull();
  });
});

describe("uydurma eylem dili yok", () => {
  it("makineyi durdur / görev gönder gibi vaatler yazılmaz", () => {
    const eylem = alarmAction(alarm("queue"))!;
    const metin = `${eylem.label} ${eylem.reason}`;
    expect(metin).not.toMatch(/durdur|görev gönder|bakım başlat|operatöre/i);
  });
});
