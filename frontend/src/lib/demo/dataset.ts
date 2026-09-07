/**
 * Demo veri kümesi — beş aşamanın her biri için hattın hâli.
 *
 * Neden gömülü veri
 * -----------------
 * Simülasyon motoru sunucuda (Python) çalışır ve demo **oturum açmadan**
 * kullanılır; hiçbir uca istek atılmaz. Bu yüzden koşum sonucu burada kurulur.
 * Sayılar uydurma değil, **türetilmiştir**: hat OEE'si istasyon OEE'lerinin
 * ortalamasıdır, akış süresi Little Yasası'ndan (WIP / throughput) gelir,
 * kayıp tutarları istasyon paylarından hesaplanır. Böylece Sonuç, Finans,
 * Intelligence ve Rapor ekranları birbiriyle çelişmez — bir demoda en çabuk
 * fark edilen hata budur.
 *
 * Verinin gerçek bir koşumdan gelmediği ekranda **kalıcı bir şeritle** yazılır
 * (`DemoBanner`); bu dosyanın işi tutarlı bir hikâye kurmak, gerçeklik iddia
 * etmek değil.
 */

import { metalTemplate } from "../../templates";
import type {
  FinancialReport,
  SimulationConfig,
  SimulationResults,
  SimulationRunResponse,
  StationMetricsResponse,
} from "../../types/simulationTypes";
import type { RunHistoryEntry } from "../runHistory";
import type { DemoPhase } from "./timeline";

/** Demo koşumunun kapsadığı vardiya (dakika). */
export const DEMO_WINDOW_MINUTES = 480;

/** Demo fabrikasının adı; kapaklarda ve kenar çubuğunda görünür. */
export const DEMO_FACTORY_NAME = "Demo Metal Hattı";

/** Demo organizasyonu. */
export const DEMO_ORG_NAME = "Demo Metal A.Ş.";

/* -------------------------------------------------------------------------- */
/* Aşama profilleri                                                            */
/* -------------------------------------------------------------------------- */

interface StationProfile {
  id: string;
  name: string;
  servers: number;
  utilization: number;
  queue: number;
  /** Bin parçada kaç tanesi hurdaya ayrılıyor. */
  scrapPerThousand: number;
}

/**
 * Dört istasyonun beş aşamadaki hâli.
 *
 * Anlatı Torna üzerinden kurulur: önce dengeli, sonra kuyruk, sonra kritik,
 * en sonunda ikinci tezgâh eklenince rahatlamış hâli. Diğer istasyonlar hafif
 * değişir — bir hatta tek bir şey değişip her şeyin sabit kalması gerçekçi
 * olmazdı.
 */
const PROFILES: Record<DemoPhase, StationProfile[]> = {
  1: [
    { id: "kesme", name: "Kesme", servers: 2, utilization: 0.55, queue: 1, scrapPerThousand: 4 },
    { id: "torna", name: "Torna", servers: 2, utilization: 0.62, queue: 2, scrapPerThousand: 38 },
    { id: "kaynak", name: "Kaynak", servers: 3, utilization: 0.58, queue: 1, scrapPerThousand: 6 },
    { id: "boyama", name: "Boyama", servers: 1, utilization: 0.44, queue: 0, scrapPerThousand: 3 },
  ],
  2: [
    { id: "kesme", name: "Kesme", servers: 2, utilization: 0.58, queue: 2, scrapPerThousand: 5 },
    { id: "torna", name: "Torna", servers: 2, utilization: 0.81, queue: 7, scrapPerThousand: 44 },
    { id: "kaynak", name: "Kaynak", servers: 3, utilization: 0.6, queue: 1, scrapPerThousand: 6 },
    { id: "boyama", name: "Boyama", servers: 1, utilization: 0.45, queue: 0, scrapPerThousand: 3 },
  ],
  3: [
    { id: "kesme", name: "Kesme", servers: 2, utilization: 0.6, queue: 3, scrapPerThousand: 5 },
    { id: "torna", name: "Torna", servers: 2, utilization: 0.96, queue: 16, scrapPerThousand: 61 },
    { id: "kaynak", name: "Kaynak", servers: 3, utilization: 0.62, queue: 2, scrapPerThousand: 7 },
    { id: "boyama", name: "Boyama", servers: 1, utilization: 0.46, queue: 1, scrapPerThousand: 3 },
  ],
  4: [
    { id: "kesme", name: "Kesme", servers: 2, utilization: 0.61, queue: 3, scrapPerThousand: 5 },
    { id: "torna", name: "Torna", servers: 2, utilization: 0.97, queue: 18, scrapPerThousand: 63 },
    { id: "kaynak", name: "Kaynak", servers: 3, utilization: 0.62, queue: 2, scrapPerThousand: 7 },
    { id: "boyama", name: "Boyama", servers: 1, utilization: 0.46, queue: 1, scrapPerThousand: 3 },
  ],
  // Öneri uygulandı: Torna'ya üçüncü tezgâh eklendi. Kuyruk eridi, hattın
  // tamamı hızlandı ve fire, kısıtta bekleyen parça kalmadığı için düştü.
  5: [
    { id: "kesme", name: "Kesme", servers: 2, utilization: 0.71, queue: 2, scrapPerThousand: 5 },
    { id: "torna", name: "Torna", servers: 3, utilization: 0.78, queue: 3, scrapPerThousand: 31 },
    { id: "kaynak", name: "Kaynak", servers: 3, utilization: 0.73, queue: 2, scrapPerThousand: 7 },
    { id: "boyama", name: "Boyama", servers: 1, utilization: 0.55, queue: 1, scrapPerThousand: 3 },
  ],
};

