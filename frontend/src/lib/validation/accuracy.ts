/**
 * Doğruluk motoru — modelin sahayı ne kadar tutturduğu.
 *
 * Formüllerin tamamı bu dosyada, açık sabitler hâlinde durur. Bileşenlerde tek
 * bir eşik ya da katsayı yoktur: "%94 uyumlu" cümlesi müşteriye gösterilen bir
 * iddiadır ve nereden geldiği tek bir yerden okunabilmelidir.
 *
 * Referans **gerçektir**
 * ----------------------
 * Sapma, gerçeğe bölünerek hesaplanır: (gerçek − simülasyon) / gerçek. Modele
 * bölmek, modelin kendi hatasını küçültmesine yol açardı — çevrim süresini
 * olduğundan kısa tahmin eden bir model, paydası küçüldüğü için daha "doğru"
 * görünürdü. Doğrulamanın amacı modeli aklamak değil, sahaya göre ölçmektir.
 *
 * Ölçülmeyen hiçbir şey hesaba girmez
 * -----------------------------------
 * Girilmemiş bir alan `null`'dır; ne sıfır sayılır ne de ortalamayı böler.
 * Bir istasyon için yalnızca çevrim süresi girildiyse, o istasyonun doğruluğu
 * yalnızca çevrim süresinden gelir ve kaç ölçüte dayandığı `measuredCount`
 * alanında görünür.
 */

import { meanServiceTime } from "../configDefaults";
import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  METRIC_ORDER,
  type AccuracyBand,
  type AccuracyGap,
  type MetricComparison,
  type RealDataSet,
  type RealStationMeasurement,
  type SimulatedStation,
  type StationValidation,
  type ValidationMetric,
  type ValidationSummary,
} from "./types";

/**
 * Ölçütlerin genel doğruluktaki ağırlıkları.
 *
 * Çevrim süresi ve üretim daha ağırdır çünkü modelin iş yapan çekirdeği
 * bunlardır: ikisi tutuyorsa kapasite tahmini tutar. Bekleme ve fire türev
 * büyüklüklerdir — bunlardaki sapma çoğu zaman ilk ikisinin sonucudur ve iki
 * kez cezalandırılmamalıdır.
 *
 * Ölçülmeyen bir ölçütün ağırlığı kalanlara dağıtılır (bkz. `weightedMean`).
 */
export const METRIC_WEIGHTS: Record<ValidationMetric, number> = {
  cycleTime: 0.35,
  throughput: 0.35,
  queue: 0.15,
  scrap: 0.15,
};

/**
 * Doğruluğun renk bantları.
 *
 * %10'a kadar sapma üretim planlamasında kabul edilebilir sayılır; %25 üzeri
 * sapma modelin o istasyonu yanlış kurduğu anlamına gelir ve kırmızıdır.
 */
export const BAND_THRESHOLDS = {
  /** Bu doğruluğun üstü yeşil. */
  good: 0.9,
  /** Bu doğruluğun üstü turuncu, altı kırmızı. */
  warning: 0.75,
} as const;

/**
 * Doğruluğu sıfırlayan sapma.
 *
 * Sapma %100'ü aştığında (model gerçeğin iki katını söylüyorsa) doğruluk zaten
 * yoktur; daha büyük sapmaların ortalamayı eksiye çekmesi engellenir, aksi
 * hâlde tek bir hatalı satır tüm raporu anlamsız bir negatif sayıya çevirirdi.
 */
export const MAX_ERROR_RATIO = 1;

/** Bir ölçümün geçerli sayılması için gereken en küçük pozitif değer. */
const EPSILON = 1e-9;

/* -------------------------------------------------------------------------- */
/* Modelden okunan değerler                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Simülasyonun istatistik penceresi (dk).
 *
 * Motor, ısınma süresi bittiğinde tüm sayaçları sıfırlar
 * (`engine._handle_warmup_end`); dolayısıyla dönen parça sayıları yalnızca
 * ısınma sonrası pencereye aittir. Üretim hızını toplam süreye bölmek, çıktıyı
 * sistematik olarak düşük gösterirdi.
 */
export function observationWindowMinutes(config: SimulationConfig): number {
  return Math.max(
    config.simulation_duration_minutes - config.warmup_period_minutes,
    0,
  );
}

/**
 * Model çıktısını gerçeğin ölçeğine getirir.
 *
 * Çevrim süresi sonuçlardan değil **modelden** okunur: motor istasyon başına
 * işlem süresi döndürmez, döndürdüğü şey o sürenin sonuçlarıdır (doluluk,
 * kuyruk). Doğrulamanın sorduğu soru da tam olarak budur — modele girilen
 * servis süresi sahadaki gerçek çevrim süresine uyuyor mu?
 */
