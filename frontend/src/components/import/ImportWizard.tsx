/**
 * Excel içe aktarma sihirbazının kabuğu.
 *
 * Altı adım: dosya → sayfa → eşleştirme → eksik bilgiler → önizleme → oluştur.
 * Tek sayfalı dosyalarda sayfa adımı **atlanır**; kullanıcıya tek seçenekli
 * bir soru sormak akışa boş bir tık eklemektir.
 *
 * Durum burada toplanır, hesap burada yapılmaz: kolon çıkarımı, skorlama,
 * doğrulama ve model kurma `lib/import` içindeki saf işlevlerdedir. Bu bileşen
 * yalnızca onları sırayla çağırır ve sonucu adım bileşenlerine dağıtır.
 *
 * Öneri sağlayıcısı dışarıdan alınabilir (`provider`): bugün kural tabanlı
 * olan sağlayıcı, ileride bir dil modeline bağlanan başka bir sağlayıcıyla
 * değiştirildiğinde bu dosyada tek satır değişmez.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import type { FactoryDetail, SimulationConfig } from "../../types/simulationTypes";
import {
  DEFAULT_IMPORT_DEFAULTS,
  RuleBasedProvider,
  buildFactoryFromRows,
  dataRows,
  detectColumns,
  mappingFromSuggestions,
  missingModelFields,
  suggestInterarrival,
  validateImport,
  type ColumnMapping,
  type FieldId,
  type ImportDefaults,
  type MappingSuggestion,
  type MappingSuggestionProvider,
  type ParsedFile,
} from "../../lib/import";
import { ImportDropzone } from "./ImportDropzone";
import { SheetPicker } from "./SheetPicker";
import { ColumnMapper } from "./ColumnMapper";
import { MissingFieldsForm } from "./MissingFieldsForm";
import { ImportPreview } from "./ImportPreview";
import { ImportSummary } from "./ImportSummary";

type Step = "file" | "sheet" | "mapping" | "missing" | "preview" | "create";

const STEP_ORDER: Step[] = [
  "file",
  "sheet",
  "mapping",
  "missing",
  "preview",
  "create",
];

const STEP_LABEL: Record<Step, string> = {
  file: "Dosya",
  sheet: "Sayfa",
  mapping: "Eşleştirme",
  missing: "Eksikler",
  preview: "Önizleme",
  create: "Oluştur",
};

interface ImportWizardProps {
  /** Fabrika oluşturulduğunda çağrılır; üst katman editöre geçirir. */
  onCreated: (detail: FactoryDetail, config: SimulationConfig) => void;
  onCancel: () => void;
  /** Öneri kaynağı; verilmezse kural tabanlı sağlayıcı kullanılır. */
  provider?: MappingSuggestionProvider;
}

