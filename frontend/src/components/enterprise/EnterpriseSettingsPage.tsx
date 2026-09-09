/**
 * Kurumsal ayarlar — logo, marka rengi, para birimi, saat dilimi, dil ve PDF
 * başlığı.
 *
 * Ayarların tamamı kurulum durumunda saklanır ve rapor katmanına geçer. Logo,
 * rapor katmanının kendi deposunu kullanır (`saveLogo`): iki ayrı yerde
 * tutulsaydı, PDF'te eski logo görünürken ekranda yenisi durabilirdi.
 */

import { useState } from "react";
import { ImageUp, Save, Trash2 } from "lucide-react";
import {
  ACCEPTED_LOGO_TYPES,
  clearLogo,
  saveLogo,
  validateLogo,
} from "../../lib/reports";
import type { EnterpriseSettings } from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";

const CURRENCIES = [
  { value: "TRY", label: "TRY — Türk lirası" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "USD", label: "USD — Dolar" },
];

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
];

const LOCALES = [
  { value: "tr-TR", label: "Türkçe" },
  { value: "en-US", label: "English" },
];

interface EnterpriseSettingsPageProps {
  settings: EnterpriseSettings;
  onChange: (settings: EnterpriseSettings) => void;
}

export function EnterpriseSettingsPage({
  settings,
  onChange,
}: EnterpriseSettingsPageProps) {
  const [draft, setDraft] = useState<EnterpriseSettings>(settings);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const patch = (values: Partial<EnterpriseSettings>): void => {
    setDraft((current) => ({ ...current, ...values }));
    setSaved(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Kurumsal Ayarlar
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Bu ayarlar raporların kapağında ve para birimi biçimlendirmesinde
          kullanılır.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          {draft.logoDataUrl !== null && (
            <img
              src={draft.logoDataUrl}
              alt="Şirket logosu"
              className="h-12 w-auto rounded-lg border border-slate-200 bg-white p-1"
            />
          )}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors duration-200 hover:border-brand-400">
            <ImageUp className="h-4 w-4" />
            Logo yükle
            <input
              type="file"
              accept={ACCEPTED_LOGO_TYPES.join(",")}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) {
                  return;
                }
                const error = validateLogo(file);
                if (error !== null) {
                  setLogoError(error);
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result);
                  saveLogo(dataUrl);
                  setLogoError(null);
                  patch({ logoDataUrl: dataUrl });
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {draft.logoDataUrl !== null && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              onClick={() => {
                clearLogo();
                patch({ logoDataUrl: null });
              }}
            >
              Logoyu kaldır
            </Button>
          )}
          {logoError !== null && (
            <span className="text-[11px] text-red-600">{logoError}</span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Marka rengi" hint="Ekrandaki vurgu rengi ve rapor başlığı.">
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={draft.brandColor}
                onChange={(event) => patch({ brandColor: event.target.value })}
                className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
              />
              <input
                type="text"
                value={draft.brandColor}
                onChange={(event) => patch({ brandColor: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
              />
            </div>
          </Field>

          <Field label="Para birimi">
            <select
              value={draft.currency}
              onChange={(event) => patch({ currency: event.target.value })}
              className={inputClass}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency.value} value={currency.value}>
                  {currency.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Saat dilimi">
            <select
              value={draft.timezone}
              onChange={(event) => patch({ timezone: event.target.value })}
              className={inputClass}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dil">
            <select
              value={draft.locale}
              onChange={(event) => patch({ locale: event.target.value })}
              className={inputClass}
            >
              {LOCALES.map((locale) => (
                <option key={locale.value} value={locale.value}>
                  {locale.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="PDF başlığı" hint="Raporların kapağında bu başlık görünür.">
              <input
                type="text"
                value={draft.pdfTitle}
                onChange={(event) => patch({ pdfTitle: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={Save}
            onClick={() => {
              onChange(draft);
              setSaved(true);
            }}
          >
            Kaydet
          </Button>
          {saved && (
            <span className="text-xs text-emerald-600">Ayarlar kaydedildi.</span>
          )}
        </div>
      </Card>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>
      )}
    </label>
  );
}
