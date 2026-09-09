/**
 * Copilot katmanının şeması.
 *
 * Copilot'un tek işi, ürünün **zaten ölçtüğü** sayıları cümleye çevirmektir.
 * Yeni bir ölçüm üretmez, tahmin yürütmez ve eksik veriyi doldurmaz. Bu yüzden
 * buradaki en önemli tip `ContextFact`'tir: her cümlenin arkasında, hangi
 * katmandan geldiği ve ölçülmüş mü türetilmiş mi olduğu belli bir sayı durur.
 *
 * Sağlayıcı soyutlaması (`CopilotProvider`) bugünden sabitlenir. Varsayılan
 * sağlayıcı **yereldir** ve hiçbir uca istek atmaz; API anahtarı zorunlu
 * değildir. Yarın bir dil modeli eklendiğinde ekranların hiçbiri değişmeyecek —
 * değişecek tek şey hangi sağlayıcının seçildiğidir.
 */

import type { PlanId } from "../sales";

/** Bağlamın hangi katmandan geldiği. */
export type ContextSource =
  | "simulation"
  | "finance"
  | "heatmap"
  | "validation"
  | "live"
  | "inventory"
  | "crm"
  | "connectors"
  /** Kurumsal kurulum durumu (SALES-6); kurulum danışmanı bunu okur. */
  | "onboarding";

export const SOURCE_LABEL: Record<ContextSource, string> = {
  simulation: "Simülasyon",
  finance: "Finans",
  heatmap: "Isı haritası",
  validation: "Doğrulama",
  live: "Canlı üretim",
  inventory: "Envanter",
  crm: "Satış",
  connectors: "Bağlayıcılar",
  onboarding: "Kurulum",
};

/** Kullanıcıya gösterilecek ekran; eylem kartları buraya götürür. */
export const SOURCE_VIEW: Record<ContextSource, string> = {
  simulation: "results",
  finance: "finance",
  heatmap: "finance",
  validation: "validation",
  live: "live",
  inventory: "inventory",
  crm: "sales",
  connectors: "connectors",
  onboarding: "dashboard",
};

/**
 * Bir değerin nereden geldiği.
 *
 * `measured` sahadan ya da koşumdan doğrudan okunmuştur; `derived` ölçülmüş
 * değerlerden hesaplanmıştır. Ayrım, "bu sayı nereden çıktı?" sorusunun
 * yanıtlanabilmesi için tutulur — Copilot'un her iddiasının izi sürülebilir
 * olmalıdır.
 */
export type FactProvenance = "measured" | "derived";

/** Bağlamdaki tek bir olgu. */
export interface ContextFact {
  /** Kural motorunun aradığı anahtar. */
  key: string;
  label: string;
  /** Cümlede geçecek biçimlenmiş değer ("₺178.772", "%84", "Kaynak"). */
  display: string;
  /** Sayısal karşılık; metinsel olgularda `null`. */
  numeric: number | null;
  source: ContextSource;
  provenance: FactProvenance;
}

/** Bir katmanın bağlamdaki bölümü. */
export interface ContextSection {
  source: ContextSource;
  /** Veri var mı? Yoksa `facts` boştur ve nedeni yazılıdır. */
  available: boolean;
  /** Verinin neden olmadığı; varsa `null`. */
  missingReason: string | null;
  facts: ContextFact[];
}

/** Copilot'un gördüğü fabrika özeti. */
export interface FactoryContext {
  factoryName: string | null;
  generatedAtMs: number;
  sections: ContextSection[];
}

/* -------------------------------------------------------------------------- */
/* Yanıt                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Yanıtın ne kadar sağlam durduğu.
 *
 * `none`, "veri yok" demektir ve yanıt metni de bunu söyler. Güven etiketi
 * yanıtın yanında **her zaman** görünür: etiketsiz bir cümle, kullanıcı
 * tarafından kesin bilgi sanılır.
 */
export type AnswerConfidence = "high" | "medium" | "low" | "none";

export const CONFIDENCE_LABEL: Record<AnswerConfidence, string> = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Düşük güven",
  none: "Veri yok",
};

