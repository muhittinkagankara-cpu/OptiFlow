/**
 * Form alanları için ortak sarmalayıcılar.
 *
 * Sihirbaz ve parametre paneli aynı görünümde alanlar kullanır; bunları iki
 * yerde ayrı ayrı yazmak, birinde yapılan iyileştirmenin diğerine geçmemesine
 * yol açardı.
 */

import { useId } from "react";
import { Tooltip } from "./Tooltip";

interface FieldProps {
  label: string;
  /** (?) düğmesinde gösterilecek açıklama. */
  help?: string;
  /** Alanın altında görünen kısa yardımcı metin. */
  hint?: string;
  children: (id: string) => React.ReactNode;
}

/** Etiket + isteğe bağlı ipucu + alan. */
export function Field({ label, help, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-700"
      >
        {label}
        {help && <Tooltip content={help} label={`${label} hakkında`} />}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none";

interface TextFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Verilirse alan, tarayıcının kendi otomatik tamamlama listesini gösterir.
   *
   * `datalist` bilinçli bir tercihtir: kullanıcı listeden seçebilir **ama**
   * listede olmayan bir değeri de yazabilir. Açılır menü olsaydı yeni bir hat
   * adı girmek imkânsızlaşır, serbest metin olsaydı aynı hat farklı yazımlarla
   * ("Kesim Hattı" / "kesim hatti") ayrı gruplara bölünürdü.
   */
  suggestions?: string[];
}

export function TextField({
  id,
  value,
  onChange,
  placeholder,
  suggestions,
}: TextFieldProps) {
  const listId = suggestions && suggestions.length > 0 ? `${id}-list` : undefined;
  return (
    <>
      <input
        id={id}
        type="text"
        className={INPUT_CLASS}
        value={value}
        placeholder={placeholder}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions?.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </>
  );
}

interface NumberFieldProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}

/**
 * Sayı alanı.
 *
 * Boş bırakılan alan `NaN` üretmemelidir: kullanıcı bir rakamı silip yenisini
 * yazarken alan bir an boş kalır ve `Number("")` sıfır döner. Boş girdide
 * değişiklik bildirilmez, böylece kullanıcı yazmaya devam edebilir.
 */
export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  suffix,
  disabled,
}: NumberFieldProps) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        className={`${INPUT_CLASS} ${suffix ? "pr-12" : ""} ${
          disabled ? "cursor-not-allowed bg-slate-100 text-slate-400" : ""
        }`}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            return;
          }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  id: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

export function SelectField<T extends string>({
  id,
  value,
  options,
  onChange,
}: SelectFieldProps<T>) {
  return (
    <select
      id={id}
      className={`${INPUT_CLASS} cursor-pointer`}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Panel içindeki başlıklı bölüm. */
export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/** "Gelişmiş Ayarlar" gibi, varsayılan olarak kapalı bölümler. */
export function Collapsible({ title, children, defaultOpen = false }: CollapsibleProps) {
  return (
    <details
      className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none text-sm font-medium text-slate-700 marker:content-none hover:text-brand-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-400 transition-transform">▸</span>
          {title}
        </span>
      </summary>
      <div className="mt-3 space-y-4 pb-1">{children}</div>
    </details>
  );
}
