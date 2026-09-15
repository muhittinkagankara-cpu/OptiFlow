/**
 * Hata durumu (Sprint 1A).
 *
 * Dört şey söyler (MASTER §13): ne başarısız oldu, bu ne demek, tek bir
 * tekrar-dene eylemi ve açılır bir teknik ayrıntı. Metin özür dilemez,
 * belirsiz olmaz ve kullanıcıyı suçlamaz.
 *
 * Teknik ayrıntı `<details>` ile çizilir: tarayıcının kendi öğesi klavye ve
 * ekran okuyucu davranışını hazır getirir; elle kurulan bir aç-kapa bunların
 * hepsini yeniden yazmayı gerektirirdi.
 *
 * Tekrar-dene düğmesi mevcut `Button` ilkelini kullanır — yeni bir düğme
 * deseni üretmek için bir gerekçe yok (MASTER §18.1).
 *
 * Bu bileşen henüz hiçbir ekrana bağlı değildir.
 */

import { normalizeDetail, retryLabel } from "../../lib/ui";
import { Button } from "./Primitives";

interface ErrorStateProps {
  /** Ne başarısız oldu — sistemin değil, kullanıcının dilinde. */
  title: string;
  /** Bu ne demek — kullanıcı için sonucu. */
  meaning: string;
  /** Tekrar-dene eylemi. Verilmezse düğme çizilmez. */
  onRetry?: () => void;
  /** Tekrar-dene düğmesinin metni; verilmezse "Yeniden dene". */
  retryText?: string;
  /** Teknik ayrıntı. Boşsa açılır bölüm hiç çizilmez. */
  detail?: string | null;
  className?: string;
}

export function ErrorState({
  title,
  meaning,
  onRetry,
  retryText,
  detail,
  className = "",
}: ErrorStateProps) {
  const technicalDetail = normalizeDetail(detail);
  return (
    <div
      role="alert"
      className={`rounded-[var(--of-radius-md)] bg-[var(--of-surface-1)] p-[var(--of-spacing-16)] ${className}`}
    >
      <p className="text-sm font-semibold text-[var(--of-ink-1)]">{title}</p>
      <p className="mt-[var(--of-spacing-4)] text-[13px] text-[var(--of-ink-2)]">
        {meaning}
      </p>

      {onRetry && (
        <div className="mt-[var(--of-spacing-12)]">
          <Button onClick={onRetry} variant="secondary" size="sm">
            {retryLabel(retryText)}
          </Button>
        </div>
      )}

      {technicalDetail && (
        <details className="mt-[var(--of-spacing-12)]">
          <summary className="cursor-pointer text-[12px] text-[var(--of-ink-3)]">
            Teknik ayrıntı
          </summary>
          <pre className="mt-[var(--of-spacing-8)] overflow-x-auto rounded-[var(--of-radius-sm)] bg-[var(--of-surface-sunken)] p-[var(--of-spacing-12)] text-[11.5px] whitespace-pre-wrap text-[var(--of-ink-3)]">
            {technicalDetail}
          </pre>
        </details>
      )}
    </div>
  );
}
