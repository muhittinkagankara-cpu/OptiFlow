/**
 * Vardiya saati.
 *
 * Canlı ekrandaki her satır "14:32" biçiminde bir saat taşır. Bu saat gerçek
 * duvar saati **değildir**: olay akışı bir senaryodan gelir ve senaryonun kendi
 * zamanı vardır. `new Date()` okunsaydı işlev saf olmaktan çıkar, testler
 * çalıştıkları saate göre farklı sonuç verirdi.
 */

/** Vardiyanın başladığı dakika (08:00). */
export const SHIFT_START_MINUTES = 8 * 60;

/** Bir günde kaç dakika var; saat bu değerde başa döner. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Gün içindeki dakikayı "SS:DD" biçimine çevirir.
 *
 * Gün sınırını aşan değerler başa sarar (25:00 → 01:00); gece vardiyasında
 * sarma olmasaydı ekranda "25:30" gibi okunamayan bir saat görünürdü.
 */
export function formatClock(minutes: number): string {
  const normalized =
    ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
