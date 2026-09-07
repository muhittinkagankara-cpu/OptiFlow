/**
 * Saha olayları ve bunları göreve uygulayan saf indirgeyici (reducer).
 *
 * Operatörün yaptığı her şey bir **olaydır**: işi başlattı, duraklattı, parça
 * bildirdi, hurda girdi, işi bitirdi. Durumu doğrudan değiştirmek yerine olay
 * üretmek bilinçlidir — gerçek bir MES bağlantısı geldiğinde aynı olaylar ağ
 * üzerinden gelecek ve `applyEvent` değişmeden çalışacaktır. Sağlayıcı
 * (`OperatorEventProvider`) yalnızca olayların nereden geldiğini değiştirir.
 *
 * Zaman dışarıdan verilir (`at`). `Date.now()` burada okunsaydı işlev saf
 * olmaktan çıkar ve sınanamazdı.
 */

import type { OperatorTask, ScrapReason } from "./types";

export type OperatorEvent =
  | { type: "task_started"; taskId: string; at: string }
  | { type: "task_paused"; taskId: string; at: string }
  | { type: "task_completed"; taskId: string; at: string }
  | { type: "unit_produced"; taskId: string; at: string; quantity: number }
  | {
      type: "scrap_recorded";
      taskId: string;
      at: string;
      reason: ScrapReason;
      quantity: number;
      photoCount: number;
      note: string | null;
    };

/**
 * Bir olayı görev listesine uygular ve **yeni** bir liste döner.
 *
 * Tanınmayan görev kimliği hata değildir: liste sessizce olduğu gibi döner.
 * Bir MES bağlantısında başka bir operatörün görevine ait olay gelmesi
 * olağandır ve arayüzün bu yüzden çökmemesi gerekir.
 */
export function applyEvent(
  tasks: OperatorTask[],
  event: OperatorEvent,
): OperatorTask[] {
  return tasks.map((task) =>
    task.id === event.taskId ? reduce(task, event) : task,
  );
}

/** Olay dizisini sırayla uygular. */
export function applyEvents(
  tasks: OperatorTask[],
  events: OperatorEvent[],
): OperatorTask[] {
  return events.reduce(applyEvent, tasks);
}

function reduce(task: OperatorTask, event: OperatorEvent): OperatorTask {
  switch (event.type) {
    case "task_started":
      // Zaten çalışan bir işi yeniden başlatmak sayacı sıfırlamamalı.
      return task.status === "active"
        ? task
        : {
            ...task,
            status: "active",
            startedAt: event.at,
            finishedAt: null,
          };

    case "task_paused":
      return task.status !== "active"
        ? task
        : {
            ...task,
            status: "paused",
            workedSeconds: task.workedSeconds + elapsed(task.startedAt, event.at),
            startedAt: null,
          };

    case "task_completed":
      return {
        ...task,
        status: "done",
        workedSeconds: task.workedSeconds + elapsed(task.startedAt, event.at),
        startedAt: null,
        finishedAt: event.at,
      };

    case "unit_produced": {
      const quantity = Math.max(0, Math.trunc(event.quantity));
      return quantity === 0
        ? task
        : {
            ...task,
            completedQuantity: task.completedQuantity + quantity,
          };
    }

    case "scrap_recorded": {
      const quantity = Math.max(0, Math.trunc(event.quantity));
      if (quantity === 0) {
        return task;
      }
      return {
        ...task,
        scrap: [
          ...task.scrap,
          {
            id: `${task.id}-scrap-${task.scrap.length + 1}`,
            taskId: task.id,
            reason: event.reason,
            quantity,
            photoCount: Math.max(0, Math.trunc(event.photoCount)),
            note: event.note,
            at: event.at,
          },
        ],
      };
    }
  }
}

/**
 * İki zaman damgası arasındaki saniye farkı.
 *
 * Geçersiz ya da eksik başlangıç zamanında sıfır döner: negatif bir süre
 * eklemek toplam çalışma süresini geriye götürür ve vardiya özetini bozardı.
 */
function elapsed(startedAt: string | null, at: string): number {
  if (!startedAt) {
    return 0;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(at);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 1000);
}