/** Hattın dakikadaki çıktısı; aşama ilerledikçe önce düşer, sonra toparlar. */
const THROUGHPUT_PER_MINUTE: Record<DemoPhase, number> = {
  1: 1.62,
  2: 1.48,
  3: 1.21,
  4: 1.19,
  5: 1.87,
};

/* -------------------------------------------------------------------------- */
/* Koşum                                                                       */
/* -------------------------------------------------------------------------- */

/** Demo fabrikasının modeli — hazır metal şablonu. */
export function demoConfig(): SimulationConfig {
  return {
    ...metalTemplate,
    simulation_duration_minutes: DEMO_WINDOW_MINUTES,
    warmup_period_minutes: 60,
    num_replications: 30,
  };
}

function buildStation(
  profile: StationProfile,
  entered: number,
  isBottleneck: boolean,
): StationMetricsResponse {
  const scrapped = Math.round((entered * profile.scrapPerThousand) / 1000);
  // Tampon dolduğu için geri çevrilen parçalar yalnızca kuyruk uzunken olur.
  const rejected = profile.queue >= 10 ? Math.round(entered * 0.012) : 0;
  const completed = entered - scrapped - rejected;

  /*
   * OEE bileşenleri ölçülmüş değerlerden türetilir: kullanılabilirlik
   * doluluğun bir fonksiyonu, kalite fire oranının tümleyeni. Üçü bağımsız
   * uydurulsaydı, çarpımları istasyon tablosundaki OEE ile tutmazdı.
   */
  const availability = Math.min(0.99, 0.9 - profile.queue * 0.004);
  const performance = Math.min(0.99, 0.72 + profile.utilization * 0.22);
  const quality = 1 - profile.scrapPerThousand / 1000;

  return {
    station_id: profile.id,
    station_name: profile.name,
    utilization: profile.utilization,
    avg_queue_length: profile.queue,
    // Kuyruktaki her parça bir çevrim kadar bekletir; kaba ama tutarlı.
    avg_wait_time: round1(profile.queue * 2.4),
    oee: {
      availability: round3(availability),
      performance: round3(performance),
      quality: round3(quality),
      oee: round3(availability * performance * quality),
    },
    is_bottleneck: isBottleneck,
    flow: { entered, completed, scrapped, rejected },
  };
}

