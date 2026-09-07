/**
 * KPI eğilim tamponu — sparkline'ların kayan penceresi.
 *
 * Her göstergenin altında son on beş dakikanın küçük grafiği var. Bu grafiğin
 * verisi durumda saklanmaz, **örneklenir**: her olay paketinden sonra o anki
 * değer bir tampona yazılır ve pencereden çıkan eski örnekler atılır.
 *
 * Neden kayan pencere
 * -------------------
 * Sınırsız biriktirilseydi sekiz saatlik bir vardiya on binlerce nokta üretir,
 * Recharts her karede hepsini çizmeye çalışırdı. Pencere hem sabit bellek hem
 * sabit çizim maliyeti verir.
 *
 * Neden zamana göre budama
 * ------------------------
 * Yalnızca nokta sayısına göre budansaydı, olay yağmurunda pencere birkaç
 * saniyeye düşer, sakin dakikalarda saatlere çıkardı; grafiğin gösterdiği
 * süre okundukça değişirdi. Budama önce zamana, sonra üst sınıra bakar.
 */

/** Tek bir örnek. */
export interface TrendSample {
  /** Gün içindeki dakika. */
  atMinutes: number;
  /** Ölçülemeyen anlarda `null`; grafik orada kesilir, sıfıra düşmez. */
  value: number | null;
}

/** Sparkline'ın kapsadığı süre (dakika). */
export const TREND_WINDOW_MINUTES = 15;

/**
 * Pencerede tutulan en fazla nokta.
 *
 * On beş dakikayı yaklaşık on saniyelik çözünürlükle örnekler. Daha sık
 * örneklemek küçük bir grafikte gözle ayırt edilemez, yalnızca çizim
 * maliyetini artırırdı.
 */
export const TREND_MAX_POINTS = 90;

/**
 * Yeni bir örnek ekler ve pencereyi budar.
 *
 * Girdiyi değiştirmez; yeni bir dizi döner. Aynı dakikaya ikinci bir örnek
 * gelirse eskisinin **yerine** yazılır: aynı dakikada onlarca olay olabilir ve
 * her biri ayrı nokta olsaydı grafik dikey bir çizgi yığınına dönerdi.
 */
export function pushSample(
  series: TrendSample[],
  sample: TrendSample,
  windowMinutes: number = TREND_WINDOW_MINUTES,
  maxPoints: number = TREND_MAX_POINTS,
): TrendSample[] {
  const last = series[series.length - 1];

  const appended =
    last && last.atMinutes === sample.atMinutes
      ? [...series.slice(0, -1), sample]
      : [...series, sample];

  const cutoff = sample.atMinutes - windowMinutes;
  const windowed = appended.filter((item) => item.atMinutes >= cutoff);

  return windowed.length > maxPoints
    ? windowed.slice(windowed.length - maxPoints)
    : windowed;
}

/**
 * Eğilimin yönü: son ölçülen değer, penceredeki ilk ölçülen değere göre.
 *
 * `null` örnekler atlanır; iki ölçüm yoksa yön bilinmez ve `null` döner.
 * Bilinmeyen yönü "sabit" göstermek, hiç veri yokken bir iddia bildirmek
 * olurdu.
 */
export function trendDirection(
  series: TrendSample[],
): "up" | "down" | "flat" | null {
  const measured = series.filter(
    (item): item is TrendSample & { value: number } => item.value !== null,
  );
  if (measured.length < 2) {
    return null;
  }

  const first = measured[0].value;
  const last = measured[measured.length - 1].value;

  // Yüzde birlik değişimler gürültüdür; sparkline'ın altındaki ok bunlar için
  // yön değiştirmemelidir.
  const threshold = Math.abs(first) * 0.01;
  if (Math.abs(last - first) <= threshold) {
    return "flat";
  }
  return last > first ? "up" : "down";
}

/** Penceredeki en küçük ve en büyük ölçülmüş değer; ölçüm yoksa `null`. */
export function trendRange(
  series: TrendSample[],
): { min: number; max: number } | null {
  const values = series
    .map((item) => item.value)
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}
