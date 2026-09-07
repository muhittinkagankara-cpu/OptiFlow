/**
 * Operatör ekranlarının ortak yapı taşları.
 *
 * Masaüstündeki `ui/Primitives` yeniden kullanılamadı çünkü ölçüler farklı:
 * orada bir düğme 32-36 piksel yüksekliğindedir ve fareyle tıklanır, burada
 * eldivenli bir parmakla dokunulur. Dokunma hedefleri en az 48 piksel
 * yüksekliğindedir (WCAG 2.5.5 önerisi) ve birincil eylemler ekranın alt
 * yarısında durur — telefon tek elle tutulurken başparmağın rahat ulaştığı
 * bölge orasıdır.
 */

import type { ReactNode } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/operator";

/* -------------------------------------------------------------------------- */
/* Dokunma düğmesi                                                             */
/* -------------------------------------------------------------------------- */

type TouchTone = "primary" | "neutral" | "success" | "danger" | "warning";

const TOUCH_TONE: Record<TouchTone, string> = {
  primary: "bg-brand-600 text-white active:bg-brand-700",
  neutral:
    "border border-slate-200 bg-slate-100 text-slate-800 active:bg-slate-200",
  success: "bg-emerald-500 text-white active:bg-emerald-600",
  danger: "bg-red-500 text-white active:bg-red-600",
  warning: "bg-amber-500 text-white active:bg-amber-600",
};

export function TouchButton({
  children,
  onClick,
  icon: Icon,
  tone = "neutral",
  disabled,
  full,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: LucideIcon;
  tone?: TouchTone;
  disabled?: boolean;
  /** Satırın tamamını kaplasın mı? */
  full?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold transition-all duration-200 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
        full ? "w-full" : ""
      } ${disabled ? "" : "active:scale-[0.98]"} ${TOUCH_TONE[tone]} ${className}`}
    >
      {Icon && <Icon className="h-5 w-5 shrink-0" />}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Ekran başlığı                                                               */
/* -------------------------------------------------------------------------- */

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-3 backdrop-blur">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Geri"
          className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors active:bg-slate-200 active:text-slate-900"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        )}
      </div>
      {action}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Sayı kartı                                                                  */
/* -------------------------------------------------------------------------- */

const TILE_TONE: Record<"neutral" | "good" | "warning" | "bad", string> = {
  neutral: "text-slate-900",
  good: "text-emerald-700",
  warning: "text-amber-700",
  bad: "text-red-700",
};

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "good" | "warning" | "bad";
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${TILE_TONE[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rozetler                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Öncelik üç renkle gösterilir (kırmızı / turuncu / yeşil) ama renk hiçbir
 * zaman tek başına konuşmaz: her rozette yazılı etiket de vardır. Hat
 * aydınlatması ve renk körlüğü kırmızıyla turuncuyu ayırt edilemez kılabilir.
 */
const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: "border-red-200 bg-red-50 text-red-800",
  high: "border-amber-200 bg-amber-50 text-amber-800",
  normal: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[priority]}`}
    >
      {TASK_PRIORITY_LABEL[priority]}
    </span>
  );
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: "border-slate-200 bg-slate-100 text-slate-600",
  active: "border-brand-200 bg-brand-50 text-brand-700",
  paused: "border-amber-200 bg-amber-50 text-amber-800",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}
    >
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Kaynak şeridi                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Verinin nereden geldiğini söyleyen şerit.
 *
 * Sağlayıcı canlı değilken kalıcı olarak görünür. Sahte görevleri gerçek
 * üretim verisi sanan bir operatör, olmayan bir işi tamamlanmış sayabilir;
 * bu şeridi kapatılabilir yapmamak bilinçli bir karardır.
 */
export function SourceBanner({ text }: { text: string }) {
  return (
    <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[11px] font-medium text-amber-900">
      {text}
    </p>
  );
}
