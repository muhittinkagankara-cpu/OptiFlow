/**
 * Canlı yük inceleyici.
 *
 * Cihazdan gelen her ölçüm burada görünür: hangi makine, hangi alan, hangi
 * değer, hangi protokol, hangi sıra numarası. Sorun ararken ilk bakılan yer
 * burasıdır — "sunucuya ne geliyor?" sorusunun tek dürüst yanıtı ham veridir.
 *
 * Yeşil flaş
 * ----------
 * Az önce değişen satır kısa süre vurgulanır. Vurgulanmasaydı, saniyede
 * onlarca satırın aktığı bir listede hangi değerin yeni geldiğini göz tek
 * başına ayıramazdı. Vurgu **yanıp sönmez**: sekiz saat açık kalan bir
 * ekranda yanıp sönen bir satır, operatörün listeyi görmezden gelmesine yol
 * açar.
 *
 * Bozuk kaliteli satır silinmez, **işaretlenir**: bir ölçümün gelip de
 * kullanılamamış olması, hiç gelmemesinden farklı bir bilgidir.
 */

import { memo, useMemo, useState } from "react";
import { Radio, SearchX } from "lucide-react";
import {
  PROTOCOL_LABEL,
  QUALITY_LABEL,
  isFresh,
  latestByField,
  summarize,
  type DeviceDataRow,
  type StreamBufferState,
} from "../../lib/stream";
import { formatClock } from "../../lib/monitoring";
import { Badge, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import type { BadgeTone } from "../ui/Primitives";

const QUALITY_TONE: Record<string, BadgeTone> = {
  good: "good",
  uncertain: "warning",
  bad: "bad",
};

const PROTOCOL_TONE: Record<string, BadgeTone> = {
  rest: "info",
  opcua: "info",
  mqtt: "info",
  unknown: "neutral",
};

type InspectorView = "latest" | "stream";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "doğru" : "yanlış";
  return String(value).slice(0, 40);
}

function Row({ row, nowMs }: { row: DeviceDataRow; nowMs: number }) {
  const fresh = isFresh(row, nowMs);

  return (
    <li
      className={`flex flex-col gap-1 rounded-md border px-2.5 py-2 transition-colors duration-500 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
        fresh
          ? "border-emerald-300 bg-emerald-50/70"
          : "border-slate-200 bg-white/60"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-900">
          {row.machineId} · {row.field}
          <span className="ml-1.5 font-semibold tabular-nums text-slate-700">
            {formatValue(row.value)}
            {row.unit !== null && ` ${row.unit}`}
          </span>
        </p>
        <p className="mt-0.5 truncate text-[10px] text-slate-500">
          {row.origin ?? "kaynak bildirilmedi"} · {formatClock(row.timestampMs)} · #
          {row.sequence}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Badge tone={PROTOCOL_TONE[row.protocol] ?? "neutral"}>
          {PROTOCOL_LABEL[row.protocol]}
        </Badge>
        {!row.usable && (
          <Badge tone={QUALITY_TONE[row.quality] ?? "warning"}>
            {QUALITY_LABEL[row.quality]}
          </Badge>
        )}
      </div>
    </li>
  );
}

interface PayloadInspectorProps {
  buffer: StreamBufferState;
  /** Tazelik hesabı için şu an; testlerde sabitlenir. */
  nowMs: number;
}

function PayloadInspectorInner({ buffer, nowMs }: PayloadInspectorProps) {
  const [view, setView] = useState<InspectorView>("latest");

  const totals = useMemo(() => summarize(buffer), [buffer]);
  const rows = useMemo(
    () => (view === "latest" ? latestByField(buffer.rows) : buffer.rows),
    [buffer.rows, view],
  );

  return (
    <Card>
      <SectionTitle
        title="Yük İnceleyici"
        description="Cihazdan gelen ham ölçümler; az önce değişen satır vurgulanır."
        action={
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {[
              { id: "latest" as const, label: "Son değerler" },
              { id: "stream" as const, label: "Akış" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  view === item.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Satır", value: String(totals.total) },
          { label: "Makine", value: String(totals.machines) },
          { label: "Bağlantı", value: String(totals.connectors) },
          { label: "Kullanılamayan", value: String(totals.unusable) },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2"
          >
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Cihazdan ölçüm gelmedi."
          description="Akış açık olsa bile cihaz veri göndermeden bu liste boş kalır; açık bir bağlantı akan veri demek değildir."
        />
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 50).map((row) => (
            <Row key={`${row.connectorId}-${row.sequence}`} row={row} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {totals.duplicates > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
          <Radio className="h-3 w-3" />
          {totals.duplicates} yinelenen ölçüm elendi (akış yeniden açıldığında
          sunucu son olayları tekrar gönderir).
        </p>
      )}
    </Card>
  );
}

export const PayloadInspector = memo(PayloadInspectorInner);
