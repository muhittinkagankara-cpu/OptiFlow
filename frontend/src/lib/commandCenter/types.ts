/**
 * Command Center'ın sunum sözlüğü (Sprint 2D).
 *
 * Bu klasör **iş kuralı taşımaz**. Eşikler, para hesapları ve sağlık
 * göstergeleri `lib/actionItems`, `lib/dashboardMetrics` ve `lib/factoryHealth`
 * içinde kalır; burada yalnızca o çıktıların ekrana nasıl **seçileceği ve
 * cümleye çevrileceği** durur.
 *
 * Ayrı bir klasör olmasının nedeni mimari kuraldır: bileşen yalnızca render
 * eder. "Hangi eylem baş karar olur", "kısıt cümlesi nasıl kurulur" ve "bu
 * sayının kökeni nedir" sorularının hepsi sınanabilir kararlardır.
 */

import type { MeasuredState } from "../ui";

/** Kısıt şeridindeki tek bir istasyon. */
export interface RailStation {
  id: string;
  label: string;
  /**
   * Segmentin genişliğini belirleyen ölçülmüş oran (0–1).
   *
   * Kaynağı istasyonun **doluluğudur** (`utilization`). MASTER §15.3 bu alanı
   * "kapasite payı" diye anar, ama simülasyon çıktısı istasyon başına kapasite
   * payı üretmez; ürettiği şey doluluktur. Uydurulmuş bir pay yerine ölçülmüş
   * doluluk kullanılır ve adı burada açıkça yazılır — geometri yine gerçek bir
   * ölçümü taşır ve en geniş segment kısıttır.
   */
  share: number;
  /** Ekranda yazılan okuma değeri. */
  value: string;
  state: MeasuredState;
  isConstraint: boolean;
}

/** Ekranı açan durum tespiti. */
export interface FactoryStatement {
  /** Ana cümle. */
  headline: string;
  /** Cümleyi destekleyen tek satır; ölçülemiyorsa `null`. */
  detail: string | null;
  /** Kısıt bulunamadıysa kullanıcıyı bir sonraki adıma götüren eylem. */
  action: { label: string; target: "simulation" } | null;
}

/** Koşumun kökeni ve güvenilirliği — "bu sayı nereden geldi?" */
export interface RunProvenance {
  /** Veri gerçek cihazdan mı, üretilmiş bir koşumdan mı. */
  origin: "simulated" | "unverified";
  /** İnsan okuyacak kaynak açıklaması. */
  source: string;
  /** Kaç tekrar koşuldu; bilinmiyorsa `null`. */
  replications: number | null;
  /** %95 güven aralığı metni; hesaplanamıyorsa `null`. */
  interval: string | null;
}
