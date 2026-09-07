/**
 * Adım 3 — Kolon eşleştirme.
 *
 * Akışın en önemli ekranı: dosyanın kendi dilinden ürünün diline geçiş burada
 * olur. Tasarımın taşıdığı üç karar:
 *
 * 1. **Öneriler otomatik gelir, ama her biri değiştirilebilir.** Otomatik
 *    eşleştirmeyi onaylatmadan geçmek, yanlış bir kolonun sessizce modele
 *    girmesi demekti; her satırda bir açılır liste vardır ve kullanıcı istediği
 *    anda düzeltir.
 * 2. **Güven açıkça yazılır** (Yüksek / Orta / Düşük). Kullanıcı hangi
 *    satırları kontrol etmesi gerektiğini bilmelidir; hepsi aynı görünseydi ya
 *    hepsini tek tek denetler ya da hiçbirine bakmazdı.
 * 3. **Örnek değerler gösterilir.** "Kolon 4 → Çevrim Süresi" tek başına
 *    doğrulanamaz; "3,5 · 4 · 2,5" görüldüğünde doğruluğu bir bakışta anlaşılır.
 *
 * Bu sürümde öneriler kural tabanlıdır ve bu ekranda açıkça belirtilir
 * (`provider.description`). Sağlayıcı değiştiğinde (Claude, yerel model) bu
 * bileşen değişmez.
 */

import { useMemo } from "react";
import { ArrowRight, CircleCheck, CircleHelp, Sparkles } from "lucide-react";
import {
  CONFIDENCE_LABEL,
  FIELDS,
  type ColumnMapping,
  type DetectedColumn,
  type FieldId,
  type MappingConfidence,
  type MappingSuggestion,
} from "../../lib/import";
import type { ImportIssue } from "../../lib/import";

const CONFIDENCE_STYLE: Record<MappingConfidence, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-100 text-slate-600",
};

interface ColumnMapperProps {
  columns: DetectedColumn[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
  /** Öneri kaynağının kullanıcıya gösterilecek açıklaması. */
  providerNote: string;
  issues: ImportIssue[];
  onChange: (fieldId: FieldId, columnIndex: number | null) => void;
  onContinue: () => void;
  onBack: () => void;
  canContinue: boolean;
}

export function ColumnMapper({
  columns,
  mapping,
  suggestions,
  providerNote,
  issues,
  onChange,
  onContinue,
  onBack,
  canContinue,
}: ColumnMapperProps) {
  const suggestionOf = useMemo(
    () => new Map(suggestions.map((item) => [item.fieldId, item])),
    [suggestions],
  );

  const columnOf = useMemo(
    () => new Map(columns.map((column) => [column.index, column])),
    [columns],
  );

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Kolonları eşleştirin
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Dosyanızdaki kolonları OptiFlow alanlarına bağladık. Yanlış olanları
          değiştirebilirsiniz.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
          <Sparkles className="h-3 w-3 text-brand-700" />
          {providerNote}
        </p>
      </header>

      {/* Hatalar önce gelir: ilerlemeyi engelleyen şey en üstte olmalıdır. */}
      {errors.length > 0 && (
        <ul className="optiflow-enter mb-4 space-y-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          {errors.map((issue) => (
            <li key={issue.message} className="text-sm text-red-800">
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="optiflow-enter mb-4 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          {warnings.map((issue) => (
            <li key={issue.message} className="text-xs text-amber-800">
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2.5">
        {FIELDS.map((field, index) => {
          const selected = mapping[field.id] ?? null;
          const suggestion = suggestionOf.get(field.id);
          const column = selected === null ? null : (columnOf.get(selected) ?? null);
          const isAuto =
            suggestion?.columnIndex !== null &&
            suggestion?.columnIndex === selected;

          return (
            <div
              key={field.id}
              style={{ animationDelay: `${index * 40}ms` }}
              className="optiflow-enter optiflow-glass grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
            >
              {/* Sol: Excel kolonu */}
              <div className="min-w-0">
                <label
                  htmlFor={`map-${field.id}`}
                  className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-500 uppercase"
                >
                  Excel kolonu
                </label>
                <select
                  id={`map-${field.id}`}
                  value={selected === null ? "" : String(selected)}
                  onChange={(event) =>
                    onChange(
                      field.id,
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                  className="w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800 transition-colors focus:border-brand-500 focus:outline-none"
                >
                  <option value="">— eşleştirme —</option>
                  {columns.map((option) => (
                    <option key={option.index} value={option.index}>
                      {option.header}
                    </option>
                  ))}
                </select>

                {column && column.samples.length > 0 && (
                  // Örnek değerler doğrulamayı bir bakışta mümkün kılar.
                  <p className="mt-1.5 truncate text-[11px] text-slate-500">
                    {column.samples.join(" · ")}
                  </p>
                )}
              </div>

              {/* Orta: yön */}
              <ArrowRight className="mx-auto hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />

              {/* Sağ: OptiFlow alanı */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-slate-900">
                    {field.label}
                  </span>
                  {field.required && (
                    <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] font-bold text-red-800">
                      ZORUNLU
                    </span>
                  )}
                  {field.usage === "inventory" && (
                    // Modele girmeyen alanlar açıkça işaretlenir; aksi hâlde
                    // kullanıcı eşleştirdiği bir kolonun neden şemada
                    // görünmediğini anlayamazdı.
                    <span
                      className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-500"
                      title="Envanter modülünün alanı; fabrika şemasına girmez."
                    >
                      ENVANTER
                    </span>
                  )}

                  {selected !== null && suggestion && isAuto && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_STYLE[suggestion.confidence]}`}
                      title={suggestion.reason}
                    >
                      <CircleCheck className="h-2.5 w-2.5" />
                      {CONFIDENCE_LABEL[suggestion.confidence]}
                    </span>
                  )}
                  {selected !== null && !isAuto && (
                    <span className="rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                      Elle seçildi
                    </span>
                  )}
                  {selected === null && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      <CircleHelp className="h-2.5 w-2.5" />
                      Eşleşmedi
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  {field.hint}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:text-slate-900 focus:outline-none"
        >
          Geri
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          title={canContinue ? undefined : "Önce yukarıdaki hataları giderin"}
          className="flex-1 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          Devam
        </button>
      </div>
    </div>
  );
}
