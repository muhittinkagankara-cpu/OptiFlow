/**
 * Rapor logosu.
 *
 * Logo tarayıcıda saklanır (`localStorage`), sunucuya gönderilmez. Bu bilinçli
 * bir sınırdır: logo bir marka varlığıdır, iş verisi değil; sunucuya yüklemek
 * kiracı başına dosya saklama, boyut ve erişim denetimi gerektirirdi ve bu
 * sprintin kapsamı değil. Bunun bedeli de açıkça yazılır — logo yalnızca bu
 * tarayıcıda görünür.
 *
 * `factoryModel.ts` ile aynı deseni izler: her `localStorage` erişimi
 * `try/catch` içindedir, çünkü gizli sekmede ve depolama kapalıyken yazma hata
 * verir ve bir kolaylık özelliği rapor üretimini durdurmamalıdır.
 */

const STORAGE_KEY = "optiflow.reportLogo";

/**
 * Kabul edilen türler.
 *
 * pdfmake yalnızca PNG ve JPEG gömebilir; SVG desteklenmez. Kullanıcıya
 * "yüklendi" deyip PDF üretiminde sessizce düşmek yerine, seçim anında
 * reddetmek doğrusudur.
 */
export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg"] as const;

/**
 * En büyük logo boyutu (bayt).
 *
 * `localStorage` kotası tarayıcı başına birkaç megabayttır ve base64
 * kodlaması dosyayı yaklaşık üçte bir büyütür. 512 KB, bir logo için fazlasıyla
 * yeterli ve kotayı zorlamaz.
 */
export const MAX_LOGO_BYTES = 512 * 1024;

export interface LogoCandidate {
  type: string;
  size: number;
}

/**
 * Seçilen dosyayı doğrular.
 *
 * Uygunsa `null`, değilse kullanıcıya gösterilecek Türkçe hata döner. Hata
 * metninin burada üretilmesi bilinçlidir: kural ile mesaj birlikte sınanır ve
 * bileşen yalnızca gösterir.
 */
export function validateLogo(file: LogoCandidate): string | null {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type as (typeof ACCEPTED_LOGO_TYPES)[number])) {
    return "Logo yalnızca PNG veya JPEG olabilir; PDF'e gömülebilen türler bunlar.";
  }
  if (file.size > MAX_LOGO_BYTES) {
    const limit = Math.round(MAX_LOGO_BYTES / 1024);
    return `Logo ${limit} KB'den küçük olmalı; seçilen dosya ${Math.round(file.size / 1024)} KB.`;
  }
  if (file.size === 0) {
    return "Seçilen dosya boş görünüyor.";
  }
  return null;
}

/**
 * Saklanmış bir logonun PDF'e gömülebilir olup olmadığı.
 *
 * Depodan okunan değere güvenilmez: kullanıcı ya da başka bir sekme oraya
 * herhangi bir metin yazmış olabilir ve geçersiz bir veri URL'i pdfmake'i
 * çalışma zamanında düşürürdü.
 */
export function isEmbeddableLogo(value: string | null): value is string {
  if (value === null) {
    return false;
  }
  return ACCEPTED_LOGO_TYPES.some((type) => value.startsWith(`data:${type};base64,`));
}

/** Saklanmış logoyu okur; yoksa ya da bozuksa `null`. */
export function readLogo(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isEmbeddableLogo(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Logoyu saklar. Depolama kapalıysa sessizce vazgeçer. */
export function saveLogo(dataUrl: string): void {
  if (!isEmbeddableLogo(dataUrl)) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, dataUrl);
  } catch {
    // Kota dolu ya da depolama kapalı; logo bir kolaylıktır, akışı durdurmaz.
  }
}

/** Saklanmış logoyu siler. */
export function clearLogo(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Yok sayılır.
  }
}
