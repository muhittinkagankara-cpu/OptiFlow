import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_LABEL,
  DEFAULT_ROWS,
  MAX_ROWS,
  MIN_ROWS,
  STATE_COLOR_VAR,
  STATE_DOT_CLASS,
  STATE_RULE_CLASS,
  clampRows,
  isVerifiedLive,
  needsAttention,
  normalizeDetail,
  originPresentation,
  retryLabel,
  skeletonBars,
  skeletonLabel,
} from "./index";
import type { DataOrigin, MeasuredState, SkeletonShape } from "./index";

const STATES: MeasuredState[] = ["ok", "warn", "fault", "unknown"];
const SHAPES: SkeletonShape[] = ["text", "metric", "table", "chart"];
const ORIGINS: DataOrigin[] = ["live", "simulated", "unverified"];

describe("iskelet geometrisi", () => {
  it("her biçim için çubuk üretir", () => {
    for (const shape of SHAPES) {
      expect(skeletonBars(shape).length).toBeGreaterThan(0);
    }
  });

  it("satır sayısı verilmezse biçimin varsayılanını kullanır", () => {
    expect(skeletonBars("table")).toHaveLength(DEFAULT_ROWS.table);
    expect(skeletonBars("text")).toHaveLength(DEFAULT_ROWS.text);
  });

  it("metin bloğunun son satırı kısadır", () => {
    const bars = skeletonBars("text", 3);
    expect(bars[0].widthPercent).toBe(100);
    expect(bars[2].widthPercent).toBeLessThan(100);
  });

  it("tek satırlık metinde kısaltma yapmaz", () => {
    // Tek satır zaten paragraf değildir; kısaltmak onu bozuk gösterirdi.
    expect(skeletonBars("text", 1)[0].widthPercent).toBe(100);
  });

  it("her metrik bir etiket ve bir değer çubuğu üretir", () => {
    const bars = skeletonBars("metric", 2);
    expect(bars).toHaveLength(4);
    // Değer çubuğu etiketten yüksektir; ölçüm etiketten büyük yazılır.
    expect(bars[1].heightPx).toBeGreaterThan(bars[0].heightPx);
  });

  it("tablo satırları eşit ölçüdedir", () => {
    const bars = skeletonBars("table", 4);
    expect(new Set(bars.map((bar) => bar.heightPx)).size).toBe(1);
    expect(new Set(bars.map((bar) => bar.widthPercent)).size).toBe(1);
  });

  it("satır sayısını kabul edilen aralığa sıkıştırır", () => {
    expect(clampRows(0)).toBe(MIN_ROWS);
    expect(clampRows(-5)).toBe(MIN_ROWS);
    expect(clampRows(999)).toBe(MAX_ROWS);
    expect(clampRows(Number.NaN)).toBe(MIN_ROWS);
    expect(clampRows(3.4)).toBe(3);
  });

  it("her biçimin ekran okuyucu metni vardır ve boş değildir", () => {
    for (const shape of SHAPES) {
      expect(skeletonLabel(shape).length).toBeGreaterThan(0);
    }
  });

  it("ekran okuyucu metni neyin yüklendiğini söyler", () => {
    // "Yükleniyor" tek başına yetersizdir; biçim adı geçmelidir.
    expect(skeletonLabel("table")).toContain("Tablo");
    expect(skeletonLabel("chart")).toContain("Grafik");
  });
});

describe("durum sözlüğü", () => {
  it("dört durumun da rengi, kelepçesi ve noktası tanımlıdır", () => {
    for (const state of STATES) {
      expect(STATE_COLOR_VAR[state]).toMatch(/^--of-semantic-/);
      expect(STATE_RULE_CLASS[state]).toContain("border-l-[var(--of-semantic-");
      expect(STATE_DOT_CLASS[state]).toContain("bg-[var(--of-semantic-");
    }
  });

  it("ölçülmemiş durum arıza rengini kullanmaz", () => {
    // Ürünün en önemli görsel kuralı: gri "ölçmedik", kırmızı "ölçtük, kötü".
    expect(STATE_COLOR_VAR.unknown).toBe("--of-semantic-unknown");
    expect(STATE_COLOR_VAR.unknown).not.toBe(STATE_COLOR_VAR.fault);
  });

  it("ölçülmemiş durum ilgi istemez", () => {
    expect(needsAttention("unknown")).toBe(false);
    expect(needsAttention("ok")).toBe(false);
    expect(needsAttention("warn")).toBe(true);
    expect(needsAttention("fault")).toBe(true);
  });
});

describe("veri kökeni", () => {
  it("üç kökenin de etiketi ve açıklaması vardır", () => {
    for (const origin of ORIGINS) {
      const presentation = originPresentation(origin);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.description.length).toBeGreaterThan(0);
    }
  });

  it("doğrulanmamış bağlantı arıza olarak gösterilmez", () => {
    // Kırmızı "denedik, olmadı" demektir; denenmemiş bağlantı nötrdür.
    expect(originPresentation("unverified").state).toBe("unknown");
  });

  it("benzetim gerçek veri gibi gösterilmez", () => {
    const simulated = originPresentation("simulated");
    expect(simulated.state).not.toBe("ok");
    expect(simulated.label).toBe("Benzetim");
  });

  it("yalnızca doğrulanmış canlı veri 'Canlı' sayılır", () => {
    expect(isVerifiedLive("live")).toBe(true);
    expect(isVerifiedLive("simulated")).toBe(false);
    expect(isVerifiedLive("unverified")).toBe(false);
  });
});

describe("hata durumu metinleri", () => {
  it("boş teknik ayrıntı null döner", () => {
    expect(normalizeDetail(undefined)).toBeNull();
    expect(normalizeDetail(null)).toBeNull();
    expect(normalizeDetail("")).toBeNull();
    expect(normalizeDetail("   \n ")).toBeNull();
  });

  it("dolu teknik ayrıntı kırpılarak döner", () => {
    expect(normalizeDetail("  HTTP 500  ")).toBe("HTTP 500");
  });

  it("tekrar-dene metni verilmezse varsayılana düşer", () => {
    expect(retryLabel()).toBe(DEFAULT_RETRY_LABEL);
    expect(retryLabel("   ")).toBe(DEFAULT_RETRY_LABEL);
    expect(retryLabel("Tekrar bağlan")).toBe("Tekrar bağlan");
  });
});
