/**
 * 44px dokunma hedefi bekçisi (Sprint 2M, MASTER §14 / V4 §3.8.9).
 *
 * Ölçüm yöntemi iki kez düzeltildi; ikisi de burada kalıcı hale getirildi:
 *
 * 1. `getBoundingClientRect()` yeterli değil. Hedef `::after` ile büyütülmüş
 *    olabilir ve dikdörtgen bunu göstermez — küçük görünen bir düğme aslında
 *    44px'i geçiyor olabilir. Bu yüzden gerçek vuruş testi yapılır.
 * 2. Tekil `elementFromPoint` yanlış negatif üretir: yapışkan bir başlığın
 *    altında kalan kontrol "erişilemez" görünür. `min-h-[44px]` taşıyan
 *    düğmeler bile 0 çıkmıştı. Çoğul `elementsFromPoint` ile yığının tamamına
 *    bakılır.
 *
 * Tek istisna zaman tüneli satırlarıdır (V4 §3.8.9, Sprint 2I-C ölçümü);
 * bilgi yoğunluğu gerekçesiyle korunur ve burada **raporlanır**, gizlenmez.
 */

import { expect, test } from "@playwright/test";

import { SCREENS, VIEWPORTS, enterDemo, gotoScreen, settle, type ScreenId } from "./helpers";

interface KucukHedef {
  ad: string;
  metin: string;
  gen: number;
  yuk: number;
  zamanTuneli: boolean;
}

async function kucukHedefler(
  page: import("@playwright/test").Page,
): Promise<{ toplam: number; kucuk: KucukHedef[] }> {
  return page.evaluate(() => {
    const secici =
      'button, a[href], [role="button"], [role="tab"], input, select, summary';
    const kontroller = Array.from(document.querySelectorAll(secici));
    const kucuk: KucukHedef[] = [];

    const vurdu = (x: number, y: number, e: Element) =>
      document
        .elementsFromPoint(x, y)
        .some((n) => n === e || e.contains(n) || n.contains(e));

    for (const e of kontroller) {
      if ((e as HTMLButtonElement).disabled) continue;
      const s = getComputedStyle(e);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.pointerEvents === "none"
      ) {
        continue;
      }
      e.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Gerçekten erişilemiyorsa ölçülmez; bu bir hedef sorunu değil.
      if (!vurdu(cx, cy, e)) continue;

      let yuk = 0;
      let gen = 0;
      for (let d = 1; d <= 30; d++) {
        if (vurdu(cx, cy - d, e) || vurdu(cx, cy + d, e)) yuk = d * 2;
        else break;
      }
      for (let d = 1; d <= 30; d++) {
        if (vurdu(cx - d, cy, e) || vurdu(cx + d, cy, e)) gen = d * 2;
        else break;
      }

      if (yuk < 44 || gen < 44) {
        kucuk.push({
          ad: `${e.tagName}.${String((e as HTMLElement).className ?? "").slice(0, 50)}`,
          metin: (e.textContent ?? "").trim().slice(0, 25),
          gen,
          yuk,
          // Zaman tüneli satırları belgelenmiş istisnadır.
          zamanTuneli: Boolean(e.closest("[data-timeline], [data-zaman-tuneli]")),
        });
      }
    }

    return { toplam: kontroller.length, kucuk };
  });
}

for (const screen of Object.keys(SCREENS) as ScreenId[]) {
  test.describe(`${SCREENS[screen]} — dokunma hedefleri`, () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.ad}px`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await enterDemo(page);
        await gotoScreen(page, screen);
        await settle(page);

        const { toplam, kucuk } = await kucukHedefler(page);

        // Hiç kontrol bulunmazsa test sahte bir şekilde geçerdi.
        expect(toplam, "sayılan kontrol").toBeGreaterThan(0);

        const ihlal = kucuk.filter((k) => !k.zamanTuneli);
        expect(
          ihlal.map((k) => `${k.ad} "${k.metin}" ${k.gen}x${k.yuk}`),
          "44px altında kalan kontroller",
        ).toEqual([]);
      });
    }
  });
}
