/**
 * Hat sağlığı ile koşum üstverisinin ayrılması (Sprint 2F-C).
 *
 * `buildHealthIndicators` altı gösterge üretir ve bunların **hepsi doğrudur**;
 * sorun ölçümde değil, ikisinin aynı başlık altında durmasındaydı. "Hat
 * sağlığı" başlığı fabrikanın durumunu vaat eder, ama iki hücre fabrikayı
 * değil **koşumu** anlatıyordu:
 *
 * - `validation` — Little Yasası denetimi. Koşumun kendi içinde tutarlı olup
 *   olmadığını söyler; hattın sağlığıyla ilgisi yoktur. Bir koşum "geçmedi"
 *   diye fabrikada bir şey bozulmuş olmaz, yalnızca o koşuma daha az
 *   güvenilir.
 * - `replications` — kaç bağımsız koşumun ortalaması alındığı. Bu bir yöntem
 *   bilgisidir; makinelerle ilgili hiçbir şey söylemez.
 *
 * Bu dosya göstergeleri **ikiye ayırır**, hiçbirini silmez ve hiçbirinin
 * değerini değiştirmez: eşikler, tonlar ve metinler `lib/factoryHealth`
 * içinde olduğu gibi kalır. Yapılan iş yalnızca "hangisi nereye yazılır"
 * kararıdır.
 */

import type { HealthIndicator } from "../factoryHealth";

/**
 * Fabrikanın değil, koşumun niteliğini anlatan gösterge kimlikleri.
 *
 * Kimliğe göre ayırmak, etikete göre ayırmaktan güvenlidir: etiket metni
 * çevrilebilir ya da yeniden yazılabilir, kimlik `factoryHealth` içinde
 * sabittir.
 */
const RUN_META_IDS = new Set(["validation", "replications"]);

/** Şeritte kalacak, gerçekten operasyonel olan göstergeler. */
export function operationalHealth(
  indicators: HealthIndicator[],
): HealthIndicator[] {
  return indicators.filter((indicator) => !RUN_META_IDS.has(indicator.id));
}

/** Şeritten çıkan, koşuma ait göstergeler. */
export function runQuality(indicators: HealthIndicator[]): HealthIndicator[] {
  return indicators.filter((indicator) => RUN_META_IDS.has(indicator.id));
}

/**
 * Koşum satırı — kararın dayandığı koşumun kimliği tek satırda.
 *
 * `confidence` zaten "30 tekrar · %95 aralık 554 – 588" biçiminde tekrar
 * sayısını taşır; bu yüzden `replications` göstergesi satıra **ikinci kez**
 * eklenmez. Aynı sayıyı iki kez yazmak, iki ayrı ölçüm varmış izlenimi
 * bırakırdı.
 *
 * Doğrulama sonucu ise başka hiçbir yerde görünmüyor; kararın yanına, ona
 * ne kadar güvenileceğini söyleyen yere yazılır.
 *
 * ## Zaman (Sprint 2F-E)
 *
 * Satırın başına koşumun **ne zaman** alındığı eklenir. Gerekçe ölçüldü:
 * telefonda sayfa iki ekran boyundan uzun ve üstteki köken rozeti karar
 * bloğuna gelindiğinde çoktan yukarı kaymış oluyor. Kararın hemen yanında
 * zamanın bulunması, "bu öneri ne kadar taze bir ölçüme dayanıyor?" sorusunu
 * yukarı kaydırmadan yanıtlar.
 *
 * Tekrar edilen bir rozet **değildir**: üstteki cümle birincil ve rozetlidir
 * ("Benzetim · Son koşum 4 dk önce"), buradaki ise 11 piksellik sessiz bir
 * dipnottur ve "Son koşum" sözcüklerini yinelemez — satırın etiketi zaten
 * "KOŞUM".
 *
 * Yazacak hiçbir şey yoksa `null` döner ve satır hiç çizilmez — boş bir
 * "Koşum:" etiketi ölçüm varmış izlenimi bırakırdı (Yasa 4).
 */
export function runQualityLine(
  indicators: HealthIndicator[],
  confidence: string | null,
  /** Koşumun tazeliği; `runFreshness` çıktısı. Yoksa hiçbir şey yazılmaz. */
  freshness: { text: string; isOlderThanADay: boolean } | null = null,
): string | null {
  const parts: string[] = [];
  if (freshness !== null) {
    parts.push(
      freshness.isOlderThanADay
        ? `${freshness.text} · bir günden eski`
        : freshness.text,
    );
  }
  if (confidence !== null) {
    parts.push(confidence);
  }
  const validation = indicators.find((item) => item.id === "validation");
  if (validation !== undefined) {
    parts.push(`${validation.label}: ${validation.value}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
