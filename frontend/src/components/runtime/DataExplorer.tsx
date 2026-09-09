/**
 * Data Explorer — cihazdan gelen ham veri.
 *
 * Bu ekranın amacı ham veriyi **görünür** kılmaktır: hangi kaynaktan, hangi
 * makineden, hangi ölçüm, hangi değer ve ne zaman. Bir hattın "veri gelmiyor"
 * şikâyeti çoğu zaman burada çözülür — ya hiç satır yoktur, ya makine adı
 * modeldekiyle tutmuyordur, ya da yük çevrilememiştir.
 *
 * Ölçülemeyen her alan "—" ile gösterilir; hiçbir sayı varsayılmaz.
 */

import {
  Activity,
  CircleAlert,
  Database,
  TriangleAlert,
} from "lucide-react";
import {
  FEED_LABEL,
  MACHINE_STATE_LABEL,
  METRIC_LABEL,
  describeStream,
  type DevicePage,
  type FeedVerdict,
} from "../../lib/connectors";
import { Badge, Card, EmptyState, SectionTitle } from "../ui/Primitives";
import {
  FEED_TONE,
  NOT_MEASURED,
  QUALITY_TONE,
  showClock,
  showCount,
  showNumber,
} from "./runtimeStyles";

interface DataExplorerProps {
  page: DevicePage;
  feed: FeedVerdict;
}

export function DataExplorer({ page, feed }: DataExplorerProps) {
  const { summary } = page;

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle
          title="Veri akışı"
          description="Cihazdan gelen ölçümlerin ekrana ulaşıp ulaşmadığı."
          action={<Badge tone={FEED_TONE[feed.status]}>{FEED_LABEL[feed.status]}</Badge>}
        />

        <Card className="p-4">
          <p className="text-xs leading-relaxed text-slate-600">{feed.reason}</p>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Ölçüm sayısı</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {showCount(summary.deviceEvents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Makine</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {showCount(summary.machines)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Toplam üretim</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {showNumber(summary.productionCount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Çevrilemeyen</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {showCount(summary.problems)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {page.streams.length > 0 && (
        <div>
          <SectionTitle title="Akışlar" description="Sunucudaki dinleme ve yoklama görevleri." />
          <ul className="space-y-2">
            {page.streams.map((stream) => (
              <li key={stream.connectionId}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {stream.connectionId}
                      <Badge tone="neutral">{stream.kind}</Badge>
                      <Badge tone={stream.hasData ? "good" : stream.running ? "info" : "neutral"}>
                        {stream.hasData
                          ? "Veri akıyor"
                          : stream.running
                            ? "Veri bekleniyor"
                            : "Kapalı"}
                      </Badge>
                    </p>
                    <span className="text-xs text-slate-500">
                      {describeStream(stream)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">Yük</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">
                        {showCount(stream.payloads)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Ölçüm</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">
                        {showCount(stream.eventsPublished)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">İzlenen düğüm</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">
                        {stream.monitoredItems === null
                          ? NOT_MEASURED
                          : showCount(stream.monitoredItems)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Yoklama aralığı</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">
                        {stream.intervalMs === null
                          ? NOT_MEASURED
                          : `${showCount(stream.intervalMs)} ms`}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      {page.mappingWarnings.length > 0 && (
        <div>
          <SectionTitle
            title="Eşleme uyarıları"
            description="Verisi gelen ama modelde karşılığı olmayan makineler."
          />
          <Card className="p-4">
            <ul className="space-y-2">
              {page.mappingWarnings.map((warning) => (
                <li
                  key={warning.machineId}
                  className="flex items-start gap-2 text-xs text-amber-900"
                >
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">
                    {warning.reason} ({showCount(warning.sampleCount)} ölçüm)
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div>
        <SectionTitle
          title="Makineler"
          description="Gerçek veriden hesaplanan üretim metrikleri."
        />
        {page.machines.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Hiçbir makineden ölçüm gelmedi"
            description="Bir bağlantıyı doğrulayıp akışı başlatın. Ölçümler geldiğinde makine başına üretim, kuyruk ve durum burada görünür."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Makine</th>
                  <th className="py-2 pr-3 font-medium">Durum</th>
                  <th className="py-2 pr-3 font-medium">Üretim</th>
                  <th className="py-2 pr-3 font-medium">Kuyruk</th>
                  <th className="py-2 pr-3 font-medium">Duruş (dk)</th>
                  <th className="py-2 pr-3 font-medium">Saatlik çıktı</th>
                  <th className="py-2 font-medium">Ölçüm</th>
                </tr>
              </thead>
              <tbody>
                {page.machines.map((machine) => (
                  <tr
                    key={machine.machineId}
                    className="border-b border-slate-200 last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {machine.machineId}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={machine.state === "running" ? "good" : "neutral"}>
                        {MACHINE_STATE_LABEL[machine.state]}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-700">
                      {showNumber(machine.productionCount)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-700">
                      {showNumber(machine.queueLength)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-700">
                      {showNumber(machine.downtimeMinutes)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-700">
                      {showNumber(machine.throughputPerHour)}
                    </td>
                    <td className="py-2.5 tabular-nums text-slate-500">
                      {showCount(machine.sampleCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <SectionTitle
          title="Son ölçümler"
          description="Cihazdan gelen ham satırlar; en yeni üstte."
        />
        {page.events.length === 0 ? (
          <EmptyState
            icon={Database}
            title="Henüz ölçüm yok"
            description="Akış açıldığında cihazdan gelen her ölçüm burada ham hâliyle görünür."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Zaman</th>
                  <th className="py-2 pr-3 font-medium">Kaynak</th>
                  <th className="py-2 pr-3 font-medium">Makine</th>
                  <th className="py-2 pr-3 font-medium">Ölçüm</th>
                  <th className="py-2 pr-3 font-medium">Değer</th>
                  <th className="py-2 font-medium">Adres</th>
                </tr>
              </thead>
              <tbody>
                {page.events.map((reading, index) => (
                  <tr
                    key={`${reading.machineId}-${reading.atMs}-${index}`}
                    className="border-b border-slate-200 last:border-0"
                  >
                    <td className="py-2 pr-3 font-mono text-xs text-slate-500">
                      {showClock(reading.atMs)}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <Badge tone="neutral">{reading.source}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {reading.machineId}
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">
                      {METRIC_LABEL[reading.metric]}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-900">
                      {reading.value === null ? NOT_MEASURED : String(reading.value)}
                      {reading.unit === null ? "" : ` ${reading.unit}`}
                      {reading.quality === "good" ? null : (
                        <span className="ml-1.5">
                          <Badge tone={QUALITY_TONE[reading.quality]}>
                            {reading.quality}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2 break-all font-mono text-[11px] text-slate-400">
                      {reading.origin ?? NOT_MEASURED}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page.problems.length > 0 && (
        <div>
          <SectionTitle
            title="Tanılama"
            description="Çevrilemeyen yükler; sessizce yutulmaz."
          />
          <Card className="p-4">
            <ul className="space-y-2">
              {page.problems
                .slice()
                .reverse()
                .map((problem, index) => (
                  <li
                    key={`${problem.atMs}-${index}`}
                    className="border-b border-slate-200 pb-2 last:border-0 last:pb-0"
                  >
                    <p className="flex items-start gap-2 text-xs text-slate-700">
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span className="break-words">{problem.reason}</span>
                    </p>
                    {problem.sample !== null && (
                      <p className="mt-1 break-all pl-5 font-mono text-[11px] text-slate-400">
                        {problem.sample}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
