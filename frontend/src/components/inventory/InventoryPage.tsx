/**
 * Envanter yönetimi — liste, ekleme/düzenleme ve kalem detayı.
 *
 * Üç görünüm tek bileşende tutulur çünkü aralarında taşınan durum (seçili
 * kalem, tazelenmesi gereken liste) küçüktür ve ayrı bir yönlendirme katmanı
 * eklemek, kazandırdığından fazlasını götürürdü.
 *
 * Listede her satırın **durumu** vardır: stok sipariş noktasının altındaysa
 * kırmızı, yaklaşıyorsa sarı, yeterliyse yeşil. Durum backend'de hesaplanır;
 * arayüz eşik tekrar etmez — iki yerde iki eşik, birinin diğerinden sessizce
 * ayrışması demektir.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  InventoryAnalysis,
  InventoryItem,
  SimulationConfig,
} from "../../types/simulationTypes";
import {
  ApiError,
  analyzeInventoryItem,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  updateInventoryItem,
} from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import {
  formatDays,
  formatQuantity,
  statusLabel,
  statusTone,
} from "../../lib/inventoryFormatting";
import type { Tone } from "../../lib/resultsFormatting";
import { PlusIcon, WarningIcon } from "../shared/icons";
import { InventoryItemDetail } from "./InventoryItemDetail";
import { ShoppingCart, Trash2 } from "lucide-react";
import { Button, Card, ProgressBar } from "../ui/Primitives";
import { InventoryItemForm } from "./InventoryItemForm";

const TONE_BADGE: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

const TONE_DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-slate-400",
};

type View = "list" | "form" | "detail";

interface InventoryPageProps {
  /** Kurulmuş model; kalemleri istasyona bağlamak için kullanılır. */
  config: SimulationConfig | null;
  /** Son koşum; üretim etkisi bundan okunur. */
  simulationId: string | null;
}

/** Liste satırı: kalem ve onun analizinden gelen durum. */
interface Row {
  item: InventoryItem;
  analysis: InventoryAnalysis | null;
}

