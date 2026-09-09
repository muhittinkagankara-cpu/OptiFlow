/**
 * Doğrulama ekranlarının ortak renk ve biçim sözlüğü.
 *
 * Aynı bant (yeşil / turuncu / kırmızı) beş ayrı yerde görünüyor: özet
 * kartları, istasyon tablosu, çubuklar, bulgu listesi ve güven halkası. Her
 * birinde ayrı yazılsaydı, "%88" bir yerde turuncu başka bir yerde yeşil
 * olurdu.
 *
 * Renk tek başına hiçbir zaman bilgi taşımaz: her renkli öğenin yanında sayı ya
 * da etiket yazar. Renk körlüğü bir yana, yazdırılan bir raporda renk zaten
 * kaybolur.
 */

import { NOT_MEASURED } from "../../lib/reports";
import type { BadgeTone } from "../ui/Primitives";
import {
  type AccuracyBand,
  type ConfidenceLevel,
  type FindingTone,
} from "../../lib/validation";

export const BAND_STYLE: Record<
  AccuracyBand,
  { chip: string; bar: string; text: string; label: string }
> = {
  good: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    label: "Uyumlu",
  },
  warning: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    bar: "bg-amber-500",
    text: "text-amber-600",
    label: "Sapma var",
  },
  bad: {
    chip: "border-red-200 bg-red-50 text-red-800",
    bar: "bg-red-500",
    text: "text-red-600",
    label: "Yüksek sapma",
  },
};

/** Ölçüm girilmemiş satırların gösterimi; renk değil, susma. */
export const UNMEASURED_STYLE = {
  chip: "border-slate-200 bg-slate-100 text-slate-500",
  bar: "bg-slate-300",
  text: "text-slate-400",
  label: "Ölçülmedi",
};

export const CONFIDENCE_STYLE: Record<
  ConfidenceLevel,
  { ring: string; chip: string; tone: BadgeTone }
> = {
  high: {
    ring: "text-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    tone: "good",
  },
  medium: {
    ring: "text-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    tone: "warning",
  },
  low: {
    ring: "text-red-500",
    chip: "border-red-200 bg-red-50 text-red-800",
    tone: "bad",
  },
};

export const FINDING_TONE: Record<FindingTone, BadgeTone> = {
  good: "good",
  warning: "warning",
  bad: "bad",
};

/** Banda göre stil; ölçülmemişse nötr. */
export function styleOfBand(band: AccuracyBand | null) {
  return band === null ? UNMEASURED_STYLE : BAND_STYLE[band];
}

/**
 * Yüzde gösterimi.
 *
 * Ölçülmemiş değer "—" olarak gösterilir. Bu ekranın tamamı "sıfır değildir"
 * kuralı üzerine kuruludur; biçimlendirmenin bu kuralı bozmaması gerekir.
 */
export function showPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return `%${(value * 100).toFixed(digits).replace(".", ",")}`;
}

/** İşaretli sapma: "+%18" model düşük tahmin ediyor, "−%18" yüksek. */
export function showSignedPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${showPercent(Math.abs(value), digits)}`;
}

/** Ondalık sayı; Türkçe virgülle. */
export function showNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return NOT_MEASURED;
  }
  return value.toFixed(digits).replace(".", ",");
}