export function simulatedStations(
  config: SimulationConfig | null,
  results: SimulationResults | null,
): SimulatedStation[] {
  if (config === null || results === null) {
    return [];
  }

  const window = observationWindowMinutes(config);
  const metricsById = new Map(
    results.station_metrics.map((item) => [item.station_id, item]),
  );

  return config.stations.map((station) => {
    const metrics = metricsById.get(station.id) ?? null;
    const service = meanServiceTime(station);
    const entered = metrics?.flow.entered ?? 0;

    return {
      stationId: station.id,
      stationName: station.name,
      cycleTimeMinutes: service > EPSILON ? service : null,
      throughputPerMinute:
        metrics !== null && window > EPSILON
          ? metrics.flow.completed / window
          : null,
      // Sıfır bekleme gerçek bir ölçümdür (kuyruk hiç oluşmamış); `null`
      // yalnızca istasyonun sonuçlarda bulunmadığı durumdur.
      waitMinutes: metrics?.avg_wait_time ?? null,
      scrapRatio:
        metrics !== null && entered > EPSILON
          ? metrics.flow.scrapped / entered
          : null,
      machineCount: station.num_servers,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Gerçek veriden türetilen değerler                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sahadan girilen değerleri ölçüt ölçeğine çevirir.
 *
 * Üretim adedi, ölçüm penceresi bilinmeden hıza çevrilemez; vardiya süresi
 * girilmemişse üretim ölçütü ölçülmemiş sayılır. Fire oranının paydası
 * "işlenen toplam parça"dır (sağlam + hurda): yalnızca hurda adedi bilindiğinde
 * bir oran üretilemez.
 */
export function realMetricValue(
  measurement: RealStationMeasurement,
  metric: ValidationMetric,
  shiftMinutes: number | null,
): number | null {
  switch (metric) {
    case "cycleTime":
      return positive(measurement.cycleTimeMinutes);

    case "throughput": {
      const produced = nonNegative(measurement.producedUnits);
      if (produced === null || shiftMinutes === null || shiftMinutes <= 0) {
        return null;
      }
      return produced / shiftMinutes;
    }

    case "queue":
      return nonNegative(measurement.waitMinutes);

    case "scrap": {
      const scrap = nonNegative(measurement.scrapUnits);
      const produced = nonNegative(measurement.producedUnits);
      if (scrap === null || produced === null) {
        return null;
      }
      const processed = scrap + produced;
      return processed > EPSILON ? scrap / processed : null;
    }
  }
}

/** Modelden okunan değerin ölçüt karşılığı. */
export function simulatedMetricValue(
  station: SimulatedStation,
  metric: ValidationMetric,
): number | null {
  switch (metric) {
    case "cycleTime":
      return station.cycleTimeMinutes;
    case "throughput":
      return station.throughputPerMinute;
    case "queue":
      return station.waitMinutes;
    case "scrap":
      return station.scrapRatio;
  }
}

/* -------------------------------------------------------------------------- */
/* Karşılaştırma                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tek bir ölçütün sapması ve doğruluğu.
 *
 * Gerçek değer sıfırken oran tanımsızdır; iki durum ayrılır: model de sıfır
 * diyorsa sapma yoktur (fire hiç olmamış, model de olmayacağını söylemiş),
 * model sıfırdan farklı bir şey diyorsa sapma tavana yazılır — "sonsuz sapma"
 * yerine tanımlı bir üst sınır kullanmak, ortalamayı bozulmaktan korur.
 */
export function compareMetric(
  metric: ValidationMetric,
  simulated: number | null,
  real: number | null,
): MetricComparison {
  if (
    simulated === null ||
    real === null ||
    !Number.isFinite(simulated) ||
    !Number.isFinite(real)
  ) {
    return { metric, simulated, real, errorRatio: null, accuracy: null };
  }

  let errorRatio: number;
  if (Math.abs(real) <= EPSILON) {
    errorRatio =
      Math.abs(simulated) <= EPSILON ? 0 : -MAX_ERROR_RATIO * Math.sign(simulated || 1);
  } else {
    errorRatio = (real - simulated) / real;
  }

  const accuracy = Math.max(
    0,
    1 - Math.min(Math.abs(errorRatio), MAX_ERROR_RATIO),
  );

  return { metric, simulated, real, errorRatio, accuracy };
}

/** Doğruluğun renk bandı. */
export function bandOf(accuracy: number | null): AccuracyBand | null {
  if (accuracy === null) {
    return null;
  }
  if (accuracy >= BAND_THRESHOLDS.good) {
    return "good";
  }
  return accuracy >= BAND_THRESHOLDS.warning ? "warning" : "bad";
}

/**
 * Ölçülen ölçütlerin ağırlıklı ortalaması.
 *
 * Ölçülmeyen ölçütün ağırlığı kalanlara **yeniden dağıtılır**. Sabit ağırlıkla
 * bölünseydi, yalnızca çevrim süresi ölçülmüş bir istasyonun doğruluğu en
 * fazla %35 çıkardı — ölçülmemiş olmak, yanlış olmakla aynı şeye indirgenirdi.
 */
function weightedMean(
  entries: { weight: number; value: number | null }[],
): number | null {
  let total = 0;
  let weight = 0;
  for (const entry of entries) {
    if (entry.value === null) {
      continue;
    }
    total += entry.value * entry.weight;
    weight += entry.weight;
  }
  return weight > EPSILON ? total / weight : null;
}

/**
 * Tüm karşılaştırmayı kurar.
 *
 * Yalnızca modelde bulunan istasyonlar değerlendirilir; sahadan gelen ama
 * modelde karşılığı olmayan bir satır sessizce atılmaz, hiç eşleşmediği için
 * `stationId`'si zaten `null`'dır ve arayüz bunu ayrıca gösterir.
 */
export function buildValidation(
  config: SimulationConfig | null,
  results: SimulationResults | null,
  data: RealDataSet,
): ValidationSummary {
  const simulated = simulatedStations(config, results);
  const realById = new Map(
    data.stations
      .filter((item) => item.stationId !== null)
      .map((item) => [item.stationId as string, item]),
  );

  const stations: StationValidation[] = simulated.map((station) => {
    const measurement = realById.get(station.stationId) ?? null;

    const metrics = {} as Record<ValidationMetric, MetricComparison>;
    let measuredCount = 0;

    for (const metric of METRIC_ORDER) {
      const comparison = compareMetric(
        metric,
        simulatedMetricValue(station, metric),
        measurement === null
          ? null
          : realMetricValue(measurement, metric, data.shiftMinutes),
      );
      metrics[metric] = comparison;
      if (comparison.accuracy !== null) {
        measuredCount += 1;
      }
    }

    const accuracy = weightedMean(
      METRIC_ORDER.map((metric) => ({
        weight: METRIC_WEIGHTS[metric],
        value: metrics[metric].accuracy,
      })),
    );

    return {
      stationId: station.stationId,
      stationName: station.stationName,
      metrics,
      accuracy,
      band: bandOf(accuracy),
      measuredCount,
    };
  });

  /* --- Ölçüt bazında doğruluk --- */
  const metricAccuracy = {} as Record<ValidationMetric, number | null>;
  for (const metric of METRIC_ORDER) {
    const values = stations
      .map((station) => station.metrics[metric].accuracy)
      .filter((value): value is number => value !== null);
    metricAccuracy[metric] =
      values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const overallAccuracy = weightedMean(
    METRIC_ORDER.map((metric) => ({
      weight: METRIC_WEIGHTS[metric],
      value: metricAccuracy[metric],
    })),
  );

  return {
    stations,
    metricAccuracy,
    overallAccuracy,
    ...extremes(stations),
    biggestGap: biggestGap(stations),
    stationCount: simulated.length,
    measuredStationCount: stations.filter((item) => item.measuredCount > 0)
      .length,
    measuredPointCount: stations.reduce(
      (sum, station) => sum + station.measuredCount,
      0,
    ),
    shiftMinutes: data.shiftMinutes,
  };
}

/**
 * En doğru ve en sapan istasyon.
 *
 * Hepsi aynı doğruluktaysa ikisi de `null` döner: aynı istasyonu hem "en
 * doğru" hem "en sapan" diye göstermek ya da eşitler arasından rastgele birini
 * seçip işaretlemek, olmayan bir farkı varmış gibi anlatmak olurdu.
 */
function extremes(stations: StationValidation[]): {
  bestStation: StationValidation | null;
  worstStation: StationValidation | null;
} {
  const measured = stations.filter(
    (station): station is StationValidation & { accuracy: number } =>
      station.accuracy !== null,
  );
  if (measured.length < 2) {
    return { bestStation: null, worstStation: null };
  }

  const sorted = [...measured].sort((a, b) => b.accuracy - a.accuracy);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return best.accuracy === worst.accuracy
    ? { bestStation: null, worstStation: null }
    : { bestStation: best, worstStation: worst };
}

/** Mutlak değerce en büyük sapma. */
function biggestGap(stations: StationValidation[]): AccuracyGap | null {
  let gap: AccuracyGap | null = null;

  for (const station of stations) {
    for (const metric of METRIC_ORDER) {
      const { errorRatio } = station.metrics[metric];
      if (errorRatio === null) {
        continue;
      }
      if (gap === null || Math.abs(errorRatio) > Math.abs(gap.errorRatio)) {
        gap = {
          stationId: station.stationId,
          stationName: station.stationName,
          metric,
          errorRatio,
        };
      }
    }
  }

  return gap;
}

/* -------------------------------------------------------------------------- */

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > EPSILON
    ? value
    : null;
}

function nonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}