/** Yanıtın sonundaki yönlendirme kartı. */
export interface ActionCard {
  id: string;
  label: string;
  /** Uygulamanın hangi ekranını açacağı (`navigation.ts` görünüm kimliği). */
  view: string;
  /** Kartın neden önerildiği. */
  reason: string;
}

export interface CopilotAnswer {
  text: string;
  /**
   * "Neden bunu öneriyorum?" maddeleri.
   *
   * Her madde bağlamdaki bir olguya dayanır; gerekçesiz bir öneri, kullanıcının
   * doğrulayamayacağı bir iddiadır.
   */
  reasons: string[];
  actions: ActionCard[];
  confidence: AnswerConfidence;
  /** Yanıtın beslendiği katmanlar. */
  sources: ContextSource[];
}

/* -------------------------------------------------------------------------- */
/* Konuşma                                                                     */
/* -------------------------------------------------------------------------- */

export type MessageRole = "user" | "assistant";

export interface CopilotMessage {
  id: string;
  role: MessageRole;
  text: string;
  atMs: number;
  /** Yalnızca yanıtlarda dolu. */
  confidence: AnswerConfidence | null;
  reasons: string[];
  actions: ActionCard[];
  sources: ContextSource[];
}

export interface Conversation {
  id: string;
  /** İlk sorudan türetilen başlık. */
  title: string;
  startedAtMs: number;
  updatedAtMs: number;
  messages: CopilotMessage[];
}

/* -------------------------------------------------------------------------- */
/* Kota                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Abonelik paketi.
 *
 * Satış katmanındaki paket kimlikleriyle **aynı tip** kullanılır: iki yerde iki
 * ayrı liste tutulsaydı, teklifte "Growth" yazan bir müşteri üründe başka bir
 * sınıra tabi olabilirdi.
 */
export type CopilotTier = PlanId;

export interface QuotaState {
  tier: CopilotTier;
  /** Bu dönemde kaç analiz yapıldı. */
  used: number;
  /** Dönemin başladığı an (ISO değil, milisaniye). */
  periodStartMs: number;
}

export interface QuotaSnapshot {
  tier: CopilotTier;
  used: number;
  /** Dönem sınırı; sınırsız pakette `null`. */
  limit: number | null;
  /** Kalan analiz; sınırsızda `null`. */
  remaining: number | null;
  /** Dönemin biteceği an. */
  periodEndMs: number;
  /** Kullanıcıya gösterilecek uyarı; yoksa `null`. */
  warning: string | null;
  /** Yeni bir analiz yapılabilir mi? */
  allowed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Sağlayıcı                                                                   */
/* -------------------------------------------------------------------------- */

export type ProviderStatus = "ready" | "unavailable" | "error";

export interface ProviderHealth {
  status: ProviderStatus;
  /** Son yanıt süresi (ms); ölçülmediyse `null`. */
  latencyMs: number | null;
  detail: string;
}

export interface CopilotRequest {
  question: string;
  context: FactoryContext;
  /** İsteğin yapıldığı an; sağlayıcılar saat okumaz. */
  nowMs: number;
  /** Önceki mesajlar; kural tabanlı sağlayıcı bunu kullanmaz ama sözleşmede durur. */
  history: CopilotMessage[];
}

/**
 * Tüm Copilot sağlayıcılarının uyduğu sözleşme.
 *
 * Ekranlar yalnızca bu arayüzü görür. Somut sınıf adı hiçbir bileşende geçmez;
 * yarın OpenAI ya da yerel bir model eklendiğinde arayüz aynı kalır.
 */
export interface CopilotProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Bu sürümde kullanılabiliyor mu? */
  readonly isAvailable: boolean;
  /** Çalışması için API anahtarı gerekiyor mu? */
  readonly requiresApiKey: boolean;
  generate(request: CopilotRequest): Promise<CopilotAnswer>;
  health(): ProviderHealth;
  /** Sağlayıcının kendi kotası; yoksa `null` (ürün kotası ayrı işler). */
  quota(): QuotaSnapshot | null;
}
