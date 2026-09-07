/**
 * Görev listesinden türetilen saf değerler.
 *
 * Bileşenler bu dosyadan okur ve kendileri hesap yapmaz. İlerleme oranı
 * ekranda üç yerde görünüyor (ana sayfa kartı, görev listesi, görev detayı);
 * her birinde ayrı yazılsaydı biri hurdayı sayar, öteki saymaz ve aynı iş için
 * iki farklı yüzde gösterilirdi.
 */

import {
  PRIORITY_ORDER,
  STATUS_ORDER,
  type OperatorTask,
  type TaskProgress,
} from "./types";

/**
 * Bir görevin tamamlanma durumu.
 *
 * `completed` yalnızca **sağlam** adedi sayar; hurda ayrı bir kalemdir ve
 * `scrapSummary` tarafından raporlanır. Hurdayı ilerlemeye katmak, hedefe
 * ulaşılmış gibi görünürken depoya eksik parça gitmesine yol açardı.
 */
export function taskProgress(task: OperatorTask): TaskProgress {
  const target = Math.max(0, task.targetQuantity);
  const completed = Math.max(0, task.completedQuantity);
  const remaining = Math.max(0, target - completed);
  return {
    completed,
    target,
    remaining,
    ratio: target <= 0 ? 0 : Math.min(1, completed / target),
    isComplete: target > 0 && completed >= target,
  };
}

/**
 * Ekranda gösterilecek sıra.
 *
 * Önce duruma, sonra önceliğe bakılır: çalışan iş her zaman en üstte durur,
 * çünkü operatörün telefonu eline aldığı andaki tek sorusu "şu an ne
 * yapıyorum?" olur. Yalnızca önceliğe göre sıralansaydı, üzerinde çalışılan
 * iş listenin ortasında kaybolabilirdi.
 *
 * Girdiyi değiştirmez; yeni bir dizi döner.
 */
export function sortTasks(tasks: OperatorTask[]): OperatorTask[] {
  return [...tasks].sort((left, right) => {
    const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    const byPriority =
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    // Eşitlikte iş emri numarası: sıralama koşudan koşuya değişmesin.
    return left.workOrder.localeCompare(right.workOrder, "tr");
  });
}

/**
 * Şu an üzerinde çalışılan iş.
 *
 * Duraklatılmış iş de "aktif" sayılır: operatör ona geri dönecektir ve ana
 * sayfada onu görmesi gerekir. Aynı anda birden fazla iş çalışıyorsa ilki
 * döner — sıralama `sortTasks` ile aynı olduğu için bu, listede en üstte
 * görünen iştir.
 */
export function activeTask(tasks: OperatorTask[]): OperatorTask | null {
  const running = sortTasks(tasks).find(
    (task) => task.status === "active" || task.status === "paused",
  );
  return running ?? null;
}

export interface TaskCounts {
  total: number;
  done: number;
  active: number;
  pending: number;
  /** Hiç görev yoksa `true`; "hepsi bitti" ile karıştırılmamalıdır. */
  isEmpty: boolean;
  /** En az bir görev var ve hepsi tamamlandı. */
  allDone: boolean;
}

/** Ana sayfadaki sayaç kartlarının kaynağı. */
export function taskCounts(tasks: OperatorTask[]): TaskCounts {
  const done = tasks.filter((task) => task.status === "done").length;
  const active = tasks.filter(
    (task) => task.status === "active" || task.status === "paused",
  ).length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  return {
    total: tasks.length,
    done,
    active,
    pending,
    isEmpty: tasks.length === 0,
    allDone: tasks.length > 0 && done === tasks.length,
  };
}

/**
 * Kalan iş için tahmini süre (dakika).
 *
 * Çevrim süresinden türetilir, tahmini toplam süreden değil: iş yarılandığında
 * kalan sürenin de yarılanması beklenir. Çevrim süresi bilinmiyorsa `null`
 * döner — sıfır göstermek "bitmek üzere" anlamına gelirdi.
 */
export function remainingMinutes(task: OperatorTask): number | null {
  if (task.cycleSeconds <= 0) {
    return null;
  }
  return (taskProgress(task).remaining * task.cycleSeconds) / 60;
}
