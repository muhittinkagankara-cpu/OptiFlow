/**
 * Görev kartı — ana sayfada ve görev listesinde aynı kart kullanılır.
 *
 * Tek bir bileşen olması bilinçlidir: iki ekranda ayrı yazılsaydı biri
 * ilerleme çubuğunu hurdayı sayarak, öteki saymayarak çizebilir ve aynı iş
 * için iki farklı yüzde görünürdü. Oran `taskProgress` ile hesaplanır, burada
 * değil.
 */

import { Clock, Package } from "lucide-react";
import { taskProgress, type OperatorTask } from "../../lib/operator";
import { PriorityChip, StatusChip } from "./operatorUi";

/** Öncelik şeridi — kartın sol kenarındaki renk. */
const PRIORITY_BAR: Record<OperatorTask["priority"], string> = {
  urgent: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-emerald-500",
};

export function TaskCard({
  task,
  onOpen,
  index = 0,
}: {
  task: OperatorTask;
  onOpen: (taskId: string) => void;
  index?: number;
}) {
  const progress = taskProgress(task);
  const isDone = task.status === "done";

  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      style={{ animationDelay: `${index * 45}ms` }}
      className={`optiflow-enter w-full overflow-hidden rounded-2xl border text-left transition-transform duration-200 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        isDone
          ? "border-slate-200 bg-slate-100/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex gap-3 p-3.5">
        <span
          className={`w-1 shrink-0 rounded-full ${
            isDone ? "bg-slate-300" : PRIORITY_BAR[task.priority]
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900">
                {task.stationName}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {task.workOrder} · {task.machineName}
              </p>
            </div>
            <StatusChip status={task.status} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PriorityChip priority={task.priority} />
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              {task.estimatedMinutes} dk
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
              <Package className="h-3.5 w-3.5" />
              {progress.completed} / {progress.target}
            </span>
          </div>

          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`optiflow-progress-fill h-full rounded-full ${
                isDone ? "bg-emerald-500" : "bg-brand-500"
              }`}
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
