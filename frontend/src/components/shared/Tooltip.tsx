/**
 * Küçük bir (?) düğmesi ve yanında açılan açıklama balonu.
 *
 * Teknik olmayan kullanıcı için kritik bir bileşen: "Üstel Dağılım" gibi bir
 * terimi gördüğünde ne anlama geldiğini öğrenebilmeli, ama bu açıklama arayüzü
 * sürekli meşgul etmemeli. Balon hem fareyle üzerine gelince hem klavye
 * odağında açılır; yalnızca `:hover` ile çalışan bir ipucu klavye kullanıcıları
 * ve dokunmatik cihazlar için erişilemez olurdu.
 */

import { useId, useState } from "react";
import { InfoIcon } from "./icons";

interface TooltipProps {
  /** Balonda gösterilecek açıklama. */
  content: string;
  /** Ekran okuyucular için düğmenin adı. */
  label?: string;
}

export function Tooltip({ content, label = "Açıklama" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="cursor-help rounded-full p-0.5 text-slate-400 transition-colors hover:text-brand-600 focus:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // Dokunmatik cihazlarda hover yok; tıklama ile açılıp kapanır.
          event.preventDefault();
          setOpen((previous) => !previous);
        }}
      >
        <InfoIcon className="h-4 w-4" />
      </button>

      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-xs leading-relaxed font-normal text-white shadow-lg"
        >
          {content}
          <span className="absolute top-full left-1/2 -ml-1 border-4 border-transparent border-t-slate-800" />
        </span>
      )}
    </span>
  );
}
