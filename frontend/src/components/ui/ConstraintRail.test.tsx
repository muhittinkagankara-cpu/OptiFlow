/**
 * `ConstraintRail` render testleri (Sprint 2D).
 *
 * Şeridin tek işi kısıtı **yanlışsız** göstermek. Testler üç şeyi korur:
 * kısıt birden fazla işaretlenmemeli, renk tek taşıyıcı olmamalı ve istasyon
 * yokken şerit hiç çizilmemeli.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConstraintRail, type ConstraintRailStation } from "./ConstraintRail";

const stations: ConstraintRailStation[] = [
  {
    id: "s1",
    label: "Kesim",
    share: 0.55,
    value: "%55",
    state: "ok",
    isConstraint: false,
  },
  {
    id: "s2",
    label: "Torna",
    share: 0.97,
    value: "%97",
    state: "fault",
    isConstraint: true,
  },
];

const render = (list: ConstraintRailStation[]) =>
  renderToStaticMarkup(<ConstraintRail stations={list} />);

describe("ConstraintRail", () => {
  it("istasyon yoksa hiçbir şey çizmez", () => {
    // Boş bir şerit, ölçülmemiş bir hattı ölçülmüş gibi gösterirdi.
    expect(render([])).toBe("");
  });

  it("her istasyonu adı ve değeriyle çizer", () => {
    const html = render(stations);
    expect(html).toContain("Kesim");
    expect(html).toContain("%55");
    expect(html).toContain("Torna");
    expect(html).toContain("%97");
  });

  it("kısıtı yazıyla da işaretler, yalnızca renkle değil", () => {
    expect(render(stations)).toContain("Kısıt");
  });

  it("yalnızca tek bir kısıt işaretlenir", () => {
    const html = render(stations);
    expect(html.match(/Kısıt/g)).toHaveLength(1);
  });

  it("kısıtın rengi ölçülmüş durumdan gelir", () => {
    expect(render(stations)).toContain("--of-semantic-fault");
  });

  it("genişlik ölçülmüş orandan türer", () => {
    // Geometri bilgi taşır: en dolu istasyon en geniş segmenttir.
    const html = render(stations);
    expect(html).toContain("flex-grow:0.55");
    expect(html).toContain("flex-grow:0.97");
  });

  it("erişilebilir bir adı vardır", () => {
    expect(render(stations)).toContain('aria-label="Hat kısıdı"');
  });

  it("dar ekranda dikey listeye döner", () => {
    expect(render(stations)).toContain("flex-col");
  });

  it("gradient kullanmaz", () => {
    expect(render(stations)).not.toContain("gradient");
  });
});

describe("ConstraintRail — görsel ağırlık (Sprint 2F-B)", () => {
  it("kısıt etiketi kendi istasyonunun adıyla aynı kutuda durur", () => {
    // Etiket segmentin sağ ucundayken bir sonraki istasyonun adına yapışıyor
    // ve "KISIT KAYNAK" diye okunuyordu; kısıt yanlış istasyona işaret ediyor
    // gibi duruyordu. Arada başka bir ad ya da okuma değeri olmamalı.
    const html = render(stations);
    const arada = html.slice(html.indexOf("Torna"), html.indexOf("Kısıt"));
    expect(arada).not.toContain("Kesim");
    expect(arada).not.toContain("%97");
  });

  it("okuma değeri adın ardından gelir", () => {
    const html = render(stations);
    expect(html.indexOf("Torna")).toBeLessThan(html.indexOf("%97"));
    expect(html.indexOf("Kısıt")).toBeLessThan(html.indexOf("%97"));
  });

  it("her okuma değeri tek kez yazılır", () => {
    // Dar ve geniş ekran aynı düğümü paylaşır. İki ayrı düğüm konsaydı ekran
    // okuyucu her istasyonu iki kez okurdu.
    const html = render(stations);
    expect(html.match(/%97/g)).toHaveLength(1);
    expect(html.match(/%55/g)).toHaveLength(1);
  });

  it("çubuk kalınlığı ölçek jetonlarından gelir", () => {
    // Şeridin aleti dolgu çubuğudur; kalınlığı uydurulmuş bir sayı değil,
    // MASTER §3'teki ölçek jetonudur.
    const html = render(stations);
    expect(html).toContain("h-[var(--of-spacing-8)]");
    expect(html).toContain("md:h-[var(--of-spacing-12)]");
  });

  it("kelepçe 2 piksel kalır", () => {
    // MASTER §15.2'deki üç sinyalden biri; kalınlaşan çubuk onun yerine geçmez.
    expect(render(stations)).toContain("h-0.5");
  });

  it("gölge, parlama ya da bulanıklık kullanmaz", () => {
    const html = render(stations);
    expect(html).not.toContain("shadow");
    expect(html).not.toContain("blur");
  });
});
