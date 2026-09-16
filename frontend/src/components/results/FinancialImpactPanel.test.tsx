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

/* ===================================================================== *
 * Sprint 2H-C — sadeleştirme
 *
 * Yukarıdaki 2H-A karakterizasyon testleri olduğu gibi durur; aşağıdakiler
 * sadeleştirmenin geri alınmasını zorlaştırır. Tıklama gerektiren yollar
 * (akordeon, yükleme, hata) burada değil, tarayıcıda doğrulanır — `vitest`
 * `environment: "node"` ile koşar ve sunucu render'ında olay yoktur.
 * ===================================================================== */

/** Isı haritası olmayan rapor: panelin kendi yüzeylerini yalıtmak için. */
const haritasizRapor = (r: FinancialReport = demoReport(3)): FinancialReport => ({
  ...r,
  heat: [],
  top_loss_stations: [],
});

describe("başlık kartları kaldırıldı", () => {
  it("rapor görünümünde yuvarlak kenarlıklı kart kalmadı", () => {
    // `rounded-xl` üç `HeadlineCard`'ın imzasıydı.
    const html = rapor(haritasizRapor());
    expect(html).not.toContain("rounded-xl");
  });

  it("kart ızgarası kalmadı", () => {
    const html = rapor(haritasizRapor());
    expect(html).not.toMatch(/grid gap-3 sm:grid-cols-3/);
  });

  it("üç değer ve etiketleri korundu", () => {
    const html = rapor(haritasizRapor());
    expect(html).toContain("Bugünkü tahmini kayıp");
    expect(html).toContain("Kurtarılabilir kayıp");
    expect(html).toContain("Pencere toplamı");
  });

  it("güven bilgisi kaybolmadı, yazıya taşındı", () => {
    const html = rapor(haritasizRapor());
    expect(html).toMatch(/Güven: (Yüksek|Orta|Düşük|—)/);
  });
});

describe("karar yüzeyindeki büyük rakam burada tekrar edilmiyor", () => {
  it("panelde 2xl/3xl punto yok", () => {
    // Sonuç ekranının finansal cümlesi (2H-B) ana ifadedir; panel dökümdür.
    const html = rapor(haritasizRapor());
    expect(html).not.toMatch(/text-(2xl|3xl|4xl)/);
  });
});

describe("gereksiz yüzey ve gölge kalmadı", () => {
  it("rapor görünümünde gölge yok", () => {
    expect(rapor(haritasizRapor())).not.toContain("shadow");
  });

  it("rapor görünümünde gradient yok", () => {
    expect(rapor(haritasizRapor())).not.toContain("gradient");
  });

  it("eksik oran uyarısı kart değil, kenar çizgisi", () => {
    // Isı haritası dışarıda bırakılır: `HeatLegend` kendi lejant renklerini
    // (`bg-amber-500`) taşır ve bu sprintin kapsamında değildir.
    const html = rapor(haritasizRapor(raporlaKalemler([doluKalem, eksikKalem])));
    expect(html).toContain("border-amber-400");
    expect(html).not.toMatch(/bg-amber-50(?![0-9])/);
    expect(html).not.toMatch(/border-amber-200(?![0-9])/);
  });

  it("uyarı metni ve eksik oran adları korundu", () => {
    const html = rapor(raporlaKalemler([doluKalem, eksikKalem]));
    expect(html).toContain("toplam gerçek kaybın altındadır");
    expect(html).toContain("Eksik oranlar");
  });
});

describe("kaynak (provenance) düz yazıya indi ama korundu", () => {
  it("renkli hap kalmadı", () => {
    // Isı haritasının ilerleme çubukları da `rounded-full` kullanır; ölçüm
    // panelin kendi yüzeyleriyle sınırlanır.
    const html = rapor(haritasizRapor(raporlaKalemler([doluKalem])));
    expect(html).not.toContain("rounded-full");
  });

  it("kaynak etiketi hâlâ yazıyla okunuyor", () => {
    const html = rapor(raporlaKalemler([doluKalem]));
    expect(html).toMatch(/Ölçüldü|Hesaplandı|Tahmin/);
  });

  it("kaynağın açıklaması title olarak duruyor", () => {
    const html = rapor(raporlaKalemler([doluKalem]));
    expect(html).toMatch(/title="[^"]+"/);
  });
});

