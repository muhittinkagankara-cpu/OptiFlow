/**
 * Kurulum ilerlemesi — tek satır (Sprint 2D).
 *
 * Command Center eskiden aynı yedi maddeyi **iki ayrı blokta** gösteriyordu:
 * bir kez çip satırı (`First30MinutesGuide`), bir kez tam liste
 * (`SetupChecklistCard`). İkisi de aynı `useEnterpriseSetup` durumundan
 * besleniyordu ve birlikte ilk ekranın tamamını kaplıyordu
 * (ANTI-PATTERNS #9, #18).
 *
 * Artık tek satır: kaç adım bitti, sırada ne var, nereye gidilir. Tüm adımlar
 * bitince şerit **tümüyle kaybolur** — bitmiş bir işin ekranda yer kaplaması,
 * kullanıcıya hâlâ yapacak bir şey varmış gibi gelirdi.
 *
 * Kurulum mantığı burada değil: adımlar, süreler ve "bitti mi" kararı
 * `lib/onboarding-enterprise` içinde kalır.
 */

import { ArrowRight } from "lucide-react";
import type { ChecklistItem } from "../../lib/onboarding-enterprise";

interface SetupProgressStripProps {
  items: ChecklistItem[];
  onNavigate: (view: string) => void;
}

export function SetupProgressStrip({
  items,
  onNavigate,
}: SetupProgressStripProps) {
  const done = items.filter((item) => item.done).length;
  const next = items.find((item) => !item.done);

  // Kurulum bitti: şerit hiç çizilmez.
  if (items.length === 0 || next === undefined) {
    return null;
  }

  return (
    <section className="flex flex-wrap items-center gap-x-[var(--of-spacing-12)] gap-y-[var(--of-spacing-8)] rounded-[var(--of-radius-md)] bg-[var(--of-surface-1)] px-[var(--of-spacing-16)] py-[var(--of-spacing-12)]">
      <span className="font-mono text-[13px] tabular-nums text-[var(--of-ink-1)]">
        {done}/{items.length}
      </span>
      <span className="text-[13px] text-[var(--of-ink-2)]">
        Kurulum sürüyor — sırada{" "}
        <span className="font-medium text-[var(--of-ink-1)]">{next.label}</span>
      </span>
      <button
        type="button"
        onClick={() => onNavigate(next.view)}
        /*
         * Dokunma hedefi 27,5 px'ti (MASTER §14: en az 44×44). Yükseklik
         * `min-h` ile açılır; yazı boyutu ve dolgu değişmez, yani bağlantı
         * görünümü korunur — yalnızca parmağın isabet ettiği alan büyür.
         */
        className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-[var(--of-radius-sm)] px-[var(--of-spacing-8)] py-[var(--of-spacing-4)] text-[13px] font-medium text-[var(--of-interactive)] transition-colors duration-200 hover:text-[var(--of-interactive-hover)] focus:outline-none"
      >
        Devam et
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
