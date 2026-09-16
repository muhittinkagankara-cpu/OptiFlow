/**
 * `DecisionBlock` render testleri (Sprint 2D).
 *
 * Blok yalnızca **ölçülmüş** olanı yazar: verilmeyen satır hiç çizilmez. Tek
 * istisna para satırıdır — tutar yoksa gizlenmez, nedeni ve eylemiyle birlikte
 * "—" gösterilir (Yasa 4, MASTER §16).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionBlock } from "./DecisionBlock";

const base = {
  state: "fault" as const,
  stateLabel: "Acil konu",
  situation: "Hat kararsız",
  action: <button type="button">Modeli aç</button>,
};

const render = (props: Partial<Parameters<typeof DecisionBlock>[0]> = {}) =>
  renderToStaticMarkup(<DecisionBlock {...base} {...props} />);

describe("DecisionBlock — çekirdek", () => {
  it("durumu renk ve yazıyla birlikte taşır", () => {
    const html = render();
    expect(html).toContain("Acil konu");
    expect(html).toContain("--of-semantic-fault");
  });

  it("durum cümlesini yazar", () => {
    expect(render()).toContain("Hat kararsız");
  });

  it("eylemi her zaman çizer", () => {
    expect(render()).toContain("Modeli aç");
  });
});

describe("DecisionBlock — verilmeyen satır çizilmez", () => {
  it("neden verilmezse satır yok", () => {
    expect(render()).not.toContain("Neden");
  });

  it("etki verilmezse satır yok", () => {
    expect(render()).not.toContain("Etki");
  });

  it("koşum bilgisi verilmezse satır yok", () => {
    // Boş bir "Koşum:" etiketi, ölçüm varmış izlenimi bırakırdı.
    expect(render()).not.toContain("Koşum");
  });

  it("verilen satırlar çizilir", () => {
    const html = render({
      why: "Kuyruklar büyümeye devam ediyor",
      impact: "Çıktı düşüyor",
      provenanceLine: "30 tekrar · %95 aralık 554 – 588",
    });
    expect(html).toContain("Neden");
    expect(html).toContain("Kuyruklar büyümeye devam ediyor");
    expect(html).toContain("Etki");
    expect(html).toContain("Koşum");
    expect(html).toContain("30 tekrar");
  });
});

describe("DecisionBlock — para (Yasa 4)", () => {
  it("tutar varsa rezerve mürekkeple yazılır", () => {
    const html = render({
      money: { amount: "₺5.900", reason: null },
    });
    expect(html).toContain("₺5.900");
    expect(html).toContain("--of-semantic-value-ink");
  });

  it("tutar yoksa gizlenmez; tire, neden ve eylem birlikte görünür", () => {
    const html = render({
      money: {
        amount: null,
        reason: "Maliyet oranları girilmedi",
        action: <button type="button">Finans'a git</button>,
      },
    });
    expect(html).toContain("Para");
    expect(html).toContain("—");
    expect(html).toContain("Maliyet oranları girilmedi");
    expect(html).toContain("Finans&#x27;a git");
    expect(html).not.toContain("--of-semantic-value-ink");
  });

  it("para hiç verilmezse satır çizilmez", () => {
    // Karara özel tutar veride yoksa, hat düzeyindeki tutarı buraya yazmak
    // ölçülmemiş bir atıf olurdu.
    expect(render()).not.toContain("Para");
  });
});

describe("DecisionBlock — yüzey", () => {
  it("iç içe kenarlıklı kutu üretmez", () => {
    const html = render({ why: "x", impact: "y" });
    expect(html).not.toContain("gradient");
    // Bölmeler hairline; kutu değil.
    expect(html).toContain("border-t border-[var(--of-surface-hairline)]");
  });
});

describe("DecisionBlock — dikey ritim (Sprint 2F-C)", () => {
  it("koşum satırı eylemin yanında durur, gerekçelerin arasında değil", () => {
    // Ayrı bir etiket–değer satırıyken "Neden" ile eşit ağırlıktaydı; oysa o
    // bir gerekçe değil, kararın dayandığı koşumun kimliğidir.
    const html = render({
      why: "Kuyruklar büyümeye devam ediyor",
      provenanceLine: "30 tekrar · %95 aralık 554 – 588",
    });
    expect(html.indexOf("Neden")).toBeLessThan(html.indexOf("Modeli aç"));
    expect(html.indexOf("Modeli aç")).toBeLessThan(html.indexOf("Koşum"));
  });

  it("koşum satırı gerekçeden daha hafif yazılır", () => {
    const html = render({ provenanceLine: "30 tekrar" });
    expect(html).toContain("text-[11px]");
    expect(html).toContain("--of-ink-3");
  });

  it("eylem gerekçelerle aynı hairline ritmini sürdürür", () => {
    // Eylem 33 piksellik bir boşlukla ayrıyken bloğa sonradan eklenmiş gibi
    // duruyordu.
    const html = render({ why: "x" });
    expect(html).toContain("border-t border-[var(--of-surface-hairline)]");
    expect(html).not.toContain("--of-spacing-16)] border-t");
  });

  it("eşik aşımı yokken de tek birincil eylemle biter", () => {
    // Boş durum da bir karar yüzeyidir; kutlama dili ya da yapay zekâ dili yok.
    const html = render({
      state: "ok",
      stateLabel: "Eşik aşımı yok",
      situation: "Şu anda eşiği aşan bir konu yok.",
    });
    expect(html).toContain("Eşik aşımı yok");
    expect(html).toContain("--of-semantic-ok");
    expect(html).toContain("Modeli aç");
    // Sınıf adlarında "hairline" gibi diziler geçtiği için ham işaretlemede
    // değil, yalnızca görünen metinde aranır.
    const metin = html.replace(/<[^>]*>/g, " ");
    expect(metin).not.toMatch(/Tebrikler|Harika|mükemmel|yapay zekâ|(?<![A-Za-z])AI(?![A-Za-z])/i);
  });
});
