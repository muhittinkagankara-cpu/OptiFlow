/**
 * Dokunsal geri bildirim (titreşim).
 *
 * Sahada operatörün eldiveni ve gürültü vardır: bir düğmeye basıldığının
 * anlaşılması için görsel geri bildirim her zaman yetmez. Titreşim bunun için
 * kullanılır — ama **hiçbir zaman tek başına bilgi taşımaz**; her titreşimin
 * ekranda bir karşılığı olur.
 *
 * Tek yerde toplanması bilinçlidir: `navigator.vibrate` her tarayıcıda yoktur,
 * masaüstünde hiç yoktur ve kullanıcı hareket azaltma isteğinde bulunmuş
 * olabilir. Bu üç denetim çağrı yerlerine dağılsaydı, biri unutulduğunda
 * uygulama bazı cihazlarda hata verirdi.
 */

/** Kalıp adları; süreler milisaniye cinsindendir. */
const PATTERNS = {
  /** Düğmeye dokunuş. */
  tap: 12,
  /** İş başlatma / duraklatma gibi durum değişimi. */
  transition: [18, 40, 18],
  /** Görev tamamlandı. */
  success: [24, 60, 24, 60, 48],
  /** Geçersiz işlem. */
  reject: [60, 40, 60],
} as const;

export type HapticPattern = keyof typeof PATTERNS;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Cihaz destekliyorsa titreşir.
 *
 * Sessizce başarısız olur: titreşim bir kolaylıktır, desteklenmediği için
 * kullanıcıya hata göstermek anlamsız olurdu.
 */
export function haptic(pattern: HapticPattern): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  if (prefersReducedMotion()) {
    return;
  }
  try {
    navigator.vibrate(PATTERNS[pattern] as number | number[]);
  } catch {
    // Bazı tarayıcılar kullanıcı etkileşimi olmadan çağrıldığında hata atar.
  }
}
