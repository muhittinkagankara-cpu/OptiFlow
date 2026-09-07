/**
 * "Son Çalıştığınız Fabrikalar" — hero ekranının altındaki hızlı giriş.
 *
 * İlk kez gelen kullanıcı için görünmez (kayıtlı fabrika yoksa hiç
 * çizilmez); dönen kullanıcı içinse ekranın en değerli parçasıdır. Onboarding
 * akışının başına dönmek zorunda kalmadan, bıraktığı yerden devam eder.
 *
 * Rozetteki sayılar **mevcut veriden** gelir: OEE, darboğaz ve son çalıştırma
 * zamanı, o fabrikadan alınmış son koşumun kaydından okunur (bkz.
 * `lib/onboarding.recentFactories`). Koşum kaydı yoksa rozet hiç gösterilmez —
 * "%0 OEE" yazmak, hattın ölçülmüş ve kötü çıkmış olduğu izlenimini verirdi.
 */

import { ArrowRight, Building2, Gauge, TriangleAlert } from "lucide-react";
import type { RecentFactory } from "../../lib/onboarding";
import { relativeTime } from "../../lib/runHistory";

interface RecentFactoriesProps {
  items: RecentFactory[];
  onOpen: (factoryId: string) => void;
}

export function RecentFactories({ items, onOpen }: RecentFactoriesProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mt-12 w-full">
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
        Son Çalıştığınız Fabrikalar
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ factory, lastRun }, index) => (
          <button
            key={factory.id}
            type="button"
            onClick={() => onOpen(factory.id)}
            style={{ animationDelay: `${index * 60}ms` }}
            className="optiflow-glass optiflow-lift optiflow-enter group rounded-xl border border-slate-200 p-4 text-left hover:border-brand-300 focus:outline-none"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600/15 text-brand-700">
                <Building2 className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {factory.name}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {factory.sector ?? "Sektör belirtilmedi"}
                  {" · "}
                  {lastRun
                    ? `son açılış ${relativeTime(lastRun.ranAt)}`
                    : `${factory.version_count} sürüm`}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5" />
            </div>

            {/* Son simülasyon rozeti — yalnızca gerçek bir koşum varsa. */}
            {lastRun && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-3">
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                  <Gauge className="h-3 w-3" />
                  %{Math.round(lastRun.oee * 100)} OEE
                </span>
                {lastRun.bottleneckName && (
                  <span
                    className="inline-flex max-w-[9rem] items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                    title={`Darboğaz: ${lastRun.bottleneckName}`}
                  >
                    <TriangleAlert className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lastRun.bottleneckName}</span>
                  </span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
