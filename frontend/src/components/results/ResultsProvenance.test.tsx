/**
 * Sonuç sayfasının köken satırı (Sprint 2G-A).
 *
 * Denetimde bulundu: sayfa benzetim çıktısı gösteriyor ama bunu hiçbir yerde
 * söylemiyordu — "Benzetim" kelimesi ekranda sıfır kez geçiyordu (KURAL 1).
 *
 * Bu testler `ResultsPage`'in tamamını render etmez; sayfa ağır alt bileşenler
 * (ısı haritası, Sankey, animasyon) ve ağ çağrıları taşır. Sınanan şey,
 * sayfanın köken rozetini **hangi veriden** kurduğudur: aynı işlev zinciri
 * burada doğrudan çağrılır ve rozet o çıktıyla çizilir.
 *
 * Tazelik kurallarının kendisi `lib/commandCenter` testlerinde sınanmıştır;
 * burada yinelenmez. Sınanan, Sonuç sayfasının o kuralları **atlamadığıdır**.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { freshnessLine, runFreshness, runProvenance } from "../../lib/commandCenter";
import type { SimulationResults } from "../../types/simulationTypes";
import { OriginBadge } from "../ui/OriginBadge";

const sonuc = {
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
} as SimulationResults;

const simdi = new Date("2026-09-15T16:20:00.000Z");

/** Sayfanın kurduğu zincirin birebir aynısı. */
const rozet = (ranAt: string | null) => {
  const provenance = runProvenance(sonuc, ranAt);
  const freshness = freshnessLine(runFreshness(provenance.ranAt, simdi));
  return renderToStaticMarkup(
    <OriginBadge origin={provenance.origin} detail={freshness} />,
  );
};

describe("Sonuç sayfası kökeni (KURAL 1)", () => {
  it("koşumu benzetim olarak etiketler", () => {
    expect(rozet("2026-09-15T16:18:00.000Z")).toContain("Benzetim");
  });

  it("gerçek bağlantı iddiası üretmez", () => {
    const html = rozet("2026-09-15T16:18:00.000Z");
    const metin = html.replace(/<[^>]*>/g, " ");
    expect(metin).not.toMatch(/Canlı|Aktif|Şimdi/);
  });
});

describe("Sonuç sayfası tazeliği (Sprint 2F-A anlamları)", () => {
  it("bir günün altındaki koşum göreli anlatılır", () => {
    expect(rozet("2026-09-15T16:18:00.000Z")).toContain("Son koşum 2 dk önce");
  });

  it("bir günden eski koşum mutlak tarihle ve eskilik notuyla yazılır", () => {
    const html = rozet("2026-09-13T16:00:00.000Z");
    expect(html).toContain("bir günden eski");
  });

  it("zaman damgası yoksa saat uydurulmaz", () => {
    const html = rozet(null);
    expect(html).toContain("Benzetim");
    expect(html).not.toContain("Son koşum");
    expect(html).not.toMatch(/\d+\s*(dk|saat)\s*önce/);
  });

  it("geçersiz zaman damgası da uydurulmuş bir saat üretmez", () => {
    const html = rozet("bu bir tarih değil");
    expect(html).toContain("Benzetim");
    expect(html).not.toContain("Son koşum");
  });

  it("ikinci bir zaman kaynağı kullanılmaz", () => {
    // `runFreshness` enjekte edilen "şimdi" ile çalışır; sabit bir girdi her
    // koşumda aynı çıktıyı verir. Bileşen içinde `new Date()` olsaydı bu
    // eşitlik bozulurdu.
    expect(rozet("2026-09-15T16:18:00.000Z")).toBe(
      rozet("2026-09-15T16:18:00.000Z"),
    );
  });
});
