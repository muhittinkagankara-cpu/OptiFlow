/**
 * Vardiya özeti.
 *
 * Vardiya sonunda gösterilen dört kart ile motivasyon mesajı buradan gelir.
 * Mesaj metni de burada seçilir, bileşende değil: "Tebrikler" demenin ne zaman
 * doğru, ne zaman yanlış olduğu bir karardır ve karar sınanabilir bir yerde
 * durmalıdır. Fire oranı yüksek bir vardiyayı kutlamak, operatöre yanlış
 * geri bildirim vermek olurdu.
 */

import { collectScrap, scrapSummary } from "./scrap";
import { taskCounts } from "./tasks";
import type { OperatorTask, ShiftSummary } from "./types";

/**
 * Vardiyanın tamamını tek bir özete indirger.
 *
 * Yalnızca **tamamlanmış** görevlerin adetleri değil, üzerinde çalışılmış her
 * görevin adedi sayılır: yarım kalan bir işte üretilen parçalar da gerçekten
 * üretilmiştir ve vardiya sonunda görünmelidir.
 */
export function buildShiftSummary(tasks: OperatorTask[]): ShiftSummary {
  const counts = taskCounts(tasks);
  const produced = tasks.reduce(
    (sum, task) => sum + Math.max(0, task.completedQuantity),
    0,
  );
  const scrap = scrapSummary(collectScrap(tasks), produced);
  const workedMinutes =
    tasks.reduce((sum, task) => sum + Math.max(0, task.workedSeconds), 0) / 60;

  const handled = produced + scrap.total;
  const yieldRate = handled > 0 ? produced / handled : null;

  return {
    produced,
    scrapped: scrap.total,
    yieldRate,
    workedMinutes,
    taskCount: counts.total,
    completedCount: counts.done,
    allDone: counts.allDone,
    tone: scrap.tone === "neutral" ? "neutral" : scrap.tone,
    ...message(counts.isEmpty, counts.allDone, counts.done, scrap.tone),
  };
}

/**
 * Vardiya sonundaki iki satırlık mesaj.
 *
 * Dört durum ayrılır: hiç görev yok, hiçbiri bitmemiş, hepsi bitmiş, kısmen
 * bitmiş. Fire yüksekse kutlama cümlesi kullanılmaz — mesaj yine olumlu kalır
 * ama asıl konuyu söyler.
 */
function message(
  isEmpty: boolean,
  allDone: boolean,
  done: number,
  tone: ShiftSummary["tone"],
): { headline: string; detail: string } {
  if (isEmpty) {
    return {
      headline: "Bu vardiyada görev atanmamış.",
      detail:
        "Görevler planlamadan geldiğinde burada listelenir; şu an bekleyen bir iş yok.",
    };
  }

  if (tone === "bad") {
    /*
     * Fire uyarısı, işin bitip bitmediğinden bağımsız olarak öne çıkar — ama
     * başlık vardiyanın tamamlandığını iddia etmez. Dörtte biri bitmiş bir
     * vardiyaya "tamamlandı" demek, operatörün kalan işleri unutmasına yol
     * açardı.
     */
    return {
      headline: allDone
        ? "Bütün görevler bitti ama fire oranı yüksek."
        : "Fire oranı yüksek.",
      detail:
        "Hurda payı beklenenin üzerinde. Nedenleri bakım ve kalite ekibiyle paylaşmakta fayda var.",
    };
  }

  if (allDone) {
    return {
      headline: "Tebrikler, bugünkü işlerin hepsini bitirdiniz.",
      detail: "Bütün görevler tamamlandı ve fire oranı beklenen aralıkta.",
    };
  }

  if (done === 0) {
    return {
      headline: "Vardiya devam ediyor.",
      detail: "Henüz tamamlanmış bir görev yok; başladığınız iş burada sayılır.",
    };
  }

  return {
    headline: "İyi gidiyorsunuz.",
    detail: `${done} görev tamamlandı, kalanlar listede sizi bekliyor.`,
  };
}
