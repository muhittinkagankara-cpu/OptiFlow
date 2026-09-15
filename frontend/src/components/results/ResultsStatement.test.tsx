/**
 * Sonuç sayfasının açılış cümlesi ve köken satırı (Sprint 2G-B).
 *
 * Bu testler **gerçek `ResultsPage`'i** render eder: demo veri kümesi zaten
 * geçerli bir `SimulationRunResponse` ve `SimulationConfig` üretiyor, ayrıca
 * motorun `headline` alanını da taşıyor. Sunucu render'ında efektler
 * çalışmadığı için katlanır panellerin ağ çağrıları tetiklenmez.
 *
 * Korunan kural: cümle **seçilir, üretilmez** ve köken satırı (Sprint 2G-A)
 * yerinde kalır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoConfig, demoRun } from "../../lib/demo/dataset";
import type { SimulationRunResponse } from "../../types/simulationTypes";
import { ResultsPage } from "./ResultsPage";

const config = demoConfig();
const temelKosum = demoRun(3);

const render = (
  run: SimulationRunResponse = temelKosum,
  ranAt: string | null = null,
) =>
  renderToStaticMarkup(
    <ResultsPage
      result={run}
      config={config}
      ranAt={ranAt}
      onBackToEditor={() => {}}
      onStartOver={() => {}}
      onCompareFromHere={() => {}}
      onOpenIntelligence={() => {}}
    />,
  );

describe("açılış cümlesi (Yasa 1)", () => {
  it("motorun yazdığı cümleyi çizer", () => {
    expect(temelKosum.headline.length).toBeGreaterThan(0);
    expect(render()).toContain(temelKosum.headline);
  });

  it("sayfa adını başlık olarak kullanmaz", () => {
    // "Simülasyon sonucu" TopBar'ın zaten gösterdiği addı; en büyük yazı
    // olarak sıfır bilgi taşıyordu (ANTI-PATTERNS #21).
    const html = render();
    const baslik = html.match(/<h2[^>]*>([^<]*)<\/h2>/);
    expect(baslik?.[1]).toBe(temelKosum.headline);
  });

  it("motor cümlesi boşsa kısıt cümlesine düşer", () => {
    const html = render({ ...temelKosum, headline: "" });
    expect(html).toMatch(/<h2[^>]*>Hattınızın çıktısını .* belirliyor\.<\/h2>/);
  });

  it("motor cümlesi yalnızca boşluksa da kısıt cümlesine düşer", () => {
    const html = render({ ...temelKosum, headline: "   " });
    expect(html).toMatch(/<h2[^>]*>Hattınızın çıktısını .* belirliyor\.<\/h2>/);
  });

  it("yedeğe düşüldüğünde aynı cümle iki kez yazılmaz", () => {
    const html = render({ ...temelKosum, headline: "" });
    expect(html.match(/Hattınızın çıktısını/g)).toHaveLength(1);
  });

  it("motor cümlesi varken kısıt paragrafı olduğu gibi kalır", () => {
    const html = render();
    expect(html).toContain("Hattınızın çıktısını");
    expect(html).toContain("kapasite eklemelisiniz");
  });
});

describe("köken satırı (Sprint 2G-A) korunur", () => {
  it("benzetim etiketi hâlâ çizilir", () => {
    expect(render()).toContain("Benzetim");
  });

  it("zaman damgası verildiğinde tazelik görünür", () => {
    const html = render(temelKosum, new Date().toISOString());
    expect(html).toContain("Son koşum");
  });

  it("zaman damgası yokken saat uydurulmaz", () => {
    const html = render(temelKosum, null);
    expect(html).toContain("Benzetim");
    expect(html).not.toContain("Son koşum");
  });
});

describe("ölçümler ve dürüstlük", () => {
  it("hat OEE değeri 2G-A'dan sonra hâlâ okunur", () => {
    const html = render();
    expect(html).toContain("Hat OEE");
  });

  it("ibreli gösterge geri gelmez", () => {
    expect(render()).not.toMatch(/\sA\s[\d.]+\s[\d.]+\s0\s[01]\s[01]\s/);
  });

  it("uydurma öneri, kazanan ya da canlılık iddiası üretmez", () => {
    const metin = render().replace(/<[^>]*>/g, " ");
    expect(metin).not.toMatch(/kazanan senaryo|yapay zekâ önerisi/i);
    expect(metin).not.toMatch(/\bCanlı veri\b|\bAktif bağlantı\b/i);
  });
});

describe("kısıt şeridi ve ölçüm şeridi (Sprint 2G-C)", () => {
  it("Command Center'ın kısıt şeridini çizer", () => {
    // Ayrı bir Results sürümü yazılmadı: aynı bileşen, aynı erişilebilir ad.
    expect(render()).toContain('aria-label="Hat kısıdı"');
  });

  it("yetkili darboğaz istasyonunu kısıt olarak işaretler", () => {
    const kisit = temelKosum.results.station_metrics.find((s) => s.is_bottleneck)!;
    const html = render();
    expect(html).toContain(kisit.station_name);
    expect(html).toContain("Kısıt");
    // Tek kısıt: şerit birden fazla istasyonu kısıt gösteremez.
    expect(html.match(/>Kısıt</g)).toHaveLength(1);
  });

  it("doluluk station_metrics'ten korunur", () => {
    const kisit = temelKosum.results.station_metrics.find((s) => s.is_bottleneck)!;
    const html = render();
    // Geometri ölçülmüş doluluktan gelir.
    expect(html).toContain(`flex-grow:${kisit.utilization}`);
    expect(html).toContain(`%${Math.round(kisit.utilization * 100)}`);
  });

  it("darboğaz yoksa bir istasyon kısıt olmaya zorlanmaz", () => {
    const kisitsiz = {
      ...temelKosum,
      results: { ...temelKosum.results, bottleneck_station_id: "yok" },
    };
    const html = render(kisitsiz);
    expect(html).toContain('aria-label="Hat kısıdı"');
    expect(html).not.toContain(">Kısıt<");
  });

  it("dört ölçümü de şeritte yazar", () => {
    const html = render();
    expect(html).toContain("Beklenen üretim");
    expect(html).toContain("Hat OEE");
    expect(html).toContain("Ortalama akış süresi");
    expect(html).toContain("Ortalama WIP");
  });

  it("eski yuvarlak özet kartları artık çizilmiyor", () => {
    // SummaryCards ile MetricGroup birebir aynı dört değeri gösteriyordu.
    const html = render();
    expect(html).not.toContain("Beklenen Üretim");
    expect(html).not.toContain("%95 güven aralığı:");
  });

  it("cümle hâlâ ilk karar ifadesidir", () => {
    const html = render();
    expect(html.indexOf("<h2")).toBeLessThan(html.indexOf('aria-label="Hat kısıdı"'));
    expect(html.indexOf('aria-label="Hat kısıdı"')).toBeLessThan(
      html.indexOf("Beklenen üretim"),
    );
  });

  it("köken satırı cümleden önce gelir", () => {
    const html = render();
    expect(html.indexOf("Benzetim")).toBeLessThan(html.indexOf("<h2"));
  });
});