/** Bir aşamanın koşum sonucu. */
export function demoResults(phase: DemoPhase): SimulationResults {
  const profiles = PROFILES[phase];
  const throughput = THROUGHPUT_PER_MINUTE[phase];
  const totalThroughput = Math.round(throughput * DEMO_WINDOW_MINUTES);

  // Hatta giren parça, çıkan parçadan fire ve ret kadar fazladır; her istasyon
  // kendinden öncekinin çıktısını alır.
  const entered = Math.round(totalThroughput * 1.09);

  const busiest = profiles.reduce((max, item) =>
    item.utilization > max.utilization ? item : max,
  );

  const stations = profiles.map((profile) =>
    buildStation(profile, entered, profile.id === busiest.id),
  );

  const lineOee =
    stations.reduce((sum, station) => sum + station.oee.oee, 0) / stations.length;

  /*
   * WIP ve akış süresi Little Yasası ile bağlıdır (L = λ·W). Akış süresi
   * bağımsız uydurulsaydı, doğrulama paneli kendi verimizde "geçmedi" derdi.
   */
  const wip =
    profiles.reduce(
      (sum, item) => sum + item.queue + item.utilization * item.servers,
      0,
    );
  const flowTime = wip / throughput;

  const isStable = phase < 3 || phase === 5;

  return {
    total_throughput: totalThroughput,
    confidence_interval_95: [
      Math.round(totalThroughput * 0.97),
      Math.round(totalThroughput * 1.03),
    ],
    station_metrics: stations,
    bottleneck_station_id: busiest.id,
    littles_law_validation: {
      passed: true,
      deviation_pct: 0.4,
      tolerance_pct: 5,
      replications_checked: 30,
      replications_passed: 30,
    },
    num_replications: 30,
    is_stable: isStable,
    avg_wip: round1(wip),
    avg_flow_time: round1(flowTime),
    throughput_per_minute: throughput,
    line_oee: round3(lineOee),
    // Teorik sınır: en dolu istasyon %100 çalışsaydı hat ne üretirdi.
    theoretical_max_throughput_per_minute: round2(throughput / busiest.utilization),
  };
}

/** Koşum yanıtı; uyarılar aşamaya göre değişir. */
export function demoRun(phase: DemoPhase): SimulationRunResponse {
  const results = demoResults(phase);
  const warnings: string[] = [];

  if (!results.is_stable) {
    warnings.push(
      "Sistem kararsız: Torna istasyonunda bekleyen iş miktarı zamanla artıyor.",
    );
  }
  if (phase === 5) {
    warnings.push(
      "Kapasite sınırlı: hat teorik üst sınırına yaklaştı, kısıt artık dışarıda.",
    );
  }

  return {
    simulation_id: `demo-run-${phase}`,
    status: "completed",
    results,
    master_seed: 20260904,
    duration_seconds: 3.8,
    warnings,
    headline: phaseHeadline(phase),
  };
}

function phaseHeadline(phase: DemoPhase): string {
  switch (phase) {
    case 1:
      return "Hat dengeli çalışıyor; belirgin bir kısıt yok.";
    case 2:
      return "Torna önünde iş birikiyor; doluluk yükseliyor.";
    case 3:
      return "Torna kısıta dönüştü ve hat kararsız hâle geldi.";
    case 4:
      return "Kaybın parasal karşılığı hesaplandı; öncelikli aksiyon hazır.";
    case 5:
      return "Torna'ya üçüncü tezgâh eklendi; kuyruk eridi ve çıktı arttı.";
  }
}

/* -------------------------------------------------------------------------- */
/* Finans                                                                      */
/* -------------------------------------------------------------------------- */

