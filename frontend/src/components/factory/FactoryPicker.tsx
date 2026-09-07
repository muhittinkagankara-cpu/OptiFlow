/**
 * Fabrikalar ekranı — kayıtlı modellerin kart ızgarası.
 *
 * Liste yerine kart kullanılmasının sebebi yalnızca görsel değil: bir fabrika
 * satırı, adının yanında sektörünü, sürüm sayısını ve son güncellenme tarihini
 * taşımak zorunda. Tek satırda bunlar ya sıkışır ya da dar ekranda kırpılır;
 * kartta hepsi kendi hiyerarşisiyle durur.
 *
 * "Yeni fabrika" kartı ızgaranın **başında** durur: yeni kullanıcı için en
 * önemli eylem odur ve listenin sonuna konsaydı, on modeli olan bir hesapta
 * kaydırma gerektirirdi.
 *
 * Gösterilmeyen alanlar hakkında
 * ------------------------------
 * Liste ucu (`GET /api/factories`) bilinçli olarak modeli taşımaz — on
 * fabrikalı bir hesapta her satır için tam `SimulationConfig` göndermek liste
 * ekranını gereksiz ağırlaştırırdı. Bu yüzden OEE ve darboğaz gibi yalnızca
 * koşumdan bilinen değerler, **açık olan** fabrika için gösterilir; diğerleri
 * için uydurulmaz.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Clock,
  FileSpreadsheet,
  FolderOpen,
  History,
  Layers,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { Factory, FactoryVersionSummary } from "../../types/simulationTypes";
import { ApiError, listFactoryVersions } from "../../lib/apiClient";
import { GENERIC_ERROR_MESSAGE } from "../../lib/errorMessages";
import { Badge, Button, Card, EmptyState, Spinner } from "../ui/Primitives";

interface FactoryPickerProps {
  factories: Factory[];
  isLoading: boolean;
  errors: string[];
  onOpen: (factoryId: string) => void;
  onDelete: (factoryId: string) => void;
  onCreateNew: () => void;
  /** Excel içe aktarma akışını açar. */
  onImportExcel: () => void;
  /** Şu an açık olan fabrika; kartında "açık" rozeti gösterilir. */
  openFactoryId?: string | null;
  /** Açık fabrikanın istasyon sayısı ve darboğazı (yalnızca o biliniyor). */
  openFactoryStats?: { stationCount: number; bottleneck: string | null } | null;
}

export function FactoryPicker({
  factories,
  isLoading,
  errors,
  onOpen,
  onDelete,
  onCreateNew,
  onImportExcel,
  openFactoryId,
  openFactoryStats,
}: FactoryPickerProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Fabrikalarınız
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Kaydedilmiş bir modeli açın ya da yeni bir hat kurun.
        </p>
      </div>

      {errors.length > 0 && (
        <ul className="mb-6 list-inside list-disc space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="optiflow-skeleton h-44 rounded-xl border border-slate-200"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NewFactoryCard onClick={onCreateNew} />
          <ImportCard onClick={onImportExcel} />

          {factories.map((factory, position) => (
            <FactoryCard
              key={factory.id}
              factory={factory}
              index={position + 1}
              isOpen={factory.id === openFactoryId}
              stats={factory.id === openFactoryId ? openFactoryStats : null}
              isConfirming={confirmingId === factory.id}
              onConfirmDelete={() => setConfirmingId(factory.id)}
              onCancelDelete={() => setConfirmingId(null)}
              onDelete={() => {
                setConfirmingId(null);
                onDelete(factory.id);
              }}
              onOpen={() => onOpen(factory.id)}
              isVersionsOpen={versionsOf === factory.id}
              onToggleVersions={() =>
                setVersionsOf((current) =>
                  current === factory.id ? null : factory.id,
                )
              }
            />
          ))}
        </div>
      )}

      {!isLoading && factories.length === 0 && (
        <div className="mt-4">
          <EmptyState
            icon={FolderOpen}
            title="Henüz kaydedilmiş bir model yok"
            description="Bir hat kurup kaydettiğinizde burada görünür ve her cihazınızdan açabilirsiniz."
            action={
              <Button variant="primary" icon={Plus} onClick={onCreateNew}>
                İlk fabrikanı kur
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Excel'den içe aktarma kartı.
 *
 * "Yeni Fabrika"nın hemen yanında durur: elinde hazır bir tablo olan kullanıcı
 * için bu, şablon seçmekten daha kısa bir yoldur ve keşfedilebilir olması
 * gerekir. Menüde ayrı bir bölüm açmak, yılda birkaç kez kullanılacak bir
 * eylemi sürekli görünür kılardı.
 */
function ImportCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="optiflow-lift optiflow-enter group flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/40 p-6 text-center transition-colors hover:border-emerald-500 hover:bg-emerald-500/6 focus:outline-none"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500 transition-colors duration-200 group-hover:border-emerald-300 group-hover:bg-emerald-500/15 group-hover:text-emerald-700">
        <FileSpreadsheet className="h-5 w-5" />
      </span>
      <span className="text-sm font-semibold text-slate-900">Excel'den içe aktar</span>
      <span className="mt-1 text-xs text-slate-500">
        Hattınızın tablosunu yükleyin, model kurulsun
      </span>
    </button>
  );
}

function NewFactoryCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="optiflow-lift optiflow-enter group flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/40 p-6 text-center transition-colors hover:border-brand-500 hover:bg-brand-600/6 focus:outline-none"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500 transition-colors duration-200 group-hover:border-brand-300 group-hover:bg-brand-600/15 group-hover:text-brand-700">
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-sm font-semibold text-slate-900">Yeni Fabrika</span>
      <span className="mt-1 text-xs text-slate-500">
        Şablondan başlayın ya da sıfırdan kurun
      </span>
    </button>
  );
}

