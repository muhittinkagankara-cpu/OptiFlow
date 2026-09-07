/**
 * Ekran 1 — Operatör ana sayfası.
 *
 * Vardiyanın ilk sorusu "şu an ne yapıyorum?", ikincisi "sırada ne var?"
 * olduğu için aktif iş en üstte, sayaçlar onun altında durur. Sayaçların
 * hepsi `taskCounts` ve `buildShiftSummary` çıktısıdır; bu bileşen hiçbir
 * toplama yapmaz.
 */

import {
  CheckCircle2,
  Coffee,
  ListChecks,
  PlayCircle,
  ClipboardList,
} from "lucide-react";
import {
  activeTask,
  buildShiftSummary,
  taskCounts,
  type OperatorTask,
} from "../../lib/operator";
import { StatTile, TouchButton } from "./operatorUi";
import { TaskCard } from "./TaskCard";

export function OperatorHome({
  tasks,
  operatorName,
  onOpenTask,
  onOpenTasks,
  onOpenShift,
}: {
  tasks: OperatorTask[];
  operatorName: string;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
  onOpenShift: () => void;
}) {
  const counts = taskCounts(tasks);
  const running = activeTask(tasks);
  const summary = buildShiftSummary(tasks);

  return (
    <div className="optiflow-screen space-y-4 px-4 py-4">
      <div>
        <p className="text-xs text-slate-500">Vardiya</p>
        <h1 className="text-2xl font-bold text-slate-900">{operatorName}</h1>
      </div>

      {/* Aktif iş */}
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Aktif iş
        </h2>
        {running ? (
          <TaskCard task={running} onOpen={onOpenTask} />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center">
            <PlayCircle className="mx-auto mb-2 h-7 w-7 text-slate-400" />
            <p className="text-sm font-medium text-slate-800">
              Şu an çalışan bir iş yok.
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {counts.isEmpty
                ? "Bu vardiyada size görev atanmamış."
                : "Görevler listesinden bir iş seçip başlatabilirsiniz."}
            </p>
            {!counts.isEmpty && (
              <TouchButton
                onClick={onOpenTasks}
                icon={ListChecks}
                tone="primary"
                className="mt-3"
              >
                Görevleri aç
              </TouchButton>
            )}
          </div>
        )}
      </section>

      {/* Sayaçlar */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Bugünkü görevler"
          value={counts.total}
          hint={counts.isEmpty ? "Atanmış iş yok" : `${counts.pending} tanesi bekliyor`}
          icon={ClipboardList}
        />
        <StatTile
          label="Tamamlanan"
          value={counts.done}
          hint={counts.allDone ? "Hepsi bitti" : `${counts.total - counts.done} kaldı`}
          tone={counts.allDone ? "good" : "neutral"}
          icon={CheckCircle2}
        />
        <StatTile
          label="Üretilen adet"
          value={summary.produced}
          hint={summary.scrapped > 0 ? `${summary.scrapped} hurda` : "Hurda yok"}
          icon={ListChecks}
        />
        {/*
          Mola sayacı bir yer tutucudur: vardiya planı backend'de tutulmuyor ve
          bu sprintte yeni bir uç eklenmiyor. Uydurma bir geri sayım göstermek,
          operatörün molaya çıkma saatini yanlış hesaplamasına yol açardı.
        */}
        <StatTile
          label="Molaya kalan"
          value="—"
          hint="Vardiya planı bağlanmadı"
          icon={Coffee}
        />
      </section>

      {/* Vardiya özeti girişi */}
      <TouchButton onClick={onOpenShift} icon={CheckCircle2} full>
        Vardiya özetini gör
      </TouchButton>
    </div>
  );
}
