/**
 * Ekran 1 — Hero.
 *
 * Kullanıcının ürünle ilk teması. Amacı bir şey öğretmek değil, otuz saniyede
 * "burası ciddi bir üretim platformu" hissini vermek ve tek bir eyleme
 * yönlendirmek.
 *
 * Rozetler (Monte Carlo, %95 güven aralığı, OEE, kuyruk teorisi) süs değildir:
 * dördü de ürünün gerçekten kullandığı yöntemlerdir ve sonuç ekranında
 * karşılıkları vardır. Kullanılmayan bir yöntemi rozet olarak göstermek,
 * ürünün ilk cümlesinde verilmemiş bir söz vermek olurdu.
 */

import {
  ArrowRight,
  FileSpreadsheet,
  PlayCircle,
  Sigma,
  Timer,
  TrendingUp,
  Waves,
} from "lucide-react";
import type { RecentFactory } from "../../lib/onboarding";
import { FactoryIllustration } from "./FactoryIllustration";
import { RecentFactories } from "./RecentFactories";

const BADGES = [
  { icon: Sigma, label: "%95 Güven Aralığı" },
  { icon: Waves, label: "Monte Carlo" },
  { icon: TrendingUp, label: "OEE" },
  { icon: Timer, label: "Kuyruk Teorisi" },
];

interface HeroScreenProps {
  onStart: () => void;
  recent: RecentFactory[];
  onOpenFactory: (factoryId: string) => void;
  /** Excel içe aktarma akışını açar. */
  onImportExcel: () => void;
}

export function HeroScreen({
  onStart,
  recent,
  onOpenFactory,
  onImportExcel,
}: HeroScreenProps) {
  return (
    <div className="relative min-h-full overflow-hidden">
      <div className="optiflow-aurora" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-4 py-10 sm:px-6 lg:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          {/* -- Metin -- */}
          <div className="optiflow-enter">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-600/12 px-3 py-1 text-[11px] font-semibold text-brand-700">
              <span className="relative flex h-1.5 w-1.5 text-brand-500">
                <span className="optiflow-live-dot absolute inset-0 rounded-full bg-current" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
              </span>
              OptiFlow · Üretim Karar Merkezi
            </span>

            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Fabrikanızı{" "}
              <span className="bg-gradient-to-r from-brand-500 to-emerald-500 bg-clip-text text-transparent">
                2 dakikada
              </span>{" "}
              dijitalleştirin.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-500 sm:text-lg">
              Kod yazmadan üretim hattınızı modelleyin, darboğazı bulun ve
              maliyet kayıplarını görün.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:bg-brand-700 hover:shadow-xl focus:outline-none"
              >
                Başla
                <ArrowRight className="h-4 w-4" />
              </button>

              {/* Elinde hazır bir tablo olan kullanıcı şablon seçmek zorunda
                  değildir; bu yol doğrudan kendi verisine gider. */}
              <button
                type="button"
                onClick={onImportExcel}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100/60 px-6 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-brand-300 hover:text-brand-700 focus:outline-none"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel'den içe aktar
              </button>

              {/* Yer tutucu olduğu açıkça söylenir: tıklayınca hiçbir şey
                  olmayan etkin bir düğme, bozuk bir düğmeden ayırt edilemez. */}
              <button
                type="button"
                disabled
                title="Tanıtım videosu bu sürümde henüz hazır değil"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-slate-100/60 px-6 py-3 text-sm font-semibold text-slate-500 opacity-70"
              >
                <PlayCircle className="h-4 w-4" />
                Demo İzle
              </button>
            </div>

            <ul className="mt-9 flex flex-wrap gap-2">
              {BADGES.map((badge, index) => (
                <li
                  key={badge.label}
                  style={{ animationDelay: `${120 + index * 70}ms` }}
                  className="optiflow-enter optiflow-glass inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600"
                >
                  <badge.icon className="h-3.5 w-3.5 text-brand-700" />
                  {badge.label}
                </li>
              ))}
            </ul>
          </div>

          {/* -- İllüstrasyon -- */}
          <div
            className="optiflow-enter optiflow-glass rounded-3xl border border-slate-200 p-4 sm:p-6"
            style={{ animationDelay: "90ms" }}
          >
            <FactoryIllustration className="h-auto w-full" />
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Şablondan başlayın, kutuları kendi hattınıza göre düzenleyin.
            </p>
          </div>
        </div>

        <RecentFactories items={recent} onOpen={onOpenFactory} />
      </div>
    </div>
  );
}