interface FactoryCardProps {
  factory: Factory;
  index: number;
  isOpen: boolean;
  stats?: { stationCount: number; bottleneck: string | null } | null;
  isConfirming: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onOpen: () => void;
  isVersionsOpen: boolean;
  onToggleVersions: () => void;
}

function FactoryCard({
  factory,
  index,
  isOpen,
  stats,
  isConfirming,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onOpen,
  isVersionsOpen,
  onToggleVersions,
}: FactoryCardProps) {
  return (
    <Card interactive index={index} className="flex flex-col overflow-hidden">
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600/12 text-brand-700">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="flex items-center gap-1.5">
            {isOpen && <Badge tone="info">Açık</Badge>}
            {stats?.bottleneck && (
              <Badge tone="bad" icon={TriangleAlert}>
                {stats.bottleneck}
              </Badge>
            )}
          </div>
        </div>

        <h3 className="mt-3 truncate text-base font-semibold text-slate-900">
          {factory.name}
        </h3>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {factory.sector ?? "Sektör belirtilmedi"}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Stat
            icon={Layers}
            label="Sürüm"
            value={
              factory.version_count === 0 ? "—" : String(factory.version_count)
            }
          />
          <Stat
            icon={Building2}
            label="İstasyon"
            value={stats ? String(stats.stationCount) : "—"}
          />
          <Stat icon={Clock} label="Güncelleme" value={shortDate(factory.updated_at)} />
        </dl>

        {factory.version_count === 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            Henüz model kaydedilmedi — açıp kurmaya devam edebilirsiniz.
          </p>
        )}
      </div>

      {isVersionsOpen && <VersionList factoryId={factory.id} />}

      <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
        {isConfirming ? (
          <>
            <span className="mr-auto text-xs text-slate-500">Silinsin mi?</span>
            <Button size="sm" variant="danger" onClick={onDelete}>
              Sil
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelDelete}>
              Vazgeç
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" icon={FolderOpen} onClick={onOpen}>
              Aç
            </Button>
            <Button
              size="sm"
              icon={History}
              onClick={onToggleVersions}
              disabled={factory.version_count === 0}
              title={
                factory.version_count === 0
                  ? "Henüz sürüm yok"
                  : "Sürüm geçmişini göster"
              }
            >
              Versiyonlar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onConfirmDelete}
              ariaLabel={`${factory.name} fabrikasını sil`}
              className="ml-auto"
              icon={Trash2}
            >
              <span className="sr-only">Sil</span>
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-2">
      <dt className="flex items-center gap-1 text-[10px] tracking-wide text-slate-500 uppercase">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-slate-800 tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * Sürüm geçmişi.
 *
 * Yalnızca açıldığında istek atar (`GET /api/factories/{id}/versions`); liste
 * ekranı açılırken her kart için sürüm çekmek, kullanıcının çoğu zaman
 * bakmadığı bir ayrıntı için N istek demek olurdu.
 */
function VersionList({ factoryId }: { factoryId: string }) {
  const [versions, setVersions] = useState<FactoryVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setVersions(await listFactoryVersions(factoryId));
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.userMessages[0] : GENERIC_ERROR_MESSAGE,
      );
    }
  }, [factoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
        Sürüm geçmişi
      </p>

      {error && <p className="text-xs text-red-800">{error}</p>}

      {!error && versions === null && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner className="h-3 w-3" />
          Yükleniyor…
        </div>
      )}

      {versions && versions.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-100/60 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-slate-700">
                v{version.version_number}
              </span>
              <span className="text-slate-500">
                {version.station_count} istasyon
              </span>
              <span className="text-slate-500">{shortDate(version.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Kısa tarih.
 *
 * Geçersiz bir değerde "—" döner: kartta "Invalid Date" yazması, hiçbir şey
 * yazmamasından kötüdür.
 */
function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}
