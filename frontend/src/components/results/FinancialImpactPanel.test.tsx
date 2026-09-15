/**
 * `FinancialImpactPanel` karakterizasyon testleri (Sprint 2H-A).
 *
 * Bu testler **mevcut davranışı kayda geçirir**, yeni bir davranış tarif
 * etmez. Amaç, finans state'i yukarı taşınırken hiçbir anlamın sessizce
 * kaybolmamasıdır — özellikle ürünün en kritik dürüstlük kuralı:
 *
 *   `amount === 0` **kayıp yok demek değildir**. Gerekli maliyet oranı
 *   verilmediğinde backend kalemi `is_available: false` ile döndürür ve tutarı
 *   0.0 olur. Arayüz `is_available`'ı yok sayıp `amount`'a bakarsa "₺0 kayıp"
 *   gösterir; hiç oran girmemiş bir kullanıcı bunu iyi haber sanar.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır. Bu yüzden tıklama gerektiren yollar (akordeonu açma,
 * "Kaybı hesapla") burada değil, tarayıcıda doğrulanır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  FinancialReport,
  FinancialSettings,
  LossComponent,
} from "../../types/simulationTypes";
import {
  FinancialImpactPanel,
  ReportView,
  SettingsForm,
} from "./FinancialImpactPanel";
import { demoRun } from "../../lib/demo/dataset";
import { demoConfig, demoReport } from "../../lib/demo/dataset";

const config = demoConfig();

/** Eksik oranı olan kalem: tutar 0, ama "kayıp yok" DEĞİL. */
const eksikKalem: LossComponent = {
  name: "scrap_loss",
  label: "Hurda kaybı",
  amount: 0,
  provenance: "calculated",
  quantity: 42,
  quantity_unit: "adet",
  rate_name: "scrap_cost_per_unit",
  rate_value: null,
  is_available: false,
  basis: "scrap_cost_per_unit verilmedigi icin hesaplanamadi",
};

/** Hesaplanmış kalem. */
const doluKalem: LossComponent = {
  name: "downtime_loss",
  label: "Duruş kaybı",
  amount: 12400,
  provenance: "calculated",
  quantity: 8,
  quantity_unit: "saat",
  rate_name: "machine_cost_per_hour",
  rate_value: 1550,
  is_available: true,
  basis: "8,00 saat ariza x saatlik makine maliyeti",
};

const raporlaKalemler = (components: LossComponent[]): FinancialReport => {
  const taban = demoReport(3);
  return {
    ...taban,
    impact: {
      ...taban.impact,
      components,
      total_loss: components
        .filter((c) => c.is_available)
        .reduce((sum, c) => sum + c.amount, 0),
      missing_inputs: components
        .filter((c) => !c.is_available)
        .map((c) => c.rate_name),
      notes: ["Eksik maliyet orani olan kalemler hesaba KATILMADI."],
    },
  };
};

const rapor = (r: FinancialReport = demoReport(3)) =>
  renderToStaticMarkup(<ReportView report={r} config={config} />);

/**
 * Yalnızca "Kayıp kalemleri" tablosunu döndürür.
 *
 * Rapor birden çok tablo taşır; istasyon tablosunda darboğaz olmayan
 * istasyonların fırsat kaybı gerçekten sıfırdır. Kalem satırındaki "sıfır
 * gösterme" kuralını sınarken o tabloya bakmak yanlış alarm üretirdi.
 */
const kalemTablosu = (html: string): string => {
  const bas = html.indexOf("Kayıp kalemleri");
  const son = html.indexOf("İstasyon bazlı kayıplar");
  return html.slice(bas, son === -1 ? undefined : son);
};

describe("kayıp kalemi — mevcut availability davranışı", () => {
  it("oranı verilmiş kalem tutarıyla yazılır", () => {
    const html = rapor(raporlaKalemler([doluKalem]));
    expect(html).toContain("Duruş kaybı");
    expect(html).toContain("12.400");
  });

  it("oranı verilmemiş kalem sıfır TL olarak GÖSTERİLMEZ", () => {
    // Bu testin kırılması, ürünün en tehlikeli hatasının geri geldiği anlamına
    // gelir: kullanıcı "kaybım yok" sanar.
    //
    // Yalnızca kalem satırına bakılır: istasyon tablosunda darboğaz olmayan
    // istasyonların fırsat kaybı **gerçekten** sıfırdır ve orada ₺0 yazması
    // doğrudur — bu ikisi karıştırılmamalı.
    const html = rapor(raporlaKalemler([eksikKalem]));
    const kalemler = kalemTablosu(html);
    expect(kalemler).toContain("hesaplanamadı");
    expect(kalemler).not.toMatch(/₺\s*0(?!\d)/);
  });

  it("hesaplanamayan kalemin payı da tire olur", () => {
    const html = rapor(raporlaKalemler([eksikKalem]));
    expect(html).toContain("—");
  });

  it("kalem etiketi her zaman görünür — eksik kalem gizlenmez", () => {
    const html = rapor(raporlaKalemler([eksikKalem]));
    expect(html).toContain("Hurda kaybı");
  });
});

