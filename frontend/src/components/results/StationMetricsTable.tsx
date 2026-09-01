/**
 * Bölüm B — İstasyon detay tablosu.
 *
 * Her satır bir istasyonu özetler; darboğaz satırı kırmızı zeminle ve açık bir
 * etiketle vurgulanır. Kullanım oranı hem sayı hem çubuk olarak gösterilir:
 * sayı kesinlik verir, çubuk istasyonlar arası karşılaştırmayı bakışta
 * mümkün kılar.
 *
 * **Darboğaz otoritesi backend'dir.** Satır, `is_bottleneck` alanına göre
 * işaretlenir; en yüksek doluluğa veya en düşük OEE'ye sahip satıra göre
 * değil. Bu ayrım daha önce backend tarafında bir hataya yol açmıştı: aç kalan
 * bir istasyonun OEE'si darboğazınkinden düşük çıkar, çünkü işleyecek parça
 * bulamaz. En düşük OEE'yi kısıt sanmak, kısıt olmayan istasyona yatırım
 * yaptıran klasik yerel optimizasyon hatasıdır.
 */

import { Fragment, useState } from "react";
import type { StationMetricsResponse } from "../../types/simulationTypes";
import {
  formatDecimal,
  formatMinutes,
  formatPercent,
  oeeTone,
  utilizationTone,
  type Tone,
} from "../../lib/resultsFormatting";
import { WarningIcon } from "../shared/icons";
import { Tooltip } from "../shared/Tooltip";

const BAR_COLORS: Record<Tone, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-slate-400",
};

const OEE_TEXT_COLORS: Record<Tone, string> = {
  good: "text-emerald-700",
  warning: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-slate-700",
};

interface StationMetricsTableProps {
  stations: StationMetricsResponse[];
  bottleneckStationId: string;
}

