/**
 * Gelen yük denetleyicisi.
 *
 * Uç noktadan **gerçekten** dönen gövdeyi olduğu gibi gösterir ve her yaprağı
 * adresiyle listeler: tip, değer, kaynak ve eşleşen alan. Sahada bir bağlantı
 * kurulurken en çok zaman alan iş, "bu uç ne döndürüyor?" sorusudur; ekranın
 * bunu göstermesi, dokümantasyon aramaktan hızlıdır.
 *
 * Yük yoksa uydurulmaz: "Henüz veri alınmadı" yazar. Örnek bir JSON göstermek,
 * kullanıcının kendi ucunun o yapıyı döndürdüğünü sanmasına yol açardı.
 */

import { useMemo, useState } from "react";
import { Braces, Search } from "lucide-react";
import {
  LIVE_FIELD_LABEL,
  inspectPayload,
  type LiveMapping,
  type PayloadEntry,
} from "../../lib/connectors";
import { Card } from "../ui/Primitives";
import { TYPE_CHIP, showValue } from "./pilotStyles";

interface PayloadInspectorProps {
  /** Uç noktadan dönen gövde; hiç istek yapılmadıysa `undefined`. */
  payload: unknown;
  mappings: LiveMapping[];
  /** Yükün alındığı an; alınmadıysa `null`. */
  receivedAtMs: number | null;
  /** Kaynak açıklaması ("REST · https://…"). */
  source: string;
  /** Bir satır eşlemeye eklendiğinde. */
  onPick?: (entry: PayloadEntry) => void;
}

const TIME_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function PayloadInspector({
  payload,
  mappings,
  receivedAtMs,
  source,
  onPick,
}: PayloadInspectorProps) {
  const [query, setQuery] = useState("");

  const entries = useMemo(
    () => (payload === undefined ? [] : inspectPayload(payload, mappings)),
    [payload, mappings],
  );

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text === "") {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(text) ||
        showValue(entry.value).toLowerCase().includes(text),
    );
  }, [entries, query]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Braces className="h-4 w-4 text-slate-400" />
            Gelen yük
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {receivedAtMs === null
              ? "Henüz veri alınmadı."
              : `${source} · ${TIME_FORMAT.format(new Date(receivedAtMs))} · ${entries.length} alan`}
          </p>
        </div>

        {entries.length > 0 && (
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              placeholder="Adres ya da değer ara"
              onChange={(event) => setQuery(event.target.value)}
              className="w-48 rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
            />
          </label>
        )}
      </div>

      {payload === undefined ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          Bağlantıyı test ettiğinizde uç noktadan dönen gövde burada, alan alan
          listelenir. Örnek veri gösterilmez.
        </p>
      ) : (
        <>
          <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-slate-200 bg-slate-950/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
            {JSON.stringify(payload, null, 2)}
          </pre>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <Th>Adres</Th>
                  <Th>Tip</Th>
                  <Th>Değer</Th>
                  <Th>Eşleşen alan</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => (
                  <tr
                    key={entry.path}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-700">
                      {entry.path}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_CHIP[entry.type]}`}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-900">
                      {showValue(entry.value)}
                    </td>
                    <td className="py-1.5">
                      {entry.matchedField === null ? (
                        onPick === undefined ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onPick(entry)}
                            className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors duration-200 hover:border-brand-400 hover:text-brand-700"
                          >
                            Alana bağla
                          </button>
                        )
                      ) : (
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          {LIVE_FIELD_LABEL[entry.matchedField as keyof typeof LIVE_FIELD_LABEL]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shown.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Bu aramaya uyan alan yok.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}
