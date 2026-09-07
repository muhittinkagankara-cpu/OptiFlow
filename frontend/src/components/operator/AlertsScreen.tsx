/**
 * Bildirimler sekmesi.
 *
 * Uyarılar `buildAlerts` tarafından üretilir; bu bileşen yalnızca çizer ve
 * ilgili göreve götürür. Kural burada yazılsaydı, "fire yüksek" eşiği bir
 * ekranda %10, başka bir ekranda %5 olabilirdi.
 */

import { BellOff, CircleCheck, TriangleAlert, XCircle } from "lucide-react";
import { buildAlerts, type OperatorAlert, type OperatorTask } from "../../lib/operator";

const TONE_STYLE: Record<OperatorAlert["tone"], { box: string; icon: string }> = {
  bad: { box: "border-red-200 bg-red-50", icon: "text-red-700" },
  warning: { box: "border-amber-200 bg-amber-50", icon: "text-amber-700" },
  info: { box: "border-emerald-200 bg-emerald-50", icon: "text-emerald-700" },
};

const TONE_ICON = {
  bad: XCircle,
  warning: TriangleAlert,
  info: CircleCheck,
};

export function AlertsScreen({
  tasks,
  onOpenTask,
}: {
  tasks: OperatorTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const alerts = buildAlerts(tasks);

  return (
    <div className="optiflow-screen space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold text-slate-900">Bildirimler</h1>

      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-12 text-center">
          <BellOff className="mx-auto mb-3 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-900">
            Dikkat isteyen bir durum yok.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Fire oranı yükseldiğinde ya da acil bir iş beklemeye başladığında
            burada uyarı çıkar.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {alerts.map((alert, index) => {
            const style = TONE_STYLE[alert.tone];
            const Icon = TONE_ICON[alert.tone];
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={() => alert.taskId && onOpenTask(alert.taskId)}
                  disabled={alert.taskId === null}
                  style={{ animationDelay: `${index * 45}ms` }}
                  className={`optiflow-enter flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-transform duration-200 focus:outline-none ${
                    alert.taskId ? "active:scale-[0.99]" : "cursor-default"
                  } ${style.box}`}
                >
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {alert.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">{alert.detail}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
