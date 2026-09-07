import { describe, expect, it } from "vitest";
import {
  MAX_PRIORITY_CARDS,
  buildImprovementCards,
  buildPriorityCards,
} from "./priorities";
import { demandConstrained, report, results, station } from "./fixtures";

function ids(cards: { id: string }[]) {
  return cards.map((card) => card.id);
}

const busyFlow = { entered: 100, completed: 70, scrapped: 20, rejected: 10 };

describe("buildPriorityCards — temel", () => {
  it("kosum yoksa bos dizi doner", () => {
    expect(buildPriorityCards(null, null)).toEqual([]);
  });

  it("darbogazi kart olarak uretir", () => {
    const cards = buildPriorityCards(results(), null);
    const card = cards.find((item) => item.id === "bottleneck");
    expect(card?.station).toBe("Torna");
    expect(card?.severity).toBe("high");
  });

  it("cok dolu darbogazi kritik yapar", () => {
    const cards = buildPriorityCards(
      results({
        station_metrics: [station("s1", "Kesim", 0.5), station("s2", "Torna", 0.97)],
      }),
      null,
    );
    expect(cards.find((c) => c.id === "bottleneck")?.severity).toBe("critical");
  });

  it("dis kisitta darbogaz karti uretmez", () => {
    // Kimse dolu degilken "darbogaz" demek, olmayan bir aciliyet yaratirdi.
    expect(ids(buildPriorityCards(demandConstrained(), null))).not.toContain(
      "bottleneck",
    );
  });

  it("kararsiz hatti kritik olarak one alir", () => {
    const cards = buildPriorityCards(results({ is_stable: false }), null);
    expect(cards[0].id).toBe("unstable");
    expect(cards[0].severity).toBe("critical");
  });
});

describe("buildPriorityCards — finans", () => {
  it("finans yoksa parasal etki null kalir", () => {
    // Uydurulmus bir tutar, hic tutar gostermemekten kotudur.
    const cards = buildPriorityCards(results(), null);
    for (const card of cards) {
      expect(card.monetaryImpact).toBeNull();
    }
  });

  it("darbogazin parasal etkisini finanstan okur", () => {
    const cards = buildPriorityCards(results(), report());
    expect(cards.find((c) => c.id === "bottleneck")?.monetaryImpact).toBe(700);
  });

  it("darbogaz disindaki pahali istasyonlari da gosterir", () => {
    const cards = buildPriorityCards(results(), report());
    const kesim = cards.find((c) => c.id === "loss-s1");
    expect(kesim?.monetaryImpact).toBe(300);
    expect(kesim?.station).toBe("Kesim");
  });

  it("ayni aciliyette daha pahali kart once gelir", () => {
    const cheap = { ...report() };
    cheap.stations = [
      {
        station_id: "a",
        station_name: "Ucuz",
        downtime_loss: 0,
        waiting_loss: 0,
        scrap_loss: 10,
        opportunity_loss: 0,
        total_loss: 10,
        is_bottleneck: false,
      },
      {
        station_id: "b",
        station_name: "Pahalı",
        downtime_loss: 0,
        waiting_loss: 0,
        scrap_loss: 900,
        opportunity_loss: 0,
        total_loss: 900,
        is_bottleneck: false,
      },
    ];
    const cards = buildPriorityCards(demandConstrained(), cheap);
    const medium = cards.filter((c) => c.severity === "medium");
    expect(medium[0].station).toBe("Pahalı");
  });
});

describe("buildPriorityCards — kalite ve kuyruk", () => {
  it("yuksek fireyi bildirir", () => {
    const cards = buildPriorityCards(
      results({
        station_metrics: [station("s1", "Kesim", 0.5, { flow: busyFlow })],
        bottleneck_station_id: "s1",
      }),
      null,
    );
    expect(ids(cards)).toContain("scrap");
  });

  it("tampon reddini fireden ayri bildirir", () => {
    const cards = buildPriorityCards(
      results({
        station_metrics: [
          station("s1", "Kesim", 0.5, {
            flow: { entered: 100, completed: 80, scrapped: 0, rejected: 20 },
          }),
        ],
        bottleneck_station_id: "s1",
      }),
      null,
    );
    expect(ids(cards)).toContain("rejected");
    expect(ids(cards)).not.toContain("scrap");
  });

  it("dogrulama gecmediyse uyarir", () => {
    const cards = buildPriorityCards(
      results({
        littles_law_validation: {
          passed: false,
          deviation_pct: 12.3,
          tolerance_pct: 5,
          replications_checked: 10,
          replications_passed: 2,
        },
      }),
      null,
    );
    const card = cards.find((c) => c.id === "validation");
    expect(card?.detail).toContain("12.3");
  });
});

