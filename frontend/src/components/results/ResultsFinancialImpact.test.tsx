/**
 * Sonuç sayfasının finansal etki yüzeyi (Sprint 2H-B).
 *
 * Karar zinciri şudur: SONUÇ → KISIT → ÖLÇÜM → FİNANSAL ETKİ → AKSİYON.
 * Bu testler yüzeyin zincirdeki yerini, hesaplanamayan kalemin **asla ₺0
 * olarak yazılmadığını** ve zincirin geri kalanının bozulmadığını kilitler.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoConfig, demoRun } from "../../lib/demo/dataset";
import type {
  FinancialReport,
  LossComponent,
} from "../../types/simulationTypes";
import { ResultsPage } from "./ResultsPage";

const config = demoConfig();
const kosum = demoRun(3);

const kalem = (
  name: string,
  label: string,
  amount: number,
  is_available: boolean,
  provenance: LossComponent["provenance"] = "calculated",
): LossComponent => ({
  name,
  label,
  amount,
  provenance,
  quantity: 12,
  quantity_unit: "saat",
  rate_name: `${name}_rate`,
  rate_value: is_available ? 250 : null,
  is_available,
  basis: is_available ? "hesaplandı" : "oran verilmedi",
});

const rapor = (
  components: LossComponent[],
  ekstra: Partial<FinancialReport> = {},
): FinancialReport => ({
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
});

const render = (financeReport: FinancialReport | null) =>
  renderToStaticMarkup(
    <ResultsPage
      result={kosum}
      config={config}
      ranAt={null}
      onBackToEditor={() => {}}
      onCompareFromHere={() => {}}
      onOpenIntelligence={() => {}}
      financeSettings={{}}
      onFinanceSettingsChange={() => {}}
      financeReport={financeReport}
      onFinanceReportChange={() => {}}
    />,
  );

/**
 * Yalnızca karar zincirindeki finansal bölümü keser — aşağıdaki
 * `FinancialImpactPanel` değil. İki yüzey aynı sözcükleri kullandığı için
 * ("kayıp", "Bekleme kaybı") kesmeden yapılan bir eşleşme yanlış yerde
 * doğrulama yapardı.
 *
 * Etiket büyük harfe CSS ile çevrildiğinden kaynakta "Finansal etki" yazar.
 */
const bolum = (html: string): string => {
  const bas = html.indexOf("Finansal etki</h2>");
  expect(bas).toBeGreaterThan(-1);
  const son = html.indexOf("</section>", bas);
  expect(son).toBeGreaterThan(bas);
  return html.slice(bas, son);
};

describe("rapor yokken yüzey çizilmez", () => {
  it("hesaplanmamış bir etki için yer ayrılmaz", () => {
    const html = render(null);
    expect(html).not.toContain("Finansal etki</h2>");
  });

  it("zincirin geri kalanı yine de tamdır", () => {
    const html = render(null);
    expect(html).toContain(kosum.headline); // SONUÇ
    expect(html).toContain("Kısıt"); // KISIT şeridi
    expect(html).toContain("Sonraki adım"); // AKSİYON
  });
});

describe("tüm kalemler hesaplanabildiğinde", () => {
  it("ölçüm penceresiyle birlikte tutar yazılır", () => {
    const html = bolum(
      render(
        rapor([
          kalem("waiting_loss", "Bekleme kaybı", 9000, true),
          kalem("scrap_loss", "Hurda kaybı", 3000, true),
        ]),
      ),
    );
    expect(html).toContain("480 dakikalık pencerede");
    expect(html).toContain("12.000");
  });

  it("baskın kalem etiketi ve kaynağıyla birlikte gösterilir (Yasa 2)", () => {
    const html = bolum(
      render(
        rapor([
          kalem("waiting_loss", "Bekleme kaybı", 9000, true, "estimated"),
          kalem("scrap_loss", "Hurda kaybı", 3000, true),
        ]),
      ),
    );
    expect(html).toContain("En büyük kalem");
    expect(html).toContain("Bekleme kaybı");
    expect(html).toContain("Tahmin");
  });

  it("eksik yoksa eksik açıklaması yazılmaz", () => {
    const html = bolum(
      render(rapor([kalem("waiting_loss", "Bekleme kaybı", 9000, true)])),
    );
    expect(html).not.toContain("hesaplanamadı");
  });

  it("günlük üretim süresi verilmişse günlük projeksiyon anlatılır", () => {
    const html = bolum(
      render(
        rapor([kalem("waiting_loss", "Bekleme kaybı", 9000, true)], {
          daily_loss: 27000,
        }),
      ),
    );
    expect(html).toContain("Günde yaklaşık");
    expect(html).toContain("27.000");
  });
});

describe("hiçbir kalem hesaplanamadığında (Yasa 4)", () => {
  const hicbiri = rapor([
    kalem("waiting_loss", "Bekleme kaybı", 0, false),
    kalem("scrap_loss", "Hurda kaybı", 0, false),
  ]);

  it("uydurulmuş sıfır yerine hesaplanamadığı söylenir", () => {
    const html = bolum(render(hicbiri));
    expect(html).toContain("Finansal etki hesaplanamadı.");
    expect(html).not.toContain("₺0");
    expect(html).not.toContain("En büyük kalem");
  });

  it("nedeni eksik girdinin adıyla yazılır", () => {
    const html = bolum(render(hicbiri));
    expect(html).toContain("2 kayıp kalemi hesaplanamadı");
  });

  it("eksiği kapatan eylem sunulur", () => {
    const html = bolum(render(hicbiri));
    expect(html).toContain("Maliyet oranlarını gir");
  });
});

describe("kısmi hesaplanabilirlikte", () => {
  const kismi = rapor([
    kalem("waiting_loss", "Bekleme kaybı", 9000, true),
    kalem("scrap_loss", "Hurda kaybı", 0, false),
  ]);

  it("hesaplanan tutar gösterilir", () => {
    expect(bolum(render(kismi))).toContain("9.000");
  });

  it("eksik kalem sessizce toplama katılmaz, ayrıca söylenir", () => {
    const html = bolum(render(kismi));
    expect(html).toContain("1 kayıp kalemi hesaplanamadı");
  });

  it("eksik kalem ₺0 olarak listelenmez", () => {
    expect(bolum(render(kismi))).not.toContain("₺0");
  });
});

describe("karar zinciri ve tasarım dili korunur", () => {
  const html = render(
    rapor([kalem("waiting_loss", "Bekleme kaybı", 9000, true)]),
  );

  it("finansal yüzey ölçüm şeridinden sonra, kapanış adımından önce gelir", () => {
    const olcum = html.indexOf("Beklenen üretim");
    const finans = html.indexOf("Finansal etki</h2>");
    const aksiyon = html.indexOf("Sonraki adım");
    expect(olcum).toBeGreaterThan(-1);
    expect(finans).toBeGreaterThan(olcum);
    expect(aksiyon).toBeGreaterThan(finans);
  });

  it("bölüm bir kart değildir — gradient, gölge ya da ikon kutusu yok", () => {
    const parca = bolum(html);
    expect(parca).not.toMatch(/bg-gradient|from-|shadow-lg|rounded-2xl/);
  });

  it("dokunma hedefi 44 pikselden küçük değildir", () => {
    expect(bolum(html)).toMatch(/<button[^>]*min-h-\[44px\]/);
  });
});
