/**
 * Kurumsal kurulum akışının şeması.
 *
 * Kurulumun "tamamlandı" bilgisi iki farklı kaynaktan gelir ve bu ayrım
 * bilinçlidir:
 *
 * - **Beyan** (şirket bilgisi, fabrika, makine listesi): kullanıcının girdiği
 *   veridir ve `EnterpriseState` içinde durur.
 * - **Kanıt** (simülasyon, doğrulama, rapor, bağlantı): kullanıcının işaretlediği
 *   bir kutu değil, ürünün gerçekten ürettiği bir sonuçtur. Bunlar
 *   `ReadinessSignals` olarak dışarıdan verilir — bir koşum var mı, kaydedilmiş
 *   doğrulama ölçümü var mı, rapor indirildi mi, kaç kaynak bağlı.
 *
 * Onay kutusuyla "simülasyon yapıldı" demek, hiç koşum almamış bir müşteriye
 * %100 hazırlık puanı göstermek olurdu. Hazırlık puanının tek anlamı, sahiden
 * yapılmış işi ölçmesidir.
 */

/** Kurulum adımları; sıralama ekranlarda ve rehberde aynıdır. */
export type SetupStepId =
  | "company"
  | "factory"
  | "machines"
  | "connectors"
  | "simulation"
  | "validation"
  | "report";

export const STEP_ORDER: SetupStepId[] = [
  "company",
  "factory",
  "machines",
  "connectors",
  "simulation",
  "validation",
  "report",
];

export const STEP_LABEL: Record<SetupStepId, string> = {
  company: "Şirket bilgileri",
  factory: "Fabrika oluştur",
  machines: "Makine envanteri",
  connectors: "Veri kaynakları",
  simulation: "İlk simülasyon",
  validation: "İlk doğrulama",
  report: "İlk yönetici raporu",
};

/**
 * Adımların tahmini süresi (dakika).
 *
 * Toplamı 30'u aşmaz: "ilk 30 dakikada kurulum" sözü, adım sürelerinin toplamı
 * tutmuyorsa boş bir slogandır. Süreler tahmindir ve arayüzde böyle yazılır.
 */
export const STEP_MINUTES: Record<SetupStepId, number> = {
  company: 3,
  factory: 4,
  machines: 8,
  connectors: 5,
  simulation: 4,
  validation: 4,
  report: 2,
};

/** Rehberin vaat ettiği toplam süre. */
export const GUIDE_BUDGET_MINUTES = 30;

/* -------------------------------------------------------------------------- */
/* Beyan edilen veri                                                           */
/* -------------------------------------------------------------------------- */

export interface CompanyProfile {
  name: string;
  /** Logo veri URL'i; yüklenmediyse `null`. */
  logoDataUrl: string | null;
  sector: string;
  /** Kaç fabrika kurulacağı; planlama için. */
  factoryCount: number | null;
  currency: string;
}

export interface FactoryProfile {
  id: string;
  name: string;
  location: string;
  lineCount: number | null;
  /** Günde kaç vardiya çalışılıyor. */
  shiftsPerDay: number | null;
  /** Bir vardiyanın uzunluğu (saat). */
  shiftHours: number | null;
}

export type MachineKind = "cnc" | "press" | "lathe" | "welding" | "robot" | "other";

export const MACHINE_KINDS: MachineKind[] = [
  "cnc",
  "press",
  "lathe",
  "welding",
  "robot",
  "other",
];

export const MACHINE_KIND_LABEL: Record<MachineKind, string> = {
  cnc: "CNC",
  press: "Pres",
  lathe: "Torna",
  welding: "Kaynak",
  robot: "Robot",
  other: "Diğer",
};

export type MachineStatus = "active" | "maintenance" | "fault";

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  active: "Aktif",
  maintenance: "Bakımda",
  fault: "Arızalı",
};

export interface Machine {
  id: string;
  factoryId: string | null;
  name: string;
  kind: MachineKind;
  /** Seri numarası; girilmediyse `null` (boş metin değil). */
  serialNumber: string | null;
  status: MachineStatus;
  /** Kurulum yılı; yaş bundan türetilir. */
  installedYear: number | null;
  /** Son bakım tarihi (ISO 8601); hiç yapılmadıysa `null`. */
  lastMaintenanceAt: string | null;
  operator: string | null;
}

