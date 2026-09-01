/**
 * Sektör şablonlarının tek giriş noktası.
 *
 * Şablonlar JSON dosyası olarak tutulur (ileride bir sunucudan da
 * çekilebilmeleri için), ancak TypeScript JSON içe aktarımlarını geniş tiplerle
 * çıkarır: `"exponential"` yerine `string`, bulunmayan alanlar için `undefined`.
 * Bu yüzden JSON ile şema arasındaki tip sınırı **tek bir yerde**, burada
 * geçilir; dosyanın her kullanıldığı yere serpiştirilmiş dönüşümler, birinde
 * yapılan hatanın fark edilmemesine yol açardı.
 *
 * Sınırı geçerken çalışma zamanı doğrulaması da yapılır. Derleyici bir JSON
 * dosyasındaki yazım hatasını (`"expoential"`) yakalayamaz; doğrulama olmadan
 * bu hata ancak kullanıcı simülasyonu çalıştırdığında, backend'den gelen 422
 * olarak ortaya çıkardı.
 */

import type { DistributionType, SimulationConfig } from "../types/simulationTypes";
import gidaJson from "./gida.json";
import metalJson from "./metal.json";
import tekstilJson from "./tekstil.json";

const VALID_DISTRIBUTION_TYPES: readonly string[] = [
  "exponential",
  "normal",
  "triangular",
  "constant",
  "empirical",
] satisfies readonly DistributionType[];

/** Şablonun beklenen biçimde olduğunu doğrular; değilse açık bir hata verir. */
function assertValidTemplate(name: string, raw: unknown): asserts raw is SimulationConfig {
  const fail = (reason: string): never => {
    throw new Error(`'${name}' şablonu geçersiz: ${reason}`);
  };

  if (typeof raw !== "object" || raw === null) {
    fail("nesne değil");
  }
  const config = raw as Partial<SimulationConfig>;

  if (!Array.isArray(config.stations) || config.stations.length === 0) {
    fail("en az bir istasyon içermeli");
  }
  if (!Array.isArray(config.connections)) {
    fail("connections alanı bir dizi olmalı");
  }
  if (!config.arrival_process?.entry_station_id) {
    fail("giriş istasyonu belirtilmemiş");
  }

  const stationIds = new Set(config.stations!.map((station) => station.id));
  if (stationIds.size !== config.stations!.length) {
    fail("istasyon kimlikleri benzersiz değil");
  }
  if (!stationIds.has(config.arrival_process!.entry_station_id)) {
    fail(
      `giriş istasyonu '${config.arrival_process!.entry_station_id}' istasyon listesinde yok`,
    );
  }

  for (const station of config.stations!) {
    const type = station.service_time_distribution?.type;
    if (!VALID_DISTRIBUTION_TYPES.includes(type)) {
      fail(`'${station.id}' istasyonunda bilinmeyen dağılım tipi: '${type}'`);
    }
  }

  for (const connection of config.connections!) {
    if (!stationIds.has(connection.from_station_id)) {
      fail(`bağlantı kaynağı '${connection.from_station_id}' istasyon listesinde yok`);
    }
    if (!stationIds.has(connection.to_station_id)) {
      fail(`bağlantı hedefi '${connection.to_station_id}' istasyon listesinde yok`);
    }
  }
}

/** JSON'u doğrulayıp şema tipine bağlar. */
function loadTemplate(name: string, raw: unknown): SimulationConfig {
  assertValidTemplate(name, raw);
  return raw;
}

export const tekstilTemplate = loadTemplate("tekstil", tekstilJson);
export const gidaTemplate = loadTemplate("gida", gidaJson);
export const metalTemplate = loadTemplate("metal", metalJson);
