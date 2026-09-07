/**
 * Bildirimler.
 *
 * Bildirim üretmek bir karardır, biçimlendirme değil: "acil iş bekliyor"
 * uyarısının ne zaman çıkacağı bir eşiktir ve sınanabilir olmalıdır. Bu yüzden
 * kural burada durur, bildirim ekranında değil.
 *
 * Uyarılar yalnızca **ölçülmüş** durumlardan üretilir; bu sürümde hiçbir
 * bildirim bir sunucudan gelmez.
 */

import { SCRAP_CRITICAL } from "./scrap";
import { scrapSummary } from "./scrap";
import { sortTasks, taskCounts } from "./tasks";
import type { OperatorTask } from "./types";

export interface OperatorAlert {
  id: string;
  tone: "bad" | "warning" | "info";
  title: string;
  detail: string;
  /** İlgili görev; genel bildirimlerde `null`. */
  taskId: string | null;
}

/**
 * Vardiyanın dikkat isteyen durumları.
 *
 * Sıra önemlidir: fire uyarısı acil iş uyarısının önünde gelir, çünkü hurda
 * üretmeye devam etmek, bir işe geç başlamaktan daha pahalıdır.
 */
export function buildAlerts(tasks: OperatorTask[]): OperatorAlert[] {
  const alerts: OperatorAlert[] = [];
  const counts = taskCounts(tasks);

  if (counts.isEmpty) {
    return alerts;
  }

  for (const task of sortTasks(tasks)) {
    const scrap = scrapSummary(task.scrap, task.completedQuantity);
    if (scrap.rate !== null && scrap.rate >= SCRAP_CRITICAL) {
      alerts.push({
        id: `scrap-${task.id}`,
        tone: "bad",
        title: `${task.stationName}: fire oranı yüksek`,
        detail: `${scrap.total} adet hurda girildi; işlenen parçaların %${Math.round(
          scrap.rate * 100,
        )}'i hurdaya ayrıldı.`,
        taskId: task.id,
      });
    }
  }

  for (const task of sortTasks(tasks)) {
    if (task.priority === "urgent" && task.status === "pending") {
      alerts.push({
        id: `urgent-${task.id}`,
        tone: "warning",
        title: `${task.workOrder} acil ve henüz başlamadı`,
        detail: `${task.stationName} istasyonundaki bu iş öncelikli olarak işaretlendi.`,
        taskId: task.id,
      });
    }
  }

  for (const task of sortTasks(tasks)) {
    if (task.status === "paused") {
      alerts.push({
        id: `paused-${task.id}`,
        tone: "warning",
        title: `${task.workOrder} duraklatıldı`,
        detail: "İş yarıda bırakıldı; devam etmek için göreve dönün.",
        taskId: task.id,
      });
    }
  }

  if (counts.allDone) {
    alerts.push({
      id: "all-done",
      tone: "info",
      title: "Bugünkü görevlerin hepsi tamamlandı",
      detail: "Vardiya özetinden üretim ve fire rakamlarını görebilirsiniz.",
      taskId: null,
    });
  }

  return alerts;
}
