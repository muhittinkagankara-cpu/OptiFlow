/**
 * Sağ paneldeki canlı göstergeler.
 *
 * Altı kart: throughput, OEE, kuyruk, ortalama çevrim, açık alarm ve son
 * güncelleme. Her birinin altında son on beş dakikanın sparkline'ı var.
 *
 * Ölçülemeyen gösterge "—" gösterir, sıfır değil. Vardiyanın ilk saniyesinde
 * "0 parça/dk" yazmak, hattın durduğunu söylemek olurdu; oysa henüz ölçecek
 * bir şey yoktur.
 *
 * İki kaynak, tek kural
 * ---------------------
 * `runtimeKpi` verildiğinde kartlar **gerçek cihaz verisinden** beslenir ve
 * runtime'ın ölçemediği alanlar benzetim değerine düşmez, "—" kalır. Düşseydi
 * ekranda gerçek ile benzetim yan yana ve ayırt edilemez biçimde dururdu;
 * gerçek sanılan bir benzetim sayısı yüzünden olmayan bir arızaya ekip
 * gönderilebilirdi.
 *
 * Her kartın altında kaynağı yazar: "cihazdan" ya da "benzetim".
 *
 * ## Rol ayrımı (Sprint 2I-B.2)
 *
 * Sprint 2I-B, ekranın üstüne bir **karar özeti** (`MetricGroup`) koydu ve o
 * özet throughput, OEE, kuyruk ve açık alarmı sonuçlarıyla birlikte yazıyor.
 * Aynı dört sayı burada da duruyordu: dar ekranda kullanıcı aynı olguyu iki
 * kez, birbirine yakın iki yüzeyde görüyordu (ANTI-PATTERNS #9).
 *
 * Kural, aynı anti-desenin verdiği kuraldır: *bir olgu bir ekranda en fazla
 * iki yerde görünür — bir kez özet, bir kez ayrıntı düzeyinde.* Masaüstünde
 * iki yüzey yan yana değil, biri solda biri sağda durur ve ikinci düzey
 * (eğilim + kaynak etiketi) gerçekten yeni bilgi taşır; orada ikisi de kalır.
 * `lg` altında ise iki yüzey üst üste yığılır ve tekrar tarama maliyetinden
 * başka bir şey üretmez; bu yüzden örtüşen dört kart orada çizilmez.
 *
 * Panelin **benzersiz** taşıdıkları her genişlikte durur: ortalama çevrim /
 * duruş, ölçülen makine sayısı, on beş dakikalık eğilim ve kart başına
 * "cihazdan / benzetim" etiketi.
 */

import { memo } from "react";
import {
  Activity,
  BellRing,
  Clock,
  Gauge,
  Layers,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  formatClock,
  trendDirection,
  type LiveTotals,
  type TrendSample,
} from "../../lib/live";
import {
  EMPTY,
  formatMinutes,
  formatThroughput,
  type MonitoringKpi,
} from "../../lib/monitoring";
import { formatDecimal } from "../../lib/resultsFormatting";
import { Sparkline } from "./Sparkline";
import type { LiveTrends } from "./useLiveTrends";

/* Sparkline renkleri; kart tonlarıyla eşleşir. */
const COLOR = {
  brand: "#3B82F6",
  emerald: "#22C55E",
  amber: "#F59E0B",
  violet: "#A78BFA",
  red: "#EF4444",
} as const;

interface LiveKpiPanelProps {
  totals: LiveTotals;
  trends: LiveTrends;
  clockMinutes: number;
  /** Sayaç çevirme animasyonunun anahtarı; her olay paketinde değişir. */
  eventCount: number;
  /**
   * Gerçek cihazlardan okunan KPI'lar; yoksa `null`.
   *
   * Verildiğinde kartlar bunu gösterir ve runtime'ın ölçemediği alan benzetim
   * değerine düşmez.
   */
  runtimeKpi?: MonitoringKpi | null;
}

