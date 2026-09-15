/**
 * Sonuç sayfasını açan cümlenin seçimi (Yasa 1, Sprint 2G-B).
 *
 * Burada **cümle üretilmez**, yalnızca var olan iki cümleden hangisinin
 * kullanılacağına karar verilir. Yeni bir başlık algoritması, yeni bir eşik ya
 * da yeni bir öneri yoktur:
 *
 * 1. `SimulationRunResponse.headline` — simülasyon motorunun kendi yazdığı
 *    cümle. Yanıtta baştan beri vardı ve bugüne kadar hiçbir yerde
 *    çizilmiyordu; denetimin en ucuz kazancı buydu.
 * 2. Motor cümlesi yoksa, sayfanın **zaten** kullandığı kısıt cümlesi. Bu
 *    cümle ekranda hâlihazırda yazılıydı; buraya taşınırken metni
 *    değiştirilmedi.
 *
 * Motor cümlesi boş ya da yalnızca boşluksa yok sayılır: boş bir başlık,
 * ekranın en büyük yazısının sıfır bilgi taşıması demek olurdu
 * (ANTI-PATTERNS #21).
 */

/**
 * Motorun yazdığı cümle; kullanılabilir değilse `null`.
 *
 * Kırpma kasıtlıdır: `"   "` gibi bir değer teknik olarak doludur ama ekranda
 * boş bir başlık olarak görünürdü.
 */
export function backendHeadline(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Motor cümlesi yokken kullanılan kısıt cümlesi.
 *
 * Metin, sayfanın kısıt paragrafının ilk cümlesinin aynısıdır — yeni bir
 * ifade yazılmadı. İstasyon adı bilinmiyorsa `null` döner ve çağıran hiçbir
 * şey çizmez; uydurulmuş bir istasyon adı kullanıcıyı yanlış makineye
 * yönlendirirdi (Yasa 4).
 */
export function bottleneckHeadline(stationName: string | null | undefined): string | null {
  if (typeof stationName !== "string" || stationName.trim().length === 0) {
    return null;
  }
  return `Hattınızın çıktısını ${stationName.trim()} belirliyor.`;
}

/** Sonuç sayfasının açılış cümlesi ve hangi kaynaktan geldiği. */
export interface ResultsStatement {
  headline: string;
  /** Motor cümlesi mi, sayfanın kendi kısıt cümlesi mi? */
  source: "engine" | "bottleneck";
}

/**
 * Açılış cümlesini seçer.
 *
 * İkisi de yoksa `null` döner: kısıt belirlenemediğinde bir cümle uydurmak
 * yerine sayfa başlıksız açılır ve mevcut içerik durumu anlatır.
 */
export function resultsStatement(
  headline: string | null | undefined,
  bottleneckStationName: string | null | undefined,
): ResultsStatement | null {
  const engine = backendHeadline(headline);
  if (engine !== null) {
    return { headline: engine, source: "engine" };
  }
  const fallback = bottleneckHeadline(bottleneckStationName);
  return fallback === null ? null : { headline: fallback, source: "bottleneck" };
}
