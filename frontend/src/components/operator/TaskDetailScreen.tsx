/**
 * Ekran 4 — Görev detayı. Vardiyanın en çok bakılan ekranı.
 *
 * Üç eylem düğmesi (Başlat / Duraklat / Tamamla) ekranın **altında** ve
 * yapışık durur: operatör listeyi kaydırırken düğmeleri kaybetmemelidir ve
 * başparmağın ulaştığı bölge orasıdır. Düğme yüksekliği eldivenli parmak
 * hesaba katılarak 52 pikselden küçük değildir.
 *
 * Bileşen hiçbir durum geçişi kuralı bilmez: her dokunuş bir olaya çevrilir ve
 * `applyEvent` neyin mümkün olduğuna karar verir. Kurallar burada yazılsaydı
 * gerçek MES bağlantısında sunucudan gelen olaylarla ekrandaki mantık
 * ayrışırdı.
 */

import {
  CheckCircle2,
  CircleDot,
  Cog,
  Layers,
  Pause,
  Play,
  Plus,
  Timer,
  User,
} from "lucide-react";
import {
  remainingMinutes,
  scrapSummary,
  taskProgress,
  type OperatorTask,
} from "../../lib/operator";
import { PriorityChip, ScreenHeader, StatusChip, TouchButton } from "./operatorUi";

export function TaskDetailScreen({
  task,
  onBack,
  onStart,
  onPause,
  onComplete,
  onReportUnit,
  onOpenScrap,
}: {
  task: OperatorTask;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onReportUnit: (quantity: number) => void;
  onOpenScrap: () => void;
}) {
  const progress = taskProgress(task);
  const scrap = scrapSummary(task.scrap, task.completedQuantity);
  const remaining = remainingMinutes(task);
  const isRunning = task.status === "active";
  const isDone = task.status === "done";

  return (
    <div className="optiflow-screen flex min-h-full flex-col">
      <ScreenHeader
        title={task.stationName}
        subtitle={task.workOrder}
        onBack={onBack}
        action={<StatusChip status={task.status} />}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {/* İlerleme */}
        <section
          className={`rounded-2xl border border-slate-200 bg-white p-4 ${
            isDone ? "optiflow-task-done" : ""
          }`}
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">Tamamlanan adet</p>
              <p className="text-4xl font-bold text-slate-900 tabular-nums">
                {progress.completed}
                <span className="text-lg font-semibold text-slate-500">
                  {" / "}
                  {progress.target}
                </span>
              </p>
            </div>
            {isDone ? (
              <CheckCircle2 className="optiflow-check-pop h-9 w-9 text-emerald-600" />
            ) : (
              <PriorityChip priority={task.priority} />
            )}
          </div>

          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`optiflow-progress-fill h-full rounded-full ${
                isDone ? "bg-emerald-500" : "bg-brand-500"
              }`}
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span className="tabular-nums">Kalan {progress.remaining} adet</span>
            <span className="tabular-nums">
              {remaining === null
                ? "Kalan süre bilinmiyor"
                : `Yaklaşık ${Math.round(remaining)} dk`}
            </span>
          </div>
        </section>

        {/* Künye */}
        <section className="grid grid-cols-2 gap-2.5">
          <DetailRow icon={CircleDot} label="İstasyon" value={task.stationName} />
          <DetailRow icon={Cog} label="Makine" value={task.machineName} />
          <DetailRow icon={User} label="Operatör" value={task.operatorName} />
          <DetailRow
            icon={Timer}
            label="Çevrim süresi"
            value={`${task.cycleSeconds} sn`}
          />
        </section>

        {/* Hurda */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-500" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Hurda</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {scrap.total === 0
                    ? "Bu işte hurda girilmedi"
                    : `${scrap.total} adet${
                        scrap.rate === null
                          ? ""
                          : ` · %${(scrap.rate * 100).toFixed(1).replace(".", ",")}`
                      }`}
                </p>
              </div>
            </div>
            <TouchButton onClick={onOpenScrap} icon={Plus}>
              Gir
            </TouchButton>
          </div>
        </section>

        {/* Adet bildirimi — çevrimi biten parça buradan sayılır. */}
        {!isDone && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-sm font-semibold text-slate-900">Parça bildir</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Sağlam çıkan parçaları ekleyin; hurda ayrı girilir.
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {[1, 5, 10].map((quantity) => (
                <TouchButton
                  key={quantity}
                  onClick={() => onReportUnit(quantity)}
                  disabled={!isRunning}
                >
                  +{quantity}
                </TouchButton>
              ))}
            </div>
            {!isRunning && (
              <p className="mt-2 text-[11px] text-slate-500">
                Parça bildirmek için önce işi başlatın.
              </p>
            )}
          </section>
        )}
      </div>

      {/* Eylemler — başparmak bölgesinde, yapışık. */}
      <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        {isDone ? (
          <p className="py-2 text-center text-sm font-semibold text-emerald-700">
            Bu görev tamamlandı.
          </p>
        ) : (
          <div className="flex gap-2">
            {isRunning ? (
              <TouchButton onClick={onPause} icon={Pause} tone="warning" full>
                Duraklat
              </TouchButton>
            ) : (
              <TouchButton onClick={onStart} icon={Play} tone="primary" full>
                Başlat
              </TouchButton>
            )}
            <TouchButton
              onClick={onComplete}
              icon={CheckCircle2}
              tone="success"
              full
            >
              Tamamla
            </TouchButton>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleDot;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}