/** Bir aşamanın finansal etkisi. */
export function demoReport(phase: DemoPhase): FinancialReport {
  const results = demoResults(phase);
  const stations = results.station_metrics;

  /*
   * Kayıp, istasyonun **boşa geçen** kapasitesinden ve firesinden türetilir.
   * Sabit bir tutar yazılsaydı, aşama ilerledikçe kayıp ile hattın hâli
   * arasındaki bağ kopardı: kuyruk büyürken kayıp sabit kalırdı.
   */
  const perStation = stations.map((station) => {
    const waiting = Math.round(station.avg_wait_time * 340);
    const downtime = Math.round((1 - station.oee.availability) * 9_000);
    const scrap = Math.round(station.flow.scrapped * 26);
    const opportunity = Math.round(station.flow.rejected * 34);
    return {
      station_id: station.station_id,
      station_name: station.station_name,
      downtime_loss: downtime,
      waiting_loss: waiting,
      scrap_loss: scrap,
      opportunity_loss: opportunity,
      total_loss: downtime + waiting + scrap + opportunity,
      is_bottleneck: station.is_bottleneck,
    };
  });

  const sum = (pick: (item: (typeof perStation)[number]) => number) =>
    perStation.reduce((total, item) => total + pick(item), 0);

  const downtime = sum((item) => item.downtime_loss);
  const waiting = sum((item) => item.waiting_loss);
  const scrap = sum((item) => item.scrap_loss);
  const opportunity = sum((item) => item.opportunity_loss);
  const total = downtime + waiting + scrap + opportunity;

  const worst = perStation.reduce((max, item) =>
    item.total_loss > max.total_loss ? item : max,
  );
  const heatCells = buildHeatCells(perStation, worst.total_loss);

  return {
    impact: {
      downtime_loss: downtime,
      waiting_loss: waiting,
      scrap_loss: scrap,
      opportunity_loss: opportunity,
      total_loss: total,
      confidence: 0.82,
      data_completeness: 1,
      components: [
        component("downtime_loss", "Duruş kaybı", downtime, 42, "dk", "Arıza ve bakım süresi"),
        component("waiting_loss", "Bekleme kaybı", waiting, waitMinutes(stations), "dk", "Kuyrukta geçen süre"),
        component("scrap_loss", "Hurda kaybı", scrap, scrapCount(stations), "adet", "Hurdaya ayrılan parça"),
        component("opportunity_loss", "Fırsat kaybı", opportunity, rejectCount(stations), "adet", "Tampon dolu olduğu için alınamayan parça"),
      ],
      missing_inputs: [],
      notes: [],
    },
    stations: [...perStation].sort((a, b) => b.total_loss - a.total_loss),
    // Öneriler dördüncü dakikada belirir: demo o dakikada "ne yapmalıyım"
    // sorusuna geçer.
    suggestions:
      phase < 4
        ? []
        : [
            {
              station_id: worst.station_id,
              station_name: worst.station_name,
              dominant_loss: "waiting_loss",
              recoverable_amount: Math.round(worst.total_loss * 0.62),
              action: "Torna'ya üçüncü tezgâhı ekleyin ya da çevrim süresini kısaltın.",
              rationale:
                "Kaybın büyük bölümü bu istasyonun önünde bekleyen parçalardan geliyor.",
            },
          ],
    recoverable_loss: Math.round(total * 0.48),
    daily_loss: Math.round((total / DEMO_WINDOW_MINUTES) * 480),
    window_minutes: DEMO_WINDOW_MINUTES,
    heat: heatCells,
    // Isı sıralaması görecelidir; bu liste **tutara** göre sıralanır ve
    // Finans ekranındaki "en çok kaybeden" panelini besler. Boş bırakılsaydı
    // demo, o paneli "maliyet oranları girilmedi" boş durumuyla gösterirdi.
    top_loss_stations: [...heatCells]
      .sort((a, b) => b.total_loss - a.total_loss)
      .slice(0, 3),
  };
}

/** Isı hücrelerini istasyon kayıplarından türetir. */
function buildHeatCells(
  perStation: {
    station_id: string;
    station_name: string;
    total_loss: number;
    is_bottleneck: boolean;
  }[],
  worstLoss: number,
) {
  return perStation
      .map((item) => ({
        station_id: item.station_id,
        station_name: item.station_name,
        score: Math.round((item.total_loss / worstLoss) * 100),
        band: bandFor(item.total_loss / worstLoss),
        components: [],
        total_loss: item.total_loss,
        is_bottleneck: item.is_bottleneck,
        // Skorlar bu koşumdaki en kötü istasyona göre ölçekleniyor.
        is_relative: true,
      }))
      .sort((a, b) => b.score - a.score);
}

function component(
  name: string,
  label: string,
  amount: number,
  quantity: number,
  unit: string,
  basis: string,
) {
  return {
    name,
    label,
    amount,
    provenance: "calculated" as const,
    quantity,
    quantity_unit: unit,
    rate_name: name,
    rate_value: null,
    is_available: true,
    basis,
  };
}

function bandFor(share: number): "green" | "yellow" | "orange" | "red" {
  if (share >= 0.75) return "red";
  if (share >= 0.5) return "orange";
  if (share >= 0.25) return "yellow";
  return "green";
}

const waitMinutes = (stations: StationMetricsResponse[]) =>
  round1(stations.reduce((sum, item) => sum + item.avg_wait_time, 0));
const scrapCount = (stations: StationMetricsResponse[]) =>
  stations.reduce((sum, item) => sum + item.flow.scrapped, 0);
