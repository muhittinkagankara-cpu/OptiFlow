/**
 * `Button` dokunma hedefi testleri (Sprint 2F-D).
 *
 * MASTER §14: her dokunma hedefi en az 44×44 px. Ölçüldü — `sm` 28 px, `md`
 * 36 px yükseklikteydi. Bu testler kuralın geri kaymasını engeller ve aynı
 * zamanda **nasıl** sağlandığını kilitler: düğmeler `min-h`/`min-w` ile
 * büyütülür, dolgu ya da punto büyütülerek değil. Aksi hâlde kural "sağlanmış"
 * görünürken tüm arayüz şişerdi.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Primitives";

const render = (props: Partial<Parameters<typeof Button>[0]> = {}) =>
  renderToStaticMarkup(<Button {...props}>Simülasyona git</Button>);

describe("Button — dokunma hedefi (MASTER §14)", () => {
  it("varsayılan boyut 44 pikselin altına düşmez", () => {
    const html = render();
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[44px]");
  });

  it("küçük boyut da 44 pikselin altına düşmez", () => {
    // `sm` en çok kullanılan boyut; kuralın dışında kalsaydı arayüzün
    // çoğunluğu kuralın dışında kalırdı.
    const html = render({ size: "sm" });
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[44px]");
  });
});

describe("Button — görsel şişme olmaz", () => {
  it("küçük boyutun dolgusu ve puntosu değişmedi", () => {
    const html = render({ size: "sm" });
    expect(html).toContain("px-2.5");
    expect(html).toContain("py-1.5");
    expect(html).toContain("text-xs");
  });

  it("varsayılan boyutun dolgusu ve puntosu değişmedi", () => {
    const html = render();
    expect(html).toContain("px-3.5");
    expect(html).toContain("py-2");
    expect(html).toContain("text-sm");
  });

  it("iki boyut hâlâ birbirinden ayrı", () => {
    // 44 piksel tabanı ikisini aynı düğme yapmaz; punto ve dolgu farkı durur.
    expect(render({ size: "sm" })).not.toBe(render({ size: "md" }));
  });

  it("yeni bir ölçek jetonu uydurulmadı", () => {
    // 44 px MASTER §14'ün kendi sayısıdır; --of-spacing ölçeğine yeni bir
    // değer eklenmedi.
    const html = render();
    expect(html).not.toContain("--of-spacing-44");
  });
});

describe("Button — davranış korundu", () => {
  it("varyantlar değişmedi", () => {
    expect(render({ variant: "primary" })).toContain("bg-brand-600");
    expect(render({ variant: "danger" })).toContain("bg-red-500");
  });

  it("meşgulken dönen gösterge çizilir", () => {
    expect(render({ busy: true })).toContain("animate-spin");
  });
});
