/**
 * Tasarım dilinin temel yapı taşları (Sprint UX-1).
 *
 * Bu dosya yeni bir bileşen kütüphanesi değildir; yalnızca ekranlar arasında
 * tekrar eden dört-beş kalıbı tek yerde toplar. Amaç tutarlılık: kart
 * yuvarlaklığı, kenarlık tonu, iç boşluk ve hover davranışı sekiz ekranda ayrı
 * ayrı yazılsaydı, zamanla sessizce birbirinden ayrılırlardı.
 *
 * Renkler doğrudan Tailwind ölçeğinden alınır — ölçek `index.css` içinde koyu
 * temaya çevrilmiştir, dolayısıyla burada hiçbir onaltılık renk kodu geçmez.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Kart                                                                        */
/* -------------------------------------------------------------------------- */

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Hover'da hafifçe yükselsin mi? Yalnızca tıklanabilir kartlar için. */
  interactive?: boolean;
  /** Girişte alttan belirme animasyonunun sırası (0 = ilk). */
  index?: number;
}

export function Card({ children, className = "", interactive, index }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white ${
        interactive ? "optiflow-lift hover:border-slate-300" : ""
      } optiflow-enter ${className}`}
      style={index === undefined ? undefined : { animationDelay: `${index * 45}ms` }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bölüm başlığı                                                               */
/* -------------------------------------------------------------------------- */

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Düğme                                                                       */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400",
  secondary:
    "border border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-300 hover:text-slate-900 disabled:text-slate-400",
  ghost:
    "text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400",
  danger: "bg-red-500 text-white hover:bg-red-600 disabled:bg-slate-200",
};

/*
 * Dokunma hedefi (MASTER §14): her düğme en az 44×44 px.
 *
 * Ölçüldü (Sprint 2F-D): `sm` 28 px, `md` 36 px yükseklikteydi; ikisi de
 * kuralın altındaydı. Düzeltme `min-h`/`min-w` ile yapılır, dolgu ya da punto
 * büyütülerek değil — böylece düğmeler **görsel olarak şişmez**, yalnızca
 * tıklanabilir alanları kurala çıkar. Metinli düğmeler zaten 44 px'den
 * geniştir; `min-w` yalnızca yalnızca-ikon düğmelerini büyütür.
 */
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "min-h-[44px] min-w-[44px] gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
  md: "min-h-[44px] min-w-[44px] gap-2 rounded-lg px-3.5 py-2 text-sm",
};

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  title?: string;
  /** Butonun yanında dönen bir gösterge (kaydetme, çalıştırma). */
  busy?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  icon: Icon,
  variant = "secondary",
  size = "md",
  disabled,
  title,
  busy,
  className = "",
  ariaLabel,
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none disabled:cursor-not-allowed ${
        BUTTON_SIZE[size]
      } ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {busy ? (
        <Spinner />
      ) : (
        Icon && <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      )}
      {children}
    </button>
  );
}

/** Küçük, dönen yükleniyor göstergesi. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Rozet                                                                       */
/* -------------------------------------------------------------------------- */

export type BadgeTone = "neutral" | "good" | "warning" | "bad" | "info";

/**
 * `info` tonu yeni tasarım otoritesiyle çelişiyor — yeni kodda kullanılmaz.
 *
 * Tasarım otoritesinin 3. Yasası mavinin **yalnızca tıklanabilirlik** demesini
 * istiyor (`docs/design-system/MASTER.md` §3.3). `info` mavi bir rozet üretir
 * ama rozet tıklanabilir değildir; kullanıcıya olmayan bir eylem vaat eder.
 *
 * Ton **bilinçli olarak kaldırılmadı**: bugün 7 ekranda kullanılıyor ve rengini
 * değiştirmek Sprint 1A'nın "mevcut ekranlarda sıfır görsel fark" sözleşmesini
 * bozardı. Çelişki bu yüzden kuralla çözülüyor, pikselle değil — mevcut
 * kullanımlar olduğu gibi kalır, yeni kullanım eklenmez.
 *
 * Göç hedefi: nötr bilgi için `neutral`, ölçülmüş bir duruma bağlıysa
 * `good`/`warning`/`bad`. Kullanımlar sıfıra indiğinde ton ve bu not birlikte
 * silinir (MASTER §25).
 */
const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-red-50 text-red-800 border-red-200",
  info: "bg-brand-50 text-brand-700 border-brand-200",
};

export function Badge({
  children,
  tone = "neutral",
  icon: Icon,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${BADGE_TONE[tone]}`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Boş durum                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Veri olmadığında gösterilen ekran.
 *
 * Her boş durum kullanıcıya **ne yapacağını** söyler. "Veri yok" yazıp
 * bırakmak, kullanıcıyı bir şeyi yanlış yaptığı hissiyle baş başa bırakırdı;
 * buradaki her boş durumun bir sonraki adımı vardır.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* İlerleme çubuğu                                                             */
/* -------------------------------------------------------------------------- */

const PROGRESS_TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-400",
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  info: "bg-brand-500",
};

export function ProgressBar({
  value,
  tone = "info",
  className = "",
}: {
  /** 0-1 arası doluluk; aralık dışındaki değerler kırpılır. */
  value: number;
  tone?: BadgeTone;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Dolum süresi bir token'dan okunur.
       *
       * Değer değişmedi: `duration-500` sınıfı da 500ms'ti, `--of-motion-progress`
       * de 500ms. Sprint 1A'nın sözleşmesi mevcut ekranlarda sıfır görsel fark
       * olduğu için süre olduğu gibi bırakıldı; yalnızca **tek bir yerden**
       * yönetilebilir hâle geldi.
       *
       * Bu süre tasarım otoritesinin 240ms tavanını aşıyor (MASTER §3.7, C3) ve
       * token orada belgelenmiş bir istisna olarak duruyor. Tavana çekme kararı
       * ayrı bir sprintte verilir; o zaman değişecek tek şey token'ın değeri
       * olacak, bu dosya değil.
       *
       * `var(...)` içindeki 500ms yedeği bilinçlidir: token bir gün silinirse
       * `transition-all`ın 150ms varsayılanına düşüp sessizce hızlanmasın. */}
      <div
        className={`h-full rounded-full transition-all ${PROGRESS_TONE[tone]}`}
        style={{
          width: `${pct}%`,
          transitionDuration: "var(--of-motion-progress, 500ms)",
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Etiket-değer satırı                                                         */
/* -------------------------------------------------------------------------- */

export function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 last:border-0">
      <span className="text-xs text-slate-500" title={hint}>
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900 tabular-nums">
        {value}
      </span>
    </div>
  );
}
