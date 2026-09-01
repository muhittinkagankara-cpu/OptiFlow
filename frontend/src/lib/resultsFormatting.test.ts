/**
 * Sonuç yorumlama mantığının birim testleri.
 *
 * Buradaki üç şey, yanlış olduğunda kullanıcıyı **yanlış karara** götürür ve
 * hiçbir görsel belirti vermez:
 *
 * 1. Uyarı sınıflandırması — "kapasite sınırlı" ile "kararsız" karışırsa,
 *    geçerli bir sonuç güvenilmez sanılır ya da anlamsız sayılar güvenilir.
 * 2. Fark yönü — akış süresindeki düşüş "kötüleşme" gösterilirse, kullanıcı
 *    doğru iyileştirmeden vazgeçer.
 * 3. Anlamlılık — rastgelelikle açıklanabilen bir fark "iyileşme" gösterilirse,
 *    kullanıcı hiçbir şey değiştirmeyen bir yatırıma girişir.
 *
 * Uyarı metinleri backend'in gerçekten ürettiği çıktılardan alınmıştır.
 */

import { describe, expect, it } from "vitest";
import {
  classifyWarning,
  differenceVerdict,
  explainInapplicableComparison,
  formatDecimal,
  formatMinutes,
  formatPercent,
  formatUnits,
  higherIsBetter,
  oeeTone,
  utilizationTone,
  verdictColor,
  verdictLabel,
  metricLabel,
  metricShortLabel,
  formatMetricValue,
  CHART_COLORS,
  OEE_GOOD_THRESHOLD,
  OEE_WARNING_THRESHOLD,
} from "./resultsFormatting";
import type { PairwiseDifference } from "../types/simulationTypes";

// --------------------------------------------------------------------------- //
// 1. Uyarı sınıflandırması (kabul kriteri 3)
// --------------------------------------------------------------------------- //

const UNSTABLE_WARNING =
  "KARARSIZ SISTEM: 'S' (Istasyon) istasyonunun teorik yuku rho = 1.2000 >= 1. " +
  "Bu istasyona gelen is, islenebilecegi hizdan fazla; kuyruk sinirsiz buyuyecek " +
  "ve ortalama bekleme suresi hicbir degere yakinsamayacaktir.";

const CAPACITY_WARNING =
  "KAPASITE SINIRLI: 'S' (Istasyon) istasyonunun teorik yuku rho = 1.2000 >= 1, " +
  "ancak sistemdeki azami parca sayisi 5 ile sinirli (tampon 4 + 1 sunucu). " +
  "Kuyruk sinirsiz buyuyemez; sistem KARARLIDIR ve kararli duruma yakinsar. " +
  "M/M/1/K yaklasimiyla gelen parcalarin yaklasik %25.1'i sisteme alinamayacak.";

