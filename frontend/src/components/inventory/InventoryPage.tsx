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
import { PlusIcon, TrashIcon, WarningIcon } from "../shared/icons";
import { InventoryItemDetail } from "./InventoryItemDetail";
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <Th>Kalem</Th>
                  <Th>Mevcut stok</Th>
                  <Th>Sipariş noktası</Th>
                  <Th>Yeter</Th>
                  <Th>Durum</Th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ item, analysis }) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    analysis={analysis}
                    onOpen={() => {
                      setSelected(item);
                      setView("detail");
                    }}
                    onDelete={() => void handleDelete(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
            Ayrıntılı analiz ve tükenme riski için bir satıra tıklayın.
          </p>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  analysis,
  onOpen,
  onDelete,
}: {
  item: InventoryItem;
  analysis: InventoryAnalysis | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const tone = analysis ? statusTone(analysis.status) : "neutral";

  return (
    <tr onClick={onOpen} className="cursor-pointer transition-colors hover:bg-slate-50">
      <Td>
        <span className="font-medium text-slate-900">{item.name}</span>
        {item.linked_station_id && (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            üretime bağlı
          </span>
        )}
      </Td>
      <Td>
        <span className="tabular-nums text-slate-800">
          {formatQuantity(item.current_stock, item.unit)}
        </span>
      </Td>
      <Td>
        <span className="tabular-nums text-slate-700">
          {analysis?.is_applicable
            ? formatQuantity(analysis.reorder_point, item.unit)
            : "—"}
        </span>
      </Td>
      <Td>
        <span className="tabular-nums text-slate-700">
          {analysis ? formatDays(analysis.days_of_stock) : "—"}
        </span>
      </Td>
      <Td>
        {analysis?.is_applicable ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_BADGE[tone]}`}
          >
            {/* Renk tek başına bilgi taşımaz: noktanın yanında her zaman yazı
                bulunur, aksi hâlde renk körü kullanıcı için tablo okunamaz. */}
            <span className={`inline-block h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
            {statusLabel(analysis.status)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">tüketim girilmemiş</span>
        )}
      </Td>
      <Td>
        <button
          type="button"
          aria-label={`${item.name} kalemini sil`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </Td>
    </tr>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}
