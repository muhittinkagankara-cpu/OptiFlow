/**
 * Canlı fabrika durumunun şeması.
 *
 * Bu tipler bir **saha protokolü sözleşmesinin taslağıdır**. `SimulationResults`
 * bir koşumun bittikten sonraki özetidir; buradaki `LiveFactoryState` ise
 * hattın "şu anki" hâlidir ve olay geldikçe değişir. İkisini birleştirmek
 * cazip görünürdü ama yanlış olurdu: biri geçmişin özeti, öteki şimdinin
 * fotoğrafıdır ve bağımsız değişirler.
 *
 * Bu sürümde gerçek bir PLC / OPC UA / MES bağlantısı **yoktur**. Olaylar
 * `DemoLiveProvider` tarafından üretilir ve arayüz bunu kalıcı bir şeritte
 * açıkça söyler — sahte sensör verisini gerçek sanan bir yönetici, olmayan bir
 * arızaya ekip gönderebilir.
 */

/** Bir istasyonun anlık durumu. */
export type MachineStatus = "running" | "idle" | "queued" | "fault" | "setup";

/** Alarm önem seviyesi. */
export type AlarmLevel = "critical" | "warning" | "info";

export const STATUS_LABEL: Record<MachineStatus, string> = {
  running: "Çalışıyor",
  idle: "Bekliyor",
  queued: "Kuyruk",
  fault: "Arıza",
  setup: "Setup",
};

export const ALARM_LEVEL_LABEL: Record<AlarmLevel, string> = {
  critical: "Kritik",
  warning: "Uyarı",
  info: "Bilgi",
};

/** Sıralamada kullanılan seviye ağırlığı; küçük olan önce gelir. */
export const ALARM_LEVEL_ORDER: Record<AlarmLevel, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Tek bir istasyonun canlı durumu. */
export interface StationLiveState {
  stationId: string;
  stationName: string;
  status: MachineStatus;
  /** Önünde bekleyen parça sayısı. */
  queue: number;
  /** Vardiya başından beri tamamlanan sağlam parça. */
  completed: number;
  /** Vardiya başından beri hurdaya ayrılan parça. */
  scrapped: number;
  /** 0-1 arası genel ekipman etkinliği. */
  oee: number;
  /** Bir parçanın çevrim süresi (saniye). */
  cycleSeconds: number;
  /** İstasyondaki toplam makine sayısı. */
  machineCount: number;
  /** Şu an çalışır durumda olan makine sayısı. */
  onlineMachines: number;
  /** İstasyonda çalışan operatör; atanmamışsa `null`. */
  operatorName: string | null;
  /** Setup sırasında geçilen ürün; setup dışında `null`. */
  setupProduct: string | null;
  /** Arıza nedeni; arıza yokken `null`. */
  faultReason: string | null;
}

/** Olay akışındaki tek bir satır. */
export interface FeedEntry {
  id: string;
  /** Gün içindeki dakika (0-1439). */
  atMinutes: number;
  stationId: string | null;
  stationName: string | null;
  text: string;
  level: AlarmLevel;
}

/** Alarm merkezindeki tek bir kayıt. */
export interface Alarm {
  id: string;
  level: AlarmLevel;
  atMinutes: number;
  stationId: string;
  stationName: string;
  text: string;
  /**
   * Kaydın en son değiştiği dakika.
   *
   * Açılışta `atMinutes` ile aynıdır; alarm yükseltildiğinde ya da
   * kapatıldığında güncellenir. `atMinutes` "ne zaman başladı", bu alan ise
   * "en son ne zaman değişti" sorusunu yanıtlar — ikisi aynı alanda tutulsaydı
   * bir arızanın başlangıç saati, yükseltildiği anda kaybolurdu.
   */
  updatedAtMinutes: number;
  /**
   * Alarmın giderildiği dakika; hâlâ açıksa `null`.
   *
   * Giderilen alarmlar listeden silinmez, kapalı olarak işaretlenir: bir
   * arızanın ne zaman başlayıp ne zaman bittiği vardiya sonunda sorulacak ilk
   * sorudur ve silinmiş bir kayıt bu soruyu yanıtlayamaz.
   */
  resolvedAtMinutes: number | null;
}

/** Hattın anlık hâli. */
export interface LiveFactoryState {
  /** Gün içindeki dakika (0-1439). */
  clockMinutes: number;
  stations: StationLiveState[];
  /** En yeni önde olacak biçimde sıralı olay akışı. */
  feed: FeedEntry[];
  /** En yeni önde olacak biçimde sıralı alarmlar. */
  alarms: Alarm[];
  /** Kaç olay işlendi; sayaç animasyonlarının anahtarı olarak da kullanılır. */
  eventCount: number;
}

/** Üst şeritteki toplu göstergeler. */
export interface LiveTotals {
  /** Dakikada tamamlanan parça; ölçülecek süre yoksa `null`. */
  throughputPerMinute: number | null;
  /** Hat geneli OEE (istasyon ortalaması); istasyon yoksa `null`. */
  oee: number | null;
  /** Hurda / işlenen; hiç parça işlenmediyse `null`. */
  scrapRate: number | null;
  onlineMachines: number;
  totalMachines: number;
  /** Ortalama çevrim süresi (saniye); istasyon yoksa `null`. */
  avgCycleSeconds: number | null;
  totalCompleted: number;
  totalQueue: number;
  activeOperators: number;
  runningStations: number;
  openAlarms: number;
}