describe("classifyWarning — kararsız vs kapasite sınırlı", () => {
  it("kararsız uyarısını doğru sınıflandırır", () => {
    const classified = classifyWarning(UNSTABLE_WARNING);
    expect(classified.kind).toBe("unstable");
    expect(classified.tone).toBe("bad");
    expect(classified.title).toContain("sınırsız büyüyecek");
    expect(classified.message).toContain("karar vermeyin");
  });

  it("kapasite sınırlı uyarısını doğru sınıflandırır", () => {
    const classified = classifyWarning(CAPACITY_WARNING);
    expect(classified.kind).toBe("capacity_limited");
    expect(classified.tone).toBe("warning");
    expect(classified.title).toContain("kararlı");
    expect(classified.message).toContain("%25.1");
    expect(classified.message).toContain("Sonuçlar geçerlidir");
  });

  it("iki uyarı türü asla aynı görünmez", () => {
    // Kabul kriteri 3: bu ikisinin karışması, önceki backend düzeltmesinin
    // tüm anlamını yok ederdi.
    const unstable = classifyWarning(UNSTABLE_WARNING);
    const capacity = classifyWarning(CAPACITY_WARNING);

    expect(unstable.kind).not.toBe(capacity.kind);
    expect(unstable.tone).not.toBe(capacity.tone);
    expect(unstable.title).not.toBe(capacity.title);
  });

  it("her iki uyarıda da teknik terim sızmaz", () => {
    for (const raw of [UNSTABLE_WARNING, CAPACITY_WARNING]) {
      const classified = classifyWarning(raw);
      for (const leak of ["rho", "M/M/1/K", "KARARSIZ", "KAPASITE SINIRLI"]) {
        expect(classified.title).not.toContain(leak);
        expect(classified.message).not.toContain(leak);
      }
    }
  });

  it("kesinlik uyarısını ayrı sınıflandırır", () => {
    const classified = classifyWarning(
      "Yalnizca 5 replikasyon calistirildi; onerilen asgari 30.",
    );
    expect(classified.kind).toBe("precision");
    expect(classified.tone).toBe("neutral");
  });

  it("tanımadığı uyarıyı yutmaz, olduğu gibi taşır", () => {
    const unknown = "Beklenmedik bir durum olustu.";
    const classified = classifyWarning(unknown);
    expect(classified.kind).toBe("other");
    expect(classified.message).toBe(unknown);
  });
});

// --------------------------------------------------------------------------- //
// 2. Fark yönü ve anlamlılık (kabul kriteri 4)
// --------------------------------------------------------------------------- //

function difference(overrides: Partial<PairwiseDifference>): PairwiseDifference {
  return {
    baseline_index: 0,
    candidate_index: 1,
    metric: "units_produced",
    label: "Toplam uretim (iyi urun)",
    baseline_mean: 1000,
    candidate_mean: 1100,
    difference: 100,
    difference_pct: 10,
    ci_lower: 50,
    ci_upper: 150,
    is_significant: true,
    interpretation: "",
    ...overrides,
  };
}

describe("higherIsBetter — metrik yönü", () => {
  it("üretimde yüksek iyidir", () => {
    expect(higherIsBetter("units_produced")).toBe(true);
  });

  it("akış süresi ve WIP'te düşük iyidir", () => {
    expect(higherIsBetter("avg_flow_time")).toBe(false);
    expect(higherIsBetter("avg_wip")).toBe(false);
  });
});

describe("differenceVerdict", () => {
  it("üretim artışı iyileşmedir", () => {
    expect(differenceVerdict(difference({ difference: 120 }))).toBe("improvement");
  });

  it("üretim düşüşü kötüleşmedir", () => {
    expect(
      differenceVerdict(difference({ difference: -120, ci_lower: -180, ci_upper: -60 })),
    ).toBe("regression");
  });

  it("akış süresindeki DÜŞÜŞ iyileşmedir", () => {
    // Yön eşlemesi ters olsaydı, hattı hızlandıran bir değişiklik kullanıcıya
    // "kötüleşme" olarak gösterilirdi.
    const verdict = differenceVerdict(
      difference({
        metric: "avg_flow_time",
        difference: -6.9,
        ci_lower: -7.3,
        ci_upper: -6.5,
      }),
    );
    expect(verdict).toBe("improvement");
  });

  it("akış süresindeki ARTIŞ kötüleşmedir", () => {
    const verdict = differenceVerdict(
      difference({
        metric: "avg_flow_time",
        difference: 4.2,
        ci_lower: 3.8,
        ci_upper: 4.6,
      }),
    );
    expect(verdict).toBe("regression");
  });

  it("WIP düşüşü iyileşmedir", () => {
    expect(
      differenceVerdict(
        difference({ metric: "avg_wip", difference: -4.6, ci_lower: -4.9, ci_upper: -4.3 }),
      ),
    ).toBe("improvement");
  });

  it("anlamlılık her zaman yöne baskındır", () => {
    // Büyük görünen ama güven aralığı sıfırı içeren bir fark, yönü ne olursa
    // olsun "fark yok" olmalıdır.
    for (const metric of ["units_produced", "avg_flow_time", "avg_wip"]) {
      const positive = differenceVerdict(
        difference({ metric, difference: 500, is_significant: false }),
      );
      const negative = differenceVerdict(
        difference({ metric, difference: -500, is_significant: false }),
      );
      expect(positive).toBe("insignificant");
      expect(negative).toBe("insignificant");
    }
  });

  it("sıfırı içeren aralıkta anlamsızdır", () => {
    const verdict = differenceVerdict(
      difference({ difference: 2.7, ci_lower: -64.8, ci_upper: 70.3, is_significant: false }),
    );
    expect(verdict).toBe("insignificant");
  });
});

