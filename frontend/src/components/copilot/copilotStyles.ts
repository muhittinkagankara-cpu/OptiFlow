/**
 * Copilot ekranının ortak biçim sözlüğü.
 *
 * Güven etiketi üç ayrı yerde görünür: baloncuk, sağlık paneli ve dışa
 * aktarılan PDF. Renk her birinde ayrı yazılsaydı "orta güven" bir yerde
 * turuncu, başka bir yerde gri olurdu.
 */

import type { AnswerConfidence, ContextSource } from "../../lib/copilot";
import type { BadgeTone } from "../ui/Primitives";

export const CONFIDENCE_TONE: Record<AnswerConfidence, BadgeTone> = {
  high: "good",
  medium: "warning",
  low: "warning",
  none: "neutral",
};

export const CONFIDENCE_CHIP: Record<AnswerConfidence, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-amber-200 bg-amber-50 text-amber-800",
  none: "border-slate-200 bg-slate-100 text-slate-500",
};

/** Kaynak rozetlerinin rengi; katman ayrımı renkle de görünür. */
export const SOURCE_CHIP: Record<ContextSource, string> = {
  simulation: "border-slate-200 bg-slate-100 text-slate-600",
  finance: "border-emerald-200 bg-emerald-50 text-emerald-800",
  heatmap: "border-orange-200 bg-orange-50 text-orange-800",
  validation: "border-brand-200 bg-brand-50 text-brand-700",
  live: "border-violet-200 bg-violet-50 text-violet-700",
  inventory: "border-slate-200 bg-slate-100 text-slate-600",
  crm: "border-slate-200 bg-slate-100 text-slate-600",
  connectors: "border-cyan-200 bg-cyan-50 text-cyan-800",
  onboarding: "border-brand-200 bg-brand-50 text-brand-700",
};

/** Saat:dakika biçiminde mesaj zamanı. */
const TIME_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

export function messageTime(atMs: number): string {
  return TIME_FORMAT.format(new Date(atMs));
}
