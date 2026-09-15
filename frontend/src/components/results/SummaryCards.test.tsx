/**
 * `SummaryCards` render testleri (Sprint 2G-A).
 *
 * Bu testlerin tek işi bir gerilemeyi engellemek: ibreli gösterge
 * (ANTI-PATTERNS #4) geri gelmemeli ve kaldırılırken OEE bilgisi
 * kaybolmamalı. Eşikler `oeeTone` içinde kalır; burada yeniden tanımlanmaz.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimulationResults } from "../../types/simulationTypes";
import { SummaryCards } from "./SummaryCards";

const sonuc: SimulationResults = {
  total_throughput: 778,
  confidence_interval_95: [755, 801],
  station_metrics: [],
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
};

const render = (results: SimulationResults = sonuc) =>
  renderToStaticMarkup(<SummaryCards results={results} />);

describe("SummaryCards — ibreli gösterge kaldırıldı (ANTI-PATTERNS #4)", () => {
  it("yay (arc) çizmez", () => {
    // Gauge bölgelerini eliptik yay komutuyla çizerdi (`A r r 0 0 1 x y`).
    // Kalan SVG'ler tooltip ikonu ve güven aralığı bandıdır; ikisi de yay
    // kullanmaz, bu yüzden yay komutu gauge'ın kesin imzasıdır.
    expect(render()).not.toMatch(/\sA\s[\d.]+\s[\d.]+\s0\s[01]\s[01]\s/);
  });

  it("gauge'ın ölçek uçlarını yazmaz", () => {
    // Gauge yayın iki ucuna "%0" ve "%100" yazıyordu.
    const html = render();
    expect(html).not.toContain(">%0<");
    expect(html).not.toContain(">%100<");
  });

  it("yerine dekoratif bir grafik koymaz", () => {
    const html = render();
    expect(html).not.toContain("gradient");
    // Güven aralığı bandı korunur; o bir ölçüm taşır, süs değildir.
    expect(html).toContain("%95 güven aralığı");
  });
});

describe("SummaryCards — OEE bilgisi korunur", () => {
  it("hat OEE değeri yazıyla okunur", () => {
    const html = render();
    expect(html).toContain("Hat OEE");
    expect(html).toContain("%74");
  });

  it("eşik yargısı yazıyla da taşınır, yalnızca renkle değil", () => {
    // Renk körü bir kullanıcı için yalnızca renge dayanan bir gösterge
    // okunaksız olurdu.
    expect(render()).toContain("İyi");
  });

  it("düşük OEE mevcut eşiklere göre işaretlenir", () => {
    // Eşik `oeeTone` içinde tanımlıdır; burada yeni bir eşik üretilmez.
    const html = render({ ...sonuc, line_oee: 0.31 });
    expect(html).toContain("Düşük");
    expect(html).toContain("%31");
  });

  it("diğer üç ölçüm yerinde kalır", () => {
    const html = render();
    expect(html).toContain("Beklenen Üretim");
    expect(html).toContain("Ortalama Akış Süresi");
    expect(html).toContain("Ortalama WIP");
    expect(html).toContain("%95 güven aralığı");
  });
});
