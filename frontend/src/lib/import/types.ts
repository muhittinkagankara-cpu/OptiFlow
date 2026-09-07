/**
 * Excel içe aktarma — ortak tipler ve alan kataloğu.
 *
 * Katalog tek doğruluk kaynağıdır: eşleştirme ekranı, eksik alan formu,
 * doğrulama ve model kurucu aynı listeyi okur. Alanlar dört yerde ayrı ayrı
 * tanımlansaydı, yeni bir alan eklendiğinde birinin güncellenmesi unutulur ve
 * eşleştirilebilen ama modele hiç girmeyen bir alan ortaya çıkardı.
 */

import type { DistributionType } from "../../types/simulationTypes";

/* -------------------------------------------------------------------------- */
/* Ham veri                                                                    */
/* -------------------------------------------------------------------------- */

/** Bir hücrenin ham değeri. Excel tarih ve boolean da döndürebilir. */
export type CellValue = string | number | boolean | Date | null;

/** Bir sayfanın satırları; ilk satır başlık kabul edilir. */
export interface ImportedSheet {
  name: string;
  /** Başlık dâhil tüm satırlar. */
  rows: CellValue[][];
}

/** Yüklenen dosyanın çözümlenmiş hâli. */
export interface ParsedFile {
  fileName: string;
  /** Bayt cinsinden dosya boyutu. */
  fileSize: number;
  sheets: ImportedSheet[];
}

/* -------------------------------------------------------------------------- */
/* Kolonlar                                                                    */
/* -------------------------------------------------------------------------- */

/** Bir kolonun içeriğinin ne olduğuna dair çıkarım. */
export type ColumnKind = "number" | "text" | "empty";

export interface DetectedColumn {
  /** Kolonun sayfadaki sırası (0 tabanlı). */
  index: number;
  /** Başlık satırındaki adı; boşsa "Kolon 3" gibi bir yer tutucu üretilir. */
  header: string;
  kind: ColumnKind;
  /** Kullanıcıya gösterilecek ilk birkaç değer. */
  samples: string[];
  /** Dolu hücre sayısı (başlık hariç). */
  filledCount: number;
}

/* -------------------------------------------------------------------------- */
/* OptiFlow alanları                                                           */
/* -------------------------------------------------------------------------- */

export type FieldId =
  | "station"
  | "cycleTime"
  | "machines"
  | "operators"
  | "scrap"
  | "buffer"
  | "shift"
  | "leadTime"
  | "annualDemand";

/**
 * Alanın nereye gittiği.
 *
 * `model`: doğrudan `SimulationConfig` içine yazılır.
 * `inventory`: envanter modülünün alanıdır; fabrika modeline **girmez** ve
 *   arayüzde bu açıkça belirtilir. Eşleştirilebilir olması bilinçlidir —
 *   kullanıcının dosyasında bu kolonlar sıklıkla bulunur ve "bu kolonu
 *   tanımadım" demek yerine ne olduğunu söylemek daha yardımcıdır.
 */
export type FieldUsage = "model" | "inventory";

export interface OptiFlowField {
  id: FieldId;
  label: string;
  /** Eşleştirme ekranındaki tek satırlık açıklama. */
  hint: string;
  usage: FieldUsage;
  /** Model kurulabilmesi için zorunlu mu? */
  required: boolean;
  /** Beklenen değer türü; skorlamada kolon türüyle karşılaştırılır. */
  expects: ColumnKind;
  /**
   * Eşleşme adayları: küçük harfe indirgenmiş, noktalama temizlenmiş anahtar
   * kelimeler. Hem Türkçe hem İngilizce hem de yaygın kısaltmalar bulunur.
   */
  aliases: string[];
}

/**
 * Alan kataloğu.
 *
 * `aliases` listeleri gerçek dosyalardan derlenmiştir: bir KOBİ'nin Excel'inde
 * aynı kavram "Çevrim Süresi", "Cycle Time", "CT" ya da "islem suresi" olarak
 * geçebilir. Skorlama bunların hepsini tanır (bkz. `scoreMapping`).
 */
