/**
 * `MetricGroup` render testleri (Sprint 2D).
 *
 * En önemlisi Yasa 4: ölçülemeyen değer sıfıra düşmez, "—" olur ve nedeni
 * yazılır. Bu davranış Command Center'da maliyet oranları girilmeden önce her
 * gün görünür; kaybolursa kullanıcı ₺0 kaybettiğini sanır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricGroup, type MetricItem } from "./MetricGroup";

const measured: MetricItem = {
  id: "loss",
  label: "Aylık kayıp",
  value: "₺178.772",
  consequence: "22 iş günü üzerinden ölçeklendi",
  emptyReason: "Maliyet oranları girilmedi",
  isMoney: true,
};

const unmeasured: MetricItem = {
  ...measured,
  value: null,
  action: <button type="button">Finans'a git</button>,
};

const render = (items: MetricItem[]) =>
  renderToStaticMarkup(<MetricGroup items={items} />);

describe("MetricGroup — ölçülmüş değer", () => {
  it("değeri ve sonucunu birlikte yazar", () => {
    const html = render([measured]);
    expect(html).toContain("₺178.772");
    expect(html).toContain("22 iş günü");
  });

  it("çıplak metrik bırakmaz — sonuç satırı vardır", () => {
    expect(render([measured])).toContain(measured.consequence!);
  });

  it("para rezerve mürekkebi kullanır", () => {
    expect(render([measured])).toContain("--of-semantic-value-ink");
  });

  it("para olmayan değer rezerve mürekkebi kullanmaz", () => {
    const html = render([{ ...measured, isMoney: false }]);
    expect(html).not.toContain("--of-semantic-value-ink");
  });

  it("ölçülmüşken nedeni ve eylemi göstermez", () => {
    const html = render([{ ...measured, action: <button>Finans</button> }]);
    expect(html).not.toContain("Maliyet oranları girilmedi");
  });
});

describe("MetricGroup — ölçülmemiş değer (Yasa 4)", () => {
  it("sıfır değil, uzun tire gösterir", () => {
    const html = render([unmeasured]);
    expect(html).toContain("—");
    expect(html).not.toContain("₺0");
  });

  it("nedenini yazar", () => {
    expect(render([unmeasured])).toContain("Maliyet oranları girilmedi");
  });

  it("ölçümü tamamlayacak eylemi sunar", () => {
    expect(render([unmeasured])).toContain("Finans&#x27;a git");
  });

  it("ölçülmemiş değer rezerve para mürekkebini almaz", () => {
    // Olmayan bir tutarı altın mürekkeple yazmak, ölçüm varmış gibi görünürdü.
    expect(render([unmeasured])).not.toContain("--of-semantic-value-ink");
  });
});

describe("MetricGroup — yüzey", () => {
  it("hücreler kenarlıkla değil hairline boşlukla ayrılır", () => {
    // İç içe kutu üretmemek için ızgaranın zemini hairline, hücreler yüzey.
    const html = render([measured, unmeasured]);
    expect(html).toContain("gap-px");
    expect(html).toContain("bg-[var(--of-surface-hairline)]");
  });

  it("gradient kullanmaz", () => {
    expect(render([measured])).not.toContain("gradient");
  });
});
