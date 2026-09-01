/**
 * İstasyon metriklerini hat/bölüm bazında özetler.
 *
 * Sonuç sayfası küçük modeller için tasarlanmıştı: 3-4 istasyon düz bir liste
 * hâlinde okunabiliyordu. Gerçek bir fabrikada 20 istasyon vardır ve düz liste
 * kullanıcıyı boğar — hangi hattın sıkıştığını görmek için yirmi satırı tek tek
 * karşılaştırması gerekir. Bu modül, o karşılaştırmayı kullanıcı yerine yapar.
 *
 * Mantık bileşenden ayrı tutulur çünkü sessizce yanlış olabilir: bir istasyon
 * yanlış hatta düşerse ekranda hiçbir şey bozuk görünmez, yalnızca fabrika
 * yanlış özetlenir. Saf fonksiyon olarak birim testiyle doğrulanabilir.
 */

import type {
  SimulationConfig,
  StationMetricsResponse,
} from "../types/simulationTypes";

/**
 * Hat adı verilmemiş istasyonların düştüğü grup.
 *
 * Şema `line_name` alanını isteğe bağlı bırakır; gruplamayı hiç kullanmayan
 * modellerde tüm istasyonlar buraya düşer ve arayüz gruplama göstermez.
 */
export const UNGROUPED_LINE_NAME = "Genel";

export interface LineSummary {
  lineName: string;
  /** Bu grup, hat adı girilmemiş istasyonlardan mı oluşuyor? */
  isUngrouped: boolean;
  stations: StationMetricsResponse[];
  /** Hattaki en yüksek dolulukta çalışan istasyon — hattın kendi kısıtı. */
  bottleneck: StationMetricsResponse;
  /** Hattaki istasyonların OEE ortalaması. */
  averageOee: number;
  /** Hattaki istasyonların doluluk ortalaması. */
  averageUtilization: number;
  /** Fabrikanın genel darboğazı bu hatta mı? */
  hasFactoryBottleneck: boolean;
}

export interface FactorySummary {
  lineCount: number;
  stationCount: number;
  lines: LineSummary[];
  /** Fabrikanın genel darboğazı; istasyon listesi boşsa `null`. */
  bottleneck: StationMetricsResponse | null;
  /** Genel darboğazın bulunduğu hattın adı. */
  bottleneckLineName: string | null;
  /** Tüm istasyonların OEE ortalaması. */
  averageOee: number;
  /**
   * Gruplama arayüzü gösterilmeli mi?
   *
   * Tek grup varsa `false`: kartlar ve katlanabilir başlıklar, üç istasyonlu
   * bir modelde hiçbir bilgi eklemeden gereksiz karmaşıklık yaratırdı.
   */
  isGrouped: boolean;
}

