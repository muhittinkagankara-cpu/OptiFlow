/**
 * Doğrulama katmanının şeması — simülasyon ile sahadan ölçülen gerçeğin
 * karşılaştırılması.
 *
 * Buradaki tiplerin tek bir kuralı vardır: **ölçülmemiş bir değer sıfır
 * değildir.** Girilmeyen her alan `null` taşır ve hesap dışında kalır. Bir
 * doğruluk raporunun en tehlikeli hatası, girilmemiş bir fire alanını "%0 fire"
 * sayıp modelin sapmasını olduğundan büyük göstermektir; müşteriye gösterilen
 * "%94 uyumlu" cümlesi ancak bu kural işlediğinde dürüsttür.
 *
 * Ölçüm birimleri tek yerde sabitlenmiştir ve katman boyunca değişmez: süreler
 * **dakika**, hızlar **parça/dakika**, oranlar **0-1** arasıdır. Arayüz istediği
 * birime çevirir; hesap hep aynı ölçekte kalır.
 */

/** Karşılaştırılan dört ölçüt. */
export type ValidationMetric = "cycleTime" | "throughput" | "queue" | "scrap";

/** Ölçütlerin sabit sırası — tablo, grafik ve rapor aynı sırayı kullanır. */
export const METRIC_ORDER: ValidationMetric[] = [
  "cycleTime",
  "throughput",
  "queue",
  "scrap",
];

export const METRIC_LABEL: Record<ValidationMetric, string> = {
  cycleTime: "Çevrim süresi",
  throughput: "Üretim",
  queue: "Bekleme",
  scrap: "Fire",
};

/** Ölçütün birimi; ekranda ve raporda değerin yanında yazar. */
export const METRIC_UNIT: Record<ValidationMetric, string> = {
  cycleTime: "dk/parça",
  throughput: "parça/dk",
  queue: "dk",
  scrap: "oran",
};

/**
 * Bir istasyondan sahada ölçülen değerler.
 *
 * `stationId` modeldeki istasyonla eşleşmeyi taşır. Eşleşme kurulamadıysa
 * `null`'dır ve o satır karşılaştırmaya girmez — adı benzeyen bir istasyonu
 * tahminle eşleştirmek, kullanıcının fark etmediği yanlış bir doğruluk
 * üretirdi.
 */
export interface RealStationMeasurement {
  stationId: string | null;
  stationName: string;
  /** Bir parçanın istasyonda geçirdiği işlem süresi (dk). */
  cycleTimeMinutes: number | null;
  /** Ölçüm penceresinde tamamlanan sağlam parça sayısı. */
  producedUnits: number | null;
  /** Parça başına ortalama bekleme (dk). */
  waitMinutes: number | null;
  /** Ölçüm penceresinde hurdaya ayrılan parça sayısı. */
  scrapUnits: number | null;
  /** Vardiyada istasyonda çalışan operatör sayısı. */
  operatorCount: number | null;
  /** Sahadaki makine sayısı; modeldeki sunucu sayısıyla karşılaştırılır. */
  machineCount: number | null;
}

/** Tek bir ölçüm oturumu: bir vardiyada toplanan tüm istasyon verileri. */
export interface RealDataSet {
  /**
   * Ölçümün kaç dakikalık pencerede toplandığı.
   *
   * Üretim adedini hıza çevirmek için zorunludur: 400 parça sekiz saatte de bir
   * saatte de üretilmiş olabilir. Girilmediğinde üretim karşılaştırması yapılmaz,
   * diğer ölçütler yapılmaya devam eder.
   */
  shiftMinutes: number | null;
  /** Ölçümün alındığı an (ISO 8601). */
  measuredAt: string;
  stations: RealStationMeasurement[];
}

/**
 * Boş bir ölçüm satırı.
 *
 * Şemayla birlikte durur: form her istasyon için bir satır açar ve tüm alanlar
 * `null` başlar. Sıfırla başlatılsaydı, kullanıcı dokunmadığı alanlar "ölçtük,
 * sıfır çıktı" anlamına gelir ve doğruluk daha ilk açılışta yanlış hesaplanırdı.
 */
export function emptyMeasurement(
  stationId: string,
  stationName: string,
): RealStationMeasurement {
  return {
    stationId,
    stationName,
    cycleTimeMinutes: null,
    producedUnits: null,
    waitMinutes: null,
    scrapUnits: null,
    operatorCount: null,
    machineCount: null,
  };
}

/** Modeldeki istasyonlar için boş bir ölçüm oturumu. */
export function blankRealData(
  stations: { id: string; name: string }[],
  measuredAt: Date,
): RealDataSet {
  return {
    shiftMinutes: null,
    measuredAt: measuredAt.toISOString(),
    stations: stations.map((station) =>
      emptyMeasurement(station.id, station.name),
    ),
  };
}

/** Modelden okunan, gerçekle aynı ölçeğe getirilmiş istasyon değerleri. */
export interface SimulatedStation {
  stationId: string;
  stationName: string;
  cycleTimeMinutes: number | null;
  throughputPerMinute: number | null;
  waitMinutes: number | null;
  scrapRatio: number | null;
  machineCount: number;
}

