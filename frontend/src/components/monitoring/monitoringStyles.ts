/**
 * İzleme ekranlarının ortak sözlüğü.
 *
 * Renk hiçbir yerde tek başına bilgi taşımaz: her rozetin yanında durumun adı
 * yazılıdır ("Kritik", "Görüldü", "Benzetim"). Renk körlüğü olan bir
 * operatörün de aynı bilgiyi okuyabilmesi gerekir.
 */

import type {
  AlarmOrigin,
  UnifiedAlarmSeverity,
  UnifiedAlarmState,
} from "../../lib/monitoring";
import type { BadgeTone } from "../ui/Primitives";

/** Ölçülemeyen değerlerin ekrandaki karşılığı. */
export const NOT_MEASURED = "—";

export const SEVERITY_TONE: Record<UnifiedAlarmSeverity, BadgeTone> = {
  critical: "bad",
  warning: "warning",
  info: "info",
};

export const STATE_TONE: Record<UnifiedAlarmState, BadgeTone> = {
  OPEN: "bad",
  ACKNOWLEDGED: "warning",
  // Susturulmuş alarm nötr görünür ama listeden düşmez: nedeni sürüyor,
  // yalnızca bildirimi kesilmiş.
  SILENCED: "neutral",
  // Yükseltilmiş alarm açık alarmdan daha görünür olmalı; ikisi de kırmızı
  // olsaydı, sahipsiz kaldığı için tırmanmış bir alarm yeni açılmış biriyle
  // aynı görünürdü.
  ESCALATED: "bad",
  RESOLVED: "neutral",
};

/**
 * Kaynak rozetinin rengi.
 *
 * Benzetim satırı bilinçli olarak **uyarı** rengindedir: gerçek bir arıza gibi
 * görünmesi, bu sprintin engellemeye çalıştığı tek şeydir.
 */
export const ORIGIN_TONE: Record<AlarmOrigin, BadgeTone> = {
  runtime: "info",
  simulation: "warning",
};

/** Sağlık skorunun etiketine göre renk. */
export function scoreTone(label: string): BadgeTone {
  if (label === "İyi") return "good";
  if (label === "Dikkat") return "warning";
  if (label === "Kötü") return "bad";
  return "neutral";
}

/** Zaman çizelgesindeki satırın kenar rengi. */
export const ENTRY_BORDER: Record<UnifiedAlarmSeverity, string> = {
  critical: "border-l-red-400",
  warning: "border-l-amber-400",
  info: "border-l-slate-300",
};
