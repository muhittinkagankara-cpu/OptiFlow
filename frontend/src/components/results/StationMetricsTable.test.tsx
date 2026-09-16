/**
 * İstasyon detayının iki sunumu (Sprint 2G-D).
 *
 * 768 pikselin altında tablo çizilmez; aynı veri kayıt listesi olarak görünür.
 * Geçiş, kod tabanının her yerinde olduğu gibi **CSS kırılım noktalarıyla**
 * yapılır (`hidden md:block` / `md:hidden`) — `ConstraintRail` ve
 * `MetricGroup` de böyle çalışır ve bu sayfada üçünün aynı mekanizmayı
 * kullanması gerekir.
 *
 * Bunun testler için sonucu şudur: iki sunum da işaretlemede bulunur, hangisinin
 * **görünür** olduğunu düzen belirler. `vitest` burada `environment: "node"` ile
 * koşar, yani düzen hesabı yoktur. Bu yüzden testler "hangisi görünüyor"u değil,
 * **responsive sözleşmeyi** ve iki sunumun aynı veriyi taşıdığını sınar; görünürlük
 * tarayıcıda beş genişlikte ölçülmüştür.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoRun } from "../../lib/demo/dataset";
import type { StationMetricsResponse } from "../../types/simulationTypes";
import { StationMetricsTable } from "./StationMetricsTable";

const kosum = demoRun(3);
const stations = kosum.results.station_metrics;
const kisitId = kosum.results.bottleneck_station_id;

const render = (
  list: StationMetricsResponse[] = stations,
  bottleneckId: string = kisitId,
) =>
  renderToStaticMarkup(
    <StationMetricsTable stations={list} bottleneckStationId={bottleneckId} />,
  );

describe("responsive sözleşme", () => {
  it("tablo yalnızca 768 ve üzerinde çizilir", () => {
    // Davranışa bakılır, sınıf dizgisinin tamamına değil: yüzey tokenları
    // değiştiğinde (Sprint 2J) bu testin kırılması bir regresyon değil,
    // kırılgan bir doğrulama demekti.
    // Aynı `class` özniteliğinde hem `hidden` hem `md:block` taşıyan bir
    // sarmalayıcı bulunmalı: 768 altında gizli, üstünde görünür.
    const html = render();
    const siniflar = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
    expect(
      siniflar.some((c) => c.includes("hidden") && c.includes("md:block")),
    ).toBe(true);
  });

  it("kayıt listesi yalnızca 768 altında çizilir", () => {
    expect(render()).toContain("md:hidden");
  });

  it("dar ekran sunumu yatay kaydırmaya bırakılmaz", () => {
    // `overflow-x-auto` ve `min-w-[640px]` yalnızca masaüstü dalındadır.
    const html = render();
    const mobil = html.slice(0, html.indexOf("md:block"));
    expect(mobil).not.toContain("overflow-x-auto");
    expect(mobil).not.toContain("min-w-[640px]");
  });
});

describe("kayıt listesi aynı veriyi taşır", () => {
  const html = render();
  const mobil = html.slice(0, html.indexOf("md:block"));

  it("istasyon adlarını sırasıyla korur", () => {
    const adlar = stations.map((s) => s.station_name);
    adlar.forEach((ad) => expect(mobil).toContain(ad));
    const sira = adlar.map((ad) => mobil.indexOf(ad));
    expect(sira).toEqual([...sira].sort((a, b) => a - b));
  });

  it("doluluğu korur", () => {
    stations.forEach((s) =>
      expect(mobil).toContain(`%${Math.round(s.utilization * 100)}`),
    );
  });

  it("kuyruk ve beklemeyi korur", () => {
    expect(mobil).toContain("Kuyruk");
    expect(mobil).toContain("Bekleme");
    stations.forEach((s) =>
      expect(mobil).toContain(s.avg_queue_length.toFixed(1)),
    );
  });

  it("OEE'yi korur", () => {
    expect(mobil).toContain("OEE");
    stations.forEach((s) =>
      expect(mobil).toContain(`%${(s.oee.oee * 100).toFixed(1)}`),
    );
  });

  it("darboğazı yetkili alandan işaretler", () => {
    const kisit = stations.find((s) => s.station_id === kisitId)!;
    expect(mobil).toContain("Darboğaz");
    expect(mobil.indexOf(kisit.station_name)).toBeGreaterThan(-1);
  });
});

describe("darboğaz dürüstlüğü", () => {
  it("eşleşen istasyon yoksa hiçbiri darboğaz gösterilmez", () => {
    const html = render(stations, "boyle-bir-istasyon-yok");
    expect(html).not.toContain("Darboğaz");
  });

  it("darboğaz en yüksek dolulukla değil, kimlikle belirlenir", () => {
    // En dolu istasyon kısıt olmayabilir; otorite `bottleneck_station_id`.
    const enDolu = [...stations].sort((a, b) => b.utilization - a.utilization)[0];
    const digeri = stations.find((s) => s.station_id !== enDolu.station_id)!;
    const html = render(stations, digeri.station_id);
    const mobil = html.slice(0, html.indexOf("md:block"));
    const kisitYeri = mobil.indexOf("Darboğaz");
    expect(mobil.slice(0, kisitYeri)).toContain(digeri.station_name);
  });
});

describe("boş durum davranışı korunur", () => {
  it("istasyon yoksa bileşen yine de çizilir ve çökmez", () => {
    // Mevcut davranış: tablo başlıkları duruyor, gövde boş. Değiştirilmedi.
    const html = render([], kisitId);
    expect(html).toContain("İstasyon");
    expect(html).not.toContain("Darboğaz");
  });
});
