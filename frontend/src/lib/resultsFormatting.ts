/**
 * Sonuç ekranının yorumlama mantığı.
 *
 * Renk eşikleri, uyarı sınıflandırması ve "iyileşme mi kötüleşme mi" kararı
 * bileşenlerin içinde değil burada tutulur. Nedeni, bu kararların **sessizce
 * yanlış olabilmesidir**: akış süresindeki bir düşüşü "kötüleşme" diye
 * göstermek ya da istatistiksel olarak anlamsız bir farkı "iyileşme" diye
 * sunmak, kullanıcıyı yanlış yatırım kararına götürür. Saf fonksiyon olarak
 * ayrılınca hepsi birim testiyle doğrulanabilir.
 */

import type { PairwiseDifference } from "../types/simulationTypes";

// --------------------------------------------------------------------------- //
// Renk paleti — şartnamede belirtilen değerler
// --------------------------------------------------------------------------- //

export const CHART_COLORS = {
  /** Darboğaz istasyonu. */
  bottleneck: "#DC2626",
  /** Normal istasyon. */
  station: "#1E2761",
  /** İstatistiksel olarak anlamlı iyileşme. */
  improvement: "#16A34A",
  /** İstatistiksel olarak anlamlı kötüleşme. */
  regression: "#DC2626",
  /** Anlamsız fark. */
  neutral: "#9CA3AF",
} as const;

// --------------------------------------------------------------------------- //
// Eşikler
// --------------------------------------------------------------------------- //

/** OEE için renk eşikleri (şartname: >%70 yeşil, %50-70 sarı, <%50 kırmızı). */
export const OEE_GOOD_THRESHOLD = 0.7;
export const OEE_WARNING_THRESHOLD = 0.5;

/** Kullanım oranı bu değerin üzerindeyse istasyon "yoğun" sayılır. */
export const BUSY_UTILIZATION_THRESHOLD = 0.8;

export type Tone = "good" | "warning" | "bad" | "neutral";

/**
 * OEE değerini renk tonuna çevirir.
 *
 * Eşikler kapsayıcı üst sınırla değil, kesin karşılaştırmayla uygulanır:
 * tam %70 "iyi" değil "orta" sayılır — dünya standardı hedefinin (%85) hayli
 * altındaki bir değeri yeşil göstermek yanıltıcı olurdu.
 */
export function oeeTone(value: number): Tone {
  if (!Number.isFinite(value)) {
    return "neutral";
  }
  if (value > OEE_GOOD_THRESHOLD) {
    return "good";
  }
  if (value >= OEE_WARNING_THRESHOLD) {
    return "warning";
  }
  return "bad";
}

/**
 * Kullanım oranını renk tonuna çevirir.
 *
 * Dikkat: burada yüksek değer "iyi" değildir. Yüksek kullanım oranı, kuyruğun
 * küçük dalgalanmalara aşırı duyarlı hâle geldiği anlamına gelir; bu yüzden
 * yüksek doluluk uyarı rengiyle gösterilir.
 */
export function utilizationTone(value: number, isBottleneck: boolean): Tone {
  if (isBottleneck) {
    return "bad";
  }
  if (!Number.isFinite(value)) {
    return "neutral";
  }
  return value >= BUSY_UTILIZATION_THRESHOLD ? "warning" : "good";
}

// --------------------------------------------------------------------------- //
// Uyarı sınıflandırması
// --------------------------------------------------------------------------- //

export type WarningKind = "unstable" | "capacity_limited" | "precision" | "other";

export interface ClassifiedWarning {
  kind: WarningKind;
  title: string;
  message: string;
  tone: "bad" | "warning" | "neutral";
}

/**
 * Backend uyarısını türüne göre sınıflandırır.
 *
 * "Kararsız" ile "kapasite sınırlı" ayrımı kritik ve bilinçlidir. İkisinde de
 * bir istasyonun yükü kapasitesini aşar, ama sonuçları taban tabana zıttır:
 *
 * - **Kararsız:** tampon sınırsız olduğu için kuyruk sonsuza kadar büyür.
 *   Ölçülen ortalamalar hiçbir değere yakınsamaz; sonuçlar yorumlanamaz.
 * - **Kapasite sınırlı:** tampon sonlu olduğu için kuyruk büyüyemez. Sistem
 *   kararlıdır ve sonuçlar geçerlidir; bedeli, gelen parçaların bir kısmının
 *   sisteme hiç alınamamasıdır.
 *
 * Bu ikisini aynı görünümde sunmak, tamamen geçerli bir sonucu "güvenilmez"
 * göstermek ya da tam tersine anlamsız sayıları güvenilir sanmak demektir.
 */