describe("dar ekranda kalem tablosu kayıt listesine dönüyor", () => {
  it("768 altı için liste, üstü için tablo çizilir", () => {
    const html = rapor(raporlaKalemler([doluKalem, eksikKalem]));
    expect(html).toContain("md:hidden");
    expect(html).toContain("md:table");
  });

  it("kayıt listesinde de hesaplanamayan kalem sıfır TL değildir", () => {
    const kalemler = kalemTablosu(rapor(raporlaKalemler([eksikKalem])));
    // Hem listede hem tabloda iki kez "hesaplanamadı" yazar; hiçbirinde ₺0 yok.
    expect(kalemler.match(/hesaplanamadı/g)?.length).toBe(2);
    expect(kalemler).not.toMatch(/₺\s*0(?!\d)/);
  });

  it("kayıt listesi kalemin dayanağını da taşır", () => {
    const kalemler = kalemTablosu(rapor(raporlaKalemler([doluKalem])));
    expect(kalemler.match(/saatlik makine maliyeti/g)?.length).toBe(2);
  });
});

describe("öneri metni uydurma eyleme çevrilmedi", () => {
  /**
   * Backend `ImprovementSuggestion.action` alanı `ACTION_BY_COMPONENT`
   * sözlüğünden gelen sabit bir tavsiye cümlesidir; arkasında uç nokta, hedef
   * ekran ya da parametre yoktur. Tıklanabilir yapmak olmayan bir yetenek
   * vaat etmek olurdu.
   */
  const oneriliRapor = (): FinancialReport => ({
    ...haritasizRapor(),
    suggestions: [
      {
        station_id: "S1",
        station_name: "Pres",
        dominant_loss: "downtime_loss",
        recoverable_amount: 4200,
        action: "Önleyici bakım önceliğini bu istasyona verin.",
        rationale: "Duruş kaybının en büyük payı burada.",
      },
    ],
  });

  it("öneri metni gösterilir", () => {
    const html = rapor(oneriliRapor());
    expect(html).toContain("Önleyici bakım önceliğini bu istasyona verin.");
    expect(html).toContain("Duruş kaybının en büyük payı burada.");
    expect(html).toContain("Pres");
  });

  it("öneri bölümünde düğme ya da bağlantı yok", () => {
    const html = rapor(oneriliRapor());
    const bas = html.indexOf("En yüksek getirili iyileştirme");
    expect(bas).toBeGreaterThan(-1);
    const bolum = html.slice(bas);
    expect(bolum).not.toContain("<button");
    expect(bolum).not.toContain("<a ");
  });

  it("hedeflenen tutar korundu", () => {
    expect(rapor(oneriliRapor())).toContain("4.200");
  });
});

describe("dokunma hedefleri (MASTER §14)", () => {
  it("vardiya ön ayarlarının üçü de 44px", () => {
    const html = renderToStaticMarkup(
      <SettingsForm settings={{}} onChange={() => {}} />,
    );
    const dugmeler = html.match(/<button[^>]*>/g) ?? [];
    expect(dugmeler).toHaveLength(3);
    for (const dugme of dugmeler) {
      expect(dugme).toContain("min-h-[44px]");
    }
  });

  it("maliyet alanları 44px tabanına yükseltildi", () => {
    const html = renderToStaticMarkup(
      <SettingsForm settings={{}} onChange={() => {}} />,
    );
    expect(html).toContain("[&amp;_input]:min-h-[44px]");
  });

  it("panelin aç/kapa düğmesi 44px", () => {
    const html = renderToStaticMarkup(
      <FinancialImpactPanel
        result={demoRun(3)}
        config={config}
        settings={{}}
        onSettingsChange={() => {}}
        report={null}
        onReportChange={() => {}}
      />,
    );
    expect(html).toMatch(/<button[^>]*min-h-\[44px\]/);
  });
});

