/**
 * İstasyon detay çekmecesi.
 *
 * Diyagramdaki bir düğüme tıklanınca sağdan açılır. Gösterdiği her alan
 * sağlayıcıdan gelen canlı durumdan okunur; hiçbiri burada hesaplanmaz.
 *
 * Kapatma iki yoldan yapılabilir (düğme ve arka perde) çünkü çekmece dar
 * ekranda tüm genişliği kaplar ve tek bir küçük çarpı, dokunmatikte zor
 * hedeftir.
 */

import { memo } from "react";
import { X } from "lucide-react";
import {
  STATUS_LABEL,
  formatClock,
  type Alarm,
  type StationLiveState,
  alarmAction,
} from "../../lib/live";
import { STATUS_STYLE } from "./liveStyles";

interface StationDrawerProps {
  station: StationLiveState | null;
  /** Bu istasyonun en son alarmı; yoksa `null`. */
  lastAlarm: Alarm | null;
  clockMinutes: number;
  onClose: () => void;
  /**
   * Alarmın bağlanabildiği ekrana götürür (Sprint 2I-B).
   *
   * Yalnızca `alarmAction` güvenilir bir hedef bulduğunda çağrılır; hedefi
   * olmayan alarm için düğme hiç çizilmez.
   */
  onOpenSimulation?: () => void;
}

function StationDrawerInner({
  station,
  lastAlarm,
  clockMinutes,
  onClose,
  onOpenSimulation,
}: StationDrawerProps) {
  if (!station) {
    return null;
  }

  const style = STATUS_STYLE[station.status];
  /* Eylem kararı bileşende verilmez; `lib/live/alarmAction` verir. */
  const action = alarmAction(lastAlarm);
  const handled = station.completed + station.scrapped;
  const scrapRate = handled > 0 ? station.scrapped / handled : null;
  /*
   * Kullanım oranı, çevrimiçi makinelerden üretim yapanların payıdır. Koşum
   * metriklerindeki `utilization` ile karıştırılmamalı: o, bir simülasyonun
   * tamamının ortalamasıdır; buradaki ise şu anki hâldir.
   */
  const utilization =
    station.machineCount > 0 ? station.onlineMachines / station.machineCount : null;

  return (
    <>
      {/* Arka perde yalnızca dar ekranda; masaüstünde çekmece panelin yanında
          durur ve arkadaki diyagram görünür kalmalıdır. */}
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/50 lg:hidden"
      />

      <aside className="optiflow-screen fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[var(--of-cc-border)] bg-[var(--of-cc-panel)] shadow-[var(--of-cc-shadow)] lg:absolute">
        <header className="flex items-start justify-between gap-2 border-b border-[var(--of-cc-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-[22px] leading-7 font-semibold text-[var(--of-cc-ink)]">
              {station.stationName}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--of-cc-ink-muted)]">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              {STATUS_LABEL[station.status]}
              {station.setupProduct && ` · ${station.setupProduct}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--of-cc-ink-muted)] transition-colors hover:bg-[var(--of-cc-card)] hover:text-[var(--of-cc-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {station.faultReason && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {station.faultReason}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2">
            <Field label="Kuyruk" value={String(station.queue)} />
            <Field
              label="Kullanım"
              value={
                utilization === null ? "—" : `%${Math.round(utilization * 100)}`
              }
              hint={`${station.onlineMachines}/${station.machineCount} makine`}
            />
            <Field
              label="OEE"
              value={station.oee > 0 ? `%${Math.round(station.oee * 100)}` : "—"}
            />
            <Field
              label="Çevrim süresi"
              value={station.cycleSeconds > 0 ? `${station.cycleSeconds} sn` : "—"}
            />
            <Field
              label="Fire"
              /* Hiç parça işlenmemişken "%0 fire" demek, ölçüm yapılmadığı
                 hâlde iyi bir sonuç bildirmek olurdu. */
              value={
                scrapRate === null
                  ? "—"
                  : `%${(scrapRate * 100).toFixed(1).replace(".", ",")}`
              }
              hint={`${station.scrapped} adet`}
            />
            <Field
              label="Üretim"
              value={String(station.completed)}
              hint="vardiya toplamı"
            />
          </dl>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              Son operatör
            </h4>
            <p className="mt-0.5 text-sm font-medium text-slate-900">
              {station.operatorName ?? "Atanmamış"}
            </p>
          </section>

          <section className="rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-4">
            <h4 className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
              Son alarm
            </h4>
            {lastAlarm ? (
              <>
                <p className="mt-0.5 text-xs text-slate-700">{lastAlarm.text}</p>
                <p className="mt-1 text-[10px] text-slate-500 tabular-nums">
                  {formatClock(lastAlarm.atMinutes)}
                  {lastAlarm.resolvedAtMinutes === null
                    ? ` · ${Math.max(0, clockMinutes - lastAlarm.atMinutes)} dk açık`
                    : ` · ${lastAlarm.resolvedAtMinutes - lastAlarm.atMinutes} dk sürdü, kapandı`}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-slate-500">
                Bu istasyonda alarm oluşmadı.
              </p>
            )}
          </section>

          {/*
            Sonraki adım (Yasa 5). Çekmece eskiden yalnızca "kapat" ile
            bitiyordu: alarm okunuyor, sonra hiçbir yere gidilmiyordu.

            Eylem **yalnızca** `alarmAction` üründe var olan bir ekran
            bulduğunda çizilir — bugün bu yalnızca kuyruk alarmı için doğru.
            Arıza ve fire alarmlarında düğme hiç görünmez; bağlanacak akış
            olmadan düğme koymak olmayan bir yeteneği vaat etmek olurdu.
          */}
          {action !== null && onOpenSimulation && (
            <section className="border-t border-[var(--of-cc-border)] pt-5">
              <h4 className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
                Sonraki adım
              </h4>
              <p className="mt-2 text-[13px] leading-5 text-[var(--of-cc-ink-muted)]">
                {action.reason}
              </p>
              <button
                type="button"
                onClick={onOpenSimulation}
                className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {action.label}
              </button>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-4">
      <dt className="text-[10px] font-medium tracking-[0.12em] text-[var(--of-cc-ink-label)] uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 font-mono text-[22px] leading-7 text-[var(--of-cc-ink)] tabular-nums">
        {value}
      </dd>
      {hint && <p className="mt-1 text-[12px] text-[var(--of-cc-ink-muted)]">{hint}</p>}
    </div>
  );
}

export const StationDrawer = memo(StationDrawerInner);
