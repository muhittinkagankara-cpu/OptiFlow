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

/**
 * Sayfayı kapatan adım (Yasa 5).
 *
 * Ekran zaten eylemle bitiyordu — son blok "Sıradaki konular" listesidir ve
 * her satırı bir yere götürür. Eksik olan şuydu: liste **ne yapılacağını**
 * değil, **başka neler olduğunu** anlatır. Kullanıcı listeyi okuyup sayfanın
 * sonuna geldiğinde, asıl kararın eylemi ekranın epey yukarısında kalmış
 * oluyordu.
 *
 * Bu yüzden sayfa, kararı hatırlatan tek satırlık bir adımla kapanır.
 *
 * ## Neden her zaman çizilmiyor
 *
 * Konu listesi boşsa kapanış adımı **null** döner: o durumda son blok zaten
 * karar bloğudur ve onun son öğesi birincil eylemdir. Hemen altına aynı hedefe
 * giden ikinci bir düğme koymak, anlam katmayan bir yineleme olurdu.
 *
 * ## Neden yeni bir iş kuralı değil
 *
 * "İlk konu" ifadesi `buildActionItems`'in **zaten** ürettiği sıralamadır;
 * `leadDecision` de aynı listenin ilk öğesidir. Burada yeni bir öncelik, yeni
 * bir eşik ya da yeni bir öneri hesaplanmaz — var olan sıralama cümleye
 * çevrilir. Eylem etiketi ve hedefi de kararın kendi alanlarıdır.
 */
export interface ClosingStep {
  /** Tek cümlelik operasyonel hatırlatma. */
  text: string;
  /** Kararın kendi eylem etiketi. */
  actionLabel: string;
  /** Kararın kendi gezinme hedefi; yeni bir hedef üretilmez. */
  target: ActionItem["target"];
}

export function closingStep(
  decision: ActionItem | null,
  topics: ActionItem[],
): ClosingStep | null {
  if (decision === null || topics.length === 0) {
    return null;
  }
  const kalan =
    topics.length === 1
      ? "diğer konu bundan sonra gelir"
      : `diğer ${topics.length} konu bundan sonra gelir`;
  return {
    text: `Öncelik sırasında ilk konu "${decision.title}"; ${kalan}.`,
    actionLabel: decision.actionLabel,
    target: decision.target,
  };
}
