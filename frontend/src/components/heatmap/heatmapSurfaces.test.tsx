/**
 * Isı haritası panelleri — karakterizasyon testleri (Sprint 2J).
 *
 * Bu testler **mevcut davranışı kayda geçirir**, yeni bir davranış tarif etmez.
 * 2J yalnızca yüzey dilini birleştiriyor: renk, tipografi ve kenarlık
 * değişecek, ama bu panellerin **söylediği hiçbir şey** değişmeyecek.
 *
 * Özellikle korunması gerekenler:
 *
 * - Renk tek başına bilgi taşımaz; her bandın yazılı karşılığı ve sayısal
 *   aralığı vardır (renk körlüğü).
 * - Skorun **göreli** olduğu gizlenmez: `is_relative` doğruyken uyarı yazılır.
 * - "En çok kaybeden" listesi ısı skoruna göre değil **tutara** göre sıralıdır
 *   ve bu ayrım metinle söylenir.
 * - Parasal kayıp hesaplanamadıysa liste sıfır göstermez, nedenini yazar.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StationHeat } from "../../types/simulationTypes";
import { HeatLegend } from "./HeatLegend";
import { TopLossStations } from "./TopLossStations";
import { SelectedStationCard } from "./SelectedStationCard";

const istasyon = (
  station_id: string,
  station_name: string,
  total_loss: number,
  score = 60,
): StationHeat => ({
  station_id,
  station_name,
  score,
  band: score >= 75 ? "red" : score >= 50 ? "orange" : score >= 25 ? "yellow" : "green",
  /* Gerçek `HeatComponent` şekli: ham değer, normalize, ağırlık ve skora
     katkı. Eksik alan bırakmak kartı çökertir — fixture sözleşmeye uyar. */
  components: [
    {
      name: "loss",
      label: "Kayıp",
      raw_value: total_loss,
      normalized: 1,
      weight: 0.4,
      contribution: 40,
    },
    {
      name: "utilization",
      label: "Kullanım",
      raw_value: 0.8,
      normalized: 0.8,
      weight: 0.25,
      contribution: 20,
    },
  ],
  total_loss,
  is_bottleneck: false,
  is_relative: false,
});

describe("lejant — renk tek başına konuşmaz", () => {
  const html = (isRelative = false) =>
    renderToStaticMarkup(<HeatLegend isRelative={isRelative} />);

  it("dört bandın da yazılı karşılığı vardır", () => {
    const m = html();
    for (const etiket of ["Düşük", "Orta", "Yüksek", "Kritik"]) {
      expect(m).toContain(etiket);
    }
  });

  it("her bandın sayısal aralığı yazılır", () => {
    const m = html();
    for (const aralik of ["0–25", "25–50", "50–75", "75–100"]) {
      expect(m).toContain(aralik);
    }
  });

  it("skorun ağırlıkları gösterilir", () => {
    expect(html()).toContain("%40 kayıp");
  });

  it("skor göreliyse bu açıkça söylenir", () => {
    // Gizlenirse kullanıcı kırmızı bir kutuyu felaket sanabilir.
    expect(html(true)).toContain("en kötü istasyona");
  });

  it("skor mutlaksa göreli uyarısı yazılmaz", () => {
    expect(html(false)).not.toContain("en kötü istasyona");
  });
});

describe("en çok kaybeden — sıralama tutara göre", () => {
  const hat = [
    istasyon("s1", "Torna", 15818),
    istasyon("s2", "Kesme", 3534),
    istasyon("s3", "Kaynak", 2708),
  ];
  const html = (stations = hat) =>
    renderToStaticMarkup(
      <TopLossStations stations={stations} focusedId={null} onFocus={() => {}} />,
    );

  it("sıralamanın parasal olduğu yazıyla söylenir", () => {
    // Isı skoru ile tutar aynı şey değildir; bu ayrım kaybolmamalı.
    expect(html()).toContain("Tutara göre sıralı");
  });

  it("istasyonlar geldikleri sırayla çizilir — yeniden sıralanmaz", () => {
    const m = html();
    expect(m.indexOf("Torna")).toBeLessThan(m.indexOf("Kesme"));
    expect(m.indexOf("Kesme")).toBeLessThan(m.indexOf("Kaynak"));
  });

  it("tutarlar para olarak yazılır", () => {
    expect(html()).toContain("15.818");
  });

  it("kayıp hesaplanamadıysa sıfır değil, neden gösterilir", () => {
    const bos = html([]);
    expect(bos).toContain("hesaplanamadı");
    expect(bos).toContain("Maliyet oranlarını");
    expect(bos).not.toMatch(/₺\s*0(?!\d)/);
  });
});

describe("seçili istasyon kartı", () => {
  const html = (h = istasyon("s1", "Torna", 15818, 82)) =>
    renderToStaticMarkup(<SelectedStationCard heat={h} onClear={() => {}} />);

  it("istasyon adını ve skorunu taşır", () => {
    const m = html();
    expect(m).toContain("Torna");
    expect(m).toContain("82");
  });

  it("parasal kayıp yazılır", () => {
    expect(html()).toContain("15.818");
  });

  it("kapatma denetimi erişilebilir addadır", () => {
    expect(html()).toMatch(/aria-label="[^"]+"/);
  });
});