/** Bir istasyonun hangi hatta ait olduğunu döndürür. */
function lineOf(config: SimulationConfig, stationId: string): string {
  const station = config.stations.find((item) => item.id === stationId);
  const name = station?.line_name?.trim();
  return name ? name : UNGROUPED_LINE_NAME;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Bir istasyon kümesinin en yüksek dolulukta çalışanını bulur.
 *
 * Kıstas bilinçli olarak **doluluk**tur, OEE değil. En düşük OEE'ye sahip
 * istasyon genellikle aç kalan istasyondur: işleyecek parça bulamadığı için
 * verimsiz görünür. Onu kısıt sanmak, kısıt olmayan istasyona yatırım yaptıran
 * klasik yerel optimizasyon hatasıdır. Bu ayrım motor tarafında bir kez
 * hataya yol açmıştı; aynı hatayı arayüzde tekrarlamamak için kıstas burada da
 * doluluktur.
 */
function busiest(stations: StationMetricsResponse[]): StationMetricsResponse {
  return stations.reduce((highest, station) =>
    station.utilization > highest.utilization ? station : highest,
  );
}

/**
 * Fabrikanın genel darboğazını belirler.
 *
 * Öncelik backend'in bildirdiği kimliktedir: darboğaz tespiti motorun işidir ve
 * arayüzün onu yeniden hesaplaması iki farklı cevap üretme riski taşır. Kimlik
 * listede bulunamazsa (ör. eski bir kayıt) en yüksek dolulukta çalışan
 * istasyona düşülür; sessizce darboğazsız kalmaktansa doğru olana yakın bir
 * cevap vermek yeğdir.
 */
function resolveBottleneck(
  stations: StationMetricsResponse[],
  bottleneckStationId: string,
): StationMetricsResponse | null {
  if (stations.length === 0) {
    return null;
  }
  return (
    stations.find((station) => station.station_id === bottleneckStationId) ??
    busiest(stations)
  );
}

/**
 * İstasyon metriklerini hatlara böler ve fabrika geneli özeti çıkarır.
 *
 * Hat sırası, kullanıcının modeli kurarken kullandığı istasyon sırasını izler;
 * alfabetik sıralama, üretim akışıyla ilgisiz bir düzen dayatırdı. Hat adı
 * girilmemiş istasyonların "Genel" grubu her zaman sona konur: adı olan hatlar
 * kullanıcının bilinçli olarak tanımladığı yapıdır, artık grup değildir.
 */
export function summarizeFactory(
  stations: StationMetricsResponse[],
  config: SimulationConfig,
  bottleneckStationId: string,
): FactorySummary {
  const bottleneck = resolveBottleneck(stations, bottleneckStationId);
  const bottleneckLineName = bottleneck
    ? lineOf(config, bottleneck.station_id)
    : null;

  const byLine = new Map<string, StationMetricsResponse[]>();
  for (const station of stations) {
    const lineName = lineOf(config, station.station_id);
    const group = byLine.get(lineName);
    if (group) {
      group.push(station);
    } else {
      byLine.set(lineName, [station]);
    }
  }

  const lines: LineSummary[] = [];
  for (const [lineName, group] of byLine) {
    const isUngrouped = lineName === UNGROUPED_LINE_NAME;
    lines.push({
      lineName,
      isUngrouped,
      stations: group,
      bottleneck: busiest(group),
      averageOee: mean(group.map((station) => station.oee.oee)),
      averageUtilization: mean(group.map((station) => station.utilization)),
      hasFactoryBottleneck:
        bottleneck !== null &&
        group.some((station) => station.station_id === bottleneck.station_id),
    });
  }

  // Adsız grup sona alınır; geri kalan sıra istasyonların model sırasıdır.
  lines.sort((first, second) => Number(first.isUngrouped) - Number(second.isUngrouped));

  return {
    lineCount: lines.length,
    stationCount: stations.length,
    lines,
    bottleneck,
    bottleneckLineName,
    averageOee: mean(stations.map((station) => station.oee.oee)),
    // Tek grup, gruplama sayılmaz: kullanıcı hat adı girmediyse (ya da hepsini
    // aynı hatta koyduysa) kartlar ve akordeon hiçbir ayrım göstermez.
    isGrouped: lines.length > 1,
  };
}

/** Bir hattın adı ve o hatta bağlı istasyonların kimlikleri. */
export interface ConfigLine {
  lineName: string;
  stationIds: string[];
}

/**
 * Konfigürasyondaki hatları, istasyonların model sırasını koruyarak döndürür.
 *
 * Animasyon yalnızca konfigürasyona sahiptir; istasyon metrikleri elinde
 * yoktur. Bu yüzden `summarizeFactory` yerine bu daha dar yardımcıyı kullanır.
 * Tek hat çıkarsa çağıran taraf sekme göstermemelidir: tek sekme, seçenek
 * sunmadan ekrana bir kontrol daha eklerdi.
 */
export function configLines(config: SimulationConfig): ConfigLine[] {
  const byLine = new Map<string, string[]>();
  for (const station of config.stations) {
    const name = station.line_name?.trim() || UNGROUPED_LINE_NAME;
    const group = byLine.get(name);
    if (group) {
      group.push(station.id);
    } else {
      byLine.set(name, [station.id]);
    }
  }

  const lines = [...byLine].map(([lineName, stationIds]) => ({ lineName, stationIds }));
  // Adsız grup sona alınır; adı olan hatlar kullanıcının tanımladığı yapıdır.
  lines.sort(
    (first, second) =>
      Number(first.lineName === UNGROUPED_LINE_NAME) -
      Number(second.lineName === UNGROUPED_LINE_NAME),
  );
  return lines;
}
