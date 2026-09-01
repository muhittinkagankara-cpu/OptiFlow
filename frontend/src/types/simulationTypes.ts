/**
 * Backend Pydantic şemalarının TypeScript karşılıkları.
 *
 * Bu dosya `simulation_engine/models/schemas.py` ile birebir uyumlu tutulmalıdır.
 * Alan adları backend'in JSON çıktısıyla aynıdır (snake_case); TypeScript
 * tarafında camelCase'e çevirmemek bilinçli bir karardır — iki tarafta farklı
 * adlandırma kullanmak, her yeni alanda sessiz eşleme hatalarına yol açar.
 */

// --------------------------------------------------------------------------- //
// Girdi şemaları
// --------------------------------------------------------------------------- //

export type DistributionType =
  | "exponential"
  | "normal"
  | "triangular"
  | "constant"
  | "empirical";

/** Bir süre değişkeninin olasılık dağılımı. */
export interface Distribution {
  type: DistributionType;
  /**
   * Tipe göre değişen parametreler. Backend kanonik adlar bekler:
   * exponential -> mean, normal -> mean + std, triangular -> min/mode/max,
   * constant -> value, empirical -> values + method.
   *
   * Değer tipine `undefined` bilinçli olarak dahil edilmiştir: bir dağılımda
   * bulunmayan anahtar okunduğunda (ör. üstel dağılımda `std`) sonuç zaten
   * `undefined` olur. Bunu tipte gizlemek, okuma noktalarında sessizce `NaN`
   * üretilmesine yol açardı; açıkça belirtmek her okumada koruma yazmaya zorlar.
   */
  params: Record<string, number | number[] | string | undefined>;
}

/** Bir üretim istasyonu. */
export interface Station {
  id: string;
  name: string;
  num_servers: number;
  service_time_distribution: Distribution;
  /** Sunucu başına birim zamandaki arıza oranı; MTBF = 1 / failure_rate. */
  failure_rate?: number | null;
  repair_time_distribution?: Distribution | null;
  /** Kuyruk kapasitesi; sınırsız için -1. */
  buffer_capacity_before: number;
  /** İşlemi biten parçanın hurdaya ayrılma olasılığı (0-1). */
  scrap_rate: number;
}

/** İki istasyon arasındaki yönlendirme bağlantısı. */
export interface Connection {
  from_station_id: string;
  to_station_id: string;
  routing_probability: number;
}

/** Sisteme dışarıdan gelen parça akışı. */
export interface ArrivalProcess {
  distribution: Distribution;
  entry_station_id: string;
}

/** Tam bir simülasyon senaryosu. */
export interface SimulationConfig {
  stations: Station[];
  connections: Connection[];
  arrival_process: ArrivalProcess;
  simulation_duration_minutes: number;
  warmup_period_minutes: number;
  num_replications: number;
  random_seed?: number | null;
}

// --------------------------------------------------------------------------- //
// Çıktı şemaları
// --------------------------------------------------------------------------- //

