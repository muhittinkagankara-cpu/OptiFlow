/**
 * Editörün üst çubuğu.
 *
 * Simülasyon derinliği kullanıcıya dakika cinsinden değil, ne beklemesi
 * gerektiğini anlatan üç seçenekle sunulur: "Hızlı Test / Standart / Detaylı".
 * "10.000 dakika" ifadesi teknik olmayan bir kullanıcı için hiçbir şey ifade
 * etmez; "birkaç saniye sürer, modeli denemek için yeterli" ise doğrudan karar
 * verdirir.
 */

import { SIMULATION_DEPTH_OPTIONS } from "../../types/simulationTypes";
import type { SimulationDepth } from "../../types/simulationTypes";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
} from "../shared/icons";
import { Spinner } from "../wizard/WizardStep3_Confirmation";

interface ToolbarProps {
  depth: SimulationDepth;
  onDepthChange: (depth: SimulationDepth) => void;
  onAddStation: () => void;
  onRun: () => void;
  onBack: () => void;
  isRunning: boolean;
  stationCount: number;
  /**
   * Ana düğmenin ne yaptığı.
   *
   * Editör iki yerden açılır. Sonuç ekranından gelindiğinde kullanıcı modeli
   * düzeltip hemen tekrar çalıştırmak ister ("run"). Kurulum sihirbazının
   * içindeyken ise sıradaki adım onay ekranıdır ("continue") — orada özet ve
   * kapasite ön kontrolü gösterilir, çalıştırma oradan yapılır. Aynı yerde iki
   * ayrı ana eylem sunmak, kullanıcıyı hangisine basacağı konusunda tereddütte
   * bırakırdı.
   */
  variant?: "run" | "continue";

  /**
   * Fabrikanın adı. Verilirse başlık yerine yazılır.
   *
   * Kullanıcı birden çok fabrika kaydedebildiğinden, hangisinin açık olduğunu
   * ekranda görmek gerekir; "Süreç Şeması" başlığı üç fabrikası olan biri için
   * hiçbir şey söylemez.
   */
  factoryName?: string | null;
  /** Verilirse kaydetme düğmesi görünür. */
  onSave?: () => void;
  isSaving?: boolean;
  /** Canvas, en son kaydedilenden farklı mı? */
  isDirty?: boolean;
}

export function Toolbar({
  depth,
  onDepthChange,
  onAddStation,
  onRun,
  onBack,
  isRunning,
  stationCount,
  variant = "run",
  factoryName,
  onSave,
  isSaving = false,
  isDirty = false,
}: ToolbarProps) {
  const isContinue = variant === "continue";
  const selected =
    SIMULATION_DEPTH_OPTIONS.find((option) => option.id === depth) ??
    SIMULATION_DEPTH_OPTIONS[1];

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        disabled={isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Geri</span>
      </button>

      <div className="hidden h-6 w-px bg-slate-200 sm:block" />

      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-slate-900">
          {factoryName ?? "Süreç Şeması"}
        </h1>
        <p className="text-xs text-slate-500">
          {stationCount} istasyon
          {/* Kaydedilmemiş değişiklik yazıyla da belirtilir. Yalnızca düğmenin
              rengiyle anlatılsaydı, renk körü bir kullanıcı için görünmez
              olurdu. */}
          {onSave &&
            (isDirty ? " · kaydedilmemiş değişiklikler var" : " · kaydedildi")}
        </p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddStation}
          disabled={isRunning}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40"
        >
          <PlusIcon className="h-4 w-4" />
          İstasyon Ekle
        </button>

        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isRunning || isSaving || !isDirty}
            title={isDirty ? undefined : "Kaydedilecek bir değişiklik yok"}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 ${
              isDirty
                ? "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            <SaveIcon className="h-4 w-4" />
            {isSaving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        )}

        <div className="flex flex-col">
          <label className="sr-only" htmlFor="simulation-depth">
            Simülasyon ayrıntı düzeyi
          </label>
          <select
            id="simulation-depth"
            value={depth}
            disabled={isRunning}
            onChange={(event) => onDepthChange(event.target.value as SimulationDepth)}
            className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none disabled:opacity-40"
          >
            {SIMULATION_DEPTH_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {/* Seçimin ne anlama geldiği görünür metin olarak yazılır. Bunu
              yalnızca `title` ipucuna bırakmak, dokunmatik ve klavye
              kullanıcıları için erişilemez olurdu. */}
          <span className="mt-0.5 hidden text-[11px] text-slate-500 xl:block">
            {selected.description}
          </span>
        </div>

        <button
          type="button"
          onClick={onRun}
          disabled={isRunning || stationCount === 0}
          // `title` yalnızca düğme devre dışıyken, nedenini açıklamak için
          // verilir. Etkinken verilseydi düğmenin erişilebilir adını bastırır
          // ve ekran okuyucu "Simülasyonu Çalıştır" yerine ipucu metnini
          // okurdu.
          title={stationCount === 0 ? "Önce en az bir istasyon ekleyin" : undefined}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
        >
          {isRunning ? (
            <>
              <Spinner />
              Çalışıyor…
            </>
          ) : isContinue ? (
            <>
              İleri
              <ArrowRightIcon className="h-4 w-4" />
            </>
          ) : (
            <>
              <PlayIcon className="h-4 w-4" />
              Simülasyonu Çalıştır
            </>
          )}
        </button>
      </div>
    </header>
  );
}
