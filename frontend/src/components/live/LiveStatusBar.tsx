/**
 * Komuta merkezinin üst durum çubuğu (Sprint 2J).
 *
 * Ekranın kim olduğunu ve şu anda neye baktığınızı tek satırda söyler. Dört
 * alan taşır ve **dördü de mevcut ölçümlerden okunur**; burada hiçbir şey
 * hesaplanmaz, hiçbir alan uydurulmaz:
 *
 * - Besleme durumu → `feedStatus()` (Gerçek Veri / Veri Bekleniyor / Benzetim /
 *   Doğrulanmadı). Aynı karar ekranın kalıcı köken şeridini de besler.
 * - Son güncelleme → `state.clockMinutes`, vardiya saati.
 * - Kısıt → `bottleneckStationId()`; kısıt yoksa "—" yazar, bir istasyon o
 *   role zorlanmaz (Yasa 4).
 * - Mod → seçili kaynağın adı.
 *
 * Etiketler küçük ve büyük harfli, değerler büyük: operatör iki metre öteden
 * değeri okur, etiketi ise yalnızca ilk kez bakarken okur.
 */

import type { ReactNode } from "react";

interface LiveStatusBarProps {
  /** Besleme durumunun kısa etiketi ("Benzetim", "Gerçek Veri", ...). */
  feedLabel: string;
  /** Beslemenin ölçülmüş durumu; noktanın rengini belirler. */
  feedTone: "real" | "waiting" | "simulated" | "unverified";
  /** Vardiya saati, biçimlendirilmiş. */
  clock: string;
  /** Kısıt istasyonunun adı; kısıt yoksa `null`. */
  constraintName: string | null;
}

/* Nokta rengi ölçülmüş besleme durumundan gelir; dekoratif değildir. */
const TONE_DOT: Record<LiveStatusBarProps["feedTone"], string> = {
  real: "bg-[var(--of-semantic-ok)]",
  waiting: "bg-[var(--of-semantic-warn)]",
  simulated: "bg-[var(--of-semantic-unknown)]",
  unverified: "bg-[var(--of-semantic-warn)]",
};

export function LiveStatusBar({
  feedLabel,
  feedTone,
  clock,
  constraintName,
}: LiveStatusBarProps) {
  return (
    <header className="flex min-h-[72px] shrink-0 flex-wrap items-center gap-x-8 gap-y-3 border-b border-[var(--of-cc-border)] bg-[var(--of-cc-panel)] px-4 py-3 sm:px-6">
      <p className="text-[13px] font-semibold tracking-[0.14em] text-[var(--of-cc-ink)] uppercase">
        Live Factory
      </p>

      {/* Besleme durumu: renk tek başına taşımaz, yazı her zaman yanındadır. */}
      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--of-cc-border)] px-3 py-1">
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[feedTone]}`} />
        <span className="text-[12px] font-medium text-[var(--of-cc-ink)]">
          {feedLabel}
        </span>
      </span>

      <Field label="Son güncelleme" value={clock} />
      <Field label="Kısıt" value={constraintName ?? "—"} />
      {/* "Mod" alanı kaldırıldı (V3 §3.8.6): hemen altındaki Kaynak
          seçicisi aynı değeri zaten söylüyordu. Durum çubuğu yalnızca
          başka yerde okunamayan ölçümleri taşır. */}
    </header>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[15px] text-[var(--of-cc-ink)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
