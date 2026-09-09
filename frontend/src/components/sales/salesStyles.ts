/**
 * Satış ekranlarının ortak renk ve biçim sözlüğü.
 *
 * Beş durak dört ayrı bileşende görünüyor (kart, kanban sütunu, hatırlatıcı,
 * huni). Her birinde ayrı yazılsaydı "teklif" bir yerde mavi, başka bir yerde
 * mor olurdu.
 *
 * Renk hiçbir zaman tek başına bilgi taşımaz: durak adı her yerde yazılı.
 */

import type { FollowUpSeverity, LeadStage } from "../../lib/sales";

export const STAGE_STYLE: Record<
  LeadStage,
  { chip: string; dot: string; bar: string; column: string }
> = {
  new: {
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    column: "border-slate-200",
  },
  demo: {
    chip: "border-brand-200 bg-brand-50 text-brand-700",
    dot: "bg-brand-500",
    bar: "bg-brand-500",
    column: "border-brand-400/40",
  },
  proposal: {
    chip: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
    column: "border-violet-400/40",
  },
  sent: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    column: "border-amber-400/40",
  },
  won: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    column: "border-emerald-400/40",
  },
};

export const SEVERITY_STYLE: Record<
  FollowUpSeverity,
  { box: string; text: string; label: string }
> = {
  overdue: {
    box: "border-red-400/50 bg-red-500/10",
    text: "text-red-700",
    label: "Gecikmiş",
  },
  due: {
    box: "border-amber-400/50 bg-amber-500/10",
    text: "text-amber-700",
    label: "Yaklaşıyor",
  },
  info: {
    box: "border-slate-200 bg-slate-100/60",
    text: "text-slate-500",
    label: "Bilgi",
  },
};

/**
 * "2 saat önce" biçiminde göreli zaman.
 *
 * `lib/runHistory.relativeTime` ile aynı işi yapar ama ondan ayrı durur:
 * o işlev koşum geçmişine özgü eşiklere sahip ve satış tarafı için
 * "az önce" yerine dakika göstermek gerekiyor — bir satışçı iki dakika önce
 * bıraktığı kaydı tanımak ister.
 */
export function relativeTime(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "—";
  }
  const minutes = Math.round((now.getTime() - then) / 60_000);

  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dakika önce`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;

  return `${Math.round(days / 30)} ay önce`;
}

/** Grafiklerde kullanılan renkler; koyu zeminde okunur tonlar. */
export const CHART_COLOR = {
  brand: "#3B82F6",
  emerald: "#22C55E",
  violet: "#A78BFA",
  amber: "#F59E0B",
} as const;
