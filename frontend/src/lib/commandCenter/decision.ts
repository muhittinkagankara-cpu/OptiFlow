/**
 * Baş kararın seçimi ve kalan konular.
 *
 * `buildActionItems` zaten önceliklendirilmiş bir liste üretir; bu dosya o
 * listeyi **bölmekten** ibarettir: ilki karar bloğuna, geri kalanı kritik
 * konulara. Yeni bir kural, yeni bir eşik ya da yeni bir sıralama yoktur.
 *
 * Bölmenin nedeni Yasa 1 ve 5: ekran tek bir kararla açılmalı ve tek bir
 * birincil eylemle kapanmalı. Sekiz eşit ağırlıklı kart, kullanıcıya hangisiyle
 * başlayacağını söylemez.
 */

import type { ActionItem } from "../actionItems";

/** Ekranın merkezine konacak karar; liste boşsa `null`. */
export function leadDecision(actions: ActionItem[]): ActionItem | null {
  return actions.length === 0 ? null : actions[0];
}

/** Karar bloğuna girmeyen konular. */
export function remainingTopics(actions: ActionItem[]): ActionItem[] {
  return actions.slice(1);
}

/**
 * Karar bloğunun para satırı.
 *
 * Tutar hesaplanamıyorsa **gizlenmez**: "—" ile birlikte nedeni ve ölçümü
 * tamamlayacak eylem yazılır (Yasa 4, MASTER §16). Gizlemek, kullanıcıya
 * paranın hiç önemli olmadığını düşündürürdü.
 */
export interface MoneyLine {
  /** Biçimlendirilmiş tutar; ölçülemiyorsa `null`. */
  amount: string | null;
  /** Tutar yoksa nedeni. */
  reason: string | null;
  /** Ölçümü tamamlayacak eylem; yoksa `null`. */
  action: { label: string; target: "finance" } | null;
}

export function moneyLine(amount: string | null): MoneyLine {
  if (amount !== null) {
    return { amount, reason: null, action: null };
  }
  return {
    amount: null,
    reason: "Maliyet oranları girilmedi",
    action: { label: "Finans'a git", target: "finance" },
  };
}
