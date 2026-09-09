/**
 * Kurumsal kurulum ekranlarının ortak biçim sözlüğü.
 *
 * Hazırlık bandı dört ayrı yerde görünür: puan kartı, kontrol listesi, rehber
 * ve bağlayıcı sağlık kartları. Renk her birinde ayrı yazılsaydı aynı puan iki
 * ekranda iki farklı renk alırdı.
 *
 * Renk tek başına bilgi taşımaz; her rozetin yanında sayı ya da etiket yazar.
 */

import {
  Bot,
  Cog,
  Factory,
  FileText,
  FlaskConical,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  MACHINE_STATUS_LABEL,
  type MachineStatus,
  type ReadinessBand,
  type SetupStepId,
} from "../../lib/onboarding-enterprise";

export const BAND_STYLE: Record<
  ReadinessBand,
  { chip: string; bar: string; text: string; ring: string }
> = {
  red: {
    chip: "border-red-200 bg-red-50 text-red-800",
    bar: "bg-red-500",
    text: "text-red-600",
    ring: "text-red-500",
  },
  orange: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    bar: "bg-amber-500",
    text: "text-amber-600",
    ring: "text-amber-500",
  },
  blue: {
    chip: "border-brand-200 bg-brand-50 text-brand-700",
    bar: "bg-brand-500",
    text: "text-brand-600",
    ring: "text-brand-500",
  },
  green: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    ring: "text-emerald-500",
  },
};

export const STEP_ICON: Record<SetupStepId, LucideIcon> = {
  company: Cog,
  factory: Factory,
  machines: Cog,
  connectors: Plug,
  simulation: FlaskConical,
  validation: ShieldCheck,
  report: FileText,
};

export const ADVISOR_ICON = Bot;

export const MACHINE_STATUS_STYLE: Record<
  MachineStatus,
  { chip: string; dot: string }
> = {
  active: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  maintenance: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  fault: {
    chip: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
};

export function statusLabel(status: MachineStatus): string {
  return MACHINE_STATUS_LABEL[status];
}

/** Yüzde gösterimi; ölçülmemiş değer "—". */
export function showScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return String(Math.round(value));
}

/** Süre gösterimi. */
export function showMinutes(minutes: number): string {
  return `${minutes} dk`;
}