function LiveKpiPanelInner({
  totals,
  trends,
  clockMinutes,
  eventCount,
  runtimeKpi = null,
}: LiveKpiPanelProps) {
  const live = runtimeKpi !== null;
  /* Kartın altındaki kaynak etiketi; renk değil metin taşır. */
  const source = live ? "cihazdan" : "benzetim";

  return (
    <div className="grid grid-cols-2 gap-2">
      <KpiCard
        icon={Activity}
        label="Throughput"
        /* Karar özetinde (MetricGroup) sonucuyla birlikte zaten var; dar
           ekranda ikinci kez gösterilmez (bkz. dosya başlığı). */
        className="max-lg:hidden"
        value={
          live
            ? runtimeKpi.throughput === null
              ? EMPTY
              : formatThroughput(runtimeKpi.throughput).replace(" adet/sa", "")
            : totals.throughputPerMinute === null
              ? EMPTY
              : `${formatDecimal(totals.throughputPerMinute, 1)}`
        }
        unit={
          live
            ? runtimeKpi.throughput === null
              ? (runtimeKpi.reasons.throughput ?? "ölçüm yok")
              : `adet/sa · ${source}`
            : totals.throughputPerMinute === null
              ? "ölçüm yok"
              : `parça/dk · ${source}`
        }
        series={trends.throughput}
        color={COLOR.brand}
        formatScale={(v) => formatDecimal(v, 1)}
        flipKey={eventCount}
      />
      <KpiCard
        icon={Gauge}
        label="OEE"
        /* Karar özetinde (MetricGroup) sonucuyla birlikte zaten var; dar
           ekranda ikinci kez gösterilmez (bkz. dosya başlığı). */
        className="max-lg:hidden"
        value={totals.oee === null ? "—" : `%${Math.round(totals.oee * 100)}`}
        unit={totals.oee === null ? "istasyon yok" : "hat ortalaması"}
        series={trends.oee}
        color={COLOR.emerald}
        formatScale={(v) => `%${Math.round(v * 100)}`}
        flipKey={eventCount}
      />
      <KpiCard
        icon={Layers}
        label="Kuyruk"
        /* Karar özetinde (MetricGroup) sonucuyla birlikte zaten var; dar
           ekranda ikinci kez gösterilmez (bkz. dosya başlığı). */
        className="max-lg:hidden"
        value={
          live
            ? runtimeKpi.queue === null
              ? EMPTY
              : String(Math.round(runtimeKpi.queue))
            : String(totals.totalQueue)
        }
        unit={
          live && runtimeKpi.queue === null
            ? (runtimeKpi.reasons.queue ?? "ölçüm yok")
            : `bekleyen parça · ${source}`
        }
        series={trends.queue}
        color={COLOR.amber}
        formatScale={(v) => String(Math.round(v))}
        flipKey={eventCount}
      />
      {/*
        Gerçek beslemede bu kart **duruşu** gösterir, ortalama çevrimi değil:
        çevrim süresi cihazlardan gelmiyor ve benzetim değerini gerçek verinin
        yanında göstermek, ölçülmemiş bir sayıyı ölçülmüş gibi sunmak olurdu.
      */}
      <KpiCard
        icon={Timer}
        label={live ? "Duruş" : "Ort. çevrim"}
        value={
          live
            ? runtimeKpi.downtimeMinutes === null
              ? EMPTY
              : formatMinutes(runtimeKpi.downtimeMinutes).replace(" dk", "")
            : totals.avgCycleSeconds === null
              ? EMPTY
              : `${Math.round(totals.avgCycleSeconds)}`
        }
        unit={
          live
            ? runtimeKpi.downtimeMinutes === null
              ? (runtimeKpi.reasons.downtime ?? "ölçülmedi")
              : `dakika · ${source}`
            : totals.avgCycleSeconds === null
              ? "ölçüm yok"
              : `saniye · ${source}`
        }
        series={trends.cycle}
        color={COLOR.violet}
        formatScale={(v) => String(Math.round(v))}
        flipKey={eventCount}
      />
      {/*
        Alt satır "çevrimiçi makine" değil **ölçülen** makine sayısını yazar:
        bir makinenin tanımlı olması ondan veri geldiği anlamına gelmez ve
        "2/2 çevrimiçi" yazısı, iki makine de susmuşken bile doğru görünürdü.
      */}
      <KpiCard
        icon={BellRing}
        label="Açık alarm"
        /* Karar özetinde (MetricGroup) sonucuyla birlikte zaten var; dar
           ekranda ikinci kez gösterilmez (bkz. dosya başlığı). */
        className="max-lg:hidden"
        value={String(live ? runtimeKpi.alarmCount : totals.openAlarms)}
        unit={
          live
            ? `${runtimeKpi.measuredMachines}/${runtimeKpi.totalMachines} makine ölçüldü`
            : `${totals.onlineMachines}/${totals.totalMachines} istasyon · ${source}`
        }
        series={trends.alarms}
        color={COLOR.red}
        formatScale={(v) => String(Math.round(v))}
        flipKey={eventCount}
      />
      {/*
        Gerçek beslemede benzetim saati gösterilemez: `clockMinutes` senaryonun
        kendi saatidir ve cihazdan gelen verinin ne zaman okunduğunu söylemez.
        Bu yüzden gerçek beslemede kart, saat yerine çalışan makine sayısını
        gösterir.
      */}
      <div className="rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-3">
        <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--of-cc-ink-label)] uppercase">
          <Clock className="h-3 w-3" />
          {live ? "Çalışan makine" : "Son güncelleme"}
        </p>
        <p
          key={eventCount}
          className="optiflow-count-flip mt-0.5 text-xl font-bold text-slate-900 tabular-nums"
        >
          {live
            ? `${runtimeKpi.activeMachines}/${runtimeKpi.totalMachines}`
            : formatClock(clockMinutes)}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {live
            ? `${runtimeKpi.downMachines} duruşta · ${runtimeKpi.blockedMachines} bloke`
            : `${totals.runningStations} istasyon üretimde · ${source}`}
        </p>
      </div>
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  series: TrendSample[];
  color: string;
  flipKey: number;
  /**
   * Sparkline ölçek etiketinin biçimlendiricisi (Sprint 2I-D).
   *
   * Birimi yalnızca kart bilir; grafiğe geçirilmezse ölçek çıplak bir
   * ondalık olarak okunurdu.
   */
  formatScale?: (value: number) => string;
  /**
   * Yalnızca görünürlük için ek sınıf (Sprint 2I-B.2).
   *
   * Kartın içeriğine, rengine ya da ölçüm davranışına dokunmaz; tek işi
   * kartın hangi genişlikte çizileceğini söylemektir.
   */
  className?: string;
}

const KpiCard = memo(function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  series,
  color,
  flipKey,
  formatScale,
  className = "",
}: KpiCardProps) {
  const direction = trendDirection(series);

  return (
    <div
      className={`rounded-[var(--of-cc-radius-card)] border border-[var(--of-cc-border)] bg-[var(--of-cc-card)] p-3 ${className}`}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--of-cc-ink-label)] uppercase">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        {/* `key` her pakette değişir; React düğümü yeniler ve çevirme
            animasyonu yeniden çalışır. */}
        <span
          key={flipKey}
          className="optiflow-count-flip inline-block text-xl font-bold text-slate-900 tabular-nums"
        >
          {value}
        </span>
        {/* Yön oku renk değil, karakterle de anlaşılır. */}
        {direction !== null && direction !== "flat" && (
          <span className="text-[10px] font-semibold text-slate-500">
            {direction === "up" ? "▲" : "▼"}
          </span>
        )}
      </div>
      <p className="text-[10px] text-slate-500">{unit}</p>
      <Sparkline series={series} color={color} format={formatScale} />
    </div>
  );
});

export const LiveKpiPanel = memo(LiveKpiPanelInner);
