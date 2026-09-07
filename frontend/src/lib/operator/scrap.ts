/**
 * Hurda kayıtlarının özeti.
 *
 * Oran hesabı tek yerde durur çünkü paydası tartışmalıdır: hurda oranı,
 * hurdanın **işlenen toplam** içindeki payıdır (sağlam + hurda), yalnızca
 * sağlam adete bölünmüş hâli değil. İki ekran iki farklı payda kullansaydı
 * aynı vardiya için iki farklı fire oranı görünürdü.
 */

import { SCRAP_WARNING } from "../actionItems";
import {
  SCRAP_REASON_LABEL,
  type ScrapEntry,
  type ScrapReason,
  type ScrapReasonShare,
  type ScrapSummary,
} from "./types";

/** Bu oranın üstündeki fire, vardiyanın ele alınması gereken bir sorunudur. */
export const SCRAP_CRITICAL = 0.1;

const REASON_SEQUENCE: ScrapReason[] = ["burr", "scratch", "dimension", "other"];

/**
 * Hurda kayıtlarını tek bir özete indirger.
 *
 * `producedQuantity` sağlam üretilen adettir. Sıfır olabilir: vardiyanın
 * başında ilk parça hurdaya ayrıldığında oran %100'dür ve bu doğrudur.
 * Hiçbir parça işlenmemişse oran `null` kalır — "%0 fire" demek, ölçüm
 * yapılmadığı hâlde iyi bir sonuç bildirmek olurdu.
 */
export function scrapSummary(
  entries: ScrapEntry[],
  producedQuantity: number,
): ScrapSummary {
  const produced = Math.max(0, producedQuantity);
  const total = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.quantity),
    0,
  );
  const photoCount = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.photoCount),
    0,
  );

  const byReason: ScrapReasonShare[] = REASON_SEQUENCE.map((reason) => {
    const quantity = entries
      .filter((entry) => entry.reason === reason)
      .reduce((sum, entry) => sum + Math.max(0, entry.quantity), 0);
    return {
      reason,
      label: SCRAP_REASON_LABEL[reason],
      quantity,
      share: total > 0 ? quantity / total : 0,
    };
  })
    // Hiç girilmemiş nedenler listede yer kaplamasın.
    .filter((item) => item.quantity > 0)
    .sort((left, right) => right.quantity - left.quantity);

  const handled = produced + total;
  const rate = handled > 0 ? total / handled : null;

  return {
    total,
    byReason,
    rate,
    tone: toneOf(rate),
    photoCount,
  };
}

function toneOf(rate: number | null): ScrapSummary["tone"] {
  if (rate === null) {
    return "neutral";
  }
  if (rate >= SCRAP_CRITICAL) {
    return "bad";
  }
  if (rate >= SCRAP_WARNING) {
    return "warning";
  }
  return "good";
}

/** Bir görevin tüm hurda kayıtlarını tek listede toplar. */
export function collectScrap(
  tasks: { scrap: ScrapEntry[] }[],
): ScrapEntry[] {
  return tasks.flatMap((task) => task.scrap);
}
