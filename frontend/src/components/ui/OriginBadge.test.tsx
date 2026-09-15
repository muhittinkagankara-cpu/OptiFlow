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
