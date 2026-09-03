/**
 * Kayıtlı fabrikaların listesi — açma, yeniden adlandırma, silme.
 *
 * Sihirbazın önüne konur ve yalnızca kayıtlı fabrika varsa görünür. İlk kez
 * gelen kullanıcı doğrudan sihirbazı görür; kurulum akışının önüne boş bir liste
 * ekranı koymak, ürünü ilk kez deneyen birine önce anlamsız bir engel
 * göstermek olurdu.
 *
 * Liste bilinçli olarak sadedir: ad, sektör, sürüm sayısı ve son güncelleme.
 * Sürüm geçmişini burada göstermek, kullanıcının çoğu zaman ilgilenmediği bir
 * ayrıntıyı ana akışa taşırdı.
 */

import { useState } from "react";
import type { Factory } from "../../types/simulationTypes";
import { FolderIcon, PlusIcon, TrashIcon } from "../shared/icons";

interface FactoryPickerProps {
  factories: Factory[];
  /** Yükleniyor durumu; liste henüz gelmemiş olabilir. */
  isLoading: boolean;
  errors: string[];
  onOpen: (factoryId: string) => void;
  onDelete: (factoryId: string) => void;
  onCreateNew: () => void;
}

export function FactoryPicker({
  factories,
  isLoading,
  errors,
  onOpen,
  onDelete,
  onCreateNew,
}: FactoryPickerProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Fabrikalarınız</h1>
        <p className="mt-1 text-sm text-slate-600">
          Kaydedilmiş bir modeli açın ya da yeni bir hat kurun.
        </p>
      </header>

      {errors.length > 0 && (
        <ul className="mb-6 list-inside list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
          Yükleniyor…
        </p>
      ) : (
        <ul className="space-y-2">
          {factories.map((factory) => (
            <li
              key={factory.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-brand-300"
            >
              <FolderIcon className="h-5 w-5 shrink-0 text-slate-400" />
              <button
                type="button"
                onClick={() => onOpen(factory.id)}
                className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <span className="block truncate font-medium text-slate-900">
                  {factory.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {describe(factory)}
                </span>
              </button>

              {confirmingId === factory.id ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600">Silinsin mi?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingId(null);
                      onDelete(factory.id);
                    }}
                    className="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                  >
                    Sil
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="rounded-md px-2.5 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    Vazgeç
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`${factory.name} fabrikasını sil`}
                  onClick={() => setConfirmingId(factory.id)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onCreateNew}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <PlusIcon className="h-4 w-4" />
        Yeni fabrika kur
      </button>
    </div>
  );
}

/** Satır altındaki açıklama: sektör, sürüm sayısı ve son güncelleme. */
function describe(factory: Factory): string {
  const parts: string[] = [];
  if (factory.sector) {
    parts.push(factory.sector);
  }
  parts.push(
    factory.version_count === 0
      ? "henüz model kaydedilmedi"
      : `${factory.version_count} sürüm`,
  );
  const updated = formatDate(factory.updated_at);
  if (updated) {
    parts.push(updated);
  }
  return parts.join(" · ");
}

/**
 * Zaman damgasını okunabilir bir tarihe çevirir.
 *
 * Geçersiz bir değerde boş metin döner: liste satırının "Invalid Date" yazması,
 * hiçbir şey yazmamasından kötüdür.
 */
function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