export function classifyWarning(raw: string): ClassifiedWarning {
  if (/kapasite sinirli/i.test(raw)) {
    const percentMatch = raw.match(/yaklasik %([\d.,]+)'i sisteme alinamayacak/i);
    const percent = percentMatch?.[1];
    return {
      kind: "capacity_limited",
      title: "Sistem kararlı, ancak parça kaybı var",
      message: percent
        ? `Bir istasyonun bekleme alanı dolduğu için gelen parçaların yaklaşık %${percent}'i hatta hiç alınamıyor. Sonuçlar geçerlidir; çıktıyı artırmak için o istasyonun kapasitesini yükseltmeniz gerekir.`
        : "Bir istasyonun bekleme alanı dolduğu için gelen parçaların bir kısmı hatta hiç alınamıyor. Sonuçlar geçerlidir; çıktıyı artırmak için o istasyonun kapasitesini yükseltmeniz gerekir.",
      tone: "warning",
    };
  }

  if (/kararsiz sistem/i.test(raw)) {
    return {
      kind: "unstable",
      title: "Kuyruk sınırsız büyüyecek",
      message:
        "Bir istasyon kendisine gelen işi yetiştiremiyor ve önündeki bekleme alanı sınırsız. Kuyruk sürekli büyüdüğü için aşağıdaki ortalamalar kararlı bir değere ulaşmaz — bu sonuçlara dayanarak karar vermeyin. O istasyona makine ekleyin, işlem süresini kısaltın ya da parça giriş sıklığını azaltın.",
      tone: "bad",
    };
  }

  if (/yalnizca \d+ replikasyon|bagil kesinligi/i.test(raw)) {
    return {
      kind: "precision",
      title: "Tahmin aralığı geniş",
      message:
        "Sonuç güvenilir ama kesinliği sınırlı. Daha dar bir aralık için “Detaylı” simülasyon seçeneğiyle tekrar çalıştırın.",
      tone: "neutral",
    };
  }

  return {
    kind: "other",
    title: "Dikkat edilmesi gereken bir durum",
    message: raw,
    tone: "warning",
  };
}

// --------------------------------------------------------------------------- //
// Senaryo karşılaştırması
// --------------------------------------------------------------------------- //

export type DifferenceVerdict = "improvement" | "regression" | "insignificant";

/**
 * Bir metrikte artışın mı azalışın mı iyi olduğunu söyler.
 *
 * Üretim için yüksek iyidir; akış süresi ve yarı mamul stoğu için düşük iyidir.
 * Bu eşleme yanlış olursa arayüz, akış süresindeki bir düşüşü "kötüleşme"
 * olarak gösterir — yani kullanıcıyı doğru iyileştirmeden vazgeçirir.
 */
export function higherIsBetter(metric: string): boolean {
  return metric === "units_produced";
}

/**
 * Farkın kullanıcıya nasıl sunulacağına karar verir.
 *
 * İstatistiksel anlamlılık her zaman önce gelir: anlamsız bir fark, yönü ne
 * olursa olsun "fark yok" olarak sunulur. Aksi hâlde kullanıcı rastgeleliği
 * iyileşme sanıp gerçekte hiçbir şey değiştirmeyen bir yatırıma girişebilir.
 */
export function differenceVerdict(difference: PairwiseDifference): DifferenceVerdict {
  if (!difference.is_significant) {
    return "insignificant";
  }
  const better = higherIsBetter(difference.metric)
    ? difference.difference > 0
    : difference.difference < 0;
  return better ? "improvement" : "regression";
}

/** Karara karşılık gelen kullanıcı metni. */
export function verdictLabel(verdict: DifferenceVerdict): string {
  switch (verdict) {
    case "improvement":
      return "İyileşme";
    case "regression":
      return "Kötüleşme";
    default:
      return "Fark yok";
  }
}

/**
 * Karşılaştırma metriklerinin kullanıcıya görünen adları.
 *
 * Backend her farka bir `label` alanı ekler, ancak bu alan sunucu tarafının
 * aksansız ve teknik yazımını taşır ("Ortalama akis suresi (W)"). Arayüz bu
 * metni doğrudan göstermemelidir; kullanıcı "W" veya "L" gibi kuyruk teorisi
 * simgelerini bilmek zorunda değildir.
 */
export const METRIC_LABELS: Record<string, string> = {
  units_produced: "Toplam üretim",
  avg_flow_time: "Ortalama akış süresi",
  avg_wip: "Hattaki ortalama iş",
};

/** Grafikte kullanılan kısa adlar. */
export const METRIC_SHORT_LABELS: Record<string, string> = {
  units_produced: "Üretim",
  avg_flow_time: "Akış süresi",
  avg_wip: "Hattaki iş",
};

/** Metriğin adını verir; tanınmayan metrikte backend etiketine düşer. */
export function metricLabel(metric: string, fallback: string): string {
  return METRIC_LABELS[metric] ?? fallback;
}

/** Metriğin kısa adını verir. */
export function metricShortLabel(metric: string, fallback: string): string {
  return METRIC_SHORT_LABELS[metric] ?? fallback;
}

/**
 * Bir metrik değerini kendi birimiyle biçimlendirir.
 *
 * Üretim tam sayı ve binlik ayraçlı, süre dakikalı, stok ondalıklı gösterilir.
 * Hepsini aynı biçimde yazmak, 4850 birimlik üretimi "4850.00" gibi gösterip
 * okumayı zorlaştırırdı.
 */
export function formatMetricValue(metric: string, value: number): string {
  switch (metric) {
    case "units_produced":
      return `${formatUnits(value)} birim`;
    case "avg_flow_time":
      return formatMinutes(value);
    default:
      return formatDecimal(value, 2);
  }
}

/** Karara karşılık gelen grafik/rozet rengi. */
export function verdictColor(verdict: DifferenceVerdict): string {
  switch (verdict) {
    case "improvement":
      return CHART_COLORS.improvement;
    case "regression":
      return CHART_COLORS.regression;
    default:
      return CHART_COLORS.neutral;
  }
}

// --------------------------------------------------------------------------- //
// Biçimlendirme
// --------------------------------------------------------------------------- //

/** Tam sayı birim (binlik ayraçlı). */
export function formatUnits(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("tr-TR") : "—";
}

/** Dakika cinsinden süre. */
export function formatMinutes(value: number, digits = 1): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)} dk` : "—";
}

/** 0-1 arası oranı yüzdeye çevirir. */
export function formatPercent(value: number, digits = 0): string {
  return Number.isFinite(value) ? `%${(value * 100).toFixed(digits)}` : "—";
}

/** Ondalıklı sayı (kuyruk uzunluğu gibi). */
export function formatDecimal(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/**
 * Analitik karşılaştırmanın neden yapılamadığını kullanıcı diline çevirir.
 *
 * Backend gerekçeyi teknik terimlerle verir ("islem suresi ustel degil",
 * "tampon sonlu (M/M/c/K)"). Kullanıcının bunları bilmesi beklenemez; asıl
 * mesaj, karşılaştırmanın yokluğunun bir **sorun olmadığıdır**.
 */
export function explainInapplicableComparison(reasons: string | string[]): string {
  const list = Array.isArray(reasons) ? reasons : [reasons];
  const combined = list.join(" | ");

  const causes: string[] = [];
  if (/ustel degil/i.test(combined)) {
    causes.push("işlem süreleri basit formülün varsaydığı biçimde dağılmıyor");
  }
  if (/ariza modeli var/i.test(combined)) {
    causes.push("arıza modeli tanımlı");
  }
  if (/tampon sonlu/i.test(combined)) {
    causes.push("bekleme alanı sınırlı");
  }
  if (/kararsiz/i.test(combined)) {
    causes.push("istasyon gelen işi yetiştiremiyor");
  }

  if (causes.length === 0) {
    return "Bu senaryo için basit formülle karşılaştırma yapılamıyor. Model yine de iç tutarlılık kontrollerinden geçti.";
  }

  const subject =
    list.length > 1 ? "İstasyonlarınız gerçekçi olduğu" : "Bu istasyon gerçekçi olduğu";
  return `${subject} için basit formülle karşılaştırılamıyor (${causes.join(", ")}). Bu bir sorun değildir — model iç tutarlılık kontrolleriyle doğrulanır.`;
}
