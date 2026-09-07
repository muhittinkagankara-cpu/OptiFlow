/**
 * Adım 6 — Fabrikanın oluşturulması.
 *
 * Mevcut **Factory Versioning** yapısı olduğu gibi kullanılır:
 * `POST /api/factories` çağrısı fabrikayı ve ilk sürümü birlikte oluşturur
 * (`config` gönderildiğinde backend sürüm 1'i kendisi yazar). Ayrı bir "sürüm
 * oluştur" adımı yoktur ve burada yeni bir uç eklenmemiştir.
 *
 * `note` alanı dosya adını taşır: aylar sonra sürüm geçmişine bakan biri, bu
 * modelin hangi Excel'den geldiğini görebilmelidir.
 *
 * Ad çakışması bilinçli olarak engellenmez — backend aynı adlı iki fabrikaya
 * izin verir ve kullanıcının aynı dosyayı iki kez denemesi meşru bir davranış.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import type { FactoryDetail, SimulationConfig } from "../../types/simulationTypes";
import { ApiError, createFactory } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import { factoryNameFromFile } from "../../lib/import";
import { buildFlowFromConfig } from "../../lib/configBuilder";
import { extractLayout } from "../../lib/factoryModel";

interface ImportSummaryProps {
  config: SimulationConfig;
  /** Kaynak dosyanın adı; fabrika adı ve sürüm notu bundan türetilir. */
  fileName: string;
  sheetName: string;
  importedCount: number;
  onCreated: (detail: FactoryDetail) => void;
  onBack: () => void;
}

export function ImportSummary({
  config,
  fileName,
  sheetName,
  importedCount,
  onCreated,
  onBack,
}: ImportSummaryProps) {
  const [name, setName] = useState(() => factoryNameFromFile(fileName));
  const [sector, setSector] = useState("");
  const [isSaving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Aynı içe aktarmanın iki kez gönderilmesini engeller: hızlı çift tık ya da
  // React'in çift çağrısı iki ayrı fabrika oluştururdu.
  const submitted = useRef(false);
  useEffect(() => {
    submitted.current = false;
  }, [config]);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed === "" || submitted.current) {
      return;
    }
    submitted.current = true;
    setSaving(true);
    setErrors([]);

    try {
      // Yerleşim de birlikte kaydedilir. Yalnızca `config` gönderilseydi,
      // sürüm 1 yerleşimsiz olur ve editör açılır açılmaz "kaydedilmemiş
      // değişiklikler var" derdi: canvas otomatik bir yerleşim kurar, kayıtlı
      // sürümde ise yerleşim yoktur ve ikisi farklı görünür. Kullanıcı hiçbir
      // şey değiştirmemişken bu uyarıyı görmemelidir.
      const { nodes } = buildFlowFromConfig(config);

      const detail = await createFactory({
        name: trimmed,
        sector: sector.trim() === "" ? null : sector.trim(),
        config,
        layout: extractLayout(nodes),
        note: `Excel'den içe aktarıldı: ${fileName} → ${sheetName}`,
      });
      onCreated(detail);
    } catch (error) {
      submitted.current = false;
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setSaving(false);
    }
  }, [name, sector, config, fileName, sheetName, onCreated]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-6 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700">
          <Check className="h-6 w-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Fabrikanıza bir ad verin
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {importedCount} istasyon hazır. Kaydettiğinizde sürüm 1 oluşur ve
          editöre geçersiniz.
        </p>
      </header>

      <div className="optiflow-glass optiflow-enter space-y-4 rounded-xl border border-slate-200 p-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">Fabrika adı</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Örn. Ana Üretim Hattı"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            Sektör{" "}
            <span className="font-normal text-slate-500">(isteğe bağlı)</span>
          </span>
          <input
            type="text"
            value={sector}
            onChange={(event) => setSector(event.target.value)}
            placeholder="Örn. Metal İşleme"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <p className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          Kaynak olarak <span className="text-slate-700">{fileName}</span> →{" "}
          <span className="text-slate-700">{sheetName}</span> kaydedilecek;
          sürüm geçmişinde bu modelin nereden geldiği görünür.
        </p>
      </div>

      {errors.length > 0 && (
        <ul className="optiflow-enter mt-4 space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          {errors.map((message) => (
            <li
              key={message}
              className="flex items-start gap-2 text-sm text-red-800"
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:text-slate-900 focus:outline-none disabled:opacity-50"
        >
          Geri
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSaving || name.trim() === ""}
          title={name.trim() === "" ? "Fabrikaya bir ad verin" : undefined}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSaving ? "Oluşturuluyor…" : "Fabrikayı oluştur"}
        </button>
      </div>
    </div>
  );
}
