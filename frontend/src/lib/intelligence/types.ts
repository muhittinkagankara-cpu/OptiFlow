/**
 * Factory Intelligence — karar kartlarının ortak tipleri.
 *
 * Bu katmanın tamamı **deterministiktir**: aynı koşum her zaman aynı kartları
 * üretir. Yapay zekâ kullanılmaz ve arayüzde bu açıkça yazılır.
 *
 * Sayılar nereden gelir
 * ---------------------
 * Hiçbir mühendislik hesabı burada yapılmaz. Bu modüller yalnızca backend'in
 * **zaten döndürdüğü** alanları yeniden düzenler: oranlar (iki alanın bölümü),
 * farklar, sıralamalar ve eşik karşılaştırmaları. Parasal etkiler ve geri
 * kazanılabilir tutarlar finans katmanının kendi hesabından okunur
 * (`FinancialReport.suggestions[].recoverable_amount`), burada yeniden
 * hesaplanmaz — iki yerde hesaplansaydı aynı koşum için iki farklı rakam
 * çıkabilirdi.
 *
 * Eksik veri uydurulmaz: finans raporu yoksa parasal alanlar `null` döner ve
 * arayüz "maliyet oranları girilmedi" der.
 */

/** Kartın aciliyeti; renk ve sıra bundan gelir. */
export type Severity = "critical" | "high" | "medium";

/** İyileştirmenin uygulama zorluğu. */
export type Difficulty = "easy" | "medium" | "hard";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Kolay",
  medium: "Orta",
  hard: "Zor",
};

/* -------------------------------------------------------------------------- */
/* Bölüm 1 — Yönetici özeti                                                    */
/* -------------------------------------------------------------------------- */

export interface ExecutiveSummary {
  /** Tek cümlelik durum tespiti. */
  headline: string;
  /** Cümleyi destekleyen kısa gerekçe. */
  detail: string;
  /** Ekranın genel tonu; en kötü bulguya göre. */
  tone: Severity | "good";
  /** Öne çıkan istasyon; yoksa `null`. */
  focusStation: string | null;
}

/* -------------------------------------------------------------------------- */
/* Bölüm 2 — Öncelik kartları                                                  */
/* -------------------------------------------------------------------------- */

export interface PriorityCard {
  id: string;
  severity: Severity;
  title: string;
  /** Etkilenen istasyon; hat geneli bulgularda `null`. */
  station: string | null;
  /** Sorunun ne olduğu, ölçülmüş değerle birlikte. */
  detail: string;
  /** Parasal etki; finans raporu yoksa `null`. */
  monetaryImpact: number | null;
  /** Beklenen iyileşmenin tek cümlelik ifadesi. */
  expectedGain: string;
  /** Kartın simgesini seçmek için anahtar. */
  icon: "bottleneck" | "unstable" | "scrap" | "queue" | "money" | "validation";
}

/* -------------------------------------------------------------------------- */
/* Bölüm 3 — Sebep zinciri                                                     */
/* -------------------------------------------------------------------------- */

export interface CauseLink {
  id: string;
  label: string;
  /** Bu adımı destekleyen ölçülmüş değer; yoksa `null`. */
  measure: string | null;
  /** Adımın kendi açıklaması. */
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* Bölüm 4 — İyileştirme kartları                                              */
/* -------------------------------------------------------------------------- */

export interface ImprovementCard {
  id: string;
  title: string;
  description: string;
  /** Beklenen etki; parasal ya da niteliksel. */
  expectedImpact: string;
  /** Parasal karşılığı; finans raporu yoksa `null`. */
  recoverableAmount: number | null;
  difficulty: Difficulty;
  /** Geri ödeme süresi (gün); hesaplanamıyorsa `null`. */
  paybackDays: number | null;
  station: string | null;
}

/* -------------------------------------------------------------------------- */
/* Bölüm 5 — Önce/Sonra                                                        */
/* -------------------------------------------------------------------------- */

export interface ComparisonRow {
  id: string;
  label: string;
  /** Şu anki ölçülmüş değer (0-1 ya da mutlak). */
  current: number;
  /** Referans hedef; **tahmin değil**, koşumda gözlenmiş ya da teorik bir üst sınır. */
  target: number;
  /** Değerlerin nasıl yazılacağı. */
  format: "percent" | "money";
  /** Hedefin nereden geldiği; arayüzde ipucu olarak gösterilir. */
  targetSource: string;
}

/* -------------------------------------------------------------------------- */
/* Bölüm 6 — Sağlık radarı                                                     */
/* -------------------------------------------------------------------------- */

export interface RadarAxis {
  axis: string;
  /** 0-100 arası normalize skor; yüksek = iyi. */
  score: number;
  /** Skorun neyden türetildiği. */
  basis: string;
}