describe("buildPriorityCards — siralama ve sinir", () => {
  it("en fazla bes kart doner", () => {
    const many = results({
      is_stable: false,
      station_metrics: [station("s1", "Kesim", 0.97, { flow: busyFlow })],
      bottleneck_station_id: "s1",
      littles_law_validation: {
        passed: false,
        deviation_pct: 20,
        tolerance_pct: 5,
        replications_checked: 10,
        replications_passed: 1,
      },
    });
    expect(buildPriorityCards(many, report()).length).toBeLessThanOrEqual(
      MAX_PRIORITY_CARDS,
    );
  });

  it("kritik kartlar orta kartlardan once gelir", () => {
    const cards = buildPriorityCards(results({ is_stable: false }), report());
    const severities = cards.map((c) => c.severity);
    expect(severities.indexOf("critical")).toBeLessThan(
      severities.lastIndexOf("medium"),
    );
  });
});

describe("buildImprovementCards", () => {
  it("kosum yoksa bos dizi doner", () => {
    expect(buildImprovementCards(null, null)).toEqual([]);
  });

  it("finans onerilerini oldugu gibi tasir", () => {
    // Yeni tavsiye uretilmez; metin finans katmanindan gelir.
    const cards = buildImprovementCards(results(), report());
    expect(cards[0].description).toContain("Önleyici bakım");
    expect(cards[0].recoverableAmount).toBe(300);
    expect(cards[0].station).toBe("Torna");
  });

  it("baskin kaleme gore zorluk atar", () => {
    const cards = buildImprovementCards(results(), report());
    // downtime_loss → orta
    expect(cards[0].difficulty).toBe("medium");
  });

  it("geri odeme suresini hesaplar", () => {
    const cards = buildImprovementCards(results(), report());
    expect(cards[0].paybackDays).not.toBeNull();
  });

  it("gunluk kayip yoksa geri odeme null kalir", () => {
    const cards = buildImprovementCards(
      results(),
      report({ daily_loss: null }),
    );
    expect(cards[0].paybackDays).toBeNull();
  });

  it("finans yoksa kosumdan cikarilabilen oneriler uretir", () => {
    const cards = buildImprovementCards(results(), null);
    expect(ids(cards)).toContain("add-capacity");
    // Parasal alanlar bos kalir.
    expect(cards[0].recoverableAmount).toBeNull();
  });

  it("finans yoksa fire ve tampon onerilerini de uretir", () => {
    const cards = buildImprovementCards(
      results({
        station_metrics: [station("s1", "Kesim", 0.5, { flow: busyFlow })],
        bottleneck_station_id: "s1",
      }),
      null,
    );
    expect(ids(cards)).toContain("reduce-scrap");
    expect(ids(cards)).toContain("grow-buffer");
    expect(cards.find((c) => c.id === "grow-buffer")?.difficulty).toBe("easy");
  });

  it("dis kisitta ve sorunsuz hatta oneri uretmez", () => {
    expect(buildImprovementCards(demandConstrained(), null)).toEqual([]);
  });

  it("en cok geri kazandiran kart once gelir", () => {
    const two = report({
      suggestions: [
        {
          station_id: "a",
          station_name: "Az",
          dominant_loss: "waiting_loss",
          recoverable_amount: 50,
          action: "a",
          rationale: "a",
        },
        {
          station_id: "b",
          station_name: "Çok",
          dominant_loss: "scrap_loss",
          recoverable_amount: 900,
          action: "b",
          rationale: "b",
        },
      ],
    });
    expect(buildImprovementCards(results(), two)[0].station).toBe("Çok");
  });
});
