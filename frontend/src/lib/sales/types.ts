/**
 * Satış hattının veri şeması.
 *
 * Bu tipler bir **CRM sözleşmesinin taslağıdır**. Bugün veriler tarayıcıda
 * duruyor; yarın bir sunucuya taşındığında değişecek olan yalnızca saklama
 * katmanı olacak, bu şema değil.
 *
 * Şemanın simülasyon tarafıyla hiçbir alanı paylaşmaması bilinçlidir: bir
 * `Lead` satış sürecindeki bir firmadır, bir `Factory` ise modellenmiş bir
 * hattır. İkisini birleştirmek, henüz hesap açmamış bir aday firmayı fabrika
 * listesinde göstermek anlamına gelirdi.
 */

/** Satış hattının beş durağı; sıra anlamlıdır ve geri dönüş serbesttir. */
export type LeadStage = "new" | "demo" | "proposal" | "sent" | "won";

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "Yeni Lead",
  demo: "Demo Yapıldı",
  proposal: "Teklif Oluşturuldu",
  sent: "PDF Gönderildi",
  won: "Kazanıldı",
};

/** Kanban sütunlarının soldan sağa sırası. */
export const STAGE_ORDER: LeadStage[] = ["new", "demo", "proposal", "sent", "won"];

/** Paket adları; fiyatlandırma motorunun çıktısı. */
export type PlanId = "starter" | "growth" | "enterprise";

export const PLAN_LABEL: Record<PlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

/** Demoda hangi ekranların gösterildiği; teklif konuşmasının dayanağı. */
export interface DemoRecord {
  /** ISO 8601. */
  at: string;
  /** Demonun sürdüğü dakika. */
  durationMinutes: number;
  /** Gösterilen ekranların okunur adları. */
  screens: string[];
}

/** Planlanmış bir görüşme. */
export interface Meeting {
  id: string;
  leadId: string;
  /** ISO 8601. */
  at: string;
  title: string;
}

export interface Lead {
  id: string;
  company: string;
  sector: string;
  city: string;
  contactName: string;
  phone: string;
  email: string;
  /** Fiyatlandırmanın iki girdisinden biri. */
  machineCount: number;
  employeeCount: number;
  note: string;
  stage: LeadStage;
  /** Kaydın oluşturulduğu an (ISO 8601). */
  createdAt: string;
  /** Son durum değişikliği (ISO 8601); "2 saat önce" bundan hesaplanır. */
  updatedAt: string;
  /** Demo yapıldıysa kaydı; yapılmadıysa `null`. */
  demo: DemoRecord | null;
  /** Kazanılan anlaşmanın aylık tutarı; kazanılmadıysa `null`. */
  wonMonthly: number | null;
}

/* -------------------------------------------------------------------------- */
/* Fiyatlandırma                                                               */
/* -------------------------------------------------------------------------- */

/** Fiyat motorunun girdisi. */
export interface QuoteInput {
  employeeCount: number;
  machineCount: number;
}

/** Bir paketin sabit tanımı. */
export interface PlanDefinition {
  id: PlanId;
  label: string;
  /** Aylık taban ücret (₺). */
  monthlyBase: number;
  /** Makine başına aylık ek ücret (₺). */
  monthlyPerMachine: number;
  /** Tek seferlik kurulum ücreti (₺). */
  setupFee: number;
  /** Destek kapsamı; teklif sayfasında ve PDF'te yazılır. */
  support: string;
  /** Paketin kapsadığı özellikler. */
  features: string[];
  /** Bu pakete girmek için gereken en fazla makine ve çalışan. */
  maxMachines: number;
  maxEmployees: number;
}

/** Fiyat motorunun çıktısı. */
export interface Quote {
  plan: PlanDefinition;
  /** Aylık toplam (taban + makine başına). */
  monthly: number;
  setupFee: number;
  /** İlk yıl toplamı; kurulum dâhil. */
  firstYearTotal: number;
  /** Paketin neden seçildiği; teklif sayfasında gösterilir. */
  rationale: string;
}

/* -------------------------------------------------------------------------- */
/* Hatırlatıcılar                                                              */
/* -------------------------------------------------------------------------- */

export type FollowUpSeverity = "overdue" | "due" | "info";

export interface FollowUp {
  id: string;
  leadId: string;
  company: string;
  severity: FollowUpSeverity;
  text: string;
  /** Kaç gündür beklediği; bilinmiyorsa `null`. */
  waitingDays: number | null;
}

/* -------------------------------------------------------------------------- */
/* Analitik                                                                    */
/* -------------------------------------------------------------------------- */

/** Huninin tek bir adımı. */
export interface FunnelStep {
  from: LeadStage;
  to: LeadStage;
  label: string;
  fromCount: number;
  toCount: number;
  /**
   * Dönüşüm oranı; kaynak adımda hiç kayıt yoksa `null`.
   *
   * Sıfır göstermek "hiç dönüşmedi" demek olurdu; oysa ölçülecek bir şey
   * yoktur.
   */
  rate: number | null;
}

/** Bir ayın kazanılan geliri. */
export interface MonthlyRevenue {
  /** "2026-09" biçiminde. */
  month: string;
  /** Ekranda gösterilecek okunur ad ("Eyl 2026"). */
  label: string;
  wonCount: number;
  /** Kazanılan anlaşmaların aylık toplamı (₺). */
  monthlyRevenue: number;
}