export interface EnterpriseSettings {
  logoDataUrl: string | null;
  brandColor: string;
  currency: string;
  timezone: string;
  locale: string;
  /** Raporların kapağında görünecek başlık. */
  pdfTitle: string;
}

/** Kullanıcının kendi eylemiyle oluşan kilometre taşları. */
export interface Milestones {
  /** İlk raporun indirildiği an; indirilmediyse `null`. */
  firstReportAtMs: number | null;
  /** Kurulum sihirbazının tamamlandığı an. */
  setupCompletedAtMs: number | null;
}

export interface EnterpriseState {
  company: CompanyProfile | null;
  factories: FactoryProfile[];
  machines: Machine[];
  settings: EnterpriseSettings;
  milestones: Milestones;
}

/* -------------------------------------------------------------------------- */
/* Kanıta dayalı sinyaller                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ürünün gerçekten ürettiği sonuçlar.
 *
 * Hepsi uygulamanın başka katmanlarından okunur; kurulum ekranı bunları
 * kendisi üretemez.
 */
export interface ReadinessSignals {
  /** Kaydedilmiş bir simülasyon koşumu var mı? */
  hasSimulationRun: boolean;
  /** Sunucuda kayıtlı fabrika sayısı. */
  savedFactoryCount: number;
  /** Kaydedilmiş doğrulama ölçümü sayısı. */
  validationCount: number;
  /** Tanımlı veri kaynağı sayısı. */
  connectorCount: number;
  /** Bunların kaçı bağlı durumda. */
  connectedCount: number;
}

/* -------------------------------------------------------------------------- */
/* Hazırlık puanı                                                              */
/* -------------------------------------------------------------------------- */

export type ReadinessBand = "red" | "orange" | "blue" | "green";

export const BAND_LABEL: Record<ReadinessBand, string> = {
  red: "Kurulum başlamadı",
  orange: "Kurulum sürüyor",
  blue: "Neredeyse hazır",
  green: "Kuruluma hazır",
};

export interface ReadinessCategory {
  id: SetupStepId;
  label: string;
  /** Kategorinin toplam ağırlığı. */
  weight: number;
  /** Kazanılan puan (0 ile `weight` arası). */
  earned: number;
  /** Neyin eksik olduğunu anlatan cümle; tamamlandıysa ne yapıldığı. */
  detail: string;
  complete: boolean;
}

export interface ReadinessReport {
  /** 0-100 arası toplam puan. */
  total: number;
  band: ReadinessBand;
  categories: ReadinessCategory[];
  /** Sıradaki en değerli adım; hepsi bittiyse `null`. */
  nextStep: SetupStepId | null;
}

/* -------------------------------------------------------------------------- */
/* Kontrol listesi                                                             */
/* -------------------------------------------------------------------------- */

export interface ChecklistItem {
  id: SetupStepId;
  label: string;
  done: boolean;
  /** Tamamlanmadıysa ne yapılacağı; tamamlandıysa neyin yapıldığı. */
  hint: string;
  /** Tıklandığında açılacak ekran (`navigation.ts` görünüm kimliği). */
  view: string;
  minutes: number;
}

/* -------------------------------------------------------------------------- */
/* Bağlayıcı sağlığı                                                           */
/* -------------------------------------------------------------------------- */

export interface ConnectorHealthCard {
  configId: string;
  name: string;
  kind: string;
  /** Son ölçülen gidiş-dönüş süresi (ms); ölçülmediyse `null`. */
  pingMs: number | null;
  /** Son veri alınan an; hiç veri gelmediyse `null`. */
  lastDataAtMs: number | null;
  /** Kaçıncı yeniden deneme. */
  retryCount: number;
  /** 0-100 arası sağlık skoru; hiç ölçüm yoksa `null`. */
  score: number | null;
  band: ReadinessBand;
  /** Skorun neden düştüğü; sorun yoksa durumu anlatan cümle. */
  detail: string;
  /**
   * Bu kaynak gerçek bir cihaza mı bağlı?
   *
   * Bu sürümde her zaman `false`'tur ve arayüz bunu "Benzetim" olarak yazar.
   * Alanın bugünden var olması, gerçek bağlantı geldiğinde ayrımın ekranda
   * kendiliğinden görünmesini sağlar.
   */
  isRealConnection: boolean;
}
