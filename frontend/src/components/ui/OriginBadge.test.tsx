/**
 * `OriginBadge` render testleri.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OriginBadge } from "./OriginBadge";

describe("OriginBadge", () => {
  it("benzetimi gerçek veri gibi göstermez", () => {
    // KURAL 1: üretilmiş veri açıkça etiketlenir.
    const html = renderToStaticMarkup(<OriginBadge origin="simulated" />);
    expect(html).toContain("Benzetim");
    expect(html).toContain("--of-semantic-warn");
  });

  it("doğrulanmamış bağlantıyı arıza gibi göstermez", () => {
    const html = renderToStaticMarkup(<OriginBadge origin="unverified" />);
    expect(html).toContain("Doğrulanmadı");
    expect(html).toContain("--of-semantic-unknown");
    expect(html).not.toContain("--of-semantic-fault");
  });

  it("yalnızca doğrulanmış veriyi canlı olarak işaretler", () => {
    const html = renderToStaticMarkup(<OriginBadge origin="live" />);
    expect(html).toContain("Canlı");
    expect(html).toContain("--of-semantic-ok");
  });

  it("kökeni iki sinyalle taşır: nokta ve yazı", () => {
    const html = renderToStaticMarkup(<OriginBadge origin="simulated" />);
    // Nokta dekoratiftir ve gizlenir; anlamı yazı taşır.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Benzetim");
  });

  it("tam açıklamayı hem ipucunda hem ekran okuyucuda verir", () => {
    const html = renderToStaticMarkup(<OriginBadge origin="unverified" />);
    expect(html).toContain("title=");
    expect(html).toContain("Bağlantı henüz denenmedi");
    expect(html).toContain("sr-only");
  });
});

describe("OriginBadge — tazelik ayrıntısı (Sprint 2F-A)", () => {
  it("ayrıntı verilmezse hiçbir şey eklenmez", () => {
    const html = renderToStaticMarkup(<OriginBadge origin="simulated" />);
    expect(html).not.toContain("·");
  });

  it("ayrıntı rozetin içinde, ayrı bir satır açmadan görünür", () => {
    // Köken ile zaman aynı olgunun iki yüzü; ayrı kutulara konsaydı kullanıcı
    // bunları ayrı iddialar sanırdı.
    const html = renderToStaticMarkup(
      <OriginBadge origin="simulated" detail="Son koşum 12 dk önce" />,
    );
    expect(html).toContain("Benzetim");
    expect(html).toContain("Son koşum 12 dk önce");
    expect(html.match(/<span/g)!.length).toBeLessThan(8);
  });

  it("ayrılabilir nokta ekran okuyucudan gizlenir", () => {
    const html = renderToStaticMarkup(
      <OriginBadge origin="simulated" detail="Son koşum 12 dk önce" />,
    );
    expect(html).toContain('aria-hidden="true">·');
  });

  it("ayrıntı kökeni gölgelemez — etiket hâlâ ilk sırada", () => {
    const html = renderToStaticMarkup(
      <OriginBadge origin="simulated" detail="Son koşum 3 saat önce" />,
    );
    expect(html.indexOf("Benzetim")).toBeLessThan(html.indexOf("Son koşum"));
  });

  it("doğrulanmamış kökende de ayrıntı taşınabilir", () => {
    const html = renderToStaticMarkup(
      <OriginBadge origin="unverified" detail="Henüz koşum yok" />,
    );
    expect(html).toContain("Doğrulanmadı");
    expect(html).toContain("Henüz koşum yok");
  });

  it("ayrıntı canlı iddiası üretmez", () => {
    const html = renderToStaticMarkup(
      <OriginBadge origin="simulated" detail="Son koşum az önce" />,
    );
    expect(html).not.toContain("Canlı");
    expect(html).not.toMatch(/Aktif|Şimdi/);
  });
});
