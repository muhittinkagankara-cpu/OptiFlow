/**
 * Operatör testlerinin paylaştığı kurucular.
 *
 * Dört test dosyası da aynı biçimde görev kuruyor; her birinde yeniden
 * yazılsaydı şemaya bir alan eklendiğinde dört yerde birden güncellenmesi
 * gerekirdi.
 */

import type { OperatorTask, ScrapEntry, ScrapReason } from "./types";

export function task(
  id: string,
  overrides: Partial<OperatorTask> = {},
): OperatorTask {
  return {
    id,
    workOrder: `İE-${id}`,
    stationId: `station-${id}`,
    stationName: "Torna",
    machineName: "Torna M-01",
    operatorName: "Ayşe",
    priority: "normal",
    status: "pending",
    targetQuantity: 100,
    completedQuantity: 0,
    cycleSeconds: 60,
    estimatedMinutes: 100,
    startedAt: null,
    finishedAt: null,
    workedSeconds: 0,
    scrap: [],
    ...overrides,
  };
}

export function scrapEntry(
  reason: ScrapReason,
  quantity: number,
  overrides: Partial<ScrapEntry> = {},
): ScrapEntry {
  return {
    id: `scrap-${reason}-${quantity}`,
    taskId: "t1",
    reason,
    quantity,
    photoCount: 0,
    note: null,
    at: "2026-09-04T08:00:00.000Z",
    ...overrides,
  };
}
