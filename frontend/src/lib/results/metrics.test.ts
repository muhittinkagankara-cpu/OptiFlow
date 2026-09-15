/**
 * Sonuç sayfası ölçüm eşlemesi (Sprint 2G-C).
 *
 * Korunan kural: değerler **taşınır, üretilmez**. Ölçülemeyen bir alan "—"ye
 * düşer, sıfıra değil; sonucu olmayan metriğe sonuç uydurulmaz.
 */

import { describe, expect, it } from "vitest";
import type { SimulationResults } from "../../types/simulationTypes";
import { resultsMetrics } from "./metrics";

const sonuc = {
  total_throughput: 778,
  confidence_interval_95: [755, 801],
  station_metrics: [
    {
      station_id: "s1",
      station_name: "Kesme",
      utilization: 0.61,
      avg_queue_length: 0.4,
      avg_wait_time: 0.8,
      oee: { availability: 0.9, performance: 0.9, quality: 0.99, oee: 0.8 },
      is_bottleneck: false,
      flow: { entered: 800, processed: 790, scrapped: 6, rejected: 4 },
    },
    {
      station_id: "s2",
      station_name: "Torna",
      utilization: 0.96,
      avg_queue_length: 5.2,
      avg_wait_time: 4.1,
      oee: { availability: 0.9, performance: 0.8, quality: 0.99, oee: 0.71 },
      is_bottleneck: true,
      flow: { entered: 790, processed: 778, scrapped: 8, rejected: 4 },
    },
  ],
  bottleneck_station_id: "s2",
  littles_law_validation: {
    passed: true,
    deviation_pct: 1.2,
    tolerance_pct: 5,
    replications_checked: 30,
    replications_passed: 30,
  },
  num_replications: 30,
  is_stable: true,
  avg_wip: 8.5,
  avg_flow_time: 5.3,
  throughput_per_minute: 1.6,
  line_oee: 0.744,
  theoretical_max_throughput_per_minute: 2.1,
} as unknown as SimulationResults;

const bul = (id: string, r = sonuc) =>
  resultsMetrics(r).find((m) => m.id === id)!;

describe("ölçüm şeridi — dört çekirdek değer", () => {
  it("dört metriği bu sırayla üretir", () => {
    expect(resultsMetrics(sonuc).map((m) => m.id)).toEqual([
      "throughput",
      "oee",
      "flow",
      "wip",
    ]);
  });

  it("beklenen üretimi ve birimini taşır", () => {
    expect(bul("throughput").value).toBe("778 birim");
  });

  it("hat OEE değeri 2G-A'dakiyle aynı kalır", () => {
    // 2G-A'da gauge yerine yazılan değerle birebir aynı biçimlendirme.
    expect(bul("oee").value).toBe("%74");
  });

  it("akış süresi ve WIP taşınır", () => {
    expect(bul("flow").value).toBe("5.3 dk");
    expect(bul("wip").value).toBe("8.5 parça");
  });
});

describe("sonuçlar (Yasa 2)", () => {
  it("üretim, ölçülmüş güven aralığını taşır", () => {
    expect(bul("throughput").consequence).toBe("%95 aralık 755 – 801");
  });

  it("OEE, kısıt istasyonunu ve doluluğunu taşır", () => {
    expect(bul("oee").consequence).toBe("Kısıt Torna · %96 dolu");
  });

  it("kısıt, bottleneck_station_id üzerinden bulunur — yeniden hesaplanmaz", () => {
    const baskaKisit = { ...sonuc, bottleneck_station_id: "s1" } as SimulationResults;
    expect(bul("oee", baskaKisit).consequence).toBe("Kısıt Kesme · %61 dolu");
  });

  it("akış süresi ve WIP için sonuç uydurulmaz", () => {
    // Koşum yanıtında bu ikisi için sonuç niteliğinde ölçülmüş alan yok.
    expect(bul("flow").consequence).toBeNull();
    expect(bul("wip").consequence).toBeNull();
  });
});

