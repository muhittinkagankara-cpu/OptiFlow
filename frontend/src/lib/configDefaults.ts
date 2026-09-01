/**
 * Sihirbaz için config oluşturma ve kapasite ön kontrolü yardımcıları.
 *
 * Buradaki kapasite hesabı simülasyon değildir; kaba bir ön kontroldür.
 * Kullanıcı modelin tıkanacağını onay adımında, bir dakika beklemeden önce
 * görebilmelidir — asıl cevap her zaman simülasyondan gelir.
 */

import type { SimulationConfig, Station } from "../types/simulationTypes";
import { DEFAULT_DEPTH } from "../types/simulationTypes";

/** Sıfırdan başlayanlar için: istasyonu olmayan, geçerli varsayılanlı config. */
export function createBlankConfig(): SimulationConfig {
  return {
    stations: [],
    connections: [],
    arrival_process: {
      distribution: { type: "exponential", params: { mean: 5 } },
      entry_station_id: "",
    },
    simulation_duration_minutes: DEFAULT_DEPTH.simulation_duration_minutes,
    warmup_period_minutes: DEFAULT_DEPTH.warmup_period_minutes,
    num_replications: DEFAULT_DEPTH.num_replications,
    random_seed: 42,
  };
}

/**
 * Bir istasyonun kapasitesini birim zamanda işleyebileceği parça sayısı olarak
 * hesaplar (sunucu sayısı / ortalama işlem süresi).
 *
 * Sihirbazdaki "bu model çalışır mı?" ön kontrolü için kullanılır: backend'e
 * gitmeden, kullanıcıya darboğazın nerede olduğunu gösterebilmek gerekir.
 */
export function stationCapacityPerMinute(station: Station): number {
  const mean = meanServiceTime(station);
  return mean > 0 ? station.num_servers / mean : Infinity;
}

/** İstasyonun ortalama işlem süresi (dağılım tipinden bağımsız). */
export function meanServiceTime(station: Station): number {
  const { type, params } = station.service_time_distribution;
  const numeric = (key: string): number => {
    const value = Number(params[key]);
    return Number.isFinite(value) ? value : 0;
  };

  switch (type) {
    case "constant":
      return numeric("value");
    case "normal":
    case "exponential":
      return numeric("mean");
    case "triangular":
      return (numeric("min") + numeric("mode") + numeric("max")) / 3;
    default:
      return 0;
  }
}

/** Varış sürecinin ortalama parça giriş aralığı (dakika). */
export function interarrivalMean(config: SimulationConfig): number {
  const value = Number(config.arrival_process.distribution.params.mean);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface CapacityPreview {
  /** Birim zamanda sisteme giren parça sayısı. */
  arrivalRate: number;
  /** En yüklü istasyon ve yükü. */
  bottleneck: { station: Station; load: number } | null;
  /** Herhangi bir istasyon gelen işi yetiştiremiyor mu? */
  isOverloaded: boolean;
}

/**
 * Modelin kabaca çalışıp çalışmayacağını, simülasyonu beklemeden kestirir.
 *
 * Doğrusal hatta her istasyon her parçayı bir kez gördüğü için istasyon yükü
 * basitçe (varış hızı / kapasite) olur. Backend'in trafik denklemlerine dayalı
 * tam hesabının yerini tutmaz; amacı yalnızca kullanıcıyı 3. adımda
 * "bu model tıkanacak" diye uyarabilmektir.
 */
export function previewCapacity(config: SimulationConfig): CapacityPreview {
  const interarrival = interarrivalMean(config);
  const arrivalRate = interarrival > 0 ? 1 / interarrival : 0;

  let bottleneck: { station: Station; load: number } | null = null;
  for (const station of config.stations) {
    const capacity = stationCapacityPerMinute(station);
    const load = capacity > 0 ? arrivalRate / capacity : Infinity;
    if (!bottleneck || load > bottleneck.load) {
      bottleneck = { station, load };
    }
  }

  return {
    arrivalRate,
    bottleneck,
    isOverloaded: bottleneck !== null && bottleneck.load >= 1,
  };
}
