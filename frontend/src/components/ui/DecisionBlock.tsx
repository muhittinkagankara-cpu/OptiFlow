/**
 * Karar bloğu (MASTER §16).
 *
 * "AI Morning Brief" ile "Bugün Yapılacaklar" birleşti. Eski hâlde ikisi aynı
 * kural motorundan besleniyor ama iki ayrı biçimde sunuluyordu; üstelik brief
 * kartının içinde üç kenarlıklı kutu daha vardı (ANTI-PATTERNS #2, #9).
 *
 * Blok tek panel, iç bölmeler hairline. Satırlar yalnızca **ölçülmüş** veri
 * varsa çizilir; güven satırı hesaplanamıyorsa hiç görünmez — boş bir "Güven:"
 * etiketi ölçüm varmış izlenimi bırakırdı.
 *
 * Para satırı bunun istisnasıdır: tutar yoksa gizlenmez, "—" ile birlikte
 * nedeni ve ölçümü tamamlayacak eylem yazılır (Yasa 4).
 *
 * Bu sürümde bir dil modeli yoktur. Öneri, `lib/actionItems` içindeki eşik
 * tabanlı kurallardan gelir ve blok bunu "AI" diye sunmaz.
 *
 * ## Sprint 2F-C — dikey ritim
 *
 * Blok 1280 pikselde 246,9 piksel yer kaplıyor ve alanının yalnızca %29,5'i
 * metindi; geri kalanı boşluktu. Üç şey sıkıldı ve hiçbiri bilgi eksiltmedi:
 * satır dolgusu 12'den 8 piksele indi, koşum satırı eylemin yanına taşındı,
 * eylemi ayıran 33 piksellik boşluk 25 piksellik tek bir hairline ritmine
 * dönüştü.
 */

import type { ReactNode } from "react";
import { STATE_COLOR_VAR, type MeasuredState } from "../../lib/ui";

interface DecisionBlockProps {
  /** Kararın konusu; ölçülmüş durumdan gelir. */
  state: MeasuredState;
  /** Durumun yazılı karşılığı — renk tek taşıyıcı olmasın diye zorunlu. */
  stateLabel: string;
  /** Ne olduğu. */
  situation: string;
  /** Niçin bu sonuç çıktı. */
  why?: string | null;
  /** Operasyonel etki. */
  impact?: string | null;
  /** Parasal karşılık; `null` ise "—" ve nedeni yazılır. */
  money?: { amount: string | null; reason: string | null; action?: ReactNode };
  /**
   * Kararın dayandığı koşumun kimliği: yöntem, örneklem, belirsizlik.
   *
   * MASTER §16 bu satırı "Güven" diye anar. Burada etiketi **"Koşum"**:
   * elimizdeki belirsizlik ölçüsü (`confidence_interval_95`) çıktıya aittir,
   * tek tek kararlara değil. "Güven" yazmak, fire oranıyla ilgili bir kararın
   * güvenini ölçmüşüz izlenimi bırakırdı. Ölçülemiyorsa satır hiç çizilmez.
   *
   * Sprint 2F-C: satır yığından çıkıp eylemin yanına indi. Görünürlüğü
   * azalmadı, ağırlığı azaldı — gerekçeyle eşit puntoda durduğunda ikisi aynı
   * türden bilgi sanılıyordu.
   */
  provenanceLine?: string | null;
  /** Bulunduğu bölgenin tek birincil eylemi. */
  action: ReactNode;
  className?: string;
}

/** Etiket–değer satırı; değer yoksa satır hiç çizilmez. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-[var(--of-surface-hairline)] py-[var(--of-spacing-8)] sm:flex-row sm:gap-4">
      <span className="shrink-0 text-[11px] font-medium tracking-[0.08em] text-[var(--of-ink-3)] uppercase sm:w-24 sm:pt-0.5">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--of-ink-2)]">
        {children}
      </div>
    </div>
  );
}

export function DecisionBlock({
  state,
  stateLabel,
  situation,
  why,
  impact,
  money,
  provenanceLine,
  action,
  className = "",
}: DecisionBlockProps) {
  return (
    <section
      className={`rounded-[var(--of-radius-md)] bg-[var(--of-surface-1)] p-[var(--of-spacing-16)] ${className}`}
    >
      <div
        // Durum kelepçesi: renk + yazılı etiket, ikisi birden.
        className="border-l-2 pl-[var(--of-spacing-12)]"
        style={{ borderColor: `var(${STATE_COLOR_VAR[state]})` }}
      >
        <p
          className="text-[11px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: `var(${STATE_COLOR_VAR[state]})` }}
        >
          {stateLabel}
        </p>
        <p className="mt-1 text-[15px] leading-5 font-semibold text-[var(--of-ink-1)]">
          {situation}
        </p>
      </div>

      <div className="mt-[var(--of-spacing-12)]">
        {why && <Row label="Neden">{why}</Row>}
        {impact && <Row label="Etki">{impact}</Row>}

        {money && (
          <Row label="Para">
            {money.amount === null ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[var(--of-ink-4)]">—</span>
                {money.reason && (
                  <span className="text-[var(--of-ink-3)]">{money.reason}</span>
                )}
                {money.action}
              </span>
            ) : (
              <span className="font-mono text-base tabular-nums text-[var(--of-semantic-value-ink)]">
                {money.amount}
              </span>
            )}
          </Row>
        )}
      </div>

      {/*
        Eylem, gerekçeden 33 piksellik bir boşlukla ayrılmıştı ve bloğa sonradan
        eklenmiş gibi duruyordu. Artık satırlarla aynı hairline ritmini
        sürdürüyor: neden → koşum → eylem kesintisiz okunuyor.

        Koşum satırı buraya, eylemin yanına indi. Ayrı bir etiket–değer satırı
        olduğunda "Neden" ile eşit ağırlıktaydı; oysa o bir gerekçe değil,
        kararın dayandığı koşumun kimliğidir. Yeri, "buna ne kadar
        güvenebilirim?" sorusunun sorulduğu an — yani eyleme basmadan hemen
        önce.
      */}
      <div className="mt-[var(--of-spacing-12)] flex flex-col gap-[var(--of-spacing-12)] border-t border-[var(--of-surface-hairline)] pt-[var(--of-spacing-12)] sm:flex-row sm:items-center sm:justify-between">
        <div className="shrink-0">{action}</div>
        {provenanceLine && (
          <p className="min-w-0 text-[11px] leading-4 text-[var(--of-ink-3)] sm:text-right">
            <span className="font-medium tracking-[0.08em] uppercase">
              Koşum
            </span>{" "}
            {provenanceLine}
          </p>
        )}
      </div>
    </section>
  );
}
