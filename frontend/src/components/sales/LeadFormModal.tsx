/**
 * Firma ekleme / düzenleme kipi.
 *
 * Tek zorunlu alan firma adıdır. Bir satış görüşmesinde telefon numarası ya
 * da makine sayısı çoğu zaman sonradan öğrenilir; hepsini zorunlu kılmak,
 * satışçıyı kaydı hiç açmamaya iter.
 *
 * Makine ve çalışan sayısı boş bırakılabilir; fiyat motoru sıfırı güvenle
 * karşılar ve taban ücreti gösterir (bkz. `pricing.buildQuote`).
 */

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { buildQuote, type Lead } from "../../lib/sales";
import { formatMoney } from "../../lib/financeFormatting";
import { Button } from "../ui/Primitives";

/** Formun taşıdığı alanlar; `Lead`'in kullanıcıdan gelen bölümü. */
export interface LeadFormValues {
  company: string;
  sector: string;
  city: string;
  contactName: string;
  phone: string;
  email: string;
  machineCount: number;
  employeeCount: number;
  note: string;
}

const SECTORS = ["Metal", "Plastik", "Tekstil", "Gıda", "Otomotiv", "Diğer"];

const EMPTY: LeadFormValues = {
  company: "",
  sector: "Metal",
  city: "",
  contactName: "",
  phone: "",
  email: "",
  machineCount: 0,
  employeeCount: 0,
  note: "",
};

export function LeadFormModal({
  lead,
  onClose,
  onSave,
}: {
  /** Düzenlenen kayıt; yeni kayıtta `null`. */
  lead: Lead | null;
  onClose: () => void;
  onSave: (values: LeadFormValues) => void;
}) {
  const [values, setValues] = useState<LeadFormValues>(() =>
    lead === null ? EMPTY : pick(lead),
  );
  const [touched, setTouched] = useState(false);

  // Esc ile kapatmak, kip pencerelerinde beklenen davranıştır.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const companyMissing = values.company.trim() === "";

  /* Fiyat, kullanıcı yazarken canlı güncellenir: satışçı formu doldururken
     hangi pakete düşeceğini görür ve konuşmayı ona göre kurar. */
  const preview = useMemo(
    () =>
      buildQuote({
        machineCount: values.machineCount,
        employeeCount: values.employeeCount,
      }),
    [values.machineCount, values.employeeCount],
  );

  const submit = () => {
    setTouched(true);
    if (companyMissing) {
      return;
    }
    onSave({ ...values, company: values.company.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute inset-0 -z-10"
      />

      <div className="optiflow-screen flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {lead === null ? "Yeni Lead" : "Firmayı düzenle"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Yalnızca firma adı zorunlu; kalanı sonradan tamamlanabilir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Field label="Firma" required>
            <input
              value={values.company}
              onChange={(event) => set("company", event.target.value)}
              placeholder="ABC Metal"
              autoFocus
              className={input(touched && companyMissing)}
            />
            {touched && companyMissing && (
              <p className="mt-1 text-[11px] text-red-700">
                Firma adı olmadan kayıt listede tanınmaz.
              </p>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sektör">
              <select
                value={values.sector}
                onChange={(event) => set("sector", event.target.value)}
                className={input(false)}
              >
                {SECTORS.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Şehir">
              <input
                value={values.city}
                onChange={(event) => set("city", event.target.value)}
                placeholder="İstanbul"
                className={input(false)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Yetkili">
              <input
                value={values.contactName}
                onChange={(event) => set("contactName", event.target.value)}
                placeholder="Mehmet Yılmaz"
                className={input(false)}
              />
            </Field>
            <Field label="Telefon">
              <input
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                placeholder="0532 000 00 00"
                inputMode="tel"
                className={input(false)}
              />
            </Field>
          </div>

          <Field label="E-posta">
            <input
              value={values.email}
              onChange={(event) => set("email", event.target.value)}
              placeholder="yetkili@firma.com"
              inputMode="email"
              className={input(false)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Makine sayısı">
              <input
                value={values.machineCount === 0 ? "" : values.machineCount}
                onChange={(event) =>
                  set("machineCount", Number(event.target.value) || 0)
                }
                placeholder="12"
                inputMode="numeric"
                className={input(false)}
              />
            </Field>
            <Field label="Çalışan sayısı">
              <input
                value={values.employeeCount === 0 ? "" : values.employeeCount}
                onChange={(event) =>
                  set("employeeCount", Number(event.target.value) || 0)
                }
                placeholder="40"
                inputMode="numeric"
                className={input(false)}
              />
            </Field>
          </div>

          {/* Canlı paket önizlemesi. */}
          <p className="rounded-xl border border-brand-300/50 bg-brand-600/10 px-3 py-2.5 text-[11px] leading-relaxed text-slate-700">
            Bu ölçekte <strong className="text-brand-700">{preview.plan.label}</strong>{" "}
            paketi öneriliyor — {formatMoney(preview.monthly)} / ay,{" "}
            {formatMoney(preview.setupFee)} kurulum.
          </p>

          <Field label="Not">
            <textarea
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
              rows={3}
              placeholder="Görüşmede konuşulanlar, öncelikli sorun…"
              className={input(false)}
            />
          </Field>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" onClick={submit}>
            Kaydet
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-500">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function input(hasError: boolean): string {
  return `w-full rounded-xl border bg-slate-100 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none ${
    hasError ? "border-red-400" : "border-slate-200 focus:border-brand-500"
  }`;
}

function pick(lead: Lead): LeadFormValues {
  return {
    company: lead.company,
    sector: lead.sector,
    city: lead.city,
    contactName: lead.contactName,
    phone: lead.phone,
    email: lead.email,
    machineCount: lead.machineCount,
    employeeCount: lead.employeeCount,
    note: lead.note,
  };
}
