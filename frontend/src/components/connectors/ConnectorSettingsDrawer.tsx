/**
 * Bağlantı ayarları — şemadan çizilen form.
 *
 * Form alanları elle yazılmaz; `fieldsOf(kind)` ne döndürüyorsa o çizilir. Yeni
 * bir protokol alanı eklendiğinde bu dosya değişmez.
 *
 * Doğrulama **yazarken** çalışır ve kaydetmeyi engellemez: kullanıcı yarım
 * bıraktığı bir ayarı kaydedip sonra dönebilmelidir. Engellenen şey bağlanmadır
 * — kart üzerindeki hata rozeti bunu söyler.
 */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  CONNECTOR_LABEL,
  fieldsOf,
  validateSettings,
  type ConnectorConfig,
  type ConnectorSettings,
  type SettingValue,
} from "../../lib/connectors";
import { Button } from "../ui/Primitives";
import { SEVERITY_LABEL, SEVERITY_TONE, TONE_CLASS } from "./connectorStyles";

interface ConnectorSettingsDrawerProps {
  config: ConnectorConfig;
  onClose: () => void;
  onSave: (values: {
    name: string;
    settings: ConnectorSettings;
    autoReconnect: boolean;
  }) => void;
  onRemove: () => void;
}

export function ConnectorSettingsDrawer({
  config,
  onClose,
  onSave,
  onRemove,
}: ConnectorSettingsDrawerProps) {
  const [name, setName] = useState(config.name);
  const [settings, setSettings] = useState<ConnectorSettings>(config.settings);
  const [autoReconnect, setAutoReconnect] = useState(config.autoReconnect);

  const fields = fieldsOf(config.kind);
  const issues = useMemo(
    () => validateSettings(config.kind, settings),
    [config.kind, settings],
  );

  const patch = (key: string, value: SettingValue): void => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Arka plan tıklanınca kapanır; kaydedilmemiş değişiklik kaybolur ve
          bu, formun küçüklüğü göz önüne alındığında kabul edilebilir. */}
      <button
        type="button"
        aria-label="Kapat"
        className="absolute inset-0 bg-slate-950/60"
        onClick={onClose}
      />

      <aside className="optiflow-drawer relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {CONNECTOR_LABEL[config.kind]} ayarları
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Bu sürümde bağlantı benzetimle sınanır; gerçek cihaza gidilmez.
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={X} onClick={onClose} ariaLabel="Kapat">
            {""}
          </Button>
        </div>

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Bağlantı adı
          </span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
          />
        </label>

        <div className="mt-3 space-y-3">
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {field.label}
                {field.required && <span className="ml-1 text-red-500">*</span>}
              </span>

              {field.type === "boolean" ? (
                <button
                  type="button"
                  onClick={() => patch(field.key, settings[field.key] !== true)}
                  className={`mt-1 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors duration-200 ${
                    settings[field.key] === true
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {settings[field.key] === true ? "Açık" : "Kapalı"}
                  <span
                    className={`h-2 w-2 rounded-full ${
                      settings[field.key] === true ? "bg-brand-500" : "bg-slate-300"
                    }`}
                  />
                </button>
              ) : field.type === "select" ? (
                <select
                  value={String(settings[field.key] ?? "")}
                  onChange={(event) => patch(field.key, event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
                >
                  <option value="">Seçilmedi</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "password" ? "password" : field.type}
                  value={String(settings[field.key] ?? "")}
                  placeholder={field.placeholder}
                  min={field.min}
                  max={field.max}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") {
                      // Boş kutu "girilmedi"dir; boş metin değil.
                      patch(field.key, null);
                      return;
                    }
                    patch(
                      field.key,
                      field.type === "number" ? Number(raw) : raw,
                    );
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
                />
              )}

              {field.hint !== undefined && (
                <span className="mt-1 block text-[11px] text-slate-500">
                  {field.hint}
                </span>
              )}
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAutoReconnect((current) => !current)}
          className={`mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors duration-200 ${
            autoReconnect
              ? "border-brand-400 bg-brand-50 text-brand-700"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          Kopunca kendiliğinden yeniden bağlan
          <span
            className={`h-2 w-2 rounded-full ${autoReconnect ? "bg-brand-500" : "bg-slate-300"}`}
          />
        </button>

        {issues.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {issues.map((issue) => {
              const tone = TONE_CLASS[SEVERITY_TONE[issue.severity]];
              return (
                <li
                  key={issue.id}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${tone.chip}`}
                >
                  <span className="font-semibold">
                    {SEVERITY_LABEL[issue.severity]}:
                  </span>{" "}
                  {issue.text}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Button
            variant="primary"
            onClick={() => onSave({ name, settings, autoReconnect })}
          >
            Kaydet
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" className="ml-auto" onClick={onRemove}>
            Bağlantıyı sil
          </Button>
        </div>
      </aside>
    </div>
  );
}