describe("verdictLabel ve verdictColor", () => {
  it("anlamsız fark net biçimde 'fark yok' der", () => {
    expect(verdictLabel("insignificant")).toBe("Fark yok");
    expect(verdictColor("insignificant")).toBe(CHART_COLORS.neutral);
  });

  it("iyileşme ve kötüleşme farklı renk alır", () => {
    expect(verdictColor("improvement")).toBe(CHART_COLORS.improvement);
    expect(verdictColor("regression")).toBe(CHART_COLORS.regression);
    expect(verdictColor("improvement")).not.toBe(verdictColor("regression"));
  });

  it("üç kararın da rengi birbirinden farklıdır", () => {
    const colors = new Set([
      verdictColor("improvement"),
      verdictColor("regression"),
      verdictColor("insignificant"),
    ]);
    expect(colors.size).toBe(3);
  });
});

// --------------------------------------------------------------------------- //
// 3. Renk eşikleri
// --------------------------------------------------------------------------- //

describe("oeeTone — şartnamedeki eşikler", () => {
  it.each([
    [0.85, "good"],
    [0.71, "good"],
    [0.7, "warning"],
    [0.6, "warning"],
    [0.5, "warning"],
    [0.49, "bad"],
    [0.2, "bad"],
  ])("OEE %s -> %s", (value, expected) => {
    expect(oeeTone(value as number)).toBe(expected);
  });

  it("eşik sabitleri şartnameyle uyumlu", () => {
    expect(OEE_GOOD_THRESHOLD).toBe(0.7);
    expect(OEE_WARNING_THRESHOLD).toBe(0.5);
  });

  it("geçersiz değerde nötr döner", () => {
    expect(oeeTone(Number.NaN)).toBe("neutral");
  });
});

describe("utilizationTone", () => {
  it("darboğaz her zaman kırmızıdır, doluluk düşük olsa bile", () => {
    // Backend'in bottleneck_station_id alanı otoritedir; düşük görünen bir
    // kullanım oranı darboğaz olmadığı anlamına gelmez (blokaj nedeniyle).
    expect(utilizationTone(0.35, true)).toBe("bad");
  });

  it("yoğun ama darboğaz olmayan istasyon uyarı rengi alır", () => {
    expect(utilizationTone(0.85, false)).toBe("warning");
  });

  it("rahat istasyon yeşildir", () => {
    expect(utilizationTone(0.4, false)).toBe("good");
  });
});

// --------------------------------------------------------------------------- //
// 4. Biçimlendirme ve açıklama
// --------------------------------------------------------------------------- //

describe("biçimlendirme yardımcıları", () => {
  it("binlik ayraç kullanır", () => {
    expect(formatUnits(17749)).toBe("17.749");
  });

  it("geçersiz değerde tire gösterir", () => {
    expect(formatUnits(Number.NaN)).toBe("—");
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatDecimal(Number.NaN)).toBe("—");
  });

  it("süre ve yüzde biçimleri beklendiği gibi", () => {
    expect(formatMinutes(18.94)).toBe("18.9 dk");
    expect(formatPercent(0.7843)).toBe("%78");
    expect(formatPercent(0.7843, 1)).toBe("%78.4");
    expect(formatDecimal(3.2548)).toBe("3.3");
  });
});

