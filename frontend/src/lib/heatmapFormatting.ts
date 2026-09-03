/**
 * Isı haritasının sunum yardımcıları.
 *
 * Burada **hiçbir hesap yapılmaz**. Skor, renk bandı ve bileşen dökümü
 * backend'den hazır gelir; bu dosyanın tek işi bandı bir CSS sınıfına, bir
 * etikete ve bir animasyon kararına çevirmektir. Eşikler (0–25, 25–50, …)
 * bilinçli olarak burada **yoktur**: iki yerde tanımlansalardı biri
 * değiştiğinde diğeri sessizce eskir ve aynı skor iki ekranda iki farklı renk
 * alırdı.
 *
 * Tüm işlevler saftır: aynı girdi her zaman aynı çıktıyı verir, yan etkisi
 * yoktur, DOM'a dokunmaz. Bu sayede React olmadan test edilebilirler.
 */

import type { HeatBand, StationHeat } from "../types/simulationTypes";

/** Bandın kutu dolgusu ve kenarlığı. */
const BAND_SURFACE: Record<HeatBand, string> = {
  green: "bg-emerald-50 border-emerald-300",
  yellow: "bg-amber-50 border-amber-300",
  orange: "bg-orange-100 border-orange-400",
  red: "bg-red-100 border-red-500",
};

/** Bandın metin rengi. */
const BAND_TEXT: Record<HeatBand, string> = {
  green: "text-emerald-800",
  yellow: "text-amber-900",
  orange: "text-orange-900",
  red: "text-red-900",
};

/** Bandın gösterge noktası / lejant kutusu rengi. */
const BAND_DOT: Record<HeatBand, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-600",
};

/**
 * Banda karşılık gelen sözcük.
 *
 * Renk tek başına bilgi taşımaz: renk körü bir kullanıcı için kırmızı ile
 * yeşil ayırt edilemez. Her kutuda rengin yanında bu yazı da bulunur.
 */
const BAND_LABEL: Record<HeatBand, string> = {
  green: "Düşük",
  yellow: "Orta",
  orange: "Yüksek",
  red: "Kritik",
};

export function bandSurface(band: HeatBand): string {
  return BAND_SURFACE[band];
}

export function bandText(band: HeatBand): string {
  return BAND_TEXT[band];
}

export function bandDot(band: HeatBand): string {
  return BAND_DOT[band];
}

export function bandLabel(band: HeatBand): string {
  return BAND_LABEL[band];
}

/**
 * Bu istasyon nabız gibi atmalı mı?
 *
 * Yalnızca kritik (kırmızı) istasyonlar atar. Hepsi atsaydı hareket bir sinyal
 * olmaktan çıkar, ekran gürültüye dönüşürdü.
 *
 * `prefers-reduced-motion` ayrıca gözetilir — o kullanıcılar için animasyon
 * CSS düzeyinde kapatılır (bkz. `index.css`), burada yalnızca hangi kutunun
 * aday olduğu belirlenir.
 */
export function shouldPulse(band: HeatBand): boolean {
  return band === "red";
}

/** Skoru tam sayı olarak yazar. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) {
    return "—";
  }
  return String(Math.round(score));
}

/**
 * Bir bileşenin ham değerini okunabilir biçime çevirir.
 *
 * Kayıp bileşeni para, diğerleri orandır; ikisi aynı biçimde yazılamaz.
 */
export function formatComponentValue(name: string, rawValue: number): string {
  if (!Number.isFinite(rawValue)) {
    return "—";
  }
  if (name === "loss") {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(
      rawValue,
    );
  }
  return `%${Math.round(rawValue * 100)}`;
}

/**
 * Skorun neden bu değerde olduğunu tek cümlede özetler.
 *
 * En çok katkı yapan bileşen seçilir; ipucu balonu açılmadan da kutunun
 * hikâyesi okunabilsin diye.
 */
export function dominantComponentLabel(heat: StationHeat): string | null {
  if (heat.components.length === 0) {
    return null;
  }
  const dominant = heat.components.reduce((best, item) =>
    item.contribution > best.contribution ? item : best,
  );
  return dominant.contribution > 0 ? dominant.label : null;
}

/**
 * Isı haritasında gösterilecek istasyonu kimliğe göre bulur.
 *
 * Bulunamazsa `null` döner: React Flow düğümleri ile ısı listesi ayrı
 * kaynaklardan geldiği için (biri modelden, diğeri koşumdan) eşleşmeyen bir
 * düğüm olabilir ve bu bir çökme sebebi olmamalıdır.
 */
export function heatById(
  heat: StationHeat[],
  stationId: string,
): StationHeat | null {
  return heat.find((item) => item.station_id === stationId) ?? null;
}
