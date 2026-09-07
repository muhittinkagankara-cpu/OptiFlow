/**
 * Karşılama ekranı — oturum açmamış ziyaretçinin gördüğü ilk şey.
 *
 * İki yol sunar ve ikisi de eşit ağırlıkta değildir: **Demo Başlat** birincil
 * eylemdir çünkü ziyaretçinin ürünü görmesi, hesap açmasından önce gelir.
 * Kayıt ekranı ikinci tıkta durur.
 *
 * Demo hiçbir veri istemez ve hiçbir uca istek atmaz; bu, ekranda açıkça
 * yazılır. "Kayıt gerekmez" cümlesi bir pazarlama sözü değil, ölçülebilir bir
 * davranıştır: demo `session === null` iken çalışır ve uygulamanın bütün
 * ağ etkileri oturuma bağlıdır.
 */

import { useState } from "react";
import {
  BarChart3,
  Boxes,
  FileText,
  Play,
  Radio,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { PHASE_LIST } from "../../lib/demo";
import { LoginPage } from "../auth/LoginPage";

const HIGHLIGHTS: { icon: LucideIcon; title: string; detail: string }[] = [
  {
    icon: Radio,
    title: "Canlı üretim merkezi",
    detail: "Kayıttan oynatılan gerçek olay akışı, alarmlar ve anlık göstergeler.",
  },
  {
    icon: BarChart3,
    title: "Finansal etki",
    detail: "Kaybın nerede oluştuğu ve ne kadara mal olduğu, ısı haritasıyla.",
  },
  {
    icon: Sparkles,
    title: "Factory Intelligence",
    detail: "En büyük problem, sebebi, parasal etkisi ve önerilen aksiyon.",
  },
  {
    icon: FileText,
    title: "Yönetici raporu",
    detail: "Kapaklı PDF ve beş sekmelik Excel çıktısı — demoda da indirilebilir.",
  },
];

export function LandingPage({ onStartDemo }: { onStartDemo: () => void }) {
  const [showAuth, setShowAuth] = useState(false);

  if (showAuth) {
    return (
      <div className="relative h-full">
        <button
          type="button"
          onClick={() => setShowAuth(false)}
          className="absolute top-4 left-4 z-10 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
        >
          ← Tanıtıma dön
        </button>
        <LoginPage />
      </div>
    );
  }

  return (
    <div className="relative min-h-full overflow-y-auto">
      <div className="optiflow-aurora" />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-16">
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_1fr]">
          {/* Sol: teklif */}
          <div className="optiflow-enter">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-600/12 px-3 py-1 text-[11px] font-semibold text-brand-700">
              <span className="relative flex h-1.5 w-1.5 text-brand-500">
                <span className="optiflow-live-dot absolute inset-0 rounded-full bg-current" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
              </span>
              OptiFlow — Üretim Karar Merkezi
            </span>

            <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight text-slate-900 sm:text-4xl">
              Fabrikanızın darboğazını
              <br />
              <span className="text-brand-700">beş dakikada</span> görün.
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-500">
              Hazır bir metal işleme hattı üzerinden ürünün tamamını gezin: canlı
              üretim ekranı, alarmlar, finansal kayıp analizi, öneriler ve
              indirilebilir yönetici raporu.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onStartDemo}
                className="optiflow-lift inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Play className="h-4 w-4" />
                Demo Başlat
              </button>
              <button
                type="button"
                onClick={() => setShowAuth(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <UserPlus className="h-4 w-4" />
                Kendi Fabrikamı Oluştur
              </button>
            </div>

            {/* Vaadin ölçülebilir hâli. */}
            <p className="mt-3 text-xs text-slate-500">
              Demo için kayıt, kart ya da veri girişi gerekmez; hiçbir sunucuya
              istek gönderilmez.
            </p>

            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {HIGHLIGHTS.map((item, index) => (
                <li
                  key={item.title}
                  style={{ animationDelay: `${index * 60}ms` }}
                  className="optiflow-enter rounded-xl border border-slate-200 bg-white p-3.5"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <item.icon className="h-4 w-4 text-brand-700" />
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Sağ: demonun beş dakikası */}
          <div
            style={{ animationDelay: "120ms" }}
            className="optiflow-enter rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">
                Demoda ne olacak?
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Hat kendiliğinden ilerler; hiçbir şey tıklamanız gerekmez.
            </p>

            <ol className="mt-4 space-y-2.5">
              {PHASE_LIST.map((phase) => (
                <li key={phase.phase} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold text-slate-600">
                    {phase.phase}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-medium text-slate-900">
                      {phase.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                      {phase.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-4 rounded-xl border border-slate-200 bg-slate-100/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
              Demodaki rakamlar hazır bir veri kümesinden gelir; gerçek bir
              koşum değildir. Her ekranda bunu söyleyen bir şerit durur.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