const rejectCount = (stations: StationMetricsResponse[]) =>
  stations.reduce((sum, item) => sum + item.flow.rejected, 0);

/* -------------------------------------------------------------------------- */
/* Koşum geçmişi ve karşılaştırma                                              */
/* -------------------------------------------------------------------------- */

/**
 * Demo koşum geçmişi.
 *
 * Tarayıcı deposuna **hiç dokunmaz**: demo, kullanıcının gerçek geçmişini ne
 * okur ne de yazar. Aksi hâlde bir satış demosu, müşterinin kendi koşum
 * listesini sahte kayıtlarla kirletirdi.
 */
export function demoRunHistory(phase: DemoPhase, now: Date): RunHistoryEntry[] {
  const entries: RunHistoryEntry[] = [];

  for (let step = phase; step >= 1; step -= 1) {
    const results = demoResults(step as DemoPhase);
    const bottleneck = results.station_metrics.find((item) => item.is_bottleneck);
    entries.push({
      simulationId: `demo-run-${step}`,
      factoryId: "demo-factory",
      factoryName: DEMO_FACTORY_NAME,
      // Her aşama bir dakika önce koşulmuş sayılır.
      ranAt: new Date(now.getTime() - (phase - step) * 60_000).toISOString(),
      throughput: results.total_throughput,
      oee: results.line_oee,
      bottleneckName: bottleneck?.station_name ?? null,
      isStable: results.is_stable,
      stationCount: results.station_metrics.length,
      durationSeconds: 3.8,
    });
  }

  return entries;
}

export interface DemoComparisonRow {
  label: string;
  before: string;
  after: string;
  /** İyileşme mi? Renk ve ok yönü için. */
  improved: boolean;
}

/**
 * Beşinci dakikadaki önce/sonra karşılaştırması.
 *
 * "Önce", önerinin çıktığı andır (dördüncü aşama); "sonra" iyileştirmenin
 * uygulandığı hâl. İkisi de demonun kendi verisinden okunur — elle yazılmış
 * bir "önce" değeri, ekranın geri kalanıyla çelişirdi.
 */
export function demoComparison(): DemoComparisonRow[] {
  const before = demoResults(4);
  const after = demoResults(5);
  const beforeReport = demoReport(4);
  const afterReport = demoReport(5);

  const queueOf = (results: SimulationResults) =>
    results.station_metrics.reduce((max, item) => Math.max(max, item.avg_queue_length), 0);

  return [
    {
      label: "Çıktı",
      before: `${before.throughput_per_minute.toFixed(2).replace(".", ",")} parça/dk`,
      after: `${after.throughput_per_minute.toFixed(2).replace(".", ",")} parça/dk`,
      improved: after.throughput_per_minute > before.throughput_per_minute,
    },
    {
      label: "Hat OEE",
      before: `%${Math.round(before.line_oee * 100)}`,
      after: `%${Math.round(after.line_oee * 100)}`,
      improved: after.line_oee > before.line_oee,
    },
    {
      label: "En uzun kuyruk",
      before: `${queueOf(before)} parça`,
      after: `${queueOf(after)} parça`,
      improved: queueOf(after) < queueOf(before),
    },
    {
      label: "Vardiya kaybı",
      before: `₺${beforeReport.impact.total_loss.toLocaleString("tr-TR")}`,
      after: `₺${afterReport.impact.total_loss.toLocaleString("tr-TR")}`,
      improved: afterReport.impact.total_loss < beforeReport.impact.total_loss,
    },
  ];
}

/* -------------------------------------------------------------------------- */

/** Bir aşamanın ekranlara verilecek tüm verisi. */
export interface DemoSnapshot {
  config: SimulationConfig;
  run: SimulationRunResponse;
  report: FinancialReport;
  runHistory: RunHistoryEntry[];
  comparison: DemoComparisonRow[] | null;
}

export function demoSnapshot(phase: DemoPhase, now: Date): DemoSnapshot {
  return {
    config: demoConfig(),
    run: demoRun(phase),
    report: demoReport(phase),
    runHistory: demoRunHistory(phase, now),
    // Karşılaştırma yalnızca son aşamada anlamlıdır; öncesinde "sonra" diye
    // bir şey henüz yoktur.
    comparison: phase === 5 ? demoComparison() : null,
  };
}

/* -------------------------------------------------------------------------- */

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
