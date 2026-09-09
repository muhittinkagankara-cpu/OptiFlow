/**
 * Bağlayıcı ekranlarının ortak renk sözlüğü.
 *
 * Aynı durum dört yerde birden görünür: kart, sağlık panosu, olay günlüğü ve
 * eşleme ekranı. Renk her birinde ayrı yazılsaydı "yeniden deniyor" bir yerde
 * turuncu, başka bir yerde kırmızı olurdu.
 *
 * Renk hiçbir zaman tek başına bilgi taşımaz: her rozetin yanında durumun adı
 * yazar.
 */

import {
  Boxes,
  Cable,
  FileSpreadsheet,
  Radio,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type {
  ConnectorKind,
  ConnectorStatus,
  EventLevel,
  IssueSeverity,
  StatusTone,
} from "../../lib/connectors";
import type { BadgeTone } from "../ui/Primitives";

export const KIND_ICON: Record<ConnectorKind, LucideIcon> = {
  opcua: Cable,
  mqtt: Radio,
  rest: Waypoints,
  csv: FileSpreadsheet,
  erp: Boxes,
};

export const TONE_CLASS: Record<
  StatusTone,
  { chip: string; dot: string; bar: string; text: string }
> = {
  good: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    text: "text-emerald-600",
  },
  warning: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    text: "text-amber-600",
  },
  bad: {
    chip: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
    bar: "bg-red-500",
    text: "text-red-600",
  },
  neutral: {
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    text: "text-slate-500",
  },
};

export const BADGE_OF_TONE: Record<StatusTone, BadgeTone> = {
  good: "good",
  warning: "warning",
  bad: "bad",
  neutral: "neutral",
};

export const EVENT_TONE: Record<EventLevel, StatusTone> = {
  info: "neutral",
  warning: "warning",
  critical: "bad",
};

export const SEVERITY_TONE: Record<IssueSeverity, StatusTone> = {
  error: "bad",
  warning: "warning",
  info: "neutral",
};

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: "Hata",
  warning: "Uyarı",
  info: "Bilgi",
};

/**
 * Bağlı bir bağlantının kartında nabız animasyonu döner.
 *
 * Yalnızca `connected` durumunda: hareket, "veri akıyor" bilgisini taşır.
 * Kopmuş bir bağlantıda dönen animasyon, ekranın çalıştığı izlenimi verirdi.
 * Hareketi azaltılmış kullanıcıda tarayıcı animasyonu durdurur (`optiflow-*`
 * sınıflarının tamamı `prefers-reduced-motion` koruması altındadır).
 */
export function pulseClass(status: ConnectorStatus): string {
  return status === "connected" ? "optiflow-live-dot" : "";
}

/** Gecikmenin okunur hâli; ölçülmemişse "—". */
export function showLatency(latencyMs: number | null): string {
  if (latencyMs === null || !Number.isFinite(latencyMs)) {
    return "—";
  }
  return `${Math.round(latencyMs)} ms`;
}

/** Sayının okunur hâli; binlik ayracıyla. */
export function showCount(value: number): string {
  return value.toLocaleString("tr-TR");
}
