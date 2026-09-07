/**
 * Alt gezinme çubuğu.
 *
 * Ekranın en altındadır çünkü telefon tek elle tutulurken başparmağın rahat
 * ulaştığı bölge orasıdır. Beş sekme, 375 piksel genişlikte her birine 75
 * piksel bırakır — dokunma hedefi için yeterli, altı sekme olsaydı değildi.
 *
 * "Tara" ortada ve vurgulu durur: vardiya boyunca en sık yapılan işlem odur ve
 * ortadaki hedefe her iki elle de ulaşılır.
 */

import { OPERATOR_NAV, type OperatorTab } from "./navigation";

export function BottomNav({
  active,
  onSelect,
}: {
  active: OperatorTab;
  onSelect: (tab: OperatorTab) => void;
}) {
  return (
    <nav
      aria-label="Operatör gezinmesi"
      className="shrink-0 border-t border-slate-200 bg-slate-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="flex">
        {OPERATOR_NAV.map((item) => {
          const isActive = item.id === active;
          const isScan = item.id === "scan";
          return (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-[3.5rem] w-full flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors duration-200 focus:outline-none ${
                  isActive ? "text-brand-700" : "text-slate-500 active:text-slate-900"
                }`}
              >
                <span
                  className={`flex items-center justify-center rounded-xl transition-colors duration-200 ${
                    isScan
                      ? `h-9 w-12 ${isActive ? "bg-brand-600/20" : "bg-slate-100"}`
                      : "h-6 w-6"
                  }`}
                >
                  <item.icon className={isScan ? "h-5 w-5" : "h-5 w-5"} />
                </span>
                {/* Simge tek başına bırakılmaz: "Tara" ile "Bildirim"
                    simgelerini ilk kez gören biri ayırt edemez. */}
                <span className="text-[10px] leading-tight font-medium">
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