export function ImportWizard({
  onCreated,
  onCancel,
  provider,
}: ImportWizardProps) {
  // Sağlayıcı bir kez kurulur; her çizimde yenisi yaratılsaydı öneri efekti
  // sonsuz döngüye girerdi.
  const activeProvider = useMemo(
    () => provider ?? new RuleBasedProvider(),
    [provider],
  );

  const [step, setStep] = useState<Step>("file");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [defaults, setDefaults] = useState<ImportDefaults>(
    DEFAULT_IMPORT_DEFAULTS,
  );

  const sheet = sheetIndex === null ? null : (parsed?.sheets[sheetIndex] ?? null);

  const columns = useMemo(
    () => (sheet ? detectColumns(sheet.rows) : []),
    [sheet],
  );
  const rows = useMemo(() => (sheet ? dataRows(sheet.rows) : []), [sheet]);

  /* -- Öneriler ---------------------------------------------------------- */
  // Sayfa seçildiğinde bir kez üretilir. Sağlayıcı eşzamansızdır (ileride ağ
  // üzerinden çalışan bir model de bu sözleşmeye sığsın diye); sayfa
  // değişirse eski yanıt yok sayılır.
  useEffect(() => {
    if (columns.length === 0) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void activeProvider.suggest(columns).then((result) => {
      if (cancelled) {
        return;
      }
      setSuggestions(result);
      setMapping(mappingFromSuggestions(result));
    });
    return () => {
      cancelled = true;
    };
  }, [columns, activeProvider]);

  /* -- Doğrulama --------------------------------------------------------- */
  const validation = useMemo(
    () => validateImport(mapping, columns, rows),
    [mapping, columns, rows],
  );

  /* -- Model ------------------------------------------------------------- */
  const built = useMemo(
    () => buildFactoryFromRows(rows, mapping, defaults),
    [rows, mapping, defaults],
  );

  const missing = useMemo(() => missingModelFields(mapping), [mapping]);

  /* -- Gezinme ----------------------------------------------------------- */
  const goToMapping = useCallback(() => setStep("mapping"), []);

  const handleParsed = useCallback((file: ParsedFile) => {
    setParsed(file);
    // Tek sayfalı dosyada sayfa adımı anlamsızdır; seçim baştan yapılır.
    setSheetIndex(file.sheets.length === 1 ? 0 : null);
  }, []);

  const afterFile = useCallback(() => {
    if (!parsed) {
      return;
    }
    setStep(parsed.sheets.length === 1 ? "mapping" : "sheet");
  }, [parsed]);

  const enterMissingStep = useCallback(() => {
    // Giriş aralığının başlangıç değeri dosyadan türetilir: hat, en dar
    // halkasından hızlı beslenirse kuyruklar sonsuza büyür.
    setDefaults((current) => ({
      ...current,
      interarrivalMinutes: suggestInterarrival(rows, mapping, current.machines),
    }));
    setStep("missing");
  }, [rows, mapping]);

  const handleFieldChange = useCallback(
    (fieldId: FieldId, columnIndex: number | null) => {
      setMapping((current) => ({ ...current, [fieldId]: columnIndex }));
    },
    [],
  );

  const visibleSteps = useMemo(
    () =>
      STEP_ORDER.filter(
        (item) => item !== "sheet" || (parsed?.sheets.length ?? 0) > 1,
      ),
    [parsed],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Üst şerit: nerede olunduğu ve çıkış yolu. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 backdrop-blur-xl sm:px-6">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
        >
          <ArrowLeft className="h-4 w-4" />
          Vazgeç
        </button>

        <ol className="ml-auto flex flex-wrap items-center gap-1.5">
          {visibleSteps.map((item) => {
            const position = visibleSteps.indexOf(item);
            const current = visibleSteps.indexOf(step);
            const isDone = position < current;
            const isCurrent = item === step;

            return (
              <li key={item} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors duration-200 ${
                    isCurrent
                      ? "bg-brand-600/15 text-brand-700"
                      : isDone
                        ? "text-emerald-700"
                        : "text-slate-500"
                  }`}
                >
                  {isDone && <Check className="h-3 w-3" />}
                  {STEP_LABEL[item]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === "file" && (
          <ImportDropzone
            parsed={parsed}
            onParsed={handleParsed}
            onContinue={afterFile}
          />
        )}

        {step === "sheet" && parsed && (
          <SheetPicker
            sheets={parsed.sheets}
            selectedIndex={sheetIndex}
            onSelect={setSheetIndex}
            onContinue={goToMapping}
            onBack={() => setStep("file")}
          />
        )}

        {step === "mapping" && (
          <ColumnMapper
            columns={columns}
            mapping={mapping}
            suggestions={suggestions}
            providerNote={activeProvider.description}
            issues={validation.issues}
            onChange={handleFieldChange}
            onContinue={enterMissingStep}
            onBack={() =>
              setStep((parsed?.sheets.length ?? 0) > 1 ? "sheet" : "file")
            }
            canContinue={!validation.hasBlockingError}
          />
        )}

        {step === "missing" && (
          <MissingFieldsForm
            missing={missing}
            mapping={mapping}
            defaults={defaults}
            onChange={(patch) =>
              setDefaults((current) => ({ ...current, ...patch }))
            }
            onContinue={() => setStep("preview")}
            onBack={goToMapping}
          />
        )}

        {step === "preview" && (
          <ImportPreview
            config={built.config}
            importedCount={built.importedCount}
            skippedCount={built.skippedRows.length}
            onContinue={() => setStep("create")}
            onBack={() => setStep("missing")}
          />
        )}

        {step === "create" && parsed && (
          <ImportSummary
            config={built.config}
            fileName={parsed.fileName}
            sheetName={sheet?.name ?? "—"}
            importedCount={built.importedCount}
            onCreated={(detail) => onCreated(detail, built.config)}
            onBack={() => setStep("preview")}
          />
        )}
      </div>
    </div>
  );
}
