/**
 * Ekran 2 — Bugünkü görevler.
 *
 * Sıralama `sortTasks` tarafından yapılır: çalışan iş en üstte, sonra öncelik.
 * Liste bileşeni kendi sıralamasını yazsaydı, ana sayfadaki "aktif iş" ile
 * listenin ilk satırı farklı işler gösterebilirdi.
 */

import { ClipboardList } from "lucide-react";
import { sortTasks, taskCounts, type OperatorTask } from "../../lib/operator";
import { TaskCard } from "./TaskCard";

export function TaskListScreen({
  tasks,
  onOpenTask,
}: {
  tasks: OperatorTask[];
  onOpenTask: (taskId: string) => void;
}) {
  const ordered = sortTasks(tasks);
  const counts = taskCounts(tasks);

  return (
    <div className="optiflow-screen space-y-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Bugünkü görevler</h1>
        <span className="text-xs text-slate-500 tabular-nums">
          {counts.done}/{counts.total}
        </span>
      </div>

      {counts.isEmpty ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-12 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-900">
            Bu vardiyada görev yok.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Planlamadan görev geldiğinde burada listelenir. QR kod okutarak da
            bir işe başlayabilirsiniz.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {ordered.map((task, index) => (
            <li key={task.id}>
              <TaskCard task={task} onOpen={onOpenTask} index={index} />
            </li>
          ))}
        </ul>
      )}

      {counts.allDone && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800">
          Bugünkü işlerin hepsi tamamlandı.
        </p>
      )}
    </div>
  );
}
