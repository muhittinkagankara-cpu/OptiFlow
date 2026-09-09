/**
 * Makine envanteri yöneticisi.
 *
 * Süzgeç, sayım, yaş ve bakım gecikmesi hesaplarının hepsi
 * `lib/onboarding-enterprise/inventory.ts` içindedir; bu ekran yalnızca çizer
 * ve değişikliği yukarı iletir.
 *
 * Eksik alanlar gizlenmez: seri numarası olmayan bir makine listede "—" ile
 * görünür ve doğrulama uyarısı verilir. Envanterin tek işi eksikleri
 * göstermektir.
 */

import { useMemo, useRef, useState } from "react";
import { Download, FileUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { ImportError, parseFile } from "../../lib/import";
import {
  EMPTY_FILTER,
  MACHINE_KINDS,
  MACHINE_KIND_LABEL,
  countsByKind,
  daysSinceMaintenance,
  emptyMachine,
  filterMachines,
  isMaintenanceDue,
  machineAge,
  machineTemplateCsv,
  overdueMaintenance,
  parseMachineRows,
  removeMachine,
  statusCounts,
  upsertMachine,
  validateMachines,
  type Machine,
  type MachineFilter,
  type MachineKind,
  type MachineStatus,
} from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { MACHINE_STATUS_STYLE, statusLabel } from "./enterpriseStyles";

const STATUS_TABS: { id: MachineStatus | "all"; label: string }[] = [
  { id: "all", label: "Hepsi" },
  { id: "active", label: "Aktif" },
  { id: "maintenance", label: "Bakımda" },
  { id: "fault", label: "Arızalı" },
];

interface MachineInventoryManagerProps {
  machines: Machine[];
  factoryId: string | null;
  onChange: (machines: Machine[]) => void;
  now?: Date;
}

export function MachineInventoryManager({
  machines,
  factoryId,
  onChange,
  now = new Date(),
}: MachineInventoryManagerProps) {
  const [filter, setFilter] = useState<MachineFilter>(EMPTY_FILTER);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const shown = useMemo(() => filterMachines(machines, filter), [machines, filter]);
  const counts = useMemo(() => statusCounts(machines), [machines]);
  const kindCounts = useMemo(() => countsByKind(machines), [machines]);
  const issues = useMemo(() => validateMachines(machines, now), [machines, now]);
  const overdue = useMemo(() => overdueMaintenance(machines, now), [machines, now]);

  const handleFile = async (file: File): Promise<void> => {
    setNotice(null);
    setFailure(null);
    try {
      const parsed = await parseFile(file);
      const sheet = parsed.sheets[0];
      if (!sheet) {
        setFailure("Dosyada okunabilir bir sayfa yok.");
        return;
      }
      const result = parseMachineRows(sheet.rows, factoryId, `imp-${Date.now().toString(36)}`);
      if (result.machines.length === 0) {
        setFailure(
          "Makine adı kolonu bulunamadı. İlk satırda 'Makine adı' başlığı olmalı.",
        );
        return;
      }
      onChange([...machines, ...result.machines]);
      setNotice(
        result.skipped === 0
          ? `${result.machines.length} makine içe aktarıldı.`
          : `${result.machines.length} makine alındı; adı boş ${result.skipped} satır atlandı.`,
      );
    } catch (error) {
      setFailure(
        error instanceof ImportError
          ? error.message
          : "Dosya okunamadı. CSV ya da .xlsx olduğundan emin olun.",
      );
    }
  };

  const downloadTemplate = (): void => {
    const blob = new Blob(["﻿", machineTemplateCsv()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "optiflow-makine-sablonu.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Makine Envanteri
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {counts.total} makine · {counts.active} aktif · {counts.maintenance} bakımda ·{" "}
            {counts.fault} arızalı
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={Download} onClick={downloadTemplate}>
            Şablon
          </Button>
          <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()}>
            Excel / CSV yükle
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            onClick={() =>
              setEditing(emptyMachine(`mch-${Date.now().toString(36)}`, factoryId))
            }
          >
            Makine ekle
          </Button>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,.txt,.xlsx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFile(file);
          }
          event.target.value = "";
        }}
      />

      {notice !== null && (
        <p className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
          {notice}
        </p>
      )}
      {failure !== null && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {failure}
        </p>
      )}

      {/* --- Tür kartları --- */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {MACHINE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              setFilter((current) => ({
                ...current,
                kind: current.kind === kind ? "all" : kind,
              }))
            }
            className={`optiflow-lift rounded-xl border p-3 text-left transition-colors duration-200 ${
              filter.kind === kind
                ? "border-brand-400 bg-brand-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {MACHINE_KIND_LABEL[kind]}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
              {kindCounts[kind]}
            </p>
          </button>
        ))}
      </div>

      {/* --- Süzgeçler --- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter((current) => ({ ...current, status: tab.id }))}
              aria-pressed={filter.status === tab.id}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors duration-200 ${
                filter.status === tab.id
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <input
          type="search"
          value={filter.query}
          placeholder="Ad, seri no ya da operatör ara"
          onChange={(event) =>
            setFilter((current) => ({ ...current, query: event.target.value }))
          }
          className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
        />
      </div>

      {issues.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {issues.length} eksik alan var; {overdue.length} makinenin bakımı gecikmiş
          görünüyor.
        </p>
      )}

      {/* --- Liste --- */}
      {shown.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {machines.length === 0 ? "Envanter boş" : "Bu süzgeçte makine yok"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {machines.length === 0
              ? "Makineleri elle ekleyebilir ya da Excel/CSV dosyasından alabilirsiniz."
              : "Süzgeci değiştirip yeniden deneyin."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((machine, index) => {
            const style = MACHINE_STATUS_STYLE[machine.status];
            const age = machineAge(machine, now);
            const days = daysSinceMaintenance(machine, now);
            const due = isMaintenanceDue(machine, now);

            return (
              <Card key={machine.id} className="p-3" index={index}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(machine)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {machine.name || "İsimsiz makine"}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {MACHINE_KIND_LABEL[machine.kind]} ·{" "}
                      {machine.serialNumber ?? "seri no yok"}
                    </p>
                  </button>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {statusLabel(machine.status)}
                  </span>
                </div>

                <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <dt className="text-slate-500">Yaş</dt>
                    <dd className="font-medium text-slate-900">
                      {age === null ? "—" : `${age} yıl`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Son bakım</dt>
                    <dd className={`font-medium ${due ? "text-amber-600" : "text-slate-900"}`}>
                      {days === null ? "kayıt yok" : `${days} gün önce`}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-slate-500">Operatör</dt>
                    <dd className="truncate font-medium text-slate-900">
                      {machine.operator ?? "—"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-2 flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(machine)}>
                    Düzenle
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    ariaLabel="Makineyi sil"
                    onClick={() => onChange(removeMachine(machines, machine.id))}
                  >
                    {""}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <MachineForm
          machine={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            onChange(upsertMachine(machines, next));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Makine formu.
 *
 * Boş kutu `null` olarak kaydedilir, boş metin olarak değil: "girilmedi" ile
 * "boş bırakıldı" ayrımı doğrulamanın tek dayanağıdır.
 */
function MachineForm({
  machine,
  onClose,
  onSave,
}: {
  machine: Machine;
  onClose: () => void;
  onSave: (machine: Machine) => void;
}) {
  const [draft, setDraft] = useState<Machine>(machine);

  const patch = (patchValue: Partial<Machine>): void =>
    setDraft((current) => ({ ...current, ...patchValue }));

  const text = (value: string): string | null => (value.trim() === "" ? null : value);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Kapat"
        className="absolute inset-0 bg-slate-950/60"
        onClick={onClose}
      />
      <div className="optiflow-enter relative w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white p-5 sm:rounded-2xl">
        <h3 className="text-base font-semibold text-slate-900">
          {machine.name === "" ? "Yeni makine" : machine.name}
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Makine adı">
            <input
              type="text"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="Tür">
            <select
              value={draft.kind}
              onChange={(event) => patch({ kind: event.target.value as MachineKind })}
              className={inputClass}
            >
              {MACHINE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MACHINE_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Seri no">
            <input
              type="text"
              value={draft.serialNumber ?? ""}
              onChange={(event) => patch({ serialNumber: text(event.target.value) })}
              className={inputClass}
            />
          </Field>

          <Field label="Durum">
            <select
              value={draft.status}
              onChange={(event) => patch({ status: event.target.value as MachineStatus })}
              className={inputClass}
            >
              {(["active", "maintenance", "fault"] as MachineStatus[]).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Kurulum yılı">
            <input
              type="number"
              value={draft.installedYear ?? ""}
              onChange={(event) =>
                patch({
                  installedYear:
                    event.target.value === "" ? null : Number(event.target.value),
                })
              }
              className={inputClass}
            />
          </Field>

          <Field label="Son bakım">
            <input
              type="date"
              value={draft.lastMaintenanceAt?.slice(0, 10) ?? ""}
              onChange={(event) =>
                patch({
                  lastMaintenanceAt:
                    event.target.value === ""
                      ? null
                      : new Date(event.target.value).toISOString(),
                })
              }
              className={inputClass}
            />
          </Field>

          <Field label="Operatör">
            <input
              type="text"
              value={draft.operator ?? ""}
              onChange={(event) => patch({ operator: text(event.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Kaydet
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
