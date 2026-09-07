/**
 * Kurulum akışının saf mantığı — sektör kataloğu, canlı önizleme ve kurulum
 * adımları.
 *
 * Bileşenler yalnızca çizer; hangi sektörün hangi şablona bağlı olduğu, bir
 * şablonun kaba kapasitesinin ne olduğu ve ilerleme çubuğunun hangi yüzdede
 * hangi adımı gösterdiği burada karara bağlanır. Bu ayrım, akışın gözle
 * doğrulanması güç olan kısımlarının (kapasite hesabı, adım eşiği) tek başına
 * sınanabilmesini sağlar.
 *
 * Simülasyon matematiği burada **yoktur**. Önizlemedeki kapasite, şablonun
 * kendi alanlarından türetilen kaba bir üst sınırdır ve arayüzde açıkça
 * "tahmini" diye işaretlenir; gerçek çıktı yalnızca backend'in koşumundan
 * gelir. İkisi karıştırılırsa kullanıcı, hiç çalıştırmadığı bir modelin
 * çıktısını ölçülmüş bir sonuç sanır.
 */

import type { Factory, SimulationConfig } from "../types/simulationTypes";
import { stationCapacityPerMinute } from "./configDefaults";
import type { RunHistoryEntry } from "./runHistory";

/* -------------------------------------------------------------------------- */
/* Sektör kataloğu                                                             */
/* -------------------------------------------------------------------------- */

/** Kartta gösterilecek simgenin adı; bileşen katmanı bunu gerçek simgeye çevirir. */
export type SectorIconName =
  | "metal"
  | "food"
  | "textile"
  | "plastic"
  | "generic";

export type SectorId = "metal" | "gida" | "tekstil" | "plastik" | "genel";

export interface SectorOption {
  id: SectorId;
  title: string;
  /** Kartın altındaki tek cümlelik açıklama. */
  description: string;
  /** Hattın adımları; önizleme panelinde zincir olarak gösterilir. */
  stages: string[];
  icon: SectorIconName;
}

/**
 * Sektör kartları.
 *
 * Katalog yalnızca **sunum** bilgisini taşır; şablonun kendisi (`SimulationConfig`)
 * `templates/` altında durur ve bu listeye bileşen katmanında bağlanır. İkisi
 * burada birleştirilseydi, saf mantık modülü JSON şablonlarına ve dolayısıyla
 * doğrulama koduna bağımlı hâle gelirdi.
 */
export const SECTORS: SectorOption[] = [
  {
    id: "metal",
    title: "Metal İşleme",
    description: "Talaşlı imalat hattı: kesme, torna, kaynak ve boyama.",
    stages: ["Kesme", "Torna", "Kaynak", "Boyama"],
    icon: "metal",
  },
  {
    id: "gida",
    title: "Gıda",
    description: "Yıkamadan paketlemeye kadar hijyen odaklı işleme hattı.",
    stages: ["Yıkama", "Doğrama", "Paketleme"],
    icon: "food",
  },
  {
    id: "tekstil",
    title: "Tekstil",
    description: "Kesim, dikiş ve kalite kontrolden oluşan konfeksiyon hattı.",
    stages: ["Kesim", "Dikiş", "Kalite"],
    icon: "textile",
  },
  {
    id: "plastik",
    title: "Plastik",
    description: "Enjeksiyon kalıplama, soğutma ve çapak alma adımları.",
    stages: ["Enjeksiyon", "Soğutma", "Çapak Alma", "Kalite"],
    icon: "plastic",
  },
  {
    id: "genel",
    title: "Genel Üretim",
    description: "Boş bir şema ile başlayın; istasyonları kendiniz ekleyin.",
    stages: [],
    icon: "generic",
  },
];