export interface OEEComponentsResponse {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export interface StationMetricsResponse {
  station_id: string;
  station_name: string;
  utilization: number;
  avg_queue_length: number;
  avg_wait_time: number;
  oee: OEEComponentsResponse;
  is_bottleneck: boolean;
}

export interface LittlesLawValidationResponse {
  passed: boolean;
  deviation_pct: number;
  tolerance_pct: number;
  replications_checked: number;
  replications_passed: number;
}

export interface SimulationResults {
  total_throughput: number;
  /** [alt sınır, üst sınır] */
  confidence_interval_95: [number, number];
  station_metrics: StationMetricsResponse[];
  bottleneck_station_id: string;
  littles_law_validation: LittlesLawValidationResponse;
  num_replications: number;
  is_stable: boolean;
  avg_wip: number;
  avg_flow_time: number;
  throughput_per_minute: number;
  line_oee: number;
  theoretical_max_throughput_per_minute: number;
}

export interface SimulationRunResponse {
  simulation_id: string;
  status: "completed" | "failed";
  results: SimulationResults;
  master_seed: number;
  duration_seconds: number;
  warnings: string[];
  headline: string;
}

// --------------------------------------------------------------------------- //
// Arayüz tarafı yardımcı tipler
// --------------------------------------------------------------------------- //

/**
 * Simülasyon süresi seçenekleri.
 *
 * Kullanıcıya "dakika" gibi teknik bir kavram değil, sonucun ne kadar
 * güvenilir olacağını anlatan bir seçim sunulur.
 */
export type SimulationDepth = "quick" | "standard" | "detailed";

export interface SimulationDepthOption {
  id: SimulationDepth;
  label: string;
  description: string;
  simulation_duration_minutes: number;
  warmup_period_minutes: number;
  num_replications: number;
}

export const SIMULATION_DEPTH_OPTIONS: SimulationDepthOption[] = [
  {
    id: "quick",
    label: "Hızlı Test",
    description: "Birkaç saniye sürer. Modeli denemek için yeterli.",
    simulation_duration_minutes: 1000,
    warmup_period_minutes: 100,
    num_replications: 10,
  },
  {
    id: "standard",
    label: "Standart",
    description: "Önerilen ayar. Güvenilir sonuç, makul süre.",
    simulation_duration_minutes: 10000,
    warmup_period_minutes: 500,
    num_replications: 30,
  },
  {
    id: "detailed",
    label: "Detaylı",
    description: "En dar güven aralığı. Bir dakikadan uzun sürebilir.",
    simulation_duration_minutes: 100000,
    warmup_period_minutes: 5000,
    num_replications: 30,
  },
];

/** Sihirbazın "Direkt Çalıştır" düğmesinin kullandığı varsayılan ayar. */
export const DEFAULT_DEPTH: SimulationDepthOption = SIMULATION_DEPTH_OPTIONS[1];

/** İnsan tarafından okunabilir dağılım adları. */
export const DISTRIBUTION_LABELS: Record<DistributionType, string> = {
  constant: "Sabit",
  normal: "Normal Dağılım",
  triangular: "Üçgen Dağılım",
  exponential: "Üstel Dağılım",
  empirical: "Gerçek Veriden",
};

/**
 * Her dağılımın teknik olmayan kullanıcı için açıklaması.
 *
 * Parametre panelindeki (?) ipuçlarında gösterilir. Amaç, kullanıcının
 * "hangisini seçmeliyim?" sorusunu istatistik bilmeden yanıtlayabilmesidir.
 */
export const DISTRIBUTION_HELP: Record<DistributionType, string> = {
  constant:
    "Sabit süre: her parça tam olarak aynı sürede işlenir. Otomatik makineler ve robot hücreleri için uygundur.",
  normal:
    "Normal dağılım: işlem süreleri bir ortalama etrafında simetrik olarak dağılır; küçük sapmalar sık, büyük sapmalar nadirdir. Çoğu standart üretim süreci için uygundur.",
  triangular:
    "Üçgen dağılım: elinizde geçmiş veri yoksa kullanın. Sadece üç tahmin girersiniz — en hızlı, en olası ve en yavaş süre.",
  exponential:
    "Üstel dağılım: süreler çok değişkendir; kısa işler sık, uzun işler seyrek görülür. Arıza araları ve müşteri talebi gibi öngörülemeyen süreçler için uygundur.",
  empirical:
    "Gerçek veriden: sahada ölçtüğünüz süreleri doğrudan kullanır. En doğru seçenektir ancak yeterli sayıda ölçüm gerektirir.",
};

/** Sonsuz tampon kapasitesini ifade eden sentinel değer (backend ile aynı). */
export const INFINITE_CAPACITY = -1;

// --------------------------------------------------------------------------- //
// Doğrulama raporu şemaları — GET /api/simulations/{id}/validation-report
// --------------------------------------------------------------------------- //

/** Tek bir kapsam için L = lambda * W denetimi. */
export interface LittlesLawValidation {
  /** "system" veya istasyon kimliği. */
  scope: string;
  description: string;
  observed_l: number;
  predicted_l: number;
  arrival_rate: number;
  average_time: number;
  deviation_pct: number;
  tolerance_pct: number;
  passed: boolean;
  message: string;
}

export interface LittlesLawReport {
  system: LittlesLawValidation;
  stations: LittlesLawValidation[];
  passed: boolean;
  max_deviation_pct: number;
  messages: string[];
}

/** Analitik kuyruk modeli sonuçları (M/M/1 veya M/M/c). */
export interface QueueingMetrics {
  notation: string;
  arrival_rate: number;
  service_rate: number;
  num_servers: number;
  offered_load: number;
  utilization: number;
  is_stable: boolean;
  probability_system_empty: number;
  probability_of_waiting: number;
  l_system: number;
  l_queue: number;
  w_system: number;
  w_queue: number;
  warnings: string[];
}

/** Bir istasyonun kapalı form modelle karşılaştırması. */
export interface AnalyticalStationComparison {
  station_id: string;
  station_name: string;
  /** Kapalı form model bu istasyona uygulanabilir mi? */
  applicable: boolean;
  /** Uygulanabilir değilse gerekçesi (backend dilinde). */
  reason: string;
  analytical: QueueingMetrics | null;
  simulated_utilization: number;
  simulated_l_queue: number;
  simulated_w_queue: number;
  deviation_utilization_pct: number | null;
  deviation_l_queue_pct: number | null;
  deviation_w_queue_pct: number | null;
  passed: boolean | null;
}

/** Çalıştırma öncesi kararlılık denetimi. */
export interface StabilityCheck {
  is_stable: boolean;
  arrival_rate: number;
  station_loads: Record<string, number>;
  visit_ratios: Record<string, number>;
  unstable_station_ids: string[];
  /** rho >= 1 ama tampon sonlu: sistem kararlı, parça kaybı var. */
  capacity_limited_station_ids: string[];
  estimated_rejection_rates: Record<string, number>;
  messages: string[];
}

export interface ValidationReportResponse {
  simulation_id: string;
  tolerance_pct: number;
  passed: boolean;
  littles_law: LittlesLawReport;
  littles_law_summary: LittlesLawValidationResponse;
  queueing_comparisons: AnalyticalStationComparison[];
  stability: StabilityCheck;
  master_seed: number;
  replication_seeds: number[];
  reproducibility_note: string;
  summary: string;
}

// --------------------------------------------------------------------------- //
// Karşılaştırma şemaları — POST /api/simulations/compare
// --------------------------------------------------------------------------- //

export interface ScenarioComparisonRow {
  scenario_index: number;
  label: string;
  simulation_id: string;
  is_stable: boolean;
  total_throughput: number;
  throughput_ci_95: [number, number];
  avg_wip: number;
  avg_flow_time: number;
  bottleneck_station_id: string;
  bottleneck_utilization: number;
  line_oee: number;
  warnings: string[];
}

/**
 * İki senaryo arasındaki farkın istatistiksel değerlendirmesi.
 *
 * `is_significant` alanı arayüzde asla göz ardı edilmemelidir: anlamsız bir
 * farkı "iyileşme" gibi göstermek, kullanıcının rastgeleliğe dayanarak yatırım
 * kararı almasına yol açar.
 */
export interface PairwiseDifference {
  baseline_index: number;
  candidate_index: number;
  /** "units_produced" | "avg_flow_time" | "avg_wip" */
  metric: string;
  label: string;
  baseline_mean: number;
  candidate_mean: number;
  /** aday - referans */
  difference: number;
  difference_pct: number;
  ci_lower: number;
  ci_upper: number;
  is_significant: boolean;
  interpretation: string;
}

export interface ComparisonResponse {
  scenarios: ScenarioComparisonRow[];
  differences: PairwiseDifference[];
  best_scenario_index: number;
  best_scenario_rationale: string;
  total_duration_seconds: number;
}
