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
