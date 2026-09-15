/**
 * Hata durumunun metin kuralları (Sprint 1A).
 *
 * MASTER §13: bir hata dört şey söyler — ne başarısız oldu, bu ne demek, tek
 * bir tekrar-dene eylemi ve açılır bir teknik ayrıntı. Buradaki işlevler
 * yalnızca sonuncusunu düzenler; ilk üçü çağıranın sorumluluğudur çünkü
 * bağlama göre değişir.
 */

/** Tekrar-dene düğmesinin varsayılan metni. */
export const DEFAULT_RETRY_LABEL = "Yeniden dene";

/**
 * Teknik ayrıntıyı normalleştirir.
 *
 * Boş ya da yalnızca boşluktan oluşan bir ayrıntı `null` döner; bileşen o
 * zaman açılır bölümü hiç çizmez. Tıklandığında boş çıkan bir "ayrıntı"
 * bağlantısı, kullanıcıya bilgi saklandığını düşündürür.
 */
export function normalizeDetail(detail?: string | null): string | null {
  if (detail === undefined || detail === null) {
    return null;
  }
  const trimmed = detail.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Tekrar-dene metni; verilmezse varsayılan. */
export function retryLabel(label?: string): string {
  const trimmed = label?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? DEFAULT_RETRY_LABEL
    : trimmed;
}