describe("ölçülemeyen değer uydurulmaz (Yasa 4)", () => {
  it("geçersiz üretim sıfıra düşmez, null olur", () => {
    const bozuk = { ...sonuc, total_throughput: Number.NaN } as SimulationResults;
    expect(bul("throughput", bozuk).value).toBeNull();
  });

  it("geçersiz OEE null olur", () => {
    const bozuk = { ...sonuc, line_oee: Number.NaN } as SimulationResults;
    expect(bul("oee", bozuk).value).toBeNull();
  });

  it("ölçülemeyen güven aralığı yazılmaz", () => {
    const bozuk = {
      ...sonuc,
      confidence_interval_95: [Number.NaN, 801],
    } as unknown as SimulationResults;
    expect(bul("throughput", bozuk).consequence).toBeNull();
  });

  it("darboğaz eşleşmiyorsa istasyon uydurulmaz", () => {
    const eşleşmeyen = {
      ...sonuc,
      bottleneck_station_id: "yok",
    } as SimulationResults;
    expect(bul("oee", eşleşmeyen).consequence).toBeNull();
  });
});

describe("kapsam dışı iddia üretmez", () => {
  it("öneri, kazanan ya da para dili yoktur", () => {
    const metin = resultsMetrics(sonuc)
      .map((m) => `${m.label} ${m.value ?? ""} ${m.consequence ?? ""}`)
      .join(" ");
    expect(metin).not.toMatch(/₺|öner|kazanan|tavsiye|yapay zekâ/i);
  });
});

/* ===================================================================== *
 * Sprint 2H-D — akış süresi ve WIP güven aralıkları
 *
 * Önce karakterizasyon: değişmemesi gereken ne varsa burada kilitlenir.
 * Aralıklar backend'de hesaplanır (`3f1999f`); burada tek satır aritmetik
 * yoktur, gelen iki sınır biçimlendirilip yazılır.
 * ===================================================================== */

describe("2H-D öncesi davranış korunur", () => {
  it("ana değerler aralık eklendikten sonra da aynı kalır", () => {
    const aralikli = {
      ...sonuc,
      avg_flow_time_ci_95: [4.86, 5.23],
      avg_wip_ci_95: [8.21, 8.79],
    } as unknown as SimulationResults;
    expect(bul("flow", aralikli).value).toBe("5.3 dk");
    expect(bul("wip", aralikli).value).toBe("8.5 parça");
  });

  it("dört metrik ve sıraları değişmez", () => {
    expect(resultsMetrics(sonuc).map((m) => m.id)).toEqual([
      "throughput",
      "oee",
      "flow",
      "wip",
    ]);
  });

  it("üretim aralığı eski biçimini korur", () => {
    expect(bul("throughput").consequence).toBe("%95 aralık 755 – 801");
  });
});

describe("akış süresi güven aralığı (Yasa 2)", () => {
  const aralikli = (patch: Partial<Record<string, unknown>> = {}) =>
    ({
      ...sonuc,
      avg_flow_time_ci_95: [4.86, 5.23],
      avg_wip_ci_95: [8.21, 8.79],
      ...patch,
    }) as unknown as SimulationResults;

  it("aralık ikinci satır olarak taşınır", () => {
    expect(bul("flow", aralikli()).consequence).toBe("%95 aralık 4.86 – 5.23 dk");
  });

  it("WIP aralığı kendi birimiyle yazılır", () => {
    expect(bul("wip", aralikli()).consequence).toBe(
      "%95 aralık 8.21 – 8.79 parça",
    );
  });

  it("aralık gelmezse sonuç uydurulmaz", () => {
    // Eski koşumlar ve demo kümesi bu alanları taşımıyor; satır yazılmaz.
    expect(bul("flow").consequence).toBeNull();
    expect(bul("wip").consequence).toBeNull();
  });

  it("sınırlardan biri ölçülemiyorsa satır yazılmaz", () => {
    const bozuk = aralikli({ avg_flow_time_ci_95: [Number.NaN, 5.23] });
    expect(bul("flow", bozuk).consequence).toBeNull();
  });

  it("aralık dizi değilse satır yazılmaz", () => {
    const bozuk = aralikli({ avg_wip_ci_95: null });
    expect(bul("wip", bozuk).consequence).toBeNull();
  });

  it("değer ölçülemezse aralık da gösterilmez", () => {
    const bozuk = aralikli({ avg_flow_time: Number.NaN });
    expect(bul("flow", bozuk).value).toBeNull();
  });
});
