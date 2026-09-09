/**
 * Düğüm Eşleme Stüdyosu — kaynaktaki adresin OptiFlow alanına bağlanması.
 *
 * Sol sütun sahadan okunabilen düğümleri (PLC etiketi, MQTT konusu, REST alanı)
 * listeler; sağ sütun istasyonların beslenmesi gereken alanlarını. Bir düğüm
 * bir alana sürüklendiğinde eşleme kurulur.
 *
 * Sürükle-bırak kütüphanesiz yazılmıştır (HTML5 DnD): tek bir ekran için
 * kütüphane eklemek, paketin boyutunu kalıcı olarak büyütürdü. Sürüklemenin
 * çalışmadığı durumlar için her alanda bir seçim listesi de vardır —
 * dokunmatik ekranda ve klavyeyle erişilebilirlik bunu zorunlu kılar.
 *
 * Karar mantığının tamamı `lib/connectors/mapping.ts` içindedir; bu dosya
 * yalnızca çizer ve olayı yukarı iletir.
 */

import { useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import {
  FIELD_LABEL,
  FIELD_ORDER,
  FIELD_UNIT,
  compatibleSources,
  isTypeCompatible,
  mappingCoverage,
  mappingFor,
  sampleLabel,
  sourcesByConnector,
  stationCoverage,
  type ConnectorConfig,
  type FieldMapping,
  type OptiFlowField,
  type SourceNode,
  type ValidationIssue,
} from "../../lib/connectors";
import { Card } from "../ui/Primitives";
import {
  KIND_ICON,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  TONE_CLASS,
} from "./connectorStyles";

interface NodeMappingStudioProps {
  configs: ConnectorConfig[];
  sources: SourceNode[];
  mappings: FieldMapping[];
  stations: { id: string; name: string }[];
  issues: ValidationIssue[];
  onAssign: (sourceId: string, stationId: string, field: OptiFlowField) => void;
  onRemove: (mappingId: string) => void;
}

export function NodeMappingStudio({
  configs,
  sources,
  mappings,
  stations,
  issues,
  onAssign,
  onRemove,
}: NodeMappingStudioProps) {
  /*
   * Sürüklenen düğüm React durumunda tutulur. `dataTransfer` yükü tarayıcılar
   * arasında güvenilmez: Firefox'ta `dragover` sırasında okunamaz, dolayısıyla
   * hedefin uyumlu olup olmadığı sürükleme sırasında anlaşılamazdı.
   */
  const [dragging, setDragging] = useState<SourceNode | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const groups = useMemo(() => sourcesByConnector(sources), [sources]);
  const configById = useMemo(
    () => new Map(configs.map((config) => [config.id, config])),
    [configs],
  );
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );

  const coverage = mappingCoverage(mappings, stations.map((item) => item.id));

  return (
    <div className="space-y-4">
      <Card className="optiflow-glass p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Düğüm Eşleme Stüdyosu
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Soldaki düğümü sağdaki alana sürükleyin. Uyumsuz tipler hedefte
              soluk görünür ve bırakılamaz.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {coverage === null
                ? "—"
                : `%${Math.round(coverage * 100)}`}
            </p>
            <p className="text-[11px] text-slate-500">alan kapsaması</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Sol: kaynak düğümler --- */}
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Kaynak düğümler
          </h4>

          {groups.length === 0 ? (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              Henüz düğüm yok. Bir bağlantı ekleyip test ettiğinizde okunabilen
              adresler burada listelenir.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map((group) => {
                const config = configById.get(group.connectorId);
                const Icon = config ? KIND_ICON[config.kind] : Link2;
                return (
                  <div key={group.connectorId}>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                      <Icon className="h-3.5 w-3.5 text-slate-400" />
                      {config?.name ?? group.connectorId}
                    </p>

                    <ul className="mt-1.5 space-y-1.5">
                      {group.sources.map((source) => {
                        const used = mappings.some(
                          (item) => item.sourceId === source.id,
                        );
                        return (
                          <li
                            key={source.id}
                            draggable
                            onDragStart={() => setDragging(source)}
                            onDragEnd={() => {
                              setDragging(null);
                              setHovered(null);
                            }}
                            className={`optiflow-lift cursor-grab rounded-xl border p-2.5 transition-colors duration-200 active:cursor-grabbing ${
                              dragging?.id === source.id
                                ? "border-brand-400 bg-brand-50"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium text-slate-900">
                                {source.label}
                              </span>
                              <span
                                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                                  used
                                    ? TONE_CLASS.good.chip
                                    : TONE_CLASS.neutral.chip
                                }`}
                              >
                                {used ? "Bağlı" : "Boşta"}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                              {source.address}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {source.dataType} · örnek: {sampleLabel(source)}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* --- Sağ: OptiFlow alanları --- */}
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            OptiFlow alanları
          </h4>

          {stations.length === 0 ? (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              Açık bir model yok; eşlenecek istasyon bulunamadı.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {stations.map((station) => (
                <div key={station.id}>
                  <p className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                    {station.name}
                    <span className="text-slate-400">
                      {stationCoverage(mappings, station.id)}/{FIELD_ORDER.length}
                    </span>
                  </p>

                  <ul className="mt-1.5 space-y-1.5">
                    {FIELD_ORDER.map((field) => {
                      const mapping = mappingFor(mappings, station.id, field);
                      const source =
                        mapping === null
                          ? null
                          : (sourceById.get(mapping.sourceId) ?? null);
                      const key = `${station.id}:${field}`;
                      const canDrop =
                        dragging !== null &&
                        isTypeCompatible(dragging.dataType, field);
                      const isHovered = hovered === key && canDrop;

                      return (
                        <li
                          key={field}
                          onDragOver={(event) => {
                            if (canDrop) {
                              event.preventDefault();
                              setHovered(key);
                            }
                          }}
                          onDragLeave={() => setHovered(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setHovered(null);
                            if (dragging !== null && canDrop) {
                              onAssign(dragging.id, station.id, field);
                            }
                            setDragging(null);
                          }}
                          className={`rounded-xl border p-2.5 transition-colors duration-200 ${
                            isHovered
                              ? "border-brand-400 bg-brand-50"
                              : dragging !== null && !canDrop
                                ? "border-slate-200 bg-white opacity-40"
                                : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-900">
                              {FIELD_LABEL[field]}
                              <span className="ml-1 text-[10px] font-normal text-slate-500">
                                ({FIELD_UNIT[field]})
                              </span>
                            </span>

                            {mapping !== null && (
                              <button
                                type="button"
                                onClick={() => onRemove(mapping.id)}
                                title="Eşlemeyi kaldır"
                                className="rounded-md p-1 text-slate-400 transition-colors duration-200 hover:text-red-600"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          {source !== null ? (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-brand-700">
                              {source.address}
                            </p>
                          ) : (
                            <select
                              value=""
                              onChange={(event) => {
                                if (event.target.value !== "") {
                                  onAssign(event.target.value, station.id, field);
                                }
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none transition-colors duration-200 focus:border-brand-400"
                            >
                              <option value="">Bağlı değil — düğüm seçin</option>
                              {compatibleSources(sources, field).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {issues.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Doğrulama
          </h4>
          <ul className="mt-2 space-y-1.5">
            {issues.slice(0, 12).map((issue) => {
              const tone = TONE_CLASS[SEVERITY_TONE[issue.severity]];
              return (
                <li
                  key={issue.id}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${tone.chip}`}
                >
                  <span className="font-semibold">
                    {SEVERITY_LABEL[issue.severity]}:
                  </span>{" "}
                  {issue.text}
                </li>
              );
            })}
          </ul>
          {issues.length > 12 && (
            <p className="mt-2 text-[11px] text-slate-500">
              {issues.length - 12} bulgu daha var; önce yukarıdakileri giderin.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
