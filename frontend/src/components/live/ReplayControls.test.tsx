/**
 * Kayıttan oynatma çubuğu — dokunma hedefi ve davranış (Sprint 2I-C).
 *
 * `components/live/` altında ilk bileşen testi budur. Amaç yeni bir davranış
 * tarif etmek değil, MASTER §14 kapatılırken **mevcut davranışın ve erişilebilirlik
 * bilgisinin kaybolmadığını** kayda geçirmektir.
 *
 * Render `react-dom/server` ile yapılır (vitest `environment: "node"`), bu yüzden
 * tıklama gerektiren yollar burada değil, tarayıcıda doğrulanır. Burada
 * sınanan, işaretlemenin taşıdığı sözleşmedir: hedef sınıfları, `aria-*`
 * bilgisi ve seçenek listesi.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REPLAY_SPEEDS, type ReplayControls as Controls } from "../../lib/live";
import { ReplayControls } from "./ReplayControls";

const kontroller = (patch: Partial<Controls> = {}): Controls =>
  ({
    durationMs: 60_000,
    positionMs: 15_000,
    speed: 2,
    isPlaying: true,
    setSpeed: () => {},
    play: () => {},
    pause: () => {},
    seek: () => {},
    onProgress: () => () => {},
    onReset: () => () => {},
    ...patch,
  }) as Controls;

const ciz = (patch: Partial<Controls> = {}) =>
  renderToStaticMarkup(<ReplayControls controls={kontroller(patch)} />);

/** Tek bir `<button>`/`<input>` etiketini adına göre bulur. */
const etiket = (html: string, ara: string): string => {
  const i = html.indexOf(ara);
  expect(i).toBeGreaterThan(-1);
  const bas = html.lastIndexOf("<", i);
  return html.slice(bas, html.indexOf(">", i) + 1);
};

describe("oynat / duraklat", () => {
  it("oynarken duraklat etiketini taşır", () => {
    expect(ciz({ isPlaying: true })).toContain('aria-label="Duraklat"');
  });

  it("duraklatılmışken oynat etiketini taşır", () => {
    expect(ciz({ isPlaying: false })).toContain('aria-label="Oynat"');
  });

  it("dokunma hedefi 44px", () => {
    expect(etiket(ciz(), 'aria-label="Duraklat"')).toMatch(/h-11 w-11/);
  });

  it("görünen kare 32px kalır — yoğunluk değişmedi", () => {
    expect(ciz()).toContain("h-8 w-8");
  });
});

describe("kayıt konumu kaydırıcısı", () => {
  it("erişilebilir adı korunur", () => {
    expect(ciz()).toContain('aria-label="Kayıt konumu"');
  });

  it("native range girdisi olarak kalır", () => {
    const html = ciz();
    expect(html).toContain('type="range"');
    expect(html).toContain('value="15000"');
    expect(html).toContain('max="60000"');
  });

  it("44px hedef sınıfını taşır", () => {
    // Ray inceliği `optiflow-touch-range` içinde korunur; hedef 44px olur.
    expect(etiket(ciz(), 'aria-label="Kayıt konumu"')).toContain(
      "optiflow-touch-range",
    );
  });

  it("artık kendi yüksekliğini ray olarak kullanmıyor", () => {
    // `h-1.5` + `bg-slate-200` öğenin kendisini 6px'lik raya çeviriyordu.
    const girdi = etiket(ciz(), 'aria-label="Kayıt konumu"');
    expect(girdi).not.toContain("h-1.5");
    expect(girdi).not.toContain("bg-slate-200");
  });

  it("süre sıfırken de çizilir ve çökmez", () => {
    expect(ciz({ durationMs: 0, positionMs: 0 })).toContain('type="range"');
  });
});

describe("hız düğmeleri", () => {
  it("dört hızın tamamı çizilir", () => {
    const html = ciz();
    for (const hiz of REPLAY_SPEEDS) {
      expect(html).toContain(`${hiz}x`);
    }
  });

  it("her hız düğmesi 44px hedefe sahiptir", () => {
    const html = ciz();
    for (const hiz of REPLAY_SPEEDS) {
      expect(etiket(html, `${hiz}x<`)).toMatch(/min-h-\[44px\] min-w-\[44px\]/);
    }
  });

  it("seçili hız aria-pressed ile bildirilir — renk tek başına bırakılmaz", () => {
    const html = ciz({ speed: 4 });
    expect(etiket(html, "4x<")).toContain('aria-pressed="true"');
    expect(etiket(html, "1x<")).toContain('aria-pressed="false"');
  });

  it("seçili hızın görsel durumu korunur", () => {
    expect(etiket(ciz({ speed: 4 }), "4x<")).toContain("bg-brand-600");
  });

  it("punto 10px kalır — yazı büyütülmedi", () => {
    expect(etiket(ciz(), "1x<")).toContain("text-[10px]");
  });
});

describe("geçen süre yazısı", () => {
  it("konum ve süre dakika:saniye olarak yazılır", () => {
    expect(ciz()).toContain("0:15 / 1:00");
  });

  it("yüzde de yazıyla verilir", () => {
    expect(ciz()).toContain("%25");
  });
});