export function StationMetricsTable({
  stations,
  bottleneckStationId,
}: StationMetricsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <Th>İstasyon</Th>
              <Th>
                <span className="inline-flex items-center gap-1.5">
                  Doluluk
                  <Tooltip
                    label="Doluluk hakkında"
                    content="İstasyonun zamanının ne kadarını fiilen işlem yaparak geçirdiği. Bekleme ve arıza süreleri buna dahil değildir. %80 üzeri değerlerde kuyruk küçük dalgalanmalara bile hızla tepki verir."
                  />
                </span>
              </Th>
              <Th>Kuyruk</Th>
              <Th>Bekleme</Th>
              <Th>
                <span className="inline-flex items-center gap-1.5">
                  OEE
                  <Tooltip
                    label="OEE hakkında"
                    content="Ekipman etkinliği. Satıra tıklayarak üç bileşenini (kullanılabilirlik, performans, kalite) görebilir, hangisinin düşük olduğunu anlayabilirsiniz."
                  />
                </span>
              </Th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stations.map((station) => {
              const isBottleneck = station.station_id === bottleneckStationId;
              const isExpanded = expandedId === station.station_id;
              const utilTone = utilizationTone(station.utilization, isBottleneck);
              const oeeToneValue = oeeTone(station.oee.oee);

              return (
                <Fragment key={station.station_id}>
                  <tr
                    onClick={() =>
                      setExpandedId(isExpanded ? null : station.station_id)
                    }
                    className={`cursor-pointer transition-colors ${
                      isBottleneck
                        ? "bg-red-50 hover:bg-red-100/70"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {station.station_name}
                        </span>
                        {isBottleneck && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                            <WarningIcon className="h-3.5 w-3.5" />
                            Darboğaz
                          </span>
                        )}
                      </div>
                    </Td>

                    <Td>
                      {/* Sayı ve çubuk birlikte: biri kesinlik, diğeri
                          karşılaştırma sağlar. */}
                      <div className="flex items-center gap-2.5">
                        <span className="w-11 shrink-0 tabular-nums text-slate-800">
                          {formatPercent(station.utilization)}
                        </span>
                        <span
                          className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200"
                          role="img"
                          aria-label={`Doluluk ${formatPercent(station.utilization)}`}
                        >
                          <span
                            className={`block h-full rounded-full ${BAR_COLORS[utilTone]}`}
                            style={{
                              width: `${Math.min(Math.max(station.utilization, 0), 1) * 100}%`,
                            }}
                          />
                        </span>
                      </div>
                    </Td>

                    <Td>
                      <span className="tabular-nums text-slate-700">
                        {formatDecimal(station.avg_queue_length)}
                      </span>
                      <span className="ml-1 text-xs text-slate-400">parça</span>
                    </Td>

                    <Td>
                      <span className="tabular-nums text-slate-700">
                        {formatMinutes(station.avg_wait_time)}
                      </span>
                    </Td>

                    <Td>
                      <span
                        className={`font-semibold tabular-nums ${OEE_TEXT_COLORS[oeeToneValue]}`}
                      >
                        {formatPercent(station.oee.oee, 1)}
                      </span>
                    </Td>

                    <Td>
                      <span
                        aria-hidden="true"
                        className={`inline-block text-slate-400 transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      >
                        ▸
                      </span>
                      <span className="sr-only">
                        {isExpanded ? "Kırılımı gizle" : "OEE kırılımını göster"}
                      </span>
                    </Td>
                  </tr>

                  {isExpanded && (
                    <tr className={isBottleneck ? "bg-red-50/60" : "bg-slate-50"}>
                      <td colSpan={6} className="px-4 py-4">
                        <OeeBreakdown station={station} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        OEE kırılımını görmek için bir satıra tıklayın.
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

/**
 * OEE'nin üç bileşeni.
 *
 * Tek bir OEE skoru "düşük" der ama nedenini söylemez. Kırılım, kullanıcının
 * nereye müdahale edeceğini belirler: kullanılabilirlik düşükse bakıma,
 * performans düşükse besleme/hız sorununa, kalite düşükse fireye bakılır.
 */
function OeeBreakdown({ station }: { station: StationMetricsResponse }) {
  const components = [
    {
      key: "availability",
      label: "Kullanılabilirlik",
      value: station.oee.availability,
      help: "İstasyonun arızasız geçirdiği sürenin oranı. Düşükse önleyici bakıma öncelik verin.",
      lowAdvice: "Arızalar zamanın önemli bir kısmını alıyor.",
    },
    {
      key: "performance",
      label: "Performans",
      value: station.oee.performance,
      help: "Çalışır durumdayken gerçekten üretim yapılan sürenin oranı. Boş bekleme ve blokaj bu bileşeni düşürür.",
      lowAdvice:
        "İstasyon çalışabilir durumdayken üretim yapmıyor — parça bekliyor ya da çıkışı tıkalı olabilir.",
    },
    {
      key: "quality",
      label: "Kalite",
      value: station.oee.quality,
      help: "Üretilen parçaların hurdaya ayrılmayan oranı. Hurda, harcanan kapasitenin boşa gitmesidir.",
      lowAdvice: "Fire oranı kapasitenin bir kısmını boşa harcıyor.",
    },
  ];

  const weakest = components.reduce((lowest, item) =>
    item.value < lowest.value ? item : lowest,
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {components.map((component) => {
          const tone = oeeTone(component.value);
          const isWeakest = component.key === weakest.key;
          return (
            <div
              key={component.key}
              className={`rounded-lg border bg-white px-3 py-2.5 ${
                isWeakest ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-600">
                  {component.label}
                </span>
                <Tooltip content={component.help} label={`${component.label} hakkında`} />
              </div>
              <p
                className={`mt-1 text-xl font-semibold tabular-nums ${OEE_TEXT_COLORS[tone]}`}
              >
                {formatPercent(component.value, 1)}
              </p>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-200">
                <span
                  className={`block h-full rounded-full ${BAR_COLORS[tone]}`}
                  style={{ width: `${Math.min(Math.max(component.value, 0), 1) * 100}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>

      <p className="rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
        <strong className="font-semibold text-slate-800">
          En kısıtlayıcı bileşen: {weakest.label} ({formatPercent(weakest.value, 1)}).
        </strong>{" "}
        {weakest.lowAdvice} OEE, üç bileşenin çarpımıdır — en düşük olanı
        yükseltmek toplam skoru en çok artırır.
      </p>
    </div>
  );
}
