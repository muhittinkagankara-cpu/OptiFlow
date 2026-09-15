/**
 * `ErrorState` render testleri.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır. Tıklama sınanamaz, bu yüzden testler düğmenin
 * varlığını ve metnini denetler, davranışını değil.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorState } from "./ErrorState";

const BASE = {
  title: "Cihaz verisi okunamadı",
  meaning: "Son 5 dakikadır yeni ölçüm gelmiyor; ekrandaki değerler eski.",
};

describe("ErrorState", () => {
  it("hatayı duyurur", () => {
    const html = renderToStaticMarkup(<ErrorState {...BASE} />);
    expect(html).toContain('role="alert"');
  });

  it("ne olduğunu ve bunun ne demek olduğunu birlikte söyler", () => {
    const html = renderToStaticMarkup(<ErrorState {...BASE} />);
    expect(html).toContain("Cihaz verisi okunamadı");
    expect(html).toContain("ekrandaki değerler eski");
  });

  it("eylem verilmediğinde düğme çizmez", () => {
    const html = renderToStaticMarkup(<ErrorState {...BASE} />);
    expect(html).not.toContain("<button");
  });

  it("eylem verildiğinde varsayılan metinle düğme çizer", () => {
    const html = renderToStaticMarkup(
      <ErrorState {...BASE} onRetry={() => {}} />,
    );
    expect(html).toContain("<button");
    expect(html).toContain("Yeniden dene");
  });

  it("düğme metni özelleştirilebilir", () => {
    const html = renderToStaticMarkup(
      <ErrorState {...BASE} onRetry={() => {}} retryText="Tekrar bağlan" />,
    );
    expect(html).toContain("Tekrar bağlan");
    expect(html).not.toContain("Yeniden dene");
  });

  it("teknik ayrıntı yoksa açılır bölüm çizmez", () => {
    // Tıklandığında boş çıkan bir "ayrıntı", bilgi saklandığını düşündürür.
    expect(renderToStaticMarkup(<ErrorState {...BASE} />)).not.toContain(
      "<details",
    );
    expect(
      renderToStaticMarkup(<ErrorState {...BASE} detail="   " />),
    ).not.toContain("<details");
  });

  it("teknik ayrıntıyı açılır bölümün arkasında tutar", () => {
    const html = renderToStaticMarkup(
      <ErrorState {...BASE} detail="HTTP 503 · upstream timeout" />,
    );
    expect(html).toContain("<details");
    expect(html).toContain("Teknik ayrıntı");
    expect(html).toContain("HTTP 503");
  });
});
