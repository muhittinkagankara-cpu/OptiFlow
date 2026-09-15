/**
 * `SetupProgressStrip` render testleri (Sprint 2F-D).
 *
 * Şeridin tek eylemi "Devam et" bağlantısıdır ve 27,5 piksellik bir dokunma
 * hedefiydi — MASTER §14'ün yarısından biraz fazla. Testler hem kuralın
 * sağlandığını hem de şeridin görünümünün korunduğunu (bağlantı gibi durur,
 * düğme gibi değil) kilitler.
 *
 * Render `react-dom/server` ile yapılır; gerekçesi `Skeleton.test.tsx`
 * başlığında yazılıdır.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChecklistItem } from "../../lib/onboarding-enterprise";
import { SetupProgressStrip } from "./SetupProgressStrip";

const items: ChecklistItem[] = [
  {
    id: "company",
    label: "Şirket bilgileri",
    done: false,
    hint: "Şirket adını ve para birimini girin.",
    view: "enterprise",
    minutes: 3,
  },
  {
    id: "factory",
    label: "Fabrika",
    done: true,
    hint: "Fabrika oluşturuldu.",
    view: "factories",
    minutes: 5,
  },
];

const render = (list: ChecklistItem[] = items) =>
  renderToStaticMarkup(
    <SetupProgressStrip items={list} onNavigate={() => {}} />,
  );

describe("SetupProgressStrip — dokunma hedefi (MASTER §14)", () => {
  it("devam bağlantısı 44 pikselin altına düşmez", () => {
    const html = render();
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[44px]");
  });

  it("bağlantı görünümü korunur — düğmeye dönüşmez", () => {
    // Yükseklik `min-h` ile açılır; zemin rengi ya da kenarlık eklenmez,
    // yoksa şeritte ikinci bir birincil eylem varmış gibi görünürdü.
    const html = render();
    expect(html).toContain("text-[13px]");
    expect(html).not.toContain("bg-brand-600");
    expect(html).not.toContain("border ");
  });

  it("boşluklar MASTER ölçeğinden gelir", () => {
    const html = render();
    expect(html).toContain("px-[var(--of-spacing-8)]");
    expect(html).toContain("py-[var(--of-spacing-4)]");
  });
});

describe("SetupProgressStrip — içerik korundu", () => {
  it("kaç adımın bittiğini ve sıradakini yazar", () => {
    const html = render();
    expect(html).toContain("1/2");
    expect(html).toContain("Şirket bilgileri");
    expect(html).toContain("Devam et");
  });

  it("kurulum bitince şerit hiç çizilmez", () => {
    // Bitmiş bir işin ekranda yer kaplaması, hâlâ yapacak bir şey varmış gibi
    // gelirdi.
    const bitti = items.map((item) => ({ ...item, done: true }));
    expect(render(bitti)).toBe("");
    expect(render([])).toBe("");
  });
});