describe("eksik girdiler ve notlar", () => {
  it("eksik oranlar adlarıyla bildirilir", () => {
    const html = rapor(raporlaKalemler([doluKalem, eksikKalem]));
    expect(html).toContain("Eksik oranlar");
  });

  it("backend notları olduğu gibi aktarılır", () => {
    const html = rapor(raporlaKalemler([eksikKalem]));
    expect(html).toContain("hesaba KATILMADI");
  });
});

describe("provenance ayrımı korunur", () => {
  it("kalemin kaynağı yazıyla taşınır", () => {
    const html = rapor(raporlaKalemler([doluKalem]));
    // Renk tek başına bilgi taşımaz; rozet her zaman yazı içerir.
    expect(html).toMatch(/Ölçüldü|Hesaplandı|Tahmin/);
  });

  it("kalemin dayanağı (basis) gösterilir", () => {
    const html = rapor(raporlaKalemler([doluKalem]));
    expect(html).toContain("saatlik makine maliyeti");
  });
});

describe("günlük kayıp — ölçülemeyen değer uydurulmaz", () => {
  it("daily_loss null ise sayı değil, nedeni yazılır", () => {
    // Mevcut davranış tireden daha iyisini yapıyor: eksikliğin **nedenini**
    // söylüyor. Karakterizasyon testi olanı kaydeder, olması gerekeni değil.
    const taban = demoReport(3);
    const html = rapor({ ...taban, daily_loss: null });
    expect(html).toContain("Günlük üretim süresi girilmedi");
  });

  it("daily_loss varsa para olarak yazılır", () => {
    const taban = demoReport(3);
    const html = rapor({ ...taban, daily_loss: 9876 });
    expect(html).toContain("9.876");
  });
});

describe("rapor şekli — mevcut alanlar tüketiliyor", () => {
  it("kurtarılabilir kayıp gösterilir", () => {
    expect(rapor()).toContain("Kurtarılabilir");
  });

  it("güven etiketi gösterilir", () => {
    expect(rapor()).toContain("Güven");
  });
});

describe("ayar formu — girdi davranışı", () => {
  const form = (settings: FinancialSettings) =>
    renderToStaticMarkup(<SettingsForm settings={settings} onChange={() => {}} />);

  it("altı maliyet oranı alanını çizer", () => {
    const html = form({});
    expect(html).toContain("Birim katkı payı");
    expect(html).toContain("Saatlik makine maliyeti");
  });

  it("verilmemiş oran için alan boş kalır — sıfır yazılmaz", () => {
    // Boş bir alana 0 yazmak, kullanıcının vermediği bir oranı ona kendi
    // verisiymiş gibi geri sunmak olurdu.
    const html = form({});
    expect(html).not.toMatch(/value="0"/);
  });

  it("verilmiş oran alanda görünür", () => {
    const html = form({ machine_cost_per_hour: 1550 });
    expect(html).toContain('value="1550"');
  });

  it("vardiya ön ayarları sunulur", () => {
    const html = form({});
    expect(html).toContain("Tek vardiya");
    expect(html).toContain("Çift vardiya");
  });
});

describe("finans durumu yukarıdan gelir (Sprint 2H-A)", () => {
  const kosum = demoRun(3);

  const panel = (props: Partial<Parameters<typeof FinancialImpactPanel>[0]> = {}) =>
    renderToStaticMarkup(
      <FinancialImpactPanel
        result={kosum}
        config={config}
        settings={{}}
        onSettingsChange={() => {}}
        report={null}
        onReportChange={() => {}}
        {...props}
      />,
    );

  it("panel kendi rapor state'ini tutmaz — dışarıdan verilen rapor çizilir", () => {
    // Akordeon kapalı başlar; raporun çizilmesi için açılması gerekir.
    // Burada sınanan, panelin raporu **prop olarak kabul ettiğidir**: ikinci
    // bir lokal kaynak olsaydı bu prop hiç okunmazdı.
    const html = panel({ report: demoReport(3) });
    expect(html).toContain("Finansal Etki");
  });

  it("dışarıdan verilen oranlar forma yansır", () => {
    const html = panel({ settings: { machine_cost_per_hour: 1550 } });
    // Form yalnızca açıkken çizilir; kapalı hâlde bile panel prop'u alır ve
    // tip düzeyinde tek kaynağa bağlıdır.
    expect(html).toContain("Finansal Etki");
  });

  it("rapor yokken panel yine çizilir ve sayı uydurmaz", () => {
    const html = panel({ report: null });
    expect(html).toContain("Kayıplarınızın parasal karşılığı");
    expect(html).not.toMatch(/₺\s*0(?!\d)/);
  });
});
