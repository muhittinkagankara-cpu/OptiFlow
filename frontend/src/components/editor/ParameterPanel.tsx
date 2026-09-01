/**
 * Sağ panel — seçili node'un ayarları.
 *
 * Panelin düzeni, kullanıcının ne sıklıkla ihtiyaç duyduğuna göre sıralanmıştır:
 * en üstte her modelde değişen alanlar (ad, makine sayısı, işlem süresi), altta
 * ise çoğu kullanıcının hiç dokunmayacağı arıza ve tampon ayarları katlanmış
 * hâlde durur. Her şeyi aynı anda göstermek, teknik olmayan kullanıcıyı
 * "burayı da doldurmalı mıyım?" ikilemine sokardı.
 */

import type { Distribution, Station } from "../../types/simulationTypes";
import { INFINITE_CAPACITY } from "../../types/simulationTypes";
import type { ArrivalNodeData, FlowNode, StationNodeData } from "../../lib/configBuilder";
import { isArrivalNode, isStationNode } from "../../lib/configBuilder";
import { meanServiceTime, stationCapacityPerMinute } from "../../lib/configDefaults";
import { DistributionEditor } from "../shared/DistributionEditor";
import {
  Collapsible,
  Field,
  NumberField,
  Section,
  TextField,
} from "../shared/FormControls";
import { StationIcon, TrashIcon } from "../shared/icons";

interface ParameterPanelProps {
  selectedNode: FlowNode | null;
  /** Modelde hâlihazırda geçen hat adları; otomatik tamamlamayı besler. */
  lineNames: string[];
  onUpdateStation: (nodeId: string, station: Station) => void;
  onUpdateArrival: (distribution: Distribution) => void;
  onDeleteStation: (nodeId: string) => void;
}

