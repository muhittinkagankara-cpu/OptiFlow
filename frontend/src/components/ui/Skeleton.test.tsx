/**
 * `Skeleton` render testleri.
 *
 * Test ortamı `node`'dur ve projede DOM kütüphanesi yoktur; bu yüzden render
 * `react-dom/server` ile HTML metnine yapılır. Bu, gerçek bir DOM ağacı
 * kurmaz — tıklama gibi etkileşimler sınanamaz — ama çıkan işaretlemenin
 * (rol, aria, sınıf, metin) doğruluğunu yeni bağımlılık eklemeden sınar.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("yükleniyor durumunu duyurur", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it("görsel çubukları ekran okuyucudan gizler", () => {
    // Çubuklar bilgi taşımaz; okunmaları yalnızca gürültü olurdu.
    const html = renderToStaticMarkup(<Skeleton shape="table" rows={3} />);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it("ne yüklendiğini yazıyla söyler", () => {
    const html = renderToStaticMarkup(<Skeleton shape="chart" />);
    expect(html).toContain("Grafik yükleniyor");
  });

  it("çağıranın verdiği etiketi varsayılanın yerine kullanır", () => {
    const html = renderToStaticMarkup(
      <Skeleton shape="table" label="İstasyon tablosu yükleniyor" />,
    );
    expect(html).toContain("İstasyon tablosu yükleniyor");
    expect(html).not.toContain("Tablo yükleniyor");
  });

  it("istenen satır sayısı kadar çubuk çizer", () => {
    const html = renderToStaticMarkup(<Skeleton shape="table" rows={5} />);
    expect(html.match(/optiflow-skeleton/g)).toHaveLength(5);
  });

  it("aralık dışındaki satır sayısını sıkıştırır", () => {
    const html = renderToStaticMarkup(<Skeleton shape="table" rows={99} />);
    expect(html.match(/optiflow-skeleton/g)).toHaveLength(12);
  });

  it("dışarıdan verilen sınıfı korur", () => {
    const html = renderToStaticMarkup(<Skeleton className="mt-4" />);
    expect(html).toContain("mt-4");
  });
});
