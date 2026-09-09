/**
 * Cihaz devreye alma sihirbazının türleri.
 *
 * Sihirbaz altı adımdır ve sıra bir karardır:
 *
 *     Uç adresi → Keşif → Etiket seçimi → Eşleme → Test → Kaydet
 *
 * Test, kaydetmeden **önce** gelir. Kaydedilmiş ama hiç denenmemiş bir
 * bağlantı, arayüzde çalışıyormuş gibi durur; bu sprintin engellediği tam
 * olarak budur.
 *
 * Keşif uydurmaz
 * --------------
 * Sunucu bir uçtan yanıt alamazsa etiket listesi boş gelir. Arayüz o zaman
 * boş bir liste ve nedenini gösterir; örnek etiket üretmez.
 */

/** Sihirbaz adımı; sunucudaki değerlerle birebir aynı. */
export type ProvisioningStep =
  | "endpoint"
  | "discovery"
  | "tags"
  | "mapping"
  | "test"
  | "save";

export const PROVISIONING_STEP_LABEL: Record<ProvisioningStep, string> = {
  endpoint: "Uç adresi",
  discovery: "Keşif",
  tags: "Etiket seçimi",
  mapping: "Eşleme",
  test: "Test",
  save: "Kaydet",
};

/** Adımların sırası; atlamaya izin verilmez. */
export const PROVISIONING_ORDER: ProvisioningStep[] = [
  "endpoint",
  "discovery",
  "tags",
  "mapping",
  "test",
  "save",
];

/** Bulunan etiketin taşıdığı veri türü. */
export type TagKind = "counter" | "gauge" | "boolean" | "text" | "unknown";

export const TAG_KIND_LABEL: Record<TagKind, string> = {
  counter: "Sayaç",
  gauge: "Ölçüm",
  boolean: "Açık/Kapalı",
  text: "Metin",
  unknown: "Bilinmiyor",
};

/** Cihazda bulunmuş bir etiket. */
export interface DiscoveredTag {
  /** Cihazdaki adres: OPC UA düğümü, MQTT konusu ya da REST alan yolu. */
  address: string;
  name: string;
  kind: TagKind;
  kindLabel: string;
  /** Keşif anında okunan gerçek değer; okunamadıysa `null`. */
  value: string | number | boolean | null;
  unit: string | null;
  dataType: string | null;
}

/** Bir etiket için makine ve metrik önerisi; anlaşılamadıysa `null`. */
export interface TagSuggestion {
  address: string;
  machineId: string | null;
  metric: string | null;
}

/** Uçtaki cihazın kimliği. */
export interface DeviceFingerprint {
  endpoint: string;
  kind: string;
  digest: string;
  tagCount: number;
}

/** Bir keşif denemesinin sonucu. */
export interface DiscoveryResult {
  ok: boolean;
  kind: string;
  endpoint: string;
  tags: DiscoveredTag[];
  tagCount: number;
  /** Ne olduğu; başarısızlıkta neden olmadığı. */
  detail: string;
  /** Cihazdan gelen somut kanıt; yoksa `null`. */
  evidence: string | null;
  /** Denenip okunamayan adresler; sessizce yutulmaz. */
  unreadable: string[];
  latencyMs: number | null;
  atMs: number | null;
  /** Önbellekten mi geldi? */
  cached: boolean;
  cacheAgeMs: number | null;
  fingerprint: DeviceFingerprint | null;
  /**
   * Cihaz değişti mi? Daha önce görülmemişse `null`.
   *
   * `false` ("aynı cihaz") ile `null` ("ilk kez görülüyor") farklıdır; ikisini
   * birleştirmek ilk kurulumu bir cihaz değişimi gibi gösterirdi.
   */
  deviceChanged: boolean | null;
  suggestions: TagSuggestion[];
}

/** Kimlik bilgisi denemesinin sonucu; parola taşınmaz. */
export interface CredentialTest {
  ok: boolean;
  detail: string;
  username: string | null;
  requiresAuth: boolean | null;
  latencyMs: number | null;
}

/** Kullanıcının kurduğu tek bir eşleme. */
export interface TagMapping {
  address: string;
  machineId: string;
  metric: string;
  /**
   * Eşleme öneriden mi geldi, elle mi kuruldu?
   *
   * Geri alma bu ayrımı kullanır: öneriler toplu kaldırılabilir, elle
   * kurulanlar korunur.
   */
  source: "manual" | "suggestion";
}

/** Sihirbazın tarayıcıdaki durumu. */
export interface WizardState {
  step: ProvisioningStep;
  completed: ProvisioningStep[];
  /** Seçilen etiket adresleri. */
  selected: string[];
  mapping: Record<string, TagMapping>;
  /** Test yapılmadıysa `null`; sıfır ya da false değil. */
  testOk: boolean | null;
  testDetail: string | null;
}

/** Başlangıç durumu: ilk adım, hiçbir şey tamamlanmamış. */
export const INITIAL_WIZARD: WizardState = {
  step: "endpoint",
  completed: [],
  selected: [],
  mapping: {},
  testOk: null,
  testDetail: null,
};

/** Hiç keşif yapılmamış durum. */
export const NO_DISCOVERY: DiscoveryResult = {
  ok: false,
  kind: "unknown",
  endpoint: "",
  tags: [],
  tagCount: 0,
  detail: "Henüz keşif yapılmadı",
  evidence: null,
  unreadable: [],
  latencyMs: null,
  atMs: null,
  cached: false,
  cacheAgeMs: null,
  fingerprint: null,
  deviceChanged: null,
  suggestions: [],
};