export function ParameterPanel({
  selectedNode,
  lineNames,
  onUpdateStation,
  onUpdateArrival,
  onDeleteStation,
}: ParameterPanelProps) {
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-slate-200 bg-white">
      {selectedNode === null && <EmptyState />}

      {selectedNode !== null && isArrivalNode(selectedNode) && (
        <ArrivalSettings
          data={selectedNode.data as ArrivalNodeData}
          onChange={onUpdateArrival}
        />
      )}

      {selectedNode !== null && isStationNode(selectedNode) && (
        <StationSettings
          nodeId={selectedNode.id}
          data={selectedNode.data as StationNodeData}
          lineNames={lineNames}
          onChange={(station) => onUpdateStation(selectedNode.id, station)}
          onDelete={() => onDeleteStation(selectedNode.id)}
        />
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <StationIcon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-medium text-slate-700">Bir kutu seçin</p>
      <p className="mt-1 text-xs text-slate-500">
        Soldaki şemadan bir istasyona tıklayın; ayarları burada açılır.
      </p>
    </div>
  );
}

function ArrivalSettings({
  data,
  onChange,
}: {
  data: ArrivalNodeData;
  onChange: (distribution: Distribution) => void;
}) {
  const mean = Number(data.distribution.params.mean ?? 5);

  return (
    <div className="space-y-6 p-5">
      <header>
        <h2 className="text-base font-semibold text-slate-900">İş Girişi</h2>
        <p className="mt-1 text-xs text-slate-500">
          Parçaların hatta ne sıklıkla girdiğini belirler.
        </p>
      </header>

      <Field
        label="Ortalama giriş aralığı"
        help="İki parçanın hatta girişi arasında geçen ortalama süre. Gerçek aralıklar bu ortalama etrafında rastgele değişir; bu, gerçek siparişlerin düzensiz gelişini yansıtır."
        hint={
          mean > 0 ? `Saatte yaklaşık ${(60 / mean).toFixed(0)} parça girer.` : undefined
        }
      >
        {(id) => (
          <NumberField
            id={id}
            value={mean}
            onChange={(value) =>
              onChange({ type: "exponential", params: { mean: Math.max(value, 0.1) } })
            }
            min={0.1}
            step={0.1}
            suffix="dk"
          />
        )}
      </Field>
    </div>
  );
}

function StationSettings({
  nodeId,
  data,
  lineNames,
  onChange,
  onDelete,
}: {
  nodeId: string;
  data: StationNodeData;
  lineNames: string[];
  onChange: (station: Station) => void;
  onDelete: () => void;
}) {
  const station = data.station;
  const update = (changes: Partial<Station>) => onChange({ ...station, ...changes });

  const hasFailureModel = station.failure_rate != null;
  const mtbf = hasFailureModel ? 1 / (station.failure_rate as number) : 200;
  const mttr = Number(station.repair_time_distribution?.params.mean ?? 15);
  const bufferUnlimited = station.buffer_capacity_before === INFINITE_CAPACITY;
  const capacityPerHour = stationCapacityPerMinute(station) * 60;

  const setFailureModel = (enabled: boolean) => {
    if (enabled) {
      update({
        failure_rate: 1 / mtbf,
        repair_time_distribution: { type: "exponential", params: { mean: mttr } },
      });
    } else {
      // Backend "ya ikisi de ya hiçbiri" kuralı uygular; ikisini birlikte sileriz.
      const next = { ...station };
      delete next.failure_rate;
      delete next.repair_time_distribution;
      onChange(next);
    }
  };

  return (
    <div className="space-y-6 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">
            {station.name || "Adsız istasyon"}
          </h2>
          {Number.isFinite(capacityPerHour) && capacityPerHour > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Saatte yaklaşık {capacityPerHour.toFixed(0)} parça kapasitesi
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Bu istasyonu sil"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </header>

      <Section title="Temel bilgiler">
        <Field label="İstasyon adı">
          {(id) => (
            <TextField
              id={id}
              value={station.name}
              onChange={(name) => update({ name })}
              placeholder="Örn. Kesim"
            />
          )}
        </Field>

        <Field
          label="Hat / Bölüm"
          help="Bu istasyon hangi hatta ya da bölüme ait? Aynı adı verdiğiniz istasyonlar birlikte gruplanır."
          hint="İsteğe bağlı. Boş bırakırsanız gruplama gösterilmez."
        >
          {(id) => (
            <TextField
              id={id}
              value={station.line_name ?? ""}
              onChange={(line_name) => update({ line_name })}
              placeholder="Örn. Kesim Hattı"
              suggestions={lineNames}
            />
          )}
        </Field>

        <Field
          label="Makine / operatör sayısı"
          help="Bu istasyonda aynı anda kaç parça işlenebilir? 5 dikiş makinesi varsa 5 yazın."
        >
          {(id) => (
            <NumberField
              id={id}
              value={station.num_servers}
              onChange={(value) => update({ num_servers: Math.max(1, Math.round(value)) })}
              min={1}
              step={1}
            />
          )}
        </Field>
      </Section>

      <Section title="İşlem süresi">
        <DistributionEditor
          value={station.service_time_distribution}
          onChange={(service_time_distribution) => update({ service_time_distribution })}
          label="Süre nasıl değişiyor?"
        />
      </Section>

      <Section
        title="Kalite"
        description="İşlemi biten parçaların ne kadarı hurdaya ayrılıyor?"
      >
        <Field
          label={`Fire oranı: %${Math.round(station.scrap_rate * 100)}`}
          help="Bu istasyonda işlenen ama kusurlu çıkan parçaların oranı. Hurda parça makineyi tam süre meşgul eder, sonra hattan çıkarılır — kapasiteyi boşa harcadığı için OEE'nin kalite bileşenini düşürür."
        >
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={50}
              step={1}
              value={Math.round(station.scrap_rate * 100)}
              onChange={(event) =>
                update({ scrap_rate: Number(event.target.value) / 100 })
              }
              className="w-full accent-brand-600"
            />
          )}
        </Field>
      </Section>

      <Collapsible title="Gelişmiş ayarlar">
        <Section
          title="Arızalar"
          description="Makine bozulmaları modele dahil edilsin mi?"
        >
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hasFailureModel}
              onChange={(event) => setFailureModel(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            Bu makine zaman zaman arızalanıyor
          </label>

          {hasFailureModel && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <Field
                label="Arızalar arası süre"
                help="Ortalama olarak kaç dakika çalıştıktan sonra bir arıza oluyor? (MTBF)"
              >
                {(id) => (
                  <NumberField
                    id={id}
                    value={mtbf}
                    onChange={(value) =>
                      update({ failure_rate: 1 / Math.max(value, 1) })
                    }
                    min={1}
                    step={10}
                    suffix="dk"
                  />
                )}
              </Field>
              <Field
                label="Onarım süresi"
                help="Bir arıza ortalama kaç dakikada giderilir? (MTTR)"
              >
                {(id) => (
                  <NumberField
                    id={id}
                    value={mttr}
                    onChange={(value) =>
                      update({
                        repair_time_distribution: {
                          type: "exponential",
                          params: { mean: Math.max(value, 0.1) },
                        },
                      })
                    }
                    min={0.1}
                    step={1}
                    suffix="dk"
                  />
                )}
              </Field>
              <p className="col-span-full rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                Bu ayarlarla makine zamanın yaklaşık{" "}
                <strong className="font-semibold text-slate-800">
                  %{((mtbf / (mtbf + mttr)) * 100).toFixed(1)}
                </strong>{" "}
                kadarı çalışır durumda olur.
              </p>
            </div>
          )}
        </Section>

        <Section
          title="Bekleme alanı"
          description="Bu istasyonun önünde en fazla kaç parça bekleyebilir?"
        >
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={bufferUnlimited}
              onChange={(event) =>
                update({
                  buffer_capacity_before: event.target.checked ? INFINITE_CAPACITY : 10,
                })
              }
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            Sınırsız (yer kısıtı yok)
          </label>

          {!bufferUnlimited && (
            <Field
              label="Kapasite"
              help="Bekleme alanı dolduğunda bir önceki istasyon parçayı bırakamaz ve durmak zorunda kalır. Gerçek fabrikalardaki yer kısıtını modellemek için kullanılır."
            >
              {(id) => (
                <NumberField
                  id={id}
                  value={station.buffer_capacity_before}
                  onChange={(value) =>
                    update({ buffer_capacity_before: Math.max(0, Math.round(value)) })
                  }
                  min={0}
                  step={1}
                  suffix="parça"
                />
              )}
            </Field>
          )}
        </Section>

        <p className="text-[11px] text-slate-400">Sistem kimliği: {nodeId}</p>
      </Collapsible>

      {meanServiceTime(station) <= 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          İşlem süresi sıfır görünüyor. Simülasyonu çalıştırmadan önce geçerli bir
          süre girin.
        </p>
      )}
    </div>
  );
}
