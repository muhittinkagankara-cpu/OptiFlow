/**
 * Gerçek üretim verisinin girildiği panel.
 *
 * Alanlar bilinçli olarak **boş** başlar ve boş kalabilir: sıfırla doldurulmuş
 * bir form, dokunulmayan her alanı "ölçtük, sıfır çıktı" hâline getirir ve
 * doğruluğu ilk açılışta yanlış hesaplatır. Boş alan `null` olarak gider ve
 * hesaba girmez.
 *
 * Dosya yükleme ile elle giriş aynı veriyi besler; yükleme yalnızca alanları
 * doldurur, ayrı bir yol açmaz. Böylece kullanıcı dosyadan geleni ekranda
 * görür ve düzeltebilir — sessizce içeri alınan bir veri, yanlışını da sessizce
 * taşır.
 */

import { useCallback, useRef, useState } from "react";
import { Download, FileUp, RotateCcw } from "lucide-react";
import {
  csvTemplate,
  parseRealDataCsv,
  rowsToMeasurements,
  type RealDataSet,
  type RealStationMeasurement,
} from "../../lib/validation";
import { ImportError, parseFile } from "../../lib/import";
import { Button, Card } from "../ui/Primitives";

/** Bir istasyon satırında doldurulabilen alanlar. */
const FIELDS: {
  key: keyof RealStationMeasurement;
  label: string;
  unit: string;
  step: string;
}[] = [
  { key: "cycleTimeMinutes", label: "Çevrim", unit: "dk", step: "0.1" },
  { key: "producedUnits", label: "Üretim", unit: "adet", step: "1" },
  { key: "waitMinutes", label: "Bekleme", unit: "dk", step: "0.1" },
  { key: "scrapUnits", label: "Fire", unit: "adet", step: "1" },
  { key: "operatorCount", label: "Operatör", unit: "kişi", step: "1" },
  { key: "machineCount", label: "Makine", unit: "adet", step: "1" },
];

interface RealDataPanelProps {
  data: RealDataSet;
  stations: { id: string; name: string }[];
  onChange: (next: RealDataSet) => void;
  onReset: () => void;
}

export function RealDataPanel({
  data,
  stations,
  onChange,
  onReset,
}: RealDataPanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const patchStation = useCallback(
    (index: number, patch: Partial<RealStationMeasurement>) => {
      onChange({
        ...data,
        stations: data.stations.map((station, current) =>
          current === index ? { ...station, ...patch } : station,
        ),
      });
    },
    [data, onChange],
  );

  /**
   * Dosyadan gelen değerleri mevcut satırlara yazar.
   *
   * Mevcut satırlar korunur ve yalnızca dosyada karşılığı olan alanlar
   * güncellenir: kullanıcının elle girdiği bir değer, dosyada o alan boşsa
   * silinmemelidir.
   */
  const applyParsed = useCallback(
    (parsed: ReturnType<typeof parseRealDataCsv>) => {
      if (parsed.measurements.length === 0) {
        setFailure(
          "Dosyada istasyon adı kolonu bulunamadı. İlk satırda 'İstasyon' başlığı olmalı.",
        );
        return;
      }

      const byId = new Map(
        parsed.measurements
          .filter((item) => item.stationId !== null)
          .map((item) => [item.stationId as string, item]),
      );

      onChange({
        ...data,
        stations: data.stations.map((station) => {
          const incoming =
            station.stationId === null ? null : byId.get(station.stationId);
          if (!incoming) {
            return station;
          }
          return {
            ...station,
            cycleTimeMinutes:
              incoming.cycleTimeMinutes ?? station.cycleTimeMinutes,
            producedUnits: incoming.producedUnits ?? station.producedUnits,
            waitMinutes: incoming.waitMinutes ?? station.waitMinutes,
            scrapUnits: incoming.scrapUnits ?? station.scrapUnits,
            operatorCount: incoming.operatorCount ?? station.operatorCount,
            machineCount: incoming.machineCount ?? station.machineCount,
          };
        }),
      });

      setFailure(null);
      setNotice(
        parsed.unmatched.length === 0
          ? `${byId.size} istasyonun ölçümü dosyadan alındı.`
          : `${byId.size} istasyon eşleşti. Modelde bulunmayan satırlar atlandı: ${parsed.unmatched.join(", ")}.`,
      );
    },
    [data, onChange],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setNotice(null);
      setFailure(null);
      try {
        const parsed = await parseFile(file);
        const sheet = parsed.sheets[0];
        if (!sheet) {
          setFailure("Dosyada okunabilir bir sayfa yok.");
          return;
        }
        applyParsed(rowsToMeasurements(sheet.rows, stations));
      } catch (error) {
        // Yükleme sessizce başarısız olursa kullanıcı dosyayı seçip hiçbir şey
        // olmadığını görür ve ürünün bozuk olduğunu düşünür.
        setFailure(
          error instanceof ImportError
            ? error.message
            : "Dosya okunamadı. CSV ya da .xlsx olduğundan emin olun.",
        );
      }
    },
    [applyParsed, stations],
  );

  const downloadTemplate = useCallback(() => {
    // Şablon tarayıcıda üretilir; sunucuya gitmesi için bir neden yok.
    const blob = new Blob(["﻿", csvTemplate(stations)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "optiflow-gercek-veri-sablonu.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [stations]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Gerçek üretim verisi
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Ölçmediğiniz alanı boş bırakın; boş alan hesaba girmez.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={Download} onClick={downloadTemplate}>
            Şablon
          </Button>
          <Button
            size="sm"
            icon={FileUp}
            onClick={() => fileInput.current?.click()}
          >
            Dosya yükle
          </Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReset}>
            Temizle
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
          // Aynı dosyanın ikinci kez seçilebilmesi için değer sıfırlanır.
          event.target.value = "";
        }}
      />

      {notice !== null && (
        <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
          {notice}
        </p>
      )}
      {failure !== null && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {failure}
        </p>
      )}

      <label className="mt-4 block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Vardiya / ölçüm süresi (dk)
        </span>
        <input
          type="number"
          min={0}
          step="10"
          value={data.shiftMinutes ?? ""}
          placeholder="480"
          onChange={(event) =>
            onChange({ ...data, shiftMinutes: toNumber(event.target.value) })
          }
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Üretim adedini hıza çevirmek için gerekir; boşsa üretim ölçütü
          karşılaştırılmaz.
        </span>
      </label>

      <div className="mt-4 space-y-3">
        {data.stations.map((station, index) => (
          <div
            key={station.stationId ?? station.stationName}
            className="rounded-xl border border-slate-200 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                {station.stationName}
              </span>
              {station.stationId === null && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  Modelde yok
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    {field.label} ({field.unit})
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={field.step}
                    value={(station[field.key] as number | null) ?? ""}
                    onChange={(event) =>
                      patchStation(index, {
                        [field.key]: toNumber(event.target.value),
                      })
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-brand-400"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Girdi metnini sayıya çevirir.
 *
 * Boş kutu `null`'dır — sıfır değil. Kullanıcının sildiği bir alan, ölçülmemiş
 * alana geri döner.
 */
function toNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
