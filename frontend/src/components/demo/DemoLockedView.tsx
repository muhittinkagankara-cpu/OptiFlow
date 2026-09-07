/**
 * Demoda kapalı olan ekranların yerine geçen açıklama.
 *
 * Model düzenleme, kaydetme, Excel içe aktarma ve envanter, sunucuya yazan
 * işlemlerdir; demo oturum açmadan çalıştığı için bunlar **çağrılamaz**.
 *
 * Ekranı gizlemek yerine nedenini yazmak bilinçlidir: menüden kaybolan bir
 * bölüm, ürünün o yeteneği hiç taşımadığı izlenimi verir. Burada tam tersi
 * söylenir — özellik vardır, demoda kapalıdır ve açmanın yolu bellidir.
 */

import { Lock, UserPlus } from "lucide-react";

export function DemoLockedView({
  title,
  detail,
  onSignUp,
}: {
  title: string;
  detail: string;
  onSignUp: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
          <Lock className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          {detail}
        </p>
        <button
          type="button"
          onClick={onSignUp}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <UserPlus className="h-4 w-4" />
          Kendi fabrikanızı oluşturun
        </button>
      </div>
    </div>
  );
}