export const FIELDS: OptiFlowField[] = [
  {
    id: "station",
    label: "İstasyon",
    hint: "Her satır bir istasyon olur; bu kolon istasyonun adıdır.",
    usage: "model",
    required: true,
    expects: "text",
    aliases: [
      "istasyon",
      "istasyon adi",
      "station",
      "station name",
      "workstation",
      "is merkezi",
      "makine adi",
      "operasyon",
      "operation",
      "process",
      "surec",
      "adim",
      "step",
      "asama",
    ],
  },
  {
    id: "cycleTime",
    label: "Çevrim Süresi",
    hint: "Bir parçanın bu istasyonda geçirdiği ortalama süre (dakika).",
    usage: "model",
    required: true,
    expects: "number",
    aliases: [
      "cevrim suresi",
      "cevrim",
      "cycle time",
      "cycletime",
      "ct",
      "islem suresi",
      "isleme suresi",
      "process time",
      "processing time",
      "sure",
      "duration",
      "takt",
      "takt time",
      "tact",
      "operasyon suresi",
    ],
  },
  {
    id: "machines",
    label: "Makine",
    hint: "İstasyondaki paralel makine sayısı.",
    usage: "model",
    required: false,
    expects: "number",
    aliases: [
      "makine",
      "makina",
      "mak",
      "machine",
      "machines",
      "machine count",
      "tezgah",
      "ekipman",
      "equipment",
      "istasyon sayisi",
      "paralel",
      "adet",
    ],
  },
  {
    id: "operators",
    label: "Operatör",
    hint: "İstasyonda çalışan operatör sayısı. Makine kolonu yoksa bunun yerine kullanılır.",
    usage: "model",
    required: false,
    expects: "number",
    aliases: [
      "operator",
      "operatör",
      "oper",
      "personel",
      "isci",
      "worker",
      "workers",
      "labor",
      "labour",
      "staff",
      "calisan",
      "kisi",
      "headcount",
    ],
  },
  {
    id: "scrap",
    label: "Hurda",
    hint: "Bu istasyonda hurdaya ayrılan parça oranı. Yüzde de girilebilir.",
    usage: "model",
    required: false,
    expects: "number",
    aliases: [
      "hurda",
      "fire",
      "hurda orani",
      "fire orani",
      "scrap",
      "scrap rate",
      "waste",
      "reject",
      "red",
      "ret orani",
      "defect",
      "kusurlu",
      "hata orani",
    ],
  },
  {
    id: "buffer",
    label: "Buffer",
    hint: "İstasyon önündeki bekleme alanı kapasitesi. Boşsa sınırsız kabul edilir.",
    usage: "model",
    required: false,
    expects: "number",
    aliases: [
      "buffer",
      "tampon",
      "ara stok",
      "kuyruk",
      "queue",
      "wip",
      "stok alani",
      "bekleme",
      "buffer size",
      "kapasite",
    ],
  },
  {
    id: "shift",
    label: "Vardiya",
    hint: "Günlük vardiya süresi ya da sayısı. Envanter tarafında kullanılır.",
    usage: "inventory",
    required: false,
    expects: "number",
    aliases: [
      "vardiya",
      "shift",
      "shifts",
      "vardiya sayisi",
      "vardiya suresi",
      "mesai",
      "calisma suresi",
      "working hours",
      "gunluk sure",
    ],
  },
  {
    id: "leadTime",
    label: "Tedarik Süresi",
    hint: "Siparişin gelmesi için geçen gün sayısı. Envanter tarafında kullanılır.",
    usage: "inventory",
    required: false,
    expects: "number",
    aliases: [
      "tedarik suresi",
      "temin suresi",
      "lead time",
      "leadtime",
      "lt",
      "teslim suresi",
      "supply time",
      "siparis suresi",
    ],
  },
  {
    id: "annualDemand",
    label: "Yıllık Talep",
    hint: "Yıllık toplam talep adedi. Envanter tarafında kullanılır.",
    usage: "inventory",
    required: false,
    expects: "number",
    aliases: [
      "yillik talep",
      "annual demand",
      "yearly demand",
      "talep",
      "demand",
      "yillik adet",
      "yillik uretim",
      "forecast",
      "tahmin",
    ],
  },
];

export function fieldById(id: FieldId): OptiFlowField {
  const field = FIELDS.find((item) => item.id === id);
  if (!field) {
    throw new Error(`Bilinmeyen alan: ${id}`);
  }
  return field;
}

/* -------------------------------------------------------------------------- */
/* Eşleştirme                                                                  */
/* -------------------------------------------------------------------------- */

/** Eşleşmenin ne kadar güvenilir olduğu. */
export type MappingConfidence = "high" | "medium" | "low";

export interface MappingSuggestion {
  fieldId: FieldId;
  /** Önerilen kolonun sırası; öneri yoksa `null`. */
  columnIndex: number | null;
  /** 0-1 arası ham skor. */
  score: number;
  confidence: MappingConfidence;
  /** Önerinin neden yapıldığı; arayüzde ipucu olarak gösterilir. */
  reason: string;
}

/** Kullanıcının onayladığı/değiştirdiği son eşleştirme. */
export type ColumnMapping = Partial<Record<FieldId, number | null>>;

/* -------------------------------------------------------------------------- */
/* Doğrulama                                                                   */
/* -------------------------------------------------------------------------- */

export type IssueSeverity = "error" | "warning";

export interface ImportIssue {
  severity: IssueSeverity;
  /** Sorunun bağlı olduğu alan; genel sorunlarda `null`. */
  fieldId: FieldId | null;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Eksik bilgiler                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Dosyada bulunamayan bilgiler için kullanıcıdan alınan varsayılanlar.
 *
 * Hepsinin bir başlangıç değeri vardır ama hiçbiri gizli değildir: eksik alan
 * formu her birini açıkça sorar ve ne anlama geldiğini yazar. Sessizce
 * uygulanan bir varsayım, kullanıcının hiç vermediği bir sayıyı ona kendi
 * verisiymiş gibi geri sunmak olurdu.
 */
export interface ImportDefaults {
  machines: number;
  scrapRate: number;
  bufferCapacity: number;
  distributionType: DistributionType;
  /** Parçaların hatta giriş aralığı (dakika). */
  interarrivalMinutes: number;
}