export function sectorById(id: SectorId | null): SectorOption | null {
  return SECTORS.find((sector) => sector.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Canlı önizleme                                                              */
/* -------------------------------------------------------------------------- */

export interface SectorPreview {
  stationCount: number;
  connectionCount: number;
  /** Kapasitesi en düşük istasyon — kaba darboğaz tahmini. */
  slowestStation: string | null;
  /**
   * Hattın saatteki kaba kapasitesi.
   *
   * En yavaş istasyonun kapasitesidir; bir hat, en dar halkasından daha hızlı
   * akamaz. **Tahminî bir üst sınırdır**: kuyruk, arıza, fire ve değişkenlik
   * hesaba katılmaz — onları ancak simülasyon ölçer. Bu yüzden gerçek çıktı
   * her zaman bu sayının altındadır ve arayüz bunu "tahmini" diye işaretler.
   */
  roughCapacityPerHour: number | null;
}

/**
 * Bir şablonun önizleme özetini çıkarır.
 *
 * Şablon yoksa (boş şema) sayılar sıfırdır ve kapasite `null` olur — boş bir
 * hat için "saatte 0 parça" demek, sıfır kapasiteli bir hat kurulduğu
 * izlenimini verirdi.
 */
export function previewOf(config: SimulationConfig | null): SectorPreview {
  if (!config || config.stations.length === 0) {
    return {
      stationCount: 0,
      connectionCount: 0,
      slowestStation: null,
      roughCapacityPerHour: null,
    };
  }

  let slowest = config.stations[0];
  let slowestCapacity = stationCapacityPerMinute(slowest);

  for (const station of config.stations.slice(1)) {
    const capacity = stationCapacityPerMinute(station);
    if (capacity < slowestCapacity) {
      slowest = station;
      slowestCapacity = capacity;
    }
  }

  return {
    stationCount: config.stations.length,
    connectionCount: config.connections.length,
    slowestStation: slowest.name,
    // Sonsuz kapasite (işlem süresi sıfır) gerçek bir sayı değildir; böyle bir
    // şablonda kapasite gösterilmez.
    roughCapacityPerHour: Number.isFinite(slowestCapacity)
      ? slowestCapacity * 60
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Kurulum adımları                                                            */
/* -------------------------------------------------------------------------- */

export interface BuildStep {
  id: string;
  label: string;
  /** Bu adımın tamamlandığı ilerleme yüzdesi (0-1). */
  until: number;
}

/**
 * "Fabrika kuruluyor" ekranının adımları.
 *
 * Adımlar gerçek bir sunucu işini beklemez — şablon zaten yerel bir JSON'dır ve
 * anında hazırdır. Yine de bir kurulum anı gösterilir: kullanıcı bir sektör
 * seçtikten sonra doğrudan yirmi kutuluk bir şemaya düşerse, ne olduğunu
 * anlamadan karmaşayla karşılaşır. Bu üç saniye, sonucun ne olacağını
 * anlatarak geçer.
 *
 * Sürenin sahte olduğu arayüzde gizlenmez: adım adları yapılan işi tarif eder
 * ve hiçbiri "sunucuya bağlanılıyor" gibi olmayan bir iş iddia etmez.
 */
export const BUILD_STEPS: BuildStep[] = [
  { id: "template", label: "Şablon hazırlanıyor", until: 0.3 },
  { id: "stations", label: "İstasyonlar oluşturuluyor", until: 0.62 },
  { id: "layout", label: "Akış yerleşiyor", until: 0.9 },
  { id: "done", label: "Hazır", until: 1 },
];

/** Kurulum canlandırmasının toplam süresi (ms). */
export const BUILD_DURATION_MS = 2600;

/**
 * Verilen ilerlemede kaç adımın tamamlandığı.
 *
 * Eşik **dâhil** karşılaştırılır: ilerleme tam olarak bir adımın sınırına
 * geldiğinde o adım bitmiş sayılır. Aksi hâlde çubuk %100'e ulaştığında son
 * adım hâlâ "sürüyor" görünürdü.
 */
export function completedStepCount(
  progress: number,
  steps: BuildStep[] = BUILD_STEPS,
): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return steps.filter((step) => clamped >= step.until).length;
}

/** Verilen ilerlemede hangi adımın sürdüğü; hepsi bittiyse `null`. */
export function activeStep(
  progress: number,
  steps: BuildStep[] = BUILD_STEPS,
): BuildStep | null {
  const completed = completedStepCount(progress, steps);
  return completed >= steps.length ? null : steps[completed];
}

/* -------------------------------------------------------------------------- */
/* Son çalışılan fabrikalar                                                    */
/* -------------------------------------------------------------------------- */

export interface RecentFactory {
  factory: Factory;
  /** Bu fabrikadan alınmış en son koşum; yoksa `null`. */
  lastRun: RunHistoryEntry | null;
}

/**
 * Fabrika listesini koşum geçmişiyle eşleştirir.
 *
 * Eşleme önce fabrika kimliğiyle denenir; eski kayıtlarda kimlik bulunmadığı
 * için ada göre bir yedek yol vardır. Yalnızca ada bakılsaydı, aynı adı taşıyan
 * iki fabrikanın rozetleri birbirine karışırdı; yalnızca kimliğe bakılsaydı
 * bu özellikten önce kaydedilmiş koşumlar hiç eşleşmezdi.
 *
 * Liste, fabrikaların geldiği sırayı korur — backend zaten en son güncellenen
 * fabrikayı başa koyuyor ve burada yeniden sıralamak o kararı sessizce
 * geçersiz kılardı.
 */
export function recentFactories(
  factories: Factory[],
  runHistory: RunHistoryEntry[],
  limit = 3,
): RecentFactory[] {
  return factories.slice(0, Math.max(0, limit)).map((factory) => {
    const byId = runHistory.find((run) => run.factoryId === factory.id);
    const byName =
      byId ?? runHistory.find((run) => run.factoryName === factory.name);
    return { factory, lastRun: byName ?? null };
  });
}