/** Tek bir ölçütün karşılaştırması. */
export interface MetricComparison {
  metric: ValidationMetric;
  simulated: number | null;
  real: number | null;
  /**
   * İşaretli göreli sapma: (gerçek − simülasyon) / gerçek.
   *
   * İşaret bilinçli olarak korunur: modelin fazla mı yoksa eksik mi tahmin
   * ettiği, ne kadar saptığı kadar önemlidir. "Çevrim süresi %18 uzun" ile
   * "%18 kısa" farklı iki müdahale demektir.
   */
  errorRatio: number | null;
  /** 1 − |sapma|, 0'ın altına düşmez. Ölçülmemişse `null`. */
  accuracy: number | null;
}

/** Bir sapmanın renk bandı. */
export type AccuracyBand = "good" | "warning" | "bad";

export interface StationValidation {
  stationId: string;
  stationName: string;
  metrics: Record<ValidationMetric, MetricComparison>;
  /** Ölçülen ölçütlerin ağırlıklı doğruluğu; hiç ölçüm yoksa `null`. */
  accuracy: number | null;
  band: AccuracyBand | null;
  /** Bu istasyonda kaç ölçüt gerçekten ölçülmüş. */
  measuredCount: number;
}

/** En büyük sapmanın nerede olduğu. */
export interface AccuracyGap {
  stationId: string;
  stationName: string;
  metric: ValidationMetric;
  errorRatio: number;
}

export interface ValidationSummary {
  stations: StationValidation[];
  /** Ölçüt bazında doğruluk; o ölçüt hiç ölçülmemişse `null`. */
  metricAccuracy: Record<ValidationMetric, number | null>;
  /** Bütün ölçütlerin ağırlıklı ortalaması; hiç ölçüm yoksa `null`. */
  overallAccuracy: number | null;
  bestStation: StationValidation | null;
  worstStation: StationValidation | null;
  biggestGap: AccuracyGap | null;
  /** Modelde kaç istasyon var. */
  stationCount: number;
  /** Bunların kaçı için en az bir ölçüm girilmiş. */
  measuredStationCount: number;
  /** Toplam kaç ölçüt değeri girilmiş (istasyon × ölçüt). */
  measuredPointCount: number;
  /** Ölçümün toplandığı pencere (dk); girilmemişse `null`. */
  shiftMinutes: number | null;
}

/* -------------------------------------------------------------------------- */
/* Güven                                                                       */
/* -------------------------------------------------------------------------- */

export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Düşük güven",
};

/** Güven skorunun bileşenleri. */
export type ConfidenceFactor = "coverage" | "deviation" | "scale" | "duration";

/** Güven skorunu aşağı çeken tek bir neden. */
export interface ConfidenceReason {
  /** Kullanıcıya gösterilecek cümle. */
  text: string;
  factor: ConfidenceFactor;
}

export interface ConfidenceScore {
  /** 0-1 arası skor; hiç ölçüm yoksa `null`. */
  score: number | null;
  level: ConfidenceLevel | null;
  /** Bileşenlerin tek tek skorları; hangi eksiğin ne kadar düşürdüğü görünür. */
  parts: Record<ConfidenceFactor, number | null>;
  reasons: ConfidenceReason[];
}

/* -------------------------------------------------------------------------- */
/* Sebep analizi                                                               */
/* -------------------------------------------------------------------------- */

export type FindingTone = "good" | "warning" | "bad";

export interface ValidationFinding {
  id: string;
  stationId: string;
  stationName: string;
  metric: ValidationMetric;
  /** Sapmanın büyüklüğü; sıralama bunun üzerinden yapılır. */
  magnitude: number;
  tone: FindingTone;
  /** Ne olduğunu anlatan cümle. Yalnızca ölçülmüş sayılardan kurulur. */
  text: string;
  /** Ne yapılması gerektiği. */
  advice: string;
}

/* -------------------------------------------------------------------------- */
/* Zaman çizelgesi                                                             */
/* -------------------------------------------------------------------------- */

/** Kaydedilmiş tek bir doğrulama ölçümü. */
export interface ValidationSnapshot {
  id: string;
  /** Ölçümün ait olduğu fabrika; kaydedilmemiş modelde `null`. */
  factoryId: string | null;
  factoryName: string | null;
  /** Ölçümün alındığı an (ISO 8601). */
  measuredAt: string;
  overallAccuracy: number | null;
  confidenceScore: number | null;
  confidenceLevel: ConfidenceLevel | null;
  measuredStationCount: number;
  stationCount: number;
}

/** Ardışık ölçümler arasındaki değişim. */
export interface AccuracyTrend {
  direction: "up" | "down" | "flat" | "unknown";
  /** Son iki ölçüm arasındaki doğruluk farkı (0-1 ölçeğinde puan). */
  delta: number | null;
  first: ValidationSnapshot | null;
  last: ValidationSnapshot | null;
}
