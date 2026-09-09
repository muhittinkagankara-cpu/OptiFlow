/**
 * Besleme rozeti.
 *
 * Bu dosyanın koruduğu tek kural: **açık bir akış, akan veri demek değildir.**
 * Ekran "Gerçek Veri" yazabilmek için gerçekten bir ölçüm almış olmalıdır;
 * yoksa "Bağlantı Bekleniyor" yazar ve kullanıcı cihaz tarafına bakar.
 */

import { describe, expect, it } from "vitest";
import {
  describePollRate,
  describeQueue,
  describeThroughput,
  feedVerdict,
  pressureWarning,
} from "./feed";
import { parseStreamStats } from "./parse";
import type { StreamStats } from "./types";

function stats(overrides: Record<string, unknown> = {}): StreamStats {
  return parseStreamStats({
    streams: 1,
    running: 1,
    health: "running",
    poll_rate_hz: 1,
    dispatcher: {
      processed: 10,
      events_per_second: 2,
      queue: { depth: 3, capacity: 1_000 },
    },
    ...overrides,
  });
}

describe("besleme kararı", () => {
  it("runtime seçili değilse demo", () => {
    const verdict = feedVerdict({
      usingRuntime: false,
      hasDeviceData: true,
      runningStreams: 2,
      stats: stats(),
    });
    expect(verdict.id).toBe("demo");
  });

  it("demo rozeti benzetimi söyler", () => {
    const verdict = feedVerdict({
      usingRuntime: false,
      hasDeviceData: false,
      runningStreams: 0,
      stats: null,
    });
    expect(verdict.reason).toContain("benzetim");
  });

  it("ölçüm geldiyse gerçek veri", () => {
    const verdict = feedVerdict({
      usingRuntime: true,
      hasDeviceData: true,
      runningStreams: 1,
      stats: stats(),
    });
    expect(verdict.id).toBe("real");
    expect(verdict.label).toBe("Gerçek Veri");
  });

  it("akış açık ama ölçüm yoksa bekleniyor", () => {
    /* Açık bir soket, akan veri demek değildir. */
    const verdict = feedVerdict({
      usingRuntime: true,
      hasDeviceData: false,
      runningStreams: 1,
      stats: stats(),
    });
    expect(verdict.id).toBe("waiting");
  });

  it("beklerken nedeni yazılır", () => {
    const verdict = feedVerdict({
      usingRuntime: true,
      hasDeviceData: false,
      runningStreams: 1,
      stats: stats(),
    });
    expect(verdict.reason).toContain("henüz ölçüm gelmedi");
  });

  it("hiç akış yoksa ne yapılacağı yazılır", () => {
    const verdict = feedVerdict({
      usingRuntime: true,
      hasDeviceData: false,
      runningStreams: 0,
      stats: null,
    });
    expect(verdict.reason).toContain("aboneliği başlatın");
  });

  it("veri geldiyse akış sayısı önemsiz", () => {
    const verdict = feedVerdict({
      usingRuntime: true,
      hasDeviceData: true,
      runningStreams: 0,
      stats: null,
    });
    expect(verdict.id).toBe("real");
  });
});

describe("ölçüm açıklamaları", () => {
  it("olay hızı yazılır", () => {
    expect(describeThroughput(stats())).toBe("2.0 olay/sn");
  });

  it("ölçülmemiş olay hızı söylenir", () => {
    const olcumsuz = parseStreamStats({ dispatcher: {} });
    expect(describeThroughput(olcumsuz)).toBe("Olay hızı ölçülmedi");
  });

  it("veri yokken olay hızı söylenir", () => {
    expect(describeThroughput(null)).toBe("Olay hızı ölçülmedi");
  });

  it("yoklama sıklığı yazılır", () => {
    expect(describePollRate(stats())).toBe("1.00 Hz");
  });

  it("yoklayıcı yoksa böyle yazılır", () => {
    expect(describePollRate(parseStreamStats({}))).toBe("Yoklama yok");
  });

  it("kuyruk derinliği yazılır", () => {
    expect(describeQueue(stats())).toBe("3/1000");
  });

  it("veri yokken kuyruk tire", () => {
    expect(describeQueue(null)).toBe("—");
  });
});

describe("kuyruk baskısı uyarısı", () => {
  it("kayıp yoksa uyarı yok", () => {
    expect(pressureWarning(stats())).toBeNull();
  });

  it("düşen ölçüm bildirilir", () => {
    const dolu = stats({
      dispatcher: { queue: { depth: 1_000, capacity: 1_000, dropped: 12 } },
    });
    expect(pressureWarning(dolu)).toContain("12 ölçüm");
  });

  it("baskı altında uyarılır", () => {
    const baskili = stats({
      dispatcher: {
        queue: { depth: 900, capacity: 1_000, under_pressure: true },
      },
    });
    expect(pressureWarning(baskili)).toContain("dolmak üzere");
  });

  it("veri yokken uyarı yok", () => {
    expect(pressureWarning(null)).toBeNull();
  });
});
