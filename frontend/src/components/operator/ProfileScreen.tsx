/**
 * Profil sekmesi.
 *
 * Vardiya kimliği, verinin kaynağı ve yönetim paneline dönüş. Kaynak bilgisi
 * burada da yazılır: operatör "bu rakamlar nereden geliyor?" diye sorduğunda
 * yanıtı bir ekran kaydırma mesafesinde bulmalıdır.
 */

import { Building2, LayoutDashboard, LogOut, Radio, User } from "lucide-react";
import { buildShiftSummary, type OperatorTask } from "../../lib/operator";
import { TouchButton } from "./operatorUi";

export function ProfileScreen({
  operatorName,
  orgName,
  factoryName,
  sourceName,
  sourceDescription,
  isLive,
  tasks,
  onExit,
  onOpenShift,
}: {
  operatorName: string;
  orgName: string;
  factoryName: string | null;
  sourceName: string;
  sourceDescription: string;
  isLive: boolean;
  tasks: OperatorTask[];
  onExit: () => void;
  onOpenShift: () => void;
}) {
  const summary = buildShiftSummary(tasks);

  return (
    <div className="optiflow-screen space-y-4 px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600/15 text-brand-700">
          <User className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-slate-900">
            {operatorName}
          </p>
          <p className="truncate text-xs text-slate-500">Üretim operatörü</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <Row icon={Building2} label="Organizasyon" value={orgName} />
        <Row
          icon={LayoutDashboard}
          label="Fabrika"
          value={factoryName ?? "Seçili fabrika yok"}
        />
        <Row
          icon={Radio}
          label="Veri kaynağı"
          value={sourceName}
          hint={sourceDescription}
          last
        />
      </section>

      {!isLive && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
          Bu ekrandaki görevler örnek verilerdir. Üretim yönetim sistemi
          bağlandığında aynı ekranlar gerçek iş emirlerini gösterecek; arayüzde
          değişiklik gerekmeyecek.
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <p className="text-sm font-semibold text-slate-900">Bugünkü vardiya</p>
        <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
          {summary.completedCount}/{summary.taskCount} görev · {summary.produced}{" "}
          adet üretim · {summary.scrapped} hurda
        </p>
        <TouchButton onClick={onOpenShift} full className="mt-3">
          Vardiya özetini aç
        </TouchButton>
      </section>

      {/* Operatör modundan çıkış: oturum kapatılmaz, yalnızca yönetim
          arayüzüne dönülür. Aynı kullanıcı iki arayüzü de kullanabilir. */}
      <TouchButton onClick={onExit} icon={LogOut} full>
        Yönetim paneline dön
      </TouchButton>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  hint,
  last,
}: {
  icon: typeof User;
  label: string;
  value: string;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-3.5 py-3 ${last ? "" : "border-b border-slate-200"}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
