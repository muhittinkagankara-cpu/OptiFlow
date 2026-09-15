/**
 * Ölçülmüş durumun görsel karşılıkları (Sprint 1A).
 *
 * Sınıf adları **tam metin olarak** yazılır, parça birleştirilerek değil.
 * Tailwind kaynak dosyaları tarayarak sınıf üretir; `border-l-[var(--of-${x})]`
 * gibi çalışma zamanında kurulan bir ad taranamaz ve o sınıf hiç üretilmez —
 * sonuç, hiçbir hata vermeden görünmeyen bir kenarlıktır.
 */

import type { MeasuredState } from "./types";

/** Durumun CSS değişkeni (MASTER §3.3). */
export const STATE_COLOR_VAR: Record<MeasuredState, string> = {
  ok: "--of-semantic-ok",
  warn: "--of-semantic-warn",
  fault: "--of-semantic-fault",
  unknown: "--of-semantic-unknown",
};

/** `StatusClamp`'in 2px sol kelepçe çizgisi için sınıf (MASTER §5). */
export const STATE_RULE_CLASS: Record<MeasuredState, string> = {
  ok: "border-l-[var(--of-semantic-ok)]",
  warn: "border-l-[var(--of-semantic-warn)]",
  fault: "border-l-[var(--of-semantic-fault)]",
  unknown: "border-l-[var(--of-semantic-unknown)]",
};

/** Küçük durum noktası için sınıf (rozetlerde kullanılır). */
export const STATE_DOT_CLASS: Record<MeasuredState, string> = {
  ok: "bg-[var(--of-semantic-ok)]",
  warn: "bg-[var(--of-semantic-warn)]",
  fault: "bg-[var(--of-semantic-fault)]",
  unknown: "bg-[var(--of-semantic-unknown)]",
};

/**
 * Bu durum kullanıcının ilgisini hak ediyor mu?
 *
 * `unknown` **etmez**: ölçülmemiş bir değer bir sorun değildir, bir boşluktur.
 * Boşluğu alarm gibi göstermek, gerçek alarmların değerini düşürür.
 */
export function needsAttention(state: MeasuredState): boolean {
  return state === "warn" || state === "fault";
}
