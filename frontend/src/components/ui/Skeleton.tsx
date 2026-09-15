/**
 * İskelet yükleme göstergesi (Sprint 1A).
 *
 * Gelecek içeriğin ölçüsünü önceden ayırır. Dönen bir gösterge "bekle" der ama
 * "ne bekliyorsun" demez; ayrıca içerik gelince düzen zıplar ve bir sonraki
 * tıklamanın hedefi kayar (MASTER §12, ANTI-PATTERNS #13).
 *
 * Bu bileşen henüz hiçbir ekrana bağlı değildir. Sprint 1A'nın sözleşmesi
 * "mevcut ekranlarda sıfır görsel fark"tır; bağlama işi ekran ekran yapılır.
 *
 * Geometri burada değil `lib/ui/skeleton.ts` içindedir: kaç çubuk çizileceği
 * ve son satırın neden kısa olduğu sınanabilir bir karardır.
 */

import { skeletonBars, skeletonLabel, type SkeletonShape } from "../../lib/ui";

interface SkeletonProps {
  /** Taklit edilecek içerik biçimi. */
  shape?: SkeletonShape;
  /** Satır sayısı; verilmezse biçimin varsayılanı kullanılır. */
  rows?: number;
  /**
   * Ekran okuyucuya söylenecek metin.
   *
   * Verilmezse biçime göre bir varsayılan kullanılır ("Tablo yükleniyor").
   * Çağıran daha somut bir şey söyleyebiliyorsa söylemelidir.
   */
  label?: string;
  className?: string;
}

export function Skeleton({
  shape = "text",
  rows,
  label,
  className = "",
}: SkeletonProps) {
  const bars = skeletonBars(shape, rows);
  return (
    <div
      role="status"
      aria-busy="true"
      className={`flex flex-col gap-[var(--of-spacing-8)] ${className}`}
    >
      {bars.map((bar, index) => (
        <span
          // Çubukların sırası sabittir ve aralarına ekleme yapılmaz; dizin
          // burada kararlı bir anahtardır.
          key={index}
          aria-hidden="true"
          className="optiflow-skeleton block rounded-[var(--of-radius-sm)]"
          style={{ width: `${bar.widthPercent}%`, height: `${bar.heightPx}px` }}
        />
      ))}
      {/* Görsel iskelet ekran okuyucu için anlamsızdır; ne yüklendiği yazıyla
          söylenir. */}
      <span className="sr-only">{label ?? skeletonLabel(shape)}</span>
    </div>
  );
}
