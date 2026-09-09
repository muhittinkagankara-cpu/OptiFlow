/**
 * Doğrulama geçmişi — bir fabrikanın ölçümlerinin zaman içindeki seyri.
 *
 * Tek bir doğrulama "model %94 tutuyor" der; üç doğrulama "model her ölçümde
 * biraz daha iyi tutuyor" der. İkincisi satış konuşmasında da mühendislikte de
 * daha güçlü bir iddiadır, çünkü tek seferlik bir uyumun tesadüf olmadığını
 * gösterir.
 *
 * Kayıtlar `runHistory.ts` ile aynı deseni izler ve **tarayıcıda** durur:
 * backend'e bu sprintte dokunulmuyor ve mevcut API'de bir doğrulama ölçümünü
 * saklayacak uç yok. Sunucuya taşındığında değişecek tek yer bu dosyadaki iki
 * fonksiyondur; ekranlar aynı kalır. Kapsamın sınırı arayüzde açıkça yazar —
 * başka bir cihazda alınmış ölçüm burada görünmez.
 */

import type {
  AccuracyTrend,
  ConfidenceLevel,
  ConfidenceScore,
  ValidationSnapshot,
  ValidationSummary,
} from "./types";

const STORAGE_KEY = "optiflow.validationTimeline";

/** Saklanacak en fazla ölçüm. */
export const MAX_SNAPSHOTS = 12;

/**
 * İki ölçüm arasındaki bu farkın altındaki değişim "yatay" sayılır.
 *
 * Bir puanlık oynama ölçüm gürültüsüdür; onu "iyileşme" diye göstermek,
 * kullanıcıyı olmayan bir ilerlemeye inandırırdı.
 */
export const FLAT_MARGIN = 0.01;

/** Özet ve güven skorundan saklanabilir bir kayıt üretir. */
export function snapshotFrom(
  summary: ValidationSummary,
  confidence: ConfidenceScore,
  meta: {
    id: string;
    factoryId: string | null;
    factoryName: string | null;
    measuredAt: Date;
  },
): ValidationSnapshot {
  return {
    id: meta.id,
    factoryId: meta.factoryId,
    factoryName: meta.factoryName,
    measuredAt: meta.measuredAt.toISOString(),
    overallAccuracy: summary.overallAccuracy,
    confidenceScore: confidence.score,
    confidenceLevel: confidence.level,
    measuredStationCount: summary.measuredStationCount,
    stationCount: summary.stationCount,
  };
}

/**
 * Kaydı listeye ekler.
 *
 * Liste **eskiden yeniye** sıralı tutulur: bir zaman çizelgesi soldan sağa
 * okunur ve grafiğin veri sırası ekrandaki sırayla aynı olmalıdır. Sınır
 * aşıldığında en eski kayıt düşer.
 */
export function appendSnapshot(
  history: ValidationSnapshot[],
  snapshot: ValidationSnapshot,
  limit: number = MAX_SNAPSHOTS,
): ValidationSnapshot[] {
  const next = [...history.filter((item) => item.id !== snapshot.id), snapshot];
  next.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  return next.slice(Math.max(next.length - limit, 0));
}

/** Bir fabrikanın kayıtları; fabrika yoksa kaydedilmemiş modelin kayıtları. */
export function forFactory(
  history: ValidationSnapshot[],
  factoryId: string | null,
): ValidationSnapshot[] {
  return history.filter((item) => item.factoryId === factoryId);
}

/**
 * Doğruluğun yönü.
 *
 * Yalnızca doğruluğu hesaplanmış kayıtlar sayılır; ölçümü olmayan bir kayıt
 * trendi kıramaz. Tek kayıt varsa yön "bilinmiyor"dur — bir noktadan eğri
 * geçirilemez.
 */
export function accuracyTrend(history: ValidationSnapshot[]): AccuracyTrend {
  const measured = history.filter(
    (item): item is ValidationSnapshot & { overallAccuracy: number } =>
      item.overallAccuracy !== null,
  );

  if (measured.length === 0) {
    return { direction: "unknown", delta: null, first: null, last: null };
  }

  const first = measured[0];
  const last = measured[measured.length - 1];

  if (measured.length === 1) {
    return { direction: "unknown", delta: null, first, last };
  }

  const previous = measured[measured.length - 2];
  const delta = last.overallAccuracy - previous.overallAccuracy;

  return {
    direction:
      Math.abs(delta) < FLAT_MARGIN ? "flat" : delta > 0 ? "up" : "down",
    delta,
    first,
    last,
  };
}

/* -------------------------------------------------------------------------- */
/* Saklama                                                                     */
/* -------------------------------------------------------------------------- */

export function isValidSnapshot(value: unknown): value is ValidationSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.measuredAt === "string" &&
    (item.factoryId === null || typeof item.factoryId === "string") &&
    (item.factoryName === null || typeof item.factoryName === "string") &&
    (item.overallAccuracy === null ||
      typeof item.overallAccuracy === "number") &&
    (item.confidenceScore === null ||
      typeof item.confidenceScore === "number") &&
    (item.confidenceLevel === null ||
      isLevel(item.confidenceLevel)) &&
    typeof item.measuredStationCount === "number" &&
    typeof item.stationCount === "number"
  );
}

function isLevel(value: unknown): value is ConfidenceLevel {
  return value === "high" || value === "medium" || value === "low";
}

/**
 * Ham metni kayıtlara çevirir.
 *
 * Tanınmayan kayıtlar sessizce atılır: eski bir sürümden kalmış bozuk tek bir
 * satır yüzünden tüm geçmişi silmek, kullanıcının aylardır biriktirdiği
 * ölçümleri kaybettirirdi.
 */
export function parseTimeline(raw: string | null): ValidationSnapshot[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isValidSnapshot)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
      .slice(-MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function recallTimeline(): ValidationSnapshot[] {
  try {
    return parseTimeline(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Gizli sekmede ve depolama kapalıyken okuma hata verir; geçmişin
    // okunamaması uygulamayı durdurmamalıdır.
    return [];
  }
}

export function rememberTimeline(history: ValidationSnapshot[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* Depolama yoksa geçmiş yalnızca bu oturumda yaşar. */
  }
}

export function clearTimeline(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* yok sayılır */
  }
}
