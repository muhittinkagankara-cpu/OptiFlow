/**
 * Pilot bağlantı ekranlarının ortak biçim sözlüğü.
 *
 * En önemli kural burada: **"Bağlandı" rozeti yalnızca gerçekten denenmiş ve
 * başarılı olmuş bir sonuç için verilir.** Hiç denenmemiş bir bağlantı
 * "Doğrulanmadı" rozeti taşır ve rengi nötrdür — kırmızı da değildir, çünkü
 * kırmızı "denedik, olmadı" demektir.
 */

import type { RuntimeStatus } from "../../lib/connectors";

export const STATUS_STYLE: Record<
  RuntimeStatus,
  { chip: string; dot: string; label: string }
> = {
  idle: {
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    label: "Doğrulanmadı",
  },
  connecting: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    label: "Bağlanıyor",
  },
  connected: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
    label: "Bağlandı",
  },
  disconnected: {
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    label: "Bağlantı kapatıldı",
  },
  failed: {
    chip: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
    label: "Bağlantı kurulamadı",
  },
};

/** Yük satırındaki tip rozetleri. */
export const TYPE_CHIP: Record<string, string> = {
  number: "border-brand-200 bg-brand-50 text-brand-700",
  boolean: "border-violet-200 bg-violet-50 text-violet-700",
  string: "border-slate-200 bg-slate-100 text-slate-600",
  null: "border-slate-200 bg-slate-100 text-slate-400",
  object: "border-slate-200 bg-slate-100 text-slate-500",
};

/** Değeri okunur metne çevirir; ölçülmemişse "—". */
export function showValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? `[${value.length} kayıt]` : "{…}";
  }
  return String(value);
}

/** Sayı ya da "Doğrulanmadı". */
export function showMeasured(value: number | null, unit: string): string {
  return value === null ? "Doğrulanmadı" : `${value} ${unit}`;
}
