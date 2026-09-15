/**
 * Verinin kökeni ve nasıl sunulacağı (Sprint 1A).
 *
 * Bu dosya KURAL 1'in kodda karşılığıdır: gerçek bir cihazdan gelmeyen veri
 * gerçek gibi gösterilmez. Rozet üç şeyi birden söyler — kısa etiket, renk ve
 * ekran okuyucuya açıklama — çünkü durum asla yalnızca renkle taşınmaz
 * (MASTER §22).
 */

import type { DataOrigin, MeasuredState } from "./types";

/** Bir kökenin ekrandaki karşılığı. */
export interface OriginPresentation {
  /** Rozetin üstündeki kısa etiket. */
  label: string;
  /** Ekran okuyucuya ve ipucu metnine giden tam açıklama. */
  description: string;
  /** Rozetin rengini belirleyen ölçüm durumu. */
  state: MeasuredState;
}

const PRESENTATION: Record<DataOrigin, OriginPresentation> = {
  /* Gerçek bir uçtan ya da cihazdan doğrulanmış veri. Yalnızca doğrulama
     yapıldıysa bu köken verilir. */
  live: {
    label: "Canlı",
    description: "Veri gerçek bir cihazdan geliyor ve bağlantı doğrulandı.",
    state: "ok",
  },
  /* Üretilmiş senaryo. Hata değildir ama gerçek sanılmamalıdır; bu yüzden
     nötr değil, dikkat çeken bir ton taşır. */
  simulated: {
    label: "Benzetim",
    description:
      "Veri üretilmiş bir senaryodan geliyor; gerçek bir cihazdan değil.",
    state: "warn",
  },
  /* Henüz denenmemiş bağlantı. Kırmızı DEĞİLDİR: kırmızı "denedik, olmadı"
     demektir. Denenmemiş bir bağlantıyı arıza gibi göstermek yanlış bilgidir. */
  unverified: {
    label: "Doğrulanmadı",
    description: "Bağlantı henüz denenmedi; verinin kaynağı bilinmiyor.",
    state: "unknown",
  },
};

/** Kökenin etiketini, açıklamasını ve durumunu verir. */
export function originPresentation(origin: DataOrigin): OriginPresentation {
  return PRESENTATION[origin];
}

/**
 * Bu köken gerçek, doğrulanmış veri mi?
 *
 * Çağıranlar "bağlandı" ya da "veri geliyor" cümlesini yalnızca bu işlev
 * `true` döndüğünde kurabilir.
 */
export function isVerifiedLive(origin: DataOrigin): boolean {
  return origin === "live";
}
