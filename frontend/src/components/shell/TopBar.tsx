/**
 * Üst çubuk — bağlam solda, kullanıcı eylemleri sağda.
 *
 * Sol taraf sayfaya göre değişir: Command Center'da kullanıcıyı adıyla
 * selamlar, diğer ekranlarda sayfanın adını taşır. Sabit bir başlık
 * kullanılsaydı, karşılama yalnızca bir ekrana özel bir istisna olur ve
 * kabuğun geri kalanıyla aynı hizada durmazdı.
 *
 * Sağdaki bildirim ve AI Copilot düğmeleri bu sprintte yer tutucudur; ikisi de
 * gerçek bir uca istek atmaz. Yer tutucu olduklarını `title` ile açıkça
 * söylerler — tıklayınca hiçbir şey olmayan bir düğme, bozuk bir düğmeden
 * ayırt edilemez.
 */

import { useState } from "react";
import { Bell, LogOut, Menu, Sparkles } from "lucide-react";
import { initialsOf } from "./userDisplay";

interface TopBarProps {
  /** Command Center'da karşılama, diğer ekranlarda sayfa adı. */
  title: string;
  subtitle: string;
  orgName: string;
  userEmail: string | null;
  onOpenMenu: () => void;
  onOpenCopilot: () => void;
  onLogout: () => void;
}

export function TopBar({
  title,
  subtitle,
  orgName,
  userEmail,
  onOpenMenu,
  onOpenCopilot,
  onLogout,
}: TopBarProps) {
  const [isProfileOpen, setProfileOpen] = useState(false);

  return (
    /* Zemin opak; cam (yarı saydam + bulanıklık) bilinçli olarak kaldırıldı.
       Ölçüldü: `bg-slate-50/80` + `backdrop-blur(24px)` cam yüzey üretiyordu ve
       bu, tasarım otoritesinin açıkça dışladığı bir görünüm (MASTER §1). Ayrıca
       altındaki içeriğin bulanık hayaleti, üst çubuğun taşıdığı sayfa adının
       okunurluğunu düşürüyordu. Opak yüzey hem kuralı karşılar hem de
       enstrüman panelinin sakin dilini korur. */
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Menüyü aç"
        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h1>
        <p className="truncate text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenCopilot}
          className="hidden items-center gap-2 rounded-lg border border-brand-300 bg-brand-600/12 px-3 py-1.5 text-sm font-medium text-brand-700 transition-all duration-200 hover:bg-brand-600/20 focus:outline-none sm:inline-flex"
        >
          <Sparkles className="h-4 w-4" />
          AI Copilot
        </button>

        <button
          type="button"
          title="Bildirimler — bu sürümde yer tutucu"
          aria-label="Bildirimler"
          className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Bell className="h-4.5 w-4.5" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-brand-500" />
        </button>

        {/* Profil: tıklanınca organizasyon ve çıkış seçeneğini açar. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-expanded={isProfileOpen}
            aria-label="Profil menüsü"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white transition-transform duration-200 hover:scale-105 focus:outline-none"
          >
            {initialsOf(userEmail, orgName)}
          </button>

          {isProfileOpen && (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setProfileOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {userEmail ?? "Kullanıcı"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{orgName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <LogOut className="h-4 w-4" />
                  Çıkış yap
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
