/**
 * Tasarım sistemi ilkellerinin ortak sözlüğü (Sprint 1A).
 *
 * Buradaki üç tip, `docs/design-system/MASTER.md` içindeki anlamsal kuralların
 * kodda karşılığıdır. Ayrı bir dosyada durmalarının nedeni, dört ilkelin de
 * aynı kelimeleri kullanmasıdır: bir bileşen "uyarı" derken ötekinin "dikkat"
 * demesi, zamanla iki ayrı durum sözlüğü doğurur.
 */

/**
 * Ölçülmüş bir durumun dört hâli.
 *
 * `unknown` bilinçli olarak `fault`tan ayrıdır ve bu ayrım ürünün en önemli
 * görsel kuralıdır (MASTER Yasa 4): kırmızı "ölçtük, eşiğin dışında" demektir;
 * nötr gri "ölçmedik" demektir. İkisini aynı renge bağlamak, ölçülmemiş bir
 * değeri arıza gibi göstererek kullanıcıyı olmayan bir sorunun peşine düşürür.
 */
export type MeasuredState = "ok" | "warn" | "fault" | "unknown";

/**
 * Bir verinin nereden geldiği.
 *
 * `simulated` bir hata değildir — üretilmiş bir senaryodan gelen veri geçerli
 * bir çalışma biçimidir. Ama gerçek cihaz verisiyle karıştırılmamalıdır;
 * bu yüzden kendi rozetini taşır (KURAL 1: benzetim gerçek gibi gösterilmez).
 */
export type DataOrigin = "live" | "simulated" | "unverified";

/**
 * İskeletin taklit ettiği içerik biçimi.
 *
 * İskelet "bir şeyler yükleniyor" demez; **ne** yükleniyorsa onun ölçüsünü
 * gösterir. Bu yüzden biçim bir parametredir, bir varsayılan değil.
 */
export type SkeletonShape = "text" | "metric" | "table" | "chart";