export function InventoryPage({ config, simulationId }: InventoryPageProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const stationOptions = (config?.stations ?? []).map((station) => ({
    id: station.id,
    name: station.name,
  }));

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrors([]);
    try {
      const items = await listInventoryItems();
      // Durum her satırda gösterildiği için analiz listeyle birlikte çekilir.
      // Tek tek beklenseydi on kalemlik bir listede on ardışık tur olurdu.
      const analyses = await Promise.all(
        items.map((item) =>
          analyzeInventoryItem(item.id, 0.95).catch(() => null),
        ),
      );
      setRows(items.map((item, index) => ({ item, analysis: analyses[index] })));
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (item: InventoryItem) => {
    setIsSaving(true);
    setErrors([]);
    try {
      if (selected) {
        await updateInventoryItem(selected.id, item);
      } else {
        await createInventoryItem(item);
      }
      setSelected(null);
      setView("list");
      await load();
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    setErrors([]);
    try {
      await deleteInventoryItem(item.id);
      await load();
    } catch (error) {
      setErrors(
        error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
      );
    }
  };

  if (view === "detail" && selected) {
    return (
      <InventoryItemDetail
        item={selected}
        simulationId={simulationId}
        onBack={() => {
          setSelected(null);
          setView("list");
          void load();
        }}
        onEdit={() => setView("form")}
      />
    );
  }

  if (view === "form") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">
          {selected ? "Kalemi düzenle" : "Yeni envanter kalemi"}
        </h1>
        <p className="mb-6 text-sm text-slate-600">
          Sipariş miktarı ve zamanı bu bilgilerden hesaplanır.
        </p>
        <InventoryItemForm
          initial={selected}
          stationOptions={stationOptions}
          isSaving={isSaving}
          errors={errors}
          onSubmit={handleSave}
          onCancel={() => {
            setSelected(null);
            setView("list");
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Envanter</h1>
          <p className="mt-1 text-sm text-slate-600">
            Hangi kalemden ne kadar var, ne zaman sipariş vermeli.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setErrors([]);
            setView("form");
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <PlusIcon className="h-4 w-4" />
          Yeni Kalem Ekle
        </button>
      </header>

      {errors.length > 0 && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <ul className="list-inside list-disc space-y-1 text-sm text-red-800">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
          Yükleniyor…
        </p>
      )}

      {!isLoading && rows.length === 0 && <EmptyState />}

      {!isLoading && rows.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ item, analysis }, position) => (
              <ItemCard
                key={item.id}
                item={item}
                analysis={analysis}
                index={position}
                onOpen={() => {
                  setSelected(item);
                  setView("detail");
                }}
                onDelete={() => void handleDelete(item)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Ayrıntılı analiz ve tükenme riski için bir karta tıklayın.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Tek bir envanter kaleminin kartı.
 *
 * Tablodan karta geçilmesinin sebebi stok seviyesinin **görsel** bir büyüklük
 * olması: bir sayı ("120 adet") tek başına iyi mi kötü mü olduğunu söylemez,
 * sipariş noktasına göre konumu söyler. İlerleme çubuğu tam olarak bunu
 * gösterir ve satır düzeninde yeri yoktu.
 */
function ItemCard({
  item,
  analysis,
  index,
  onOpen,
  onDelete,
}: {
  item: InventoryItem;
  analysis: InventoryAnalysis | null;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const tone = analysis ? statusTone(analysis.status) : "neutral";

  /*
   * Çubuğun doluluğu, mevcut stoğun sipariş noktasının İKİ KATINA oranıdır.
   * Sipariş noktası ölçeğin ortasına denk gelir; böylece kullanıcı çubuğun
   * yarıdan aşağı inmesini "sipariş zamanı" diye okuyabilir. Ölçek mevcut
   * stoğun kendisine göre kurulsaydı, her kalem her zaman dolu görünür ve
   * çubuk hiçbir şey anlatmazdı.
   */
  const applicable = analysis?.is_applicable === true;
  const scale = applicable ? Math.max(analysis.reorder_point * 2, 1e-9) : 0;
  const fill = applicable ? item.current_stock / scale : 0;

  return (
    <Card interactive index={index} className="flex flex-col overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 p-5 text-left focus:outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {item.name}
            </p>
            {item.linked_station_id && (
              <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                üretime bağlı
              </span>
            )}
          </div>
          {applicable ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_BADGE[tone]}`}
            >
              {/* Renk tek başına bilgi taşımaz: noktanın yanında her zaman yazı
                  bulunur, aksi hâlde renk körü kullanıcı için kart okunamaz. */}
              <span className={`inline-block h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
              {statusLabel(analysis.status, analysis.covers_lead_time)}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-slate-400">
              tüketim girilmemiş
            </span>
          )}
        </div>

        <p className="mt-4 text-2xl font-semibold text-slate-900 tabular-nums">
          {formatQuantity(item.current_stock, item.unit)}
        </p>

        {applicable ? (
          <>
            <div className="mt-3">
              <ProgressBar value={fill} tone={tone === "neutral" ? "info" : tone} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
              <span>
                Sipariş noktası{" "}
                <span className="tabular-nums text-slate-600">
                  {formatQuantity(analysis.reorder_point, item.unit)}
                </span>
              </span>
              <span className="tabular-nums">{formatDays(analysis.days_of_stock)}</span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Günlük tüketim girilmeden sipariş noktası hesaplanamaz.
          </p>
        )}
      </button>

      <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2.5">
        <Button
          size="sm"
          variant={tone === "bad" ? "primary" : "secondary"}
          icon={ShoppingCart}
          onClick={onOpen}
          title="Sipariş miktarı ve tükenme riski ayrıntı ekranında"
        >
          Sipariş ver
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          ariaLabel={`${item.name} kalemini sil`}
          onClick={onDelete}
          className="ml-auto"
        >
          <span className="sr-only">Sil</span>
        </Button>
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">Henüz envanter kalemi yok</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Bir hammadde ya da yarı mamul ekleyin; ne zaman ve ne kadar sipariş
        vermeniz gerektiğini, stok biterse üretimin ne kadar duracağını
        hesaplayalım.
      </p>
    </div>
  );
}
