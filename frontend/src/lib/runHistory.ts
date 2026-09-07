/**
 * "Son Simülasyonlar" — çalıştırılan koşumların özet geçmişi.
 *
 * Neden tarayıcıda tutuluyor
 * --------------------------
 * Koşumların kendisi **sunucuda saklanıyor** (`simulations` tablosu; kimlik,
 * zaman damgası, organizasyon ve fabrika sürümüyle birlikte). Ancak bu sprint
 * kapsamında backend'e dokunulamıyor ve mevcut API'de koşumları **listeleyen
 * bir uç yok** — yalnızca kimliğini bildiğiniz tek bir koşumu okuyabiliyorsunuz
 * (`/validation-report`, `/trace`).
 *
 * Bu yüzden liste, kullanıcının bu tarayıcıda gerçekten çalıştırdığı
 * koşumların özetinden kurulur. Rakamlar uydurulmuş değildir: her satır, o
 * koşumun dönen sonucundan alınmıştır. Ama kapsamı sınırlıdır ve arayüz bunu
 * açıkça söyler — başka bir cihazda alınmış koşumlar burada görünmez.
 *
 * Kalıcı çözüm bir uç eklemektir (`GET /api/simulations`, org'a göre
 * filtrelenmiş); o geldiğinde bu modülün yerini doğrudan bir API çağrısı alır
 * ve bileşen arayüzü değişmeden kalır.
 *
 * `factoryModel.ts` ile aynı deseni izler: `localStorage` erişimi her zaman
 * `try/catch` içindedir, çünkü gizli sekmede ve depolama kapalıyken yazma hata
 * verir ve bir kolaylık özelliği uygulamayı durdurmamalıdır.
 */

import type {
  SimulationConfig,
  SimulationRunResponse,
} from "../types/simulationTypes";

const STORAGE_KEY = "optiflow.runHistory";

/** Saklanacak en fazla koşum. */
export const MAX_RUN_HISTORY = 8;

export interface RunHistoryEntry {
  simulationId: string;
  /**
   * Koşumun alındığı fabrikanın kimliği.
   *
   * İsteğe bağlıdır çünkü bu alan eklenmeden önce yazılmış kayıtlar onsuzdur;
   * zorunlu kılınsaydı eski geçmiş doğrulamadan geçemez ve sessizce silinirdi.
   */
  factoryId?: string | null;
  /** Koşum bir fabrikadan alındıysa onun adı; değilse `null`. */
  factoryName: string | null;
  /** ISO 8601 zaman damgası. */
  ranAt: string;
  throughput: number;
  oee: number;
  bottleneckName: string | null;
  isStable: boolean;
  stationCount: number;
  durationSeconds: number;
}

/**
 * Bir koşum yanıtından geçmiş kaydı üretir.
 *
 * Saf bir dönüşümdür: yalnızca yanıtta ve modelde zaten var olan alanları
 * kopyalar, hiçbir şey hesaplamaz.
 */
export function entryFromResult(
  result: SimulationRunResponse,
  config: SimulationConfig,
  factory: { id: string; name: string } | null,
  now: Date = new Date(),
): RunHistoryEntry {
  const bottleneck = result.results.station_metrics.find(
    (station) => station.station_id === result.results.bottleneck_station_id,
  );

  return {
    simulationId: result.simulation_id,
    factoryId: factory?.id ?? null,
    factoryName: factory?.name ?? null,
    ranAt: now.toISOString(),
    throughput: result.results.total_throughput,
    oee: result.results.line_oee,
    bottleneckName: bottleneck?.station_name ?? null,
    isStable: result.results.is_stable,
    stationCount: config.stations.length,
    durationSeconds: result.duration_seconds,
  };
}

/**
 * Yeni kaydı listenin başına ekler.
 *
 * Aynı koşum kimliği ikinci kez eklenirse eskisi düşer: kullanıcı sonuç
 * ekranından çıkıp geri döndüğünde aynı koşumun iki kez listelenmesi, geçmişi
 * okunamaz hâle getirirdi.
 */
export function addEntry(
  entries: RunHistoryEntry[],
  entry: RunHistoryEntry,
  max: number = MAX_RUN_HISTORY,
): RunHistoryEntry[] {
  const withoutDuplicate = entries.filter(
    (item) => item.simulationId !== entry.simulationId,
  );
  return [entry, ...withoutDuplicate].slice(0, Math.max(0, max));
}

/**
 * Depodan okunan ham veriyi doğrular.
 *
 * `localStorage` içeriği güvenilmez bir kaynaktır: elle düzenlenmiş,
 * yarım yazılmış ya da eski bir sürümden kalmış olabilir. Doğrulanmadan
 * kullanılsaydı, tek bozuk bir kayıt tüm gösterge panelini çökertirdi.
 */
export function isValidEntry(value: unknown): value is RunHistoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.simulationId === "string" &&
    item.simulationId.length > 0 &&
    typeof item.ranAt === "string" &&
    typeof item.throughput === "number" &&
    Number.isFinite(item.throughput) &&
    typeof item.oee === "number" &&
    Number.isFinite(item.oee) &&
    typeof item.isStable === "boolean" &&
    typeof item.stationCount === "number" &&
    typeof item.durationSeconds === "number" &&
    (item.factoryName === null || typeof item.factoryName === "string") &&
    (item.factoryId === undefined ||
      item.factoryId === null ||
      typeof item.factoryId === "string") &&
    (item.bottleneckName === null || typeof item.bottleneckName === "string")
  );
}

/** Ham JSON metnini geçerli kayıtlara çevirir; bozuk olanları atar. */
export function parseHistory(raw: string | null): RunHistoryEntry[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidEntry).slice(0, MAX_RUN_HISTORY);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Depo erişimi                                                                */
/* -------------------------------------------------------------------------- */

export function recallRunHistory(): RunHistoryEntry[] {
  try {
    return parseHistory(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Kaydı ekler ve güncellenmiş listeyi döndürür. */
export function rememberRun(entry: RunHistoryEntry): RunHistoryEntry[] {
  const next = addEntry(recallRunHistory(), entry);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Yazma başarısız olsa bile güncel liste döndürülür: ekran doğru görünür,
    // yalnızca sayfa yenilendiğinde kayıt kalıcı olmaz.
  }
  return next;
}

export function clearRunHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Yoksayılır; temizleme bir kolaylıktır.
  }
}

/**
 * "3 dakika önce" gibi göreli zaman.
 *
 * Mutlak tarih yerine göreli süre kullanılır: son koşumlar listesinde önemli
 * olan "ne zaman" değil, "ne kadar önce" bilgisidir. Bir günü aşan kayıtlar
 * tarihe döner — "37 saat önce" okunabilir bir ifade değildir.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return "—";
  }
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) {
    return "az önce";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} saat önce`;
  }
  return then.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}
