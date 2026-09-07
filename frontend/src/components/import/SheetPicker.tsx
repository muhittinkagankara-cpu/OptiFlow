/**
 * Adım 2 — Sayfa seçimi.
 *
 * Tek sayfalı dosyalarda bu adım hiç gösterilmez (bkz. `ImportWizard`):
 * kullanıcıya tek seçenekli bir soru sormak, akışa boş bir tık eklemektir.
 *
 * Her kart bir önizleme taşır — satır/kolon sayısı ve ilk beş satır. Yalnızca
 * sayfa adları listelenseydi, "Sayfa1 / Sayfa2 / Veri" gibi adlar taşıyan
 * gerçek dosyalarda kullanıcı hangisini seçeceğini bilemezdi.
 */

import { Check, Table2, TriangleAlert } from "lucide-react";
import type { ImportedSheet } from "../../lib/import";
import { cellToText, dataRows, detectColumns } from "../../lib/import";

interface SheetPickerProps {
  sheets: ImportedSheet[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onContinue: () => void;
  onBack: () => void;
}

/** Önizlemede gösterilecek satır sayısı. */
const PREVIEW_ROWS = 5;

export function SheetPicker({
  sheets,
  selectedIndex,
  onSelect,
  onContinue,
  onBack,
}: SheetPickerProps) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Hangi sayfayı kullanalım?
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Dosyanızda {sheets.length} sayfa var. İstasyon listesini içeren
          sayfayı seçin.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {sheets.map((sheet, index) => {
          const columns = detectColumns(sheet.rows);
          const body = dataRows(sheet.rows);
          const isSelected = index === selectedIndex;
          const isEmpty = columns.length === 0 || body.length === 0;

          return (
            <button
              key={`${sheet.name}-${index}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => !isEmpty && onSelect(index)}
              disabled={isEmpty}
              style={{ animationDelay: `${index * 55}ms` }}
              className={`optiflow-enter optiflow-glass rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none ${
                isEmpty
                  ? "cursor-not-allowed border-slate-200 opacity-60"
                  : isSelected
                    ? "optiflow-lift border-brand-500"
                    : "optiflow-lift border-slate-200 hover:border-brand-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      isSelected
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Table2 className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {sheet.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {isEmpty
                        ? "Boş sayfa"
                        : `${body.length} satır · ${columns.length} kolon`}
                    </p>
                  </div>
                </div>

                {isSelected && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>

              {isEmpty ? (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  Bu sayfada okunabilir veri yok.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-100/60">
                        {columns.slice(0, 5).map((column) => (
                          <th
                            key={column.index}
                            className="max-w-[7rem] truncate px-2 py-1.5 text-left font-semibold text-slate-600"
                          >
                            {column.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {body.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {columns.slice(0, 5).map((column) => (
                            <td
                              key={column.index}
                              className="max-w-[7rem] truncate px-2 py-1 text-slate-500"
                            >
                              {cellToText(row[column.index] ?? null)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </button>
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
          disabled={selectedIndex === null}
          title={selectedIndex === null ? "Devam etmek için bir sayfa seçin" : undefined}
          className="flex-1 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          Devam
        </button>
      </div>
    </div>
  );
}
