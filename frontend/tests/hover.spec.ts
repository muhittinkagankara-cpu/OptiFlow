/**
 * Hover durumunda dekoratif gölge bekçisi (Sprint 2M.1).
 *
 * Bu dosya var olmasaydı, 2M'in yakaladığı ihlal bir daha yakalanamazdı.
 *
 * Olan şuydu: `Card interactive` `optiflow-lift` kullanıyordu ve o sınıfın
 * `:hover` kuralı `--shadow-lg` uyguluyordu. Ekran durağan ölçüldüğünde gölge
 * **yok**; yalnızca imleç kartın üstüne geldiğinde beliriyor. 2J'nin bütün
 * tarayıcı ölçümleri bunu kaçırdı. Sonunda kaynak taraması yakaladı, ama
 * yakalama nedeni şanstı: yasak sınıfın adı kaynakta geçiyordu.
 *
 * Aynı gölge bir CSS kuralından gelseydi — örneğin `.optiflow-cc-lift:hover`
 * içine sonradan bir `box-shadow` eklenseydi — hiçbir bekçi görmezdi. Kaynak
 * taraması sınıf adı aramıyor olurdu, durağan tarayıcı ölçümü de hover
 * yapmıyor.
 *
 * Bu yüzden burada gerçekten hover yapılır ve ölçüm hover **sırasında**
 * alınır.
 *
 * Ölçüm tek genişlikte (1440) yapılır: hover gölgesi bir CSS durumudur,
 * kırılma noktasına göre değişmez. Altı genişlikte tekrarlamak koşum süresini
 * altıya katlar ve hiçbir yeni bilgi vermezdi.
 */

import { expect, test } from "@playwright/test";

import { SCREENS, enterDemo, gotoScreen, settle, type ScreenId } from "./helpers";

const GENISLIK = { width: 1440, height: 900 };

/** Ölçülmüş durum halkaları dekoratif sayılmaz (V4 §3.8.3). */
const OLCULMUS_RENKLER = [
  "34, 197, 94",
  "245, 158, 11",
  "239, 68, 68",
  "61, 125, 255",
  "220, 38, 38",
];

/**
 * Operatör telefon çerçevesi muafiyeti — `constitution.spec.ts` ile aynı
 * gerekçe: çerçeve bir yüzeyi süslemiyor, bir cihazı çiziyor ve bu daldan
 * önce geliyor (`b702eec`).
 */
const GOLGE_MUAF: ScreenId[] = ["operator"];

/** Aynı anda kaç öğe denensin? */
const ORNEK_SAYISI = 12;

async function hoverdaGolge(
  page: import("@playwright/test").Page,
): Promise<{ denenen: number; golgeli: string[] }> {
  /*
   * Adaylar **öncelik sırasıyla** toplanır ve bu sıra kritik.
   *
   * İlk yazdığım sürüm hepsini tek bir seçicide topluyordu ve ilk 12'yi
   * deniyordu. DOM sırasında kabuk düğmeleri önce geldiği için kota onlarla
   * doluyor, asıl riskli yüzeylere — yükselme sınıfı taşıyan kartlara — hiç
   * sıra gelmiyordu. Test, ihlal yerine geri konduğunda bile yeşil kaldı;
   * yani sahte güven üretiyordu.
   *
   * Yükselme sınıfı taşıyanlar artık her zaman önce denenir: hover gölgesi
   * tam olarak oradan geliyor.
   */
  const yukselenler = page.locator('[class*="lift"]');
  const otekiler = page.locator('[class*="cursor-pointer"], button, [role="button"]');

  const hedefler = [
    ...(await yukselenler.all()),
    ...(await otekiler.all()),
  ].slice(0, ORNEK_SAYISI);

  const golgeli: string[] = [];

  for (const oge of hedefler) {
    if (!(await oge.isVisible().catch(() => false))) continue;
    await oge.hover({ timeout: 5_000 }).catch(() => undefined);

    const bulgu = await page.evaluate((olculmus) => {
      const gorunur = (b: string) => {
        if (!b || b === "none") return false;
        const renkler = b.match(/rgba?\([^)]+\)/g) ?? [];
        return renkler.some((c) => {
          const m = c.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
          return m ? parseFloat(m[1]) > 0.01 : true;
        });
      };

      return Array.from(document.querySelectorAll("*"))
        .filter((e) => {
          const b = getComputedStyle(e).boxShadow;
          if (!gorunur(b)) return false;
          return !olculmus.some((renk) => b.includes(renk));
        })
        .map(
          (e) =>
            `${e.tagName}.${String((e as HTMLElement).className ?? "").slice(0, 55)}`,
        );
    }, OLCULMUS_RENKLER);

    for (const b of bulgu) {
      if (!golgeli.includes(b)) golgeli.push(b);
    }
  }

  return { denenen: hedefler.length, golgeli };
}

for (const screen of Object.keys(SCREENS) as ScreenId[]) {
  test(`${SCREENS[screen]} — hover'da dekoratif gölge yok`, async ({ page }) => {
    await page.setViewportSize(GENISLIK);
    await enterDemo(page);
    await gotoScreen(page, screen);
    await settle(page);

    const { denenen, golgeli } = await hoverdaGolge(page);

    // Hiç öğe denenmezse test sahte bir şekilde geçerdi.
    expect(denenen, "denenen hover hedefi").toBeGreaterThan(0);

    if (!GOLGE_MUAF.includes(screen)) {
      expect(golgeli, "hover sırasında beliren dekoratif gölge").toEqual([]);
    }
  });
}