describe("akordeon ve girdi alanları korundu", () => {
  const kapaliPanel = renderToStaticMarkup(
    <FinancialImpactPanel
      result={demoRun(3)}
      config={config}
      settings={{ machine_cost_per_hour: 1550 }}
      onSettingsChange={() => {}}
      report={demoReport(3)}
      onReportChange={() => {}}
    />,
  );

  it("panel kapalı başlar ve bunu erişilebilir biçimde bildirir", () => {
    expect(kapaliPanel).toContain('aria-expanded="false"');
  });

  it("kapalıyken rapor içeriği çizilmez", () => {
    expect(kapaliPanel).not.toContain("Kayıp kalemleri");
  });

  it("kapalıyken de rakam uydurulmaz", () => {
    expect(kapaliPanel).not.toMatch(/₺\s*0(?!\d)/);
  });

  it("alanlar etiketleriyle bağlı kalır", () => {
    const html = renderToStaticMarkup(
      <SettingsForm settings={{}} onChange={() => {}} />,
    );
    const forIds = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
    expect(forIds.length).toBe(6);
    for (const id of forIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

/* ===================================================================== *
 * Sprint 2H-D — istasyon kayıplarının dar ekran görünümü
 *
 * `StationFinancialImpact` modelinde provenance, `basis` ya da `is_available`
 * **yoktur** — bunlar kayıp kalemine (`LossComponent`) aittir, istasyona
 * değil. Bu yüzden istasyon kaydında kaynak etiketi yazılmaz: olmayan bir
 * alanı uydurmak yerine modelin gerçekten taşıdığı beş tutar gösterilir.
 * ===================================================================== */

/** Yalnızca "İstasyon bazlı kayıplar" bölümü. */
const istasyonBolumu = (html: string): string => {
  const bas = html.indexOf("İstasyon bazlı kayıplar");
  const son = html.indexOf("En yüksek getirili iyileştirme");
  return html.slice(bas, son === -1 ? undefined : son);
};

describe("istasyon kayıpları — mevcut değerler korunur", () => {
  const html = () => rapor(haritasizRapor());

  it("her istasyon adıyla listelenir", () => {
    const bolum = istasyonBolumu(html());
    for (const ad of ["Torna", "Kesme", "Kaynak", "Boyama"]) {
      expect(bolum).toContain(ad);
    }
  });

  it("darboğaz işareti korunur", () => {
    expect(istasyonBolumu(html())).toContain("darboğaz");
  });

  it("dört kalem ve toplam başlıkları korunur", () => {
    const bolum = istasyonBolumu(html());
    for (const baslik of ["Arıza", "Bekleme", "Fire", "Fırsat", "Toplam"]) {
      expect(bolum).toContain(baslik);
    }
  });
});

describe("istasyon kayıpları — 768 altında kayıt listesi", () => {
  const html = () => istasyonBolumu(rapor(haritasizRapor()));

  it("dar ekran listesi ve geniş ekran tablosu birlikte çizilir", () => {
    expect(html()).toContain("md:hidden");
    expect(html()).toContain("md:table");
  });

  it("yatay kaydırma kutusu kalmadı", () => {
    // Tablo 768 altında kayıt listesine dönüyor; kaydırma kutusu bir çözüm
    // değil, taşmanın saklanmasıdır (UI kuralı).
    expect(html()).not.toContain("overflow-x-auto");
  });

  it("kayıt listesi istasyonun toplamını ve dört kalemini taşır", () => {
    const bolum = html();
    const liste = bolum.slice(bolum.indexOf("md:hidden"), bolum.indexOf("md:table"));
    expect(liste).toContain("Torna");
    expect(liste).toContain("₺15.818");
    expect(liste).toContain("Arıza");
    expect(liste).toContain("Fırsat");
  });

  it("darboğaz işareti kayıt listesinde de var", () => {
    const bolum = html();
    const liste = bolum.slice(bolum.indexOf("md:hidden"), bolum.indexOf("md:table"));
    expect(liste).toContain("darboğaz");
  });

  it("istasyon kaydında uydurma kaynak etiketi yok", () => {
    // Modelde provenance alanı yok; "Ölçüldü" yazmak veriyi metne uydurmak
    // olurdu. Kaynak yalnızca kayıp kalemlerinde, gerçekten var olduğu yerde.
    const bolum = html();
    const liste = bolum.slice(bolum.indexOf("md:hidden"), bolum.indexOf("md:table"));
    expect(liste).not.toMatch(/Ölçüldü|Hesaplandı|Tahmin/);
  });
});
