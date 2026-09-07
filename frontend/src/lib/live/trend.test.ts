import { describe, expect, it } from "vitest";
import {
  TREND_MAX_POINTS,
  TREND_WINDOW_MINUTES,
  pushSample,
  trendDirection,
  trendRange,
} from "./trend";
import { START } from "./fixtures";

describe("pushSample", () => {
  it("bos seriye ilk ornegi ekler", () => {
    const series = pushSample([], { atMinutes: START, value: 3 });
    expect(series).toHaveLength(1);
  });

  it("girdiyi degistirmez", () => {
    const before = [{ atMinutes: START, value: 1 }];
    pushSample(before, { atMinutes: START + 1, value: 2 });
    expect(before).toHaveLength(1);
  });

  it("ayni dakikaya gelen ikinci ornek oncekinin yerine yazilir", () => {
    // Ayni dakikada onlarca olay olabilir; her biri ayri nokta olsaydi grafik
    // dikey bir cizgi yigina donerdi.
    let series = pushSample([], { atMinutes: START, value: 1 });
    series = pushSample(series, { atMinutes: START, value: 9 });
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(9);
  });

  it("pencereden cikan eski ornekleri atar", () => {
    let series = pushSample([], { atMinutes: START, value: 1 });
    series = pushSample(series, { atMinutes: START + 5, value: 2 });
    series = pushSample(series, {
      atMinutes: START + TREND_WINDOW_MINUTES + 1,
      value: 3,
    });
    // Ilk ornek pencerenin disinda kaldi.
    expect(series.map((item) => item.value)).toEqual([2, 3]);
  });

  it("pencere sinirindaki ornegi tutar", () => {
    let series = pushSample([], { atMinutes: START, value: 1 });
    series = pushSample(series, {
      atMinutes: START + TREND_WINDOW_MINUTES,
      value: 2,
    });
    expect(series).toHaveLength(2);
  });

  it("nokta ust sinirini asmaz", () => {
    let series: ReturnType<typeof pushSample> = [];
    // Ayni dakika icinde degil, kesirli dakikalarla cok sayida ornek.
    for (let i = 0; i < TREND_MAX_POINTS + 40; i += 1) {
      series = pushSample(series, { atMinutes: START + i * 0.05, value: i });
    }
    expect(series.length).toBeLessThanOrEqual(TREND_MAX_POINTS);
    // En yeni ornek her zaman icerde kalir.
    expect(series[series.length - 1].value).toBe(TREND_MAX_POINTS + 39);
  });

  it("olculemeyen ani null olarak tasir", () => {
    const series = pushSample([], { atMinutes: START, value: null });
    expect(series[0].value).toBeNull();
  });
});

describe("trendDirection", () => {
  it("iki olcum yoksa yon bilinmez", () => {
    // Bilinmeyen yonu "sabit" gostermek, veri yokken iddia bildirmek olurdu.
    expect(trendDirection([])).toBeNull();
    expect(trendDirection([{ atMinutes: START, value: 5 }])).toBeNull();
  });

  it("null ornekleri atlar", () => {
    expect(
      trendDirection([
        { atMinutes: START, value: null },
        { atMinutes: START + 1, value: null },
      ]),
    ).toBeNull();
  });

  it("artisi ve dususu ayirt eder", () => {
    expect(
      trendDirection([
        { atMinutes: START, value: 10 },
        { atMinutes: START + 1, value: 20 },
      ]),
    ).toBe("up");
    expect(
      trendDirection([
        { atMinutes: START, value: 20 },
        { atMinutes: START + 1, value: 10 },
      ]),
    ).toBe("down");
  });

  it("yuzde birlik degisimi gurultu sayar", () => {
    expect(
      trendDirection([
        { atMinutes: START, value: 100 },
        { atMinutes: START + 1, value: 100.5 },
      ]),
    ).toBe("flat");
  });

  it("sifirdan baslayan artisi yakalar", () => {
    // Esik degerin yuzdesi oldugundan, sifirda esik de sifirdir.
    expect(
      trendDirection([
        { atMinutes: START, value: 0 },
        { atMinutes: START + 1, value: 3 },
      ]),
    ).toBe("up");
  });
});

describe("trendRange", () => {
  it("olcum yoksa null doner", () => {
    expect(trendRange([])).toBeNull();
    expect(trendRange([{ atMinutes: START, value: null }])).toBeNull();
  });

  it("en kucuk ve en buyugu verir", () => {
    expect(
      trendRange([
        { atMinutes: START, value: 4 },
        { atMinutes: START + 1, value: null },
        { atMinutes: START + 2, value: 9 },
        { atMinutes: START + 3, value: 1 },
      ]),
    ).toEqual({ min: 1, max: 9 });
  });
});
