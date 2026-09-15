/**
 * Finansal etki özeti testleri (Sprint 2H-B).
 *
 * Kilitlenen kural: **hesaplanamayan bir kalem asla ₺0 olarak gösterilmez** ve
 * hiçbir toplam eksik kalemin sıfırını içermez.
 */

import { describe, expect, it } from "vitest";
import type {
  FinancialReport,
  LossComponent,
} from "../../types/simulationTypes";
import {
  availableComponents,
  availableTotal,
  financialSummary,
  primaryLossComponent,
  unavailableComponents,
} from "./financialImpact";

const kalem = (
  name: string,
  amount: number,
  is_available: boolean,
  provenance: LossComponent["provenance"] = "calculated",
): LossComponent => ({
  name,
  label: name === "waiting_loss" ? "Bekleme kaybı" : `${name} etiketi`,
  amount,
  provenance,
  quantity: 1,
  quantity_unit: "saat",
  rate_name: `${name}_rate`,
  rate_value: is_available ? 100 : null,
  is_available,
  basis: is_available ? "hesaplandı" : "oran verilmedigi icin hesaplanamadi",
});

const rapor = (
  components: LossComponent[],
  ekstra: Partial<FinancialReport> = {},
): FinancialReport =>
  ({
    impact: {
      downtime_loss: 0,
      waiting_loss: 0,
      scrap_loss: 0,
      opportunity_loss: 0,
      total_loss: components.reduce((s, c) => s + c.amount, 0),
      confidence: 0.6,
      data_completeness: 0.5,
      components,
      missing_inputs: components
        .filter((c) => !c.is_available)
        .map((c) => c.rate_name),
      notes: [],
    },
    stations: [],
    suggestions: [],
    recoverable_loss: 0,
    daily_loss: null,
    window_minutes: 480,
    heat: [],
    top_loss_stations: [],
    ...ekstra,
  }) as FinancialReport;

describe("kalem ayrımı", () => {
  it("tüm kalemler hesaplanabilmişse hepsi available sayılır", () => {
    const r = rapor([kalem("a", 100, true), kalem("b", 200, true)]);
    expect(availableComponents(r)).toHaveLength(2);
    expect(unavailableComponents(r)).toHaveLength(0);
  });

  it("hiçbiri hesaplanamamışsa hiçbiri available sayılmaz", () => {
    const r = rapor([kalem("a", 0, false), kalem("b", 0, false)]);
    expect(availableComponents(r)).toHaveLength(0);
    expect(unavailableComponents(r)).toHaveLength(2);
  });

  it("kısmi durumda ikisi ayrı ayrılır", () => {
    const r = rapor([kalem("a", 100, true), kalem("b", 0, false)]);
    expect(availableComponents(r)).toHaveLength(1);
    expect(unavailableComponents(r)).toHaveLength(1);
  });
});

describe("toplam yalnızca hesaplanabilmiş kalemlerden kurulur", () => {
  it("eksik kalemin sıfırı toplama katılmaz", () => {
    const r = rapor([kalem("a", 1000, true), kalem("b", 0, false)]);
    expect(availableTotal(r)).toBe(1000);
  });

  it("hiç hesaplanabilmiş kalem yoksa toplam sıfırdır ama gösterilmez", () => {
    const r = rapor([kalem("a", 0, false)]);
    expect(availableTotal(r)).toBe(0);
    expect(financialSummary(r)!.hasAmounts).toBe(false);
  });
});

describe("baskın kayıp kaynağı", () => {
  it("en büyük hesaplanabilmiş kalem seçilir", () => {
    const r = rapor([
      kalem("a", 100, true),
      kalem("waiting_loss", 900, true),
      kalem("c", 500, true),
    ]);
    expect(primaryLossComponent(r)!.name).toBe("waiting_loss");
  });

  it("hesaplanamayan kalem, tutarı büyük olsa bile seçilmez", () => {
    // Eksik kalemin tutarı zaten 0'dır; yine de açıkça sınanır.
    const r = rapor([kalem("a", 100, true), kalem("b", 9999, false)]);
    expect(primaryLossComponent(r)!.name).toBe("a");
  });

  it("hiç hesaplanabilmiş kalem yoksa null döner", () => {
    expect(primaryLossComponent(rapor([kalem("a", 0, false)]))).toBeNull();
  });
});

describe("özet — hesaplanabilmiş durum", () => {
  it("günlük üretim süresi verilmişse günlük projeksiyon anlatılır", () => {
    const r = rapor([kalem("a", 1000, true)], { daily_loss: 5000 });
    const s = financialSummary(r)!;
    expect(s.headline).toContain("Günde yaklaşık");
    expect(s.headline).toContain("5.000");
  });

  it("günlük süre yoksa ölçüm penceresi anlatılır — aylık denmez", () => {
    // Backend aylık bir büyüklük üretmiyor; desteklenmeyen zaman tabanı
    // adlandırılmaz.
    const s = financialSummary(rapor([kalem("a", 1000, true)]))!;
    expect(s.headline).toContain("480 dakikalık pencerede");
    expect(s.headline).not.toMatch(/ayl[ıi]k/i);
  });

  it("baskın kaynak etiketi, tutarı ve kaynağıyla taşınır", () => {
    const r = rapor([kalem("waiting_loss", 900, true, "estimated")]);
    const s = financialSummary(r)!;
    expect(s.primarySource!.label).toBe("Bekleme kaybı");
    expect(s.primarySource!.amount).toContain("900");
    expect(s.primarySource!.provenance).toBe("estimated");
  });
});

describe("özet — hesaplanamayan durum", () => {
  it("sıfır TL yerine hesaplanamadığı söylenir", () => {
    const s = financialSummary(rapor([kalem("a", 0, false)]))!;
    expect(s.headline).toBe("Finansal etki hesaplanamadı.");
    expect(s.headline).not.toMatch(/₺/);
    expect(s.primarySource).toBeNull();
  });

  it("eksik girdiler gerçek adlarıyla bildirilir", () => {
    const r = rapor([kalem("a", 0, false)], {
      impact: {
        ...rapor([kalem("a", 0, false)]).impact,
        missing_inputs: ["machine_cost_per_hour"],
      },
    } as Partial<FinancialReport>);
    expect(financialSummary(r)!.missingNote).toContain(
      "Saatlik makine maliyeti",
    );
  });
});

describe("özet — kısmi durum", () => {
  it("hesaplanabilmiş kalemler gösterilir, eksikler sayılır", () => {
    const r = rapor([
      kalem("a", 1000, true),
      kalem("b", 0, false),
      kalem("c", 0, false),
    ]);
    const s = financialSummary(r)!;
    expect(s.hasAmounts).toBe(true);
    expect(s.availableCount).toBe(1);
    expect(s.unavailableCount).toBe(2);
    expect(s.missingNote).toContain("2 kayıp kalemi");
  });

  it("eksik yoksa açıklama satırı hiç kurulmaz", () => {
    const s = financialSummary(rapor([kalem("a", 1000, true)]))!;
    expect(s.missingNote).toBeNull();
  });
});

describe("rapor yokken hiçbir şey uydurulmaz", () => {
  it("null rapor null özet verir", () => {
    expect(financialSummary(null)).toBeNull();
  });
});
