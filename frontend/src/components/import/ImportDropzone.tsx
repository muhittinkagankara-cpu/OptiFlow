/**
 * Adım 1 — Dosyanın bırakılması.
 *
 * Sürükle-bırak tek yol değildir: aynı alan tıklanabilir bir dosya seçici
 * olarak da çalışır. Yalnızca sürüklemeye izin verilseydi, dokunmatik
 * cihazlarda ve klavyeyle gezinen kullanıcılar için ekran tümüyle kullanılamaz
 * olurdu.
 *
 * Sürükleme sayacı
 * ----------------
 * `dragenter`/`dragleave` olayları alanın **iç** öğelerinde de tetiklenir;
 * basit bir boolean kullanılsaydı imleç bir alt öğenin üzerine geçtiğinde
 * vurgulama sönerdi. Bu yüzden derinlik sayılır.
 */

import { useCallback, useRef, useState } from "react";
import {
  FileSpreadsheet,
  FileWarning,
  Loader2,
  Table2,
  Upload,
} from "lucide-react";
import {
  ACCEPT_ATTRIBUTE,
  ImportError,
  formatFileSize,
  parseFile,
  type ParsedFile,
} from "../../lib/import";

interface ImportDropzoneProps {
  /** Dosya başarıyla çözümlendiğinde çağrılır. */
  onParsed: (file: ParsedFile) => void;
  /** Halihazırda çözümlenmiş dosya; kart olarak gösterilir. */
  parsed: ParsedFile | null;
  onContinue: () => void;
}

export function ImportDropzone({
  onParsed,
  parsed,
  onContinue,
}: ImportDropzoneProps) {
  const [depth, setDepth] = useState(0);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }
      setError(null);
      setBusy(true);
      try {
        onParsed(await parseFile(file));
      } catch (cause) {
        // Hiçbir durumda ham bir kütüphane hatası kullanıcıya gösterilmez.
        if (cause instanceof ImportError) {
          setError({ message: cause.message, hint: cause.hint });
        } else {
          setError({
            message: "Dosya okunurken beklenmeyen bir sorun oluştu.",
            hint: "Başka bir dosyayla tekrar deneyin.",
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [onParsed],
  );

  const isActive = depth > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="optiflow-enter mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Excel dosyanızı bırakın.
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          Hattınızın istasyonlarını içeren tabloyu yükleyin; gerisini biz
          hallederiz.
        </p>
      </header>

      {/* Bırakma alanı */}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDepth((current) => current + 1);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDepth((current) => Math.max(0, current - 1));
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDepth(0);
          void handleFile(event.dataTransfer.files?.[0]);
        }}
        className={`optiflow-glass optiflow-enter relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 sm:p-12 ${
          isActive
            ? "optiflow-drop-active border-brand-500"
            : "border-slate-300 hover:border-brand-400"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            // Aynı dosyanın ikinci kez seçilebilmesi için değer sıfırlanır;
            // aksi hâlde `change` olayı hiç tetiklenmez.
            event.target.value = "";
          }}
          className="sr-only"
          aria-label="Excel dosyası seç"
        />

        <span
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-200 ${
            isActive
              ? "scale-110 bg-brand-600 text-white"
              : "bg-brand-600/15 text-brand-700"
          }`}
        >
          {isBusy ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Upload className="h-7 w-7" />
          )}
        </span>

        <p className="mt-5 text-base font-semibold text-slate-900">
          {isBusy
            ? "Dosya okunuyor…"
            : isActive
              ? "Bırakabilirsiniz"
              : "Dosyanızı buraya sürükleyin"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          ya da{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isBusy}
            className="font-medium text-brand-700 underline-offset-4 transition-colors hover:text-brand-800 hover:underline focus:outline-none disabled:opacity-50"
          >
            bilgisayarınızdan seçin
          </button>
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
          {[".xlsx", ".csv"].map((extension) => (
            <span
              key={extension}
              className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            >
              {extension}
            </span>
          ))}
        </div>
      </div>

      {/* Hata */}
      {error && (
        <div className="optiflow-enter mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <FileWarning className="mt-0.5 h-4.5 w-4.5 shrink-0 text-red-700" />
          <div>
            <p className="text-sm font-medium text-red-800">{error.message}</p>
            {error.hint && (
              <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                {error.hint}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Yüklenen dosya kartı */}
      {parsed && !isBusy && (
        <div className="optiflow-enter optiflow-glass mt-4 rounded-xl border border-emerald-200 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {parsed.fileName}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                <span>{formatFileSize(parsed.fileSize)}</span>
                <span className="inline-flex items-center gap-1">
                  <Table2 className="h-3 w-3" />
                  {parsed.sheets.length} sayfa
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onContinue}
            className="mt-4 w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none"
          >
            Devam
          </button>
        </div>
      )}
    </div>
  );
}
