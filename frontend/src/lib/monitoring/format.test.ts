/**
 * Biçimlendirme.
 *
 * Tek kural sınanır: ölçülmeyen değer **sıfır gösterilmez**, "—" gösterilir ve
 * nedeni yazılır. Ölçülmüş sıfır ise sıfır olarak yazılır — ikisi farklı
 * bilgilerdir ve arayüzde de farklı görünmelidir.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASON,
  EMPTY,
  formatClock,
  formatCount,
  formatDecimal,
  formatDuration,
  formatMinutes,
  formatPercent,
  formatRatioAsPercent,
  formatThroughput,
  reasonFor,
  summarizeProduction,
  toKpiCards,
  toOeeCards,
} from "./format";
import type { MonitoringKpi, OeeView, ProductionStatus } from "./types";

describe("yüzde", () => {
  it("değeri biçimler", () => {
    expect(formatPercent(83.7)).toBe("%83.7");
  });

  it("ölçülmüş sıfırı yazar", () => {
    expect(formatPercent(0)).toBe("%0.0");
  });

  it("ölçülmemişi tire yapar", () => {
    expect(formatPercent(null)).toBe(EMPTY);
  });

  it("NaN'ı tire yapar", () => {
    expect(formatPercent(Number.NaN)).toBe(EMPTY);
  });

  it("oranı yüzdeye çevirir", () => {
    expect(formatRatioAsPercent(0.9)).toBe("%90.0");
  });

  it("ölçülmemiş oran tire olur", () => {
    expect(formatRatioAsPercent(null)).toBe(EMPTY);
  });
});

describe("adet ve ondalık", () => {
  it("adedi yuvarlar", () => {
    expect(formatCount(161.6)).toBe("162");
  });

  it("ölçülmüş sıfırı yazar", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("ölçülmemişi tire yapar", () => {
    expect(formatCount(null)).toBe(EMPTY);
  });

  it("ondalık biçimler", () => {
    expect(formatDecimal(3.14159, 2)).toBe("3,14");
  });

  it("ölçülmemiş ondalık tire olur", () => {
    expect(formatDecimal(null)).toBe(EMPTY);
  });
});

describe("süre", () => {
  it("bir dakikanın altı saniye yazar", () => {
    expect(formatDuration(30_000)).toBe("30 sn");
  });

  it("dakika yazar", () => {
    expect(formatDuration(600_000)).toBe("10 dk");
  });

  it("saat ve dakika yazar", () => {
    expect(formatDuration(5_400_000)).toBe("1 sa 30 dk");
  });

  it("tam saat sade yazar", () => {
    expect(formatDuration(7_200_000)).toBe("2 sa");
  });

  it("ölçülmemiş süre tire olur", () => {
    expect(formatDuration(null)).toBe(EMPTY);
  });

  it("negatif süre tire olur", () => {
    expect(formatDuration(-5)).toBe(EMPTY);
  });

  it("dakika biçimi", () => {
    expect(formatMinutes(12.5)).toBe("12,5 dk");
  });

  it("ölçülmemiş dakika tire olur", () => {
    expect(formatMinutes(null)).toBe(EMPTY);
  });
});

describe("hız", () => {
  it("saatlik çıktıyı biçimler", () => {
    expect(formatThroughput(120)).toBe("120,0 adet/sa");
  });

  it("ölçülmemiş hız tire olur", () => {
    expect(formatThroughput(null)).toBe(EMPTY);
  });
});

describe("saat", () => {
  it("epoch'u saate çevirir", () => {
    const at = new Date(2026, 8, 8, 14, 5).getTime();
    expect(formatClock(at)).toBe("14:05");
  });

  it("ölçülmemiş an tire olur", () => {
    expect(formatClock(null)).toBe(EMPTY);
  });

  it("sıfır an tire olur", () => {
    expect(formatClock(0)).toBe(EMPTY);
  });
});

describe("neden", () => {
  it("bilinen nedeni verir", () => {
    expect(reasonFor({ oee: "Kalite ölçülmedi." }, "oee")).toBe("Kalite ölçülmedi.");
  });

  it("bilinmeyen alan için varsayılan neden", () => {
    expect(reasonFor({}, "oee")).toBe(DEFAULT_REASON);
  });
});

function kpi(overrides: Partial<MonitoringKpi> = {}): MonitoringKpi {
  return {
    production: null,
    scrap: null,
    queue: null,
    throughput: null,
    availability: null,
    downtimeMinutes: null,
    activeMachines: 0,
    blockedMachines: 0,
    downMachines: 0,
    unknownMachines: 0,
    totalMachines: 0,
    measuredMachines: 0,
    alarmCount: 0,
    openAlarmCount: 0,
    reasons: {},
    ...overrides,
  };
}

describe("KPI kartları", () => {
  it("altı kart üretir", () => {
    expect(toKpiCards(kpi())).toHaveLength(6);
  });

  it("ölçülmemiş kart tire gösterir", () => {
    const cards = toKpiCards(kpi());
    expect(cards[0].value).toBe(EMPTY);
  });

  it("ölçülmemiş kart neden taşır", () => {
    const cards = toKpiCards(kpi({ reasons: { production: "Sayaç gelmedi." } }));
    expect(cards[0].reason).toBe("Sayaç gelmedi.");
  });

  it("ölçülmüş kart neden taşımaz", () => {
    const cards = toKpiCards(kpi({ production: 162 }));
    expect(cards[0].reason).toBeNull();
  });

  it("ölçülmüş kart işaretlenir", () => {
    const cards = toKpiCards(kpi({ production: 162 }));
    expect(cards[0].measured).toBe(true);
  });

  it("ölçülmüş sıfır ölçülmüş sayılır", () => {
    const cards = toKpiCards(kpi({ production: 0 }));
    expect(cards[0].measured).toBe(true);
    expect(cards[0].value).toBe("0");
  });

  it("kullanılabilirlik yüzde gösterilir", () => {
    const cards = toKpiCards(kpi({ availability: 0.9 }));
    const card = cards.find((item) => item.key === "availability");
    expect(card?.value).toBe("%90.0");
  });
});

function oee(overrides: Partial<OeeView> = {}): OeeView {
  return {
    availability: null,
    performance: null,
    quality: null,
    oee: null,
    percent: { availability: null, performance: null, quality: null, oee: null },
    reasons: {},
    complete: false,
    ...overrides,
  };
}

describe("OEE kartları", () => {
  it("dört kart üretir", () => {
    expect(toOeeCards(oee())).toHaveLength(4);
  });

  it("hesaplanamayan çarpan tire gösterir", () => {
    expect(toOeeCards(oee())[0].value).toBe(EMPTY);
  });

  it("hesaplanamayan çarpan neden taşır", () => {
    const cards = toOeeCards(oee({ reasons: { quality: "Fire ölçülmedi." } }));
    const quality = cards.find((item) => item.key === "quality");
    expect(quality?.reason).toBe("Fire ölçülmedi.");
  });

  it("hesaplanan çarpan yüzde gösterir", () => {
    const cards = toOeeCards(
      oee({ percent: { availability: 90, performance: null, quality: null, oee: null } }),
    );
    expect(cards[0].value).toBe("%90.0");
  });
});

function status(overrides: Partial<ProductionStatus> = {}): ProductionStatus {
  return {
    oee: null,
    oeePercent: null,
    oeeReasons: {},
    activeAlarms: 0,
    openAlarms: 0,
    runningMachines: 0,
    blockedMachines: 0,
    downMachines: 0,
    totalMachines: 0,
    downtimeMinutes: null,
    openDowntime: 0,
    reasons: {},
    ...overrides,
  };
}

describe("üretim özeti", () => {
  it("ölçülmemiş OEE'yi söyler", () => {
    expect(summarizeProduction(status())).toContain("OEE ölçülmedi");
  });

  it("ölçülen OEE'yi yazar", () => {
    expect(summarizeProduction(status({ oeePercent: 83.7 }))).toContain("%83.7");
  });

  it("makine sayısını yazar", () => {
    const text = summarizeProduction(status({ runningMachines: 3, totalMachines: 4 }));
    expect(text).toContain("3/4 makine");
  });

  it("alarm yoksa bunu söyler", () => {
    expect(summarizeProduction(status())).toContain("açık alarm yok");
  });

  it("alarm varsa sayısını yazar", () => {
    expect(summarizeProduction(status({ activeAlarms: 2 }))).toContain("2 alarm açık");
  });
});
