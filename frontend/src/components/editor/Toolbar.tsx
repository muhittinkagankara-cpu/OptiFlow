/**
 * Editörün üst çubuğu.
 *
 * Simülasyon derinliği kullanıcıya dakika cinsinden değil, ne beklemesi
 * gerektiğini anlatan üç seçenekle sunulur: "Hızlı Test / Standart / Detaylı".
 * "10.000 dakika" ifadesi teknik olmayan bir kullanıcı için hiçbir şey ifade
 * etmez; "birkaç saniye sürer, modeli denemek için yeterli" ise doğrudan karar
 * verdirir.
 *
 * Düğmelerin gruplanması
 * ----------------------
 * Çubuk üç bölgeye ayrılır: solda bağlam (geri, model adı), ortada **model
 * üzerinde çalışan** araçlar (ekle, geri al, yeniden yap, içe aktar), sağda
 * **modeli ileri taşıyan** eylemler (kaydet, çalıştır). Hepsi tek sırada
 * dizilseydi, "kaydet" ile "istasyon ekle" aynı görsel ağırlıkta durur ve
 * kullanıcı hangisinin ana eylem olduğunu ayırt edemezdi.
 *
 * Yer tutucu düğmeler (Excel İçe Aktar, AI ile Oluştur) devre dışıdır ve
 * nedenini `title` ile söyler. Tıklanınca hiçbir şey yapmayan etkin bir düğme,
 * bozuk bir düğmeden ayırt edilemez.
 */

import {
  ArrowLeft,
  ArrowRight,
  FileSpreadsheet,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import { SIMULATION_DEPTH_OPTIONS } from "../../types/simulationTypes";
import type { SimulationDepth } from "../../types/simulationTypes";
import { Spinner } from "../ui/Primitives";

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

  /* -- Geçmiş ------------------------------------------------------------- */
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /**
   * Excel içe aktarma akışını açar.
   *
   * Verilmezse düğme devre dışı kalır ve nedenini söyler; sihirbazın içindeki
   * editörde bu akışa girmek modeli yarıda bırakmak olurdu.
   */
  onImportExcel?: () => void;
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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onImportExcel,
}: ToolbarProps) {
  const isContinue = variant === "continue";
  const selected =
    SIMULATION_DEPTH_OPTIONS.find((option) => option.id === depth) ??
    SIMULATION_DEPTH_OPTIONS[1];

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 backdrop-blur-xl sm:px-4">
      {/* -- Bağlam -- */}
      <IconButton
        icon={ArrowLeft}
        label="Geri"
        onClick={onBack}
        disabled={isRunning}
        showLabel
      />

      <div className="hidden h-6 w-px bg-slate-200 sm:block" />

      <div className="min-w-0 max-w-[14rem]">
        <h1 className="truncate text-sm font-semibold text-slate-900">
          {factoryName ?? "Süreç Şeması"}
        </h1>
        <p className="truncate text-[11px] text-slate-500">
          {stationCount} istasyon
          {/* Kaydedilmemiş değişiklik yazıyla da belirtilir. Yalnızca düğmenin
              rengiyle anlatılsaydı, renk körü bir kullanıcı için görünmez
              olurdu. */}
          {onSave &&
            (isDirty ? " · kaydedilmemiş değişiklikler var" : " · kaydedildi")}
        </p>
      </div>

      {/* -- Model araçları -- */}
      <div className="ml-2 hidden items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 md:flex">
        <IconButton
          icon={Plus}
          label="İstasyon Ekle"
          onClick={onAddStation}
          disabled={isRunning}
          showLabel
        />
        <div className="h-5 w-px bg-slate-200" />
        <IconButton
          icon={Undo2}
          label="Geri Al"
          onClick={onUndo}
          disabled={isRunning || !canUndo}
        />
        <IconButton
          icon={Redo2}
          label="Yeniden Yap"
          onClick={onRedo}
          disabled={isRunning || !canRedo}
        />
        <div className="h-5 w-px bg-slate-200" />
        <IconButton
          icon={FileSpreadsheet}
          label="Excel İçe Aktar"
          onClick={onImportExcel}
          disabled={isRunning || !onImportExcel}
          title={
            onImportExcel
              ? "Excel dosyasından yeni bir fabrika oluştur"
              : "Excel içe aktarma yalnızca kayıtlı bir modeldeyken açılabilir"
          }
        />
        <IconButton
          icon={Sparkles}
          label="AI ile Oluştur"
          disabled
          title="AI ile model oluşturma bu sürümde henüz hazır değil"
        />
      </div>

      {/* -- İleri taşıyan eylemler -- */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Dar ekranda istasyon ekleme araç kutusundan çıkar ama kaybolmaz. */}
        <span className="md:hidden">
          <IconButton
            icon={Plus}
            label="İstasyon Ekle"
            onClick={onAddStation}
            disabled={isRunning}
          />
        </span>

        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isRunning || isSaving || !isDirty}
            title={isDirty ? undefined : "Kaydedilecek bir değişiklik yok"}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none disabled:opacity-40 ${
              isDirty
                ? "border-brand-300 bg-brand-600/12 text-brand-700 hover:bg-brand-600/20"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {isSaving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {isSaving ? "Kaydediliyor…" : "Kaydet"}
            </span>
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
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors focus:border-brand-500 focus:outline-none disabled:opacity-40"
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
          className="inline-flex items-center gap-2 self-start rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {isRunning ? (
            <>
              <Spinner className="h-4 w-4" />
              Çalışıyor…
            </>
          ) : isContinue ? (
            <>
              İleri
              <ArrowRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              <span className="hidden sm:inline">Simülasyonu Çalıştır</span>
              <span className="sm:hidden">Çalıştır</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}

/**
 * Araç çubuğu düğmesi.
 *
 * Etiket varsayılan olarak yalnızca ekran okuyucuya verilir (`aria-label`) ve
 * ipucu olarak görünür; `showLabel` ile yazı da gösterilir. Simge-yalnız
 * düğmelerin erişilebilir bir adı olmadan bırakılması, ekran okuyucu
 * kullanıcısı için işlevi tümüyle görünmez kılardı.
 */
function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  showLabel,
  title,
}: {
  icon: typeof Plus;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {showLabel && <span className="hidden lg:inline">{label}</span>}
    </button>
  );
}
