import { describe, expect, it } from "vitest";
import { buildValidation } from "./accuracy";
import { buildConfidence } from "./confidence";
import { sampleConfig, sampleRealData, sampleTimeline } from "./fixtures";
import {
  FLAT_MARGIN,
  MAX_SNAPSHOTS,
  accuracyTrend,
  appendSnapshot,
  forFactory,
  isValidSnapshot,
  parseTimeline,
  snapshotFrom,
} from "./timeline";
import type { ValidationSnapshot } from "./types";

const NOW = new Date("2026-09-07T10:00:00");

function snapshot(
  id: string,
  accuracy: number | null,
  dayOffset: number,
  factoryId: string | null = null,
): ValidationSnapshot {
  const date = new Date(NOW);
  date.setDate(date.getDate() + dayOffset);
  return {
    id,
    factoryId,
    factoryName: "Örnek Hat",
    measuredAt: date.toISOString(),
    overallAccuracy: accuracy,
    confidenceScore: 0.7,
    confidenceLevel: "medium",
    measuredStationCount: 3,
    stationCount: 4,
  };
}

describe("snapshotFrom", () => {
  it("ozet ve guven skorunu tek kayda tasir", () => {
    const config = sampleConfig();
    const summary = buildValidation(
      config,
      // Kosum yoksa kayit da olcumsuz kalir; burada gercek kosum kullanilir.
      null,
      sampleRealData(NOW),
    );
    const confidence = buildConfidence(summary);
    const record = snapshotFrom(summary, confidence, {
      id: "val-1",
      factoryId: "f1",
      factoryName: "Kuzey Hat",
      measuredAt: NOW,
    });

    expect(record.id).toBe("val-1");
    expect(record.factoryId).toBe("f1");
    expect(record.measuredAt).toBe(NOW.toISOString());
    expect(record.overallAccuracy).toBe(summary.overallAccuracy);
    expect(record.confidenceScore).toBe(confidence.score);
  });
});

describe("appendSnapshot", () => {
  it("kayitlari eskiden yeniye siralar", () => {
    const history = appendSnapshot(
      appendSnapshot([], snapshot("b", 0.9, 0)),
      snapshot("a", 0.8, -5),
    );
    expect(history.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("ayni kimlikli kayit ikilenmez, gunellenir", () => {
    const first = appendSnapshot([], snapshot("a", 0.8, 0));
    const second = appendSnapshot(first, snapshot("a", 0.93, 0));
    expect(second).toHaveLength(1);
    expect(second[0].overallAccuracy).toBe(0.93);
  });

  it("sinir asildiginda en eski kayit duser", () => {
    let history: ValidationSnapshot[] = [];
    for (let index = 0; index < MAX_SNAPSHOTS + 3; index += 1) {
      history = appendSnapshot(history, snapshot(`s${index}`, 0.9, index));
    }
    expect(history).toHaveLength(MAX_SNAPSHOTS);
    expect(history[0].id).toBe("s3");
  });
});

describe("forFactory", () => {
  it("fabrikaya gore ayirir", () => {
    const history = [
      snapshot("a", 0.9, -2, "f1"),
      snapshot("b", 0.9, -1, "f2"),
      snapshot("c", 0.9, 0, null),
    ];
    expect(forFactory(history, "f1").map((item) => item.id)).toEqual(["a"]);
    // Kaydedilmemis model de kendi geçmişini tutar.
    expect(forFactory(history, null).map((item) => item.id)).toEqual(["c"]);
  });
});

describe("accuracyTrend", () => {
  it("bos gecmiste yon bilinmez", () => {
    expect(accuracyTrend([])).toMatchObject({ direction: "unknown", delta: null });
  });

  it("tek olcumden egri gecirilmez", () => {
    const trend = accuracyTrend([snapshot("a", 0.9, 0)]);
    expect(trend.direction).toBe("unknown");
    expect(trend.delta).toBeNull();
    expect(trend.last?.id).toBe("a");
  });

  it("artisi yakalar", () => {
    const trend = accuracyTrend([snapshot("a", 0.8, -1), snapshot("b", 0.9, 0)]);
    expect(trend.direction).toBe("up");
    expect(trend.delta).toBeCloseTo(0.1, 6);
  });

  it("dususu yakalar", () => {
    const trend = accuracyTrend([snapshot("a", 0.94, -1), snapshot("b", 0.8, 0)]);
    expect(trend.direction).toBe("down");
  });

  it("olcum gurultusu kadar oynama yatay sayilir", () => {
    const trend = accuracyTrend([
      snapshot("a", 0.9, -1),
      snapshot("b", 0.9 + FLAT_MARGIN / 2, 0),
    ]);
    expect(trend.direction).toBe("flat");
  });

  it("dogrulugu hesaplanmamis kayit trendi kirmaz", () => {
    const trend = accuracyTrend([
      snapshot("a", 0.8, -2),
      snapshot("bos", null, -1),
      snapshot("b", 0.9, 0),
    ]);
    expect(trend.direction).toBe("up");
    expect(trend.first?.id).toBe("a");
    expect(trend.last?.id).toBe("b");
  });

  it("ornek gecmiste yukselen trend gorunur", () => {
    expect(accuracyTrend(sampleTimeline(NOW)).direction).toBe("up");
  });
});

describe("parseTimeline", () => {
  it("bos ve bozuk girdi gecmisi silmez, bos doner", () => {
    expect(parseTimeline(null)).toEqual([]);
    expect(parseTimeline("{ bozuk")).toEqual([]);
    expect(parseTimeline('{"a":1}')).toEqual([]);
  });

  it("taninmayan kayitlari atar, gecerlileri korur", () => {
    // Eski bir surumden kalmis tek bozuk satir yuzunden tum gecmisi silmek,
    // aylardir biriken olcumleri kaybettirirdi.
    const raw = JSON.stringify([snapshot("a", 0.9, 0), { id: "eksik" }]);
    const parsed = parseTimeline(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("a");
  });

  it("okurken de eskiden yeniye siralar", () => {
    const raw = JSON.stringify([snapshot("b", 0.9, 0), snapshot("a", 0.8, -3)]);
    expect(parseTimeline(raw).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("isValidSnapshot", () => {
  it("olcumsuz kaydi da gecerli sayar", () => {
    // Dogrulugu hesaplanamamis bir olcum de bir kayittir.
    expect(isValidSnapshot(snapshot("a", null, 0))).toBe(true);
  });

  it("eksik alanli kaydi reddeder", () => {
    expect(isValidSnapshot({ id: "a" })).toBe(false);
    expect(isValidSnapshot(null)).toBe(false);
  });
});