describe("explainInapplicableComparison", () => {
  it("üstel olmayan süre gerekçesini çevirir", () => {
    const text = explainInapplicableComparison(
      "Kapali form M/M/c modeli uygulanamaz: islem suresi ustel degil.",
    );
    expect(text).toContain("işlem süreleri");
    expect(text).not.toContain("M/M/c");
    expect(text).toContain("sorun değildir");
  });

  it("birden çok gerekçeyi birleştirir", () => {
    const text = explainInapplicableComparison(
      "Kapali form M/M/c modeli uygulanamaz: istasyonda ariza modeli var, tampon sonlu (M/M/c/K).",
    );
    expect(text).toContain("arıza modeli");
    expect(text).toContain("bekleme alanı");
  });

  it("birden çok istasyonun gerekçelerini toplar", () => {
    // Yalnızca ilk istasyonun gerekçesini göstermek, o gerekçeyi tüm
    // istasyonlara aitmiş gibi sunardı; nedenler birleştirilmeli.
    const text = explainInapplicableComparison([
      "Kapali form M/M/c modeli uygulanamaz: islem suresi ustel degil.",
      "Kapali form M/M/c modeli uygulanamaz: istasyonda ariza modeli var, tampon sonlu (M/M/c/K).",
    ]);
    expect(text).toContain("işlem süreleri");
    expect(text).toContain("arıza modeli");
    expect(text).toContain("bekleme alanı");
    expect(text).toContain("İstasyonlarınız");
  });

  it("tek istasyonda tekil dil kullanır", () => {
    const text = explainInapplicableComparison([
      "Kapali form M/M/c modeli uygulanamaz: islem suresi ustel degil.",
    ]);
    expect(text).toContain("Bu istasyon");
  });

  it("tanımadığı gerekçede bile güven verici bir mesaj döner", () => {
    const text = explainInapplicableComparison("Bilinmeyen gerekce");
    expect(text).toContain("iç tutarlılık");
    expect(text).not.toContain("Bilinmeyen gerekce");
  });
});

// --------------------------------------------------------------------------- //
// 5. Metrik adları ve birimleri
// --------------------------------------------------------------------------- //

describe("metrik adları — ham backend metni sızmamalı", () => {
  const BACKEND_LABELS: Array<[string, string]> = [
    ["units_produced", "Toplam uretim (iyi urun)"],
    ["avg_flow_time", "Ortalama akis suresi (W)"],
    ["avg_wip", "Ortalama WIP (L)"],
  ];

  it.each(BACKEND_LABELS)("%s için Türkçe ad kullanılır", (metric, backendLabel) => {
    const label = metricLabel(metric, backendLabel);
    expect(label).not.toBe(backendLabel);
    // Kuyruk teorisi simgeleri ve aksansız yazım kullanıcıya gösterilmemeli.
    for (const leak of ["(W)", "(L)", "akis", "uretim (", "WIP"]) {
      expect(label).not.toContain(leak);
    }
  });

  it("tanınmayan metrikte backend etiketine düşer", () => {
    expect(metricLabel("bilinmeyen_metrik", "Yedek Ad")).toBe("Yedek Ad");
    expect(metricShortLabel("bilinmeyen_metrik", "Yedek Ad")).toBe("Yedek Ad");
  });

  it("kısa adlar grafik için ayrı tutulur", () => {
    expect(metricShortLabel("avg_flow_time", "x")).toBe("Akış süresi");
    expect(metricLabel("avg_flow_time", "x")).toBe("Ortalama akış süresi");
  });
});

describe("formatMetricValue — metriğe göre birim", () => {
  it("üretimi binlik ayraçlı ve birimli gösterir", () => {
    expect(formatMetricValue("units_produced", 4850.43)).toBe("4.850 birim");
  });

  it("akış süresini dakikayla gösterir", () => {
    expect(formatMetricValue("avg_flow_time", 11.86)).toBe("11.9 dk");
  });

  it("stok gibi birimsiz değerleri ondalıklı gösterir", () => {
    expect(formatMetricValue("avg_wip", 6.2543)).toBe("6.25");
  });
});
